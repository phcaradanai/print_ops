package updater

import "time"

const (
	PhaseReceived           = "RECEIVED"
	PhaseVerifying          = "VERIFYING"
	PhaseWaitingForShutdown = "WAITING_FOR_SHUTDOWN"
	PhaseBackingUp          = "BACKING_UP"
	PhaseInstalling         = "INSTALLING"
	PhaseStarting           = "STARTING"
	PhaseHealthCheck        = "HEALTH_CHECK"
	PhaseCompleted          = "COMPLETED"
	PhaseRollingBack        = "ROLLING_BACK"
	PhaseRolledBack         = "ROLLED_BACK"
	PhaseFailed             = "FAILED"
	PhaseRollbackFailed     = "ROLLBACK_FAILED"
)

// Request is the narrow handoff contract from the API to the updater. It
// contains no manifest or networking policy: the API has already selected and
// verified the artifact before writing this file.
type Request struct {
	Mode              string `json:"mode"`
	OperationID       string `json:"operation_id"`
	ArtifactPath      string `json:"artifact_path"`
	ArtifactSHA256    string `json:"artifact_sha256"`
	ArtifactSignature string `json:"artifact_signature"`
	ArtifactFormat    string `json:"artifact_format"`
	RequireSignature  bool   `json:"require_signature"`
	PublicKey         string `json:"public_key"`
	Version           string `json:"version"`
	PreviousVersion   string `json:"previous_version"`
	InstallRoot       string `json:"install_root"`
	DesktopPath       string `json:"desktop_path"`
	DesktopPID        int    `json:"desktop_pid"`
	APIURL            string `json:"api_url"`
	HealthToken       string `json:"health_token"`
	StatePath         string `json:"state_path"`
	HealthTimeoutMs   int    `json:"health_check_timeout_ms"`
	ShutdownTimeoutMs int    `json:"shutdown_timeout_ms"`
	HandoffDelayMs    int    `json:"handoff_delay_ms"`
}

// State is deliberately written before every irreversible lifecycle step.
// Request is embedded so a restart can recover without relying on the old API
// process or an in-memory staged-artifact descriptor.
type State struct {
	OperationID string    `json:"operation_id"`
	Version     string    `json:"version"`
	Phase       string    `json:"phase"`
	BackupPath  string    `json:"backup_path,omitempty"`
	StartedAt   time.Time `json:"started_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	Error       string    `json:"error,omitempty"`
	Request     Request   `json:"request"`
}

type Runtime interface {
	ProcessPath(pid int) (string, error)
	StopProcessTree(pid int, timeout time.Duration) error
	KillProcessTree(pid int, timeout time.Duration) error
	StartDesktop(path, workingDirectory string) (int, error)
	RunInstaller(path, installRoot string) error
}

type HealthProbe interface {
	Wait(apiURL, token, expectedVersion string, timeout time.Duration) error
}

type Updater struct {
	Runtime Runtime
	Probe   HealthProbe
	Now     func() time.Time
	// Report is injectable for lifecycle tests; production uses the local API
	// recovery endpoint implemented in updater.go.
	Report func(Request, string, string) error
}
