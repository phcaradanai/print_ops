package updater

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type fakeRuntime struct {
	installError error
	startError   error
	install      func(string) error
	started      int
	killed       int
}

func (f *fakeRuntime) ProcessPath(int) (string, error) { return "", errors.New("not running") }

func (f *fakeRuntime) StopProcessTree(int, time.Duration) error { return nil }

func (f *fakeRuntime) KillProcessTree(int, time.Duration) error {
	f.killed++
	return nil
}

func (f *fakeRuntime) StartDesktop(string, string) (int, error) {
	if f.startError != nil {
		return 0, f.startError
	}
	f.started++
	return 100 + f.started, nil
}

func (f *fakeRuntime) RunInstaller(path, installRoot string) error {
	if f.installError != nil {
		return f.installError
	}
	if f.install != nil {
		return f.install(installRoot)
	}
	return nil
}

type fakeProbe struct {
	calls int
	errOn map[int]error
}

func (f *fakeProbe) Wait(string, string, string, time.Duration) error {
	f.calls++
	return f.errOn[f.calls]
}

func newRequest(t *testing.T) (Request, string, string) {
	t.Helper()
	directory := t.TempDir()
	installRoot := filepath.Join(directory, "install")
	if err := os.MkdirAll(installRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installRoot, "version.txt"), []byte("A"), 0o644); err != nil {
		t.Fatal(err)
	}
	artifactPath := filepath.Join(directory, "release.exe")
	artifact := []byte("verified-release")
	if err := os.WriteFile(artifactPath, artifact, 0o644); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(artifact)
	statePath := filepath.Join(directory, "ota", "updater-state.json")
	return Request{
		Mode:              "apply",
		OperationID:       "op-1",
		ArtifactPath:      artifactPath,
		ArtifactSHA256:    hex.EncodeToString(digest[:]),
		ArtifactFormat:    "nsis-installer",
		Version:           "0.1.29",
		PreviousVersion:   "0.1.28",
		InstallRoot:       installRoot,
		DesktopPath:       filepath.Join(installRoot, "printerops-desktop.exe"),
		APIURL:            "http://127.0.0.1:31415",
		HealthToken:       "local-token",
		StatePath:         statePath,
		HealthTimeoutMs:   100,
		ShutdownTimeoutMs: 100,
		HandoffDelayMs:    0,
	}, directory, installRoot
}

func noNetworkReport(Request, string, string) error { return nil }

func readState(t *testing.T, path string) State {
	t.Helper()
	var state State
	if err := readJSON(path, &state); err != nil {
		t.Fatal(err)
	}
	return state
}

func TestApplyUpdatesAtomicallyAndKeepsBackup(t *testing.T) {
	request, _, installRoot := newRequest(t)
	runtime := &fakeRuntime{
		install: func(root string) error {
			return os.WriteFile(filepath.Join(root, "version.txt"), []byte("B"), 0o644)
		},
	}
	probe := &fakeProbe{}
	worker := &Updater{Runtime: runtime, Probe: probe, Report: noNetworkReport}

	if err := worker.Apply(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	version, err := os.ReadFile(filepath.Join(installRoot, "version.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(version) != "B" {
		t.Fatalf("installed version = %q, want B", version)
	}
	state := readState(t, request.StatePath)
	if state.Phase != PhaseCompleted {
		t.Fatalf("phase = %q, want %q", state.Phase, PhaseCompleted)
	}
	if _, err := os.Stat(state.BackupPath); err != nil {
		t.Fatalf("working backup was not retained: %v", err)
	}
	if runtime.started != 1 || probe.calls != 1 {
		t.Fatalf("started=%d probeCalls=%d, want one each", runtime.started, probe.calls)
	}
}

func TestApplyHealthFailureRestoresPreviousVersion(t *testing.T) {
	request, _, installRoot := newRequest(t)
	runtime := &fakeRuntime{
		install: func(root string) error {
			return os.WriteFile(filepath.Join(root, "version.txt"), []byte("B"), 0o644)
		},
	}
	probe := &fakeProbe{errOn: map[int]error{1: errors.New("new version is unhealthy")}}
	worker := &Updater{Runtime: runtime, Probe: probe, Report: noNetworkReport}

	if err := worker.Apply(context.Background(), request); err == nil {
		t.Fatal("expected the update to report a rollback")
	}
	version, err := os.ReadFile(filepath.Join(installRoot, "version.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(version) != "A" {
		t.Fatalf("restored version = %q, want A", version)
	}
	if state := readState(t, request.StatePath); state.Phase != PhaseRolledBack {
		t.Fatalf("phase = %q, want %q", state.Phase, PhaseRolledBack)
	}
	if runtime.killed != 1 || probe.calls != 2 {
		t.Fatalf("killed=%d probeCalls=%d, want one kill and two probes", runtime.killed, probe.calls)
	}
}

func TestApplySchemaFailureRestoresDatabaseWithPreviousVersion(t *testing.T) {
	request, directory, installRoot := newRequest(t)
	databasePath := filepath.Join(directory, "data", "printops.db")
	if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(databasePath, []byte("schema-7:A"), 0o644); err != nil {
		t.Fatal(err)
	}
	request.DatabasePath = databasePath
	request.DatabaseSchemaVersion = 7
	request.TargetSchemaVersion = 8
	runtime := &fakeRuntime{
		install: func(root string) error {
			if err := os.WriteFile(filepath.Join(root, "version.txt"), []byte("B"), 0o644); err != nil {
				return err
			}
			return os.WriteFile(databasePath, []byte("schema-8:B"), 0o644)
		},
	}
	probe := &fakeProbe{errOn: map[int]error{1: errors.New("new schema is unhealthy")}}
	worker := &Updater{Runtime: runtime, Probe: probe, Report: noNetworkReport}

	if err := worker.Apply(context.Background(), request); err == nil {
		t.Fatal("expected the schema-changing update to roll back")
	}
	version, err := os.ReadFile(filepath.Join(installRoot, "version.txt"))
	if err != nil {
		t.Fatal(err)
	}
	database, err := os.ReadFile(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(version) != "A" || string(database) != "schema-7:A" {
		t.Fatalf("rollback restored version=%q database=%q, want A/schema-7:A", version, database)
	}
	state := readState(t, request.StatePath)
	if state.Phase != PhaseRolledBack || state.DatabaseBackupPath == "" {
		t.Fatalf("state = %+v, want rolled back with database backup metadata", state)
	}
}

func TestRecoverInterruptedUpdateFromPersistedBackup(t *testing.T) {
	request, directory, installRoot := newRequest(t)
	backup := filepath.Join(directory, "ota", "backups", request.OperationID)
	if err := createBackup(installRoot, backup); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installRoot, "version.txt"), []byte("partial"), 0o644); err != nil {
		t.Fatal(err)
	}
	state := State{
		OperationID: request.OperationID,
		Version:     request.Version,
		Phase:       PhaseInstalling,
		BackupPath:  backup,
		StartedAt:   time.Now().UTC(),
		Request:     request,
	}
	if err := writeJSONAtomic(request.StatePath, &state); err != nil {
		t.Fatal(err)
	}

	worker := &Updater{Runtime: &fakeRuntime{}, Probe: &fakeProbe{}, Report: noNetworkReport}
	if err := worker.Recover(context.Background(), request.StatePath, 0); err != nil {
		t.Fatal(err)
	}
	version, err := os.ReadFile(filepath.Join(installRoot, "version.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(version) != "A" {
		t.Fatalf("recovered version = %q, want A", version)
	}
	if state := readState(t, request.StatePath); state.Phase != PhaseRolledBack {
		t.Fatalf("phase = %q, want %q", state.Phase, PhaseRolledBack)
	}
}

func TestRecoverBeforeBackupRestartsPreviousVersion(t *testing.T) {
	request, directory, _ := newRequest(t)
	state := State{
		OperationID: request.OperationID,
		Version:     request.Version,
		Phase:       PhaseWaitingForShutdown,
		StartedAt:   time.Now().UTC(),
		Request:     request,
	}
	if err := writeJSONAtomic(filepath.Join(directory, "ota", "updater-state.json"), &state); err != nil {
		t.Fatal(err)
	}

	probe := &fakeProbe{}
	worker := &Updater{Runtime: &fakeRuntime{}, Probe: probe, Report: noNetworkReport}
	if err := worker.Recover(context.Background(), request.StatePath, 0); err != nil {
		t.Fatal(err)
	}
	if state := readState(t, request.StatePath); state.Phase != PhaseRolledBack {
		t.Fatalf("phase = %q, want %q", state.Phase, PhaseRolledBack)
	}
	if probe.calls != 1 {
		t.Fatalf("probe calls = %d, want 1", probe.calls)
	}
}

func TestVerifyArtifactRequiresEd25519WhenConfigured(t *testing.T) {
	request, _, _ := newRequest(t)
	publicKey, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	digest, err := hex.DecodeString(request.ArtifactSHA256)
	if err != nil {
		t.Fatal(err)
	}
	request.RequireSignature = true
	request.PublicKey = base64.StdEncoding.EncodeToString(publicKey)
	request.ArtifactSignature = base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, digest))
	if err := verifyArtifact(request); err != nil {
		t.Fatal(err)
	}
	request.ArtifactSignature = base64.StdEncoding.EncodeToString([]byte("bad"))
	if err := verifyArtifact(request); err == nil {
		t.Fatal("expected a bad signature to be rejected")
	}
}

func TestValidateRequestRejectsInstallTreeConfusion(t *testing.T) {
	request, _, _ := newRequest(t)
	request.StatePath = filepath.Join(request.InstallRoot, "ota-state.json")
	if err := validateRequest(request); err == nil {
		t.Fatal("expected state path inside install root to be rejected")
	}
}

func TestValidateRequestRejectsRemoteCallbackURL(t *testing.T) {
	request, _, _ := newRequest(t)
	request.APIURL = "https://updates.example.invalid/printops"
	if err := validateRequest(request); err == nil {
		t.Fatal("expected a remote callback URL to be rejected")
	}
}

func TestValidateRequestRejectsDowngrade(t *testing.T) {
	request, _, _ := newRequest(t)
	request.Version = "0.1.27"
	if err := validateRequest(request); err == nil {
		t.Fatal("expected a downgrade to be rejected by the native updater")
	}
}

func TestBackupFailureRestartsPreviousVersion(t *testing.T) {
	request, directory, _ := newRequest(t)
	request.InstallRoot = filepath.Join(directory, "install-file")
	if err := os.WriteFile(request.InstallRoot, []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	request.DesktopPath = filepath.Join(request.InstallRoot, "printerops-desktop.exe")
	runtime := &fakeRuntime{}
	probe := &fakeProbe{}
	worker := &Updater{Runtime: runtime, Probe: probe, Report: noNetworkReport}

	if err := worker.Apply(context.Background(), request); err == nil {
		t.Fatal("expected backup failure")
	}
	state := readState(t, request.StatePath)
	if state.Phase != PhaseRolledBack {
		t.Fatalf("phase = %q, want %q", state.Phase, PhaseRolledBack)
	}
	if runtime.started != 1 || probe.calls != 1 {
		t.Fatalf("started=%d probeCalls=%d, want one each", runtime.started, probe.calls)
	}
}
