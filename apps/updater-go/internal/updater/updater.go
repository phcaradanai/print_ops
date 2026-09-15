package updater

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (u *Updater) Apply(ctx context.Context, request Request) error {
	if err := validateRequest(request); err != nil {
		return err
	}
	if u.Runtime == nil {
		u.Runtime = NewDefaultRuntime()
	}
	if u.Probe == nil {
		u.Probe = HTTPHealthProbe{}
	}
	now := func() time.Time { return nowOrDefault(u.Now) }
	state := State{
		OperationID: request.OperationID,
		Version:     request.Version,
		Phase:       PhaseReceived,
		StartedAt:   now(),
		UpdatedAt:   now(),
		Request:     request,
	}
	if err := u.persist(request.StatePath, &state); err != nil {
		return fmt.Errorf("persist updater state: %w", err)
	}

	if request.HandoffDelayMs > 0 {
		if err := sleepContext(ctx, time.Duration(request.HandoffDelayMs)*time.Millisecond); err != nil {
			return u.fail(request, &state, PhaseFailed, err)
		}
	}
	if err := u.transition(request.StatePath, &state, PhaseVerifying, ""); err != nil {
		return err
	}
	if err := verifyArtifact(request); err != nil {
		return u.fail(request, &state, PhaseFailed, err)
	}

	if request.DesktopPID > 0 {
		if err := u.validateDesktopProcess(request); err != nil {
			return u.fail(request, &state, PhaseFailed, err)
		}
	}
	if err := u.transition(request.StatePath, &state, PhaseWaitingForShutdown, ""); err != nil {
		return err
	}
	if request.DesktopPID > 0 {
		if err := u.Runtime.StopProcessTree(request.DesktopPID, time.Duration(request.ShutdownTimeoutMs)*time.Millisecond); err != nil {
			return u.rollbackBeforeInstall(request, &state, err)
		}
	}

	state.BackupPath = filepath.Join(filepath.Dir(request.StatePath), "backups", request.OperationID)
	if withinRoot(state.BackupPath, request.InstallRoot) {
		return u.fail(request, &state, PhaseFailed, fmt.Errorf("computed backup path is inside install root"))
	}
	if request.TargetSchemaVersion > request.DatabaseSchemaVersion {
		state.DatabaseBackupPath = state.BackupPath + ".db"
		if withinRoot(state.DatabaseBackupPath, request.InstallRoot) {
			return u.fail(request, &state, PhaseFailed, fmt.Errorf("computed database backup path is inside install root"))
		}
	}
	if err := u.transition(request.StatePath, &state, PhaseBackingUp, ""); err != nil {
		return err
	}
	if err := createBackup(request.InstallRoot, state.BackupPath); err != nil {
		return u.rollbackBeforeInstall(request, &state, fmt.Errorf("backup install tree: %w", err))
	}
	if state.DatabaseBackupPath != "" {
		if err := createDatabaseBackup(request.DatabasePath, state.DatabaseBackupPath); err != nil {
			return u.rollbackBeforeInstall(request, &state, fmt.Errorf("backup database: %w", err))
		}
	}

	if err := u.transition(request.StatePath, &state, PhaseInstalling, ""); err != nil {
		return err
	}
	if err := u.Runtime.RunInstaller(request.ArtifactPath, request.InstallRoot); err != nil {
		return u.rollbackAfterFailure(ctx, request, &state, err)
	}
	if err := u.transition(request.StatePath, &state, PhaseStarting, ""); err != nil {
		return u.rollbackAfterFailure(ctx, request, &state, err)
	}
	newPID, err := u.Runtime.StartDesktop(request.DesktopPath, request.InstallRoot)
	if err != nil {
		return u.rollbackAfterFailure(ctx, request, &state, err)
	}
	if err := u.transition(request.StatePath, &state, PhaseHealthCheck, ""); err != nil {
		_ = u.Runtime.KillProcessTree(newPID, time.Duration(request.ShutdownTimeoutMs)*time.Millisecond)
		return u.rollbackAfterFailure(ctx, request, &state, err)
	}
	if err := u.Probe.Wait(request.APIURL, request.HealthToken, request.Version, time.Duration(request.HealthTimeoutMs)*time.Millisecond); err != nil {
		_ = u.Runtime.KillProcessTree(newPID, time.Duration(request.ShutdownTimeoutMs)*time.Millisecond)
		return u.rollbackAfterFailure(ctx, request, &state, err)
	}

	if err := u.transition(request.StatePath, &state, PhaseCompleted, ""); err != nil {
		return err
	}
	_ = u.report(request, "COMPLETED", "")
	return nil
}

func (u *Updater) Recover(ctx context.Context, statePath string, currentDesktopPID int) error {
	var state State
	if err := readJSON(statePath, &state); err != nil {
		return fmt.Errorf("read updater state: %w", err)
	}
	if state.Request.StatePath != "" && !samePath(state.Request.StatePath, statePath) {
		return fmt.Errorf("recovery state path does not match the requested state file")
	}
	if state.Phase == PhaseCompleted || state.Phase == PhaseRolledBack || state.Phase == PhaseRollbackFailed {
		return nil
	}
	if err := validateRecoveryRequest(state.Request, state.BackupPath, state.DatabaseBackupPath); err != nil {
		return err
	}
	if u.Runtime == nil {
		u.Runtime = NewDefaultRuntime()
	}
	if u.Probe == nil {
		u.Probe = HTTPHealthProbe{}
	}
	request := state.Request
	if currentDesktopPID > 0 {
		request.DesktopPID = currentDesktopPID
	}
	state.Request = request
	if state.Phase == PhaseReceived || state.Phase == PhaseVerifying || state.Phase == PhaseWaitingForShutdown || state.Phase == PhaseBackingUp {
		if state.BackupPath != "" {
			_ = os.RemoveAll(state.BackupPath + ".part")
		}
		if request.DesktopPID > 0 {
			if path, err := u.Runtime.ProcessPath(request.DesktopPID); err == nil && samePath(path, request.DesktopPath) {
				if err := u.Runtime.StopProcessTree(request.DesktopPID, time.Duration(request.ShutdownTimeoutMs)*time.Millisecond); err != nil {
					return u.rollbackFailed(request, &state, err)
				}
			}
		}
		if _, err := u.Runtime.StartDesktop(request.DesktopPath, request.InstallRoot); err != nil {
			return u.rollbackFailed(request, &state, err)
		}
		if err := u.Probe.Wait(request.APIURL, request.HealthToken, request.PreviousVersion, time.Duration(request.HealthTimeoutMs)*time.Millisecond); err != nil {
			return u.rollbackFailed(request, &state, err)
		}
		if err := u.transition(statePath, &state, PhaseRolledBack, "interrupted before install; previous tree was unchanged"); err != nil {
			return err
		}
		_ = u.report(request, "ROLLED_BACK", "interrupted before install; previous tree was unchanged")
		return nil
	}
	if state.BackupPath == "" {
		return fmt.Errorf("interrupted OTA has no backup path")
	}
	if err := u.transition(statePath, &state, PhaseRollingBack, ""); err != nil {
		return err
	}
	if request.DesktopPID > 0 {
		if path, err := u.Runtime.ProcessPath(request.DesktopPID); err == nil && samePath(path, request.DesktopPath) {
			if err := u.Runtime.KillProcessTree(request.DesktopPID, time.Duration(request.ShutdownTimeoutMs)*time.Millisecond); err != nil {
				return u.rollbackFailed(request, &state, err)
			}
		}
	}
	if err := restoreBackup(request.InstallRoot, state.BackupPath); err != nil {
		return u.rollbackFailed(request, &state, err)
	}
	if err := restoreDatabaseIfNeeded(request, &state); err != nil {
		return u.rollbackFailed(request, &state, err)
	}
	if _, err := u.Runtime.StartDesktop(request.DesktopPath, request.InstallRoot); err != nil {
		return u.rollbackFailed(request, &state, err)
	}
	if err := u.Probe.Wait(request.APIURL, request.HealthToken, request.PreviousVersion, time.Duration(request.HealthTimeoutMs)*time.Millisecond); err != nil {
		return u.rollbackFailed(request, &state, err)
	}
	if err := u.transition(statePath, &state, PhaseRolledBack, ""); err != nil {
		return err
	}
	_ = u.report(request, "ROLLED_BACK", "interrupted update was restored from backup")
	return nil
}

func (u *Updater) Rollback(ctx context.Context, statePath string, currentDesktopPID int) error {
	_ = ctx
	var state State
	if err := readJSON(statePath, &state); err != nil {
		return fmt.Errorf("read updater state: %w", err)
	}
	if state.Request.StatePath != "" && !samePath(state.Request.StatePath, statePath) {
		return fmt.Errorf("rollback state path does not match the requested state file")
	}
	if state.BackupPath == "" {
		return fmt.Errorf("no retained previous version is available")
	}
	if state.Phase != PhaseCompleted {
		return fmt.Errorf("cannot manually rollback updater phase %s", state.Phase)
	}
	if err := validateRecoveryRequest(state.Request, state.BackupPath, state.DatabaseBackupPath); err != nil {
		return err
	}
	if u.Runtime == nil {
		u.Runtime = NewDefaultRuntime()
	}
	if u.Probe == nil {
		u.Probe = HTTPHealthProbe{}
	}
	request := state.Request
	if currentDesktopPID > 0 {
		request.DesktopPID = currentDesktopPID
	}
	if request.DesktopPID > 0 {
		if path, err := u.Runtime.ProcessPath(request.DesktopPID); err == nil && samePath(path, request.DesktopPath) {
			if err := u.Runtime.KillProcessTree(request.DesktopPID, time.Duration(request.ShutdownTimeoutMs)*time.Millisecond); err != nil {
				return u.rollbackFailed(request, &state, err)
			}
		}
	}
	if err := u.transition(statePath, &state, PhaseRollingBack, ""); err != nil {
		return err
	}
	if err := restoreBackup(request.InstallRoot, state.BackupPath); err != nil {
		return u.rollbackFailed(request, &state, err)
	}
	if err := restoreDatabaseIfNeeded(request, &state); err != nil {
		return u.rollbackFailed(request, &state, err)
	}
	if _, err := u.Runtime.StartDesktop(request.DesktopPath, request.InstallRoot); err != nil {
		return u.rollbackFailed(request, &state, err)
	}
	if err := u.Probe.Wait(request.APIURL, request.HealthToken, request.PreviousVersion, time.Duration(request.HealthTimeoutMs)*time.Millisecond); err != nil {
		return u.rollbackFailed(request, &state, err)
	}
	if err := u.transition(statePath, &state, PhaseRolledBack, ""); err != nil {
		return err
	}
	_ = u.report(request, "ROLLED_BACK", "manual rollback restored the previous version")
	return nil
}

func (u *Updater) validateDesktopProcess(request Request) error {
	path, err := u.Runtime.ProcessPath(request.DesktopPID)
	if err != nil {
		// The desktop may already have exited cleanly before the updater got the
		// handoff. In that case there is no process to stop, so continue.
		return nil
	}
	if !samePath(path, request.DesktopPath) {
		return fmt.Errorf("desktop PID %d does not resolve to the requested PrintOps executable", request.DesktopPID)
	}
	return nil
}

func (u *Updater) rollbackAfterFailure(ctx context.Context, request Request, state *State, cause error) error {
	if err := u.transition(request.StatePath, state, PhaseRollingBack, cause.Error()); err != nil {
		return err
	}
	if err := restoreBackup(request.InstallRoot, state.BackupPath); err != nil {
		return u.rollbackFailed(request, state, fmt.Errorf("%v; restore failed: %w", cause, err))
	}
	if err := restoreDatabaseIfNeeded(request, state); err != nil {
		return u.rollbackFailed(request, state, fmt.Errorf("%v; database restore failed: %w", cause, err))
	}
	if _, err := u.Runtime.StartDesktop(request.DesktopPath, request.InstallRoot); err != nil {
		return u.rollbackFailed(request, state, fmt.Errorf("%v; previous version did not start: %w", cause, err))
	}
	if err := u.Probe.Wait(request.APIURL, request.HealthToken, request.PreviousVersion, time.Duration(request.HealthTimeoutMs)*time.Millisecond); err != nil {
		return u.rollbackFailed(request, state, fmt.Errorf("%v; previous version health failed: %w", cause, err))
	}
	if err := u.transition(request.StatePath, state, PhaseRolledBack, cause.Error()); err != nil {
		return err
	}
	_ = u.report(request, "ROLLED_BACK", cause.Error())
	_ = ctx
	return fmt.Errorf("update failed and was rolled back: %w", cause)
}

func restoreDatabaseIfNeeded(request Request, state *State) error {
	if state.DatabaseBackupPath == "" {
		return nil
	}
	if request.DatabasePath == "" {
		return fmt.Errorf("database rollback path is missing")
	}
	return restoreDatabaseBackup(state.DatabaseBackupPath, request.DatabasePath)
}

// rollbackBeforeInstall handles failures after the desktop may have been
// stopped but before any installed bytes are changed. The previous tree is
// still the working tree, so restoring it means removing only backup staging
// debris and bringing that same tree back up and healthy.
func (u *Updater) rollbackBeforeInstall(request Request, state *State, cause error) error {
	if state.BackupPath != "" {
		_ = os.RemoveAll(state.BackupPath + ".part")
	}

	running := false
	if request.DesktopPID > 0 {
		if path, err := u.Runtime.ProcessPath(request.DesktopPID); err == nil {
			if !samePath(path, request.DesktopPath) {
				return u.rollbackFailed(request, state, fmt.Errorf("unexpected process %q owns the desktop PID", path))
			}
			running = true
		}
	}
	if !running {
		if _, err := u.Runtime.StartDesktop(request.DesktopPath, request.InstallRoot); err != nil {
			return u.rollbackFailed(request, state, fmt.Errorf("%v; previous version did not start: %w", cause, err))
		}
	}
	if err := u.Probe.Wait(request.APIURL, request.HealthToken, request.PreviousVersion, time.Duration(request.HealthTimeoutMs)*time.Millisecond); err != nil {
		return u.rollbackFailed(request, state, fmt.Errorf("%v; previous version health failed: %w", cause, err))
	}
	if err := u.transition(request.StatePath, state, PhaseRolledBack, cause.Error()); err != nil {
		return err
	}
	_ = u.report(request, "ROLLED_BACK", cause.Error())
	return fmt.Errorf("update failed before install and the previous version was restored: %w", cause)
}

func (u *Updater) rollbackFailed(request Request, state *State, err error) error {
	message := err.Error()
	_ = u.transition(request.StatePath, state, PhaseRollbackFailed, message)
	_ = u.report(request, "ROLLBACK_FAILED", message)
	return fmt.Errorf("automatic rollback failed: %w", err)
}

func (u *Updater) fail(request Request, state *State, phase string, err error) error {
	message := err.Error()
	_ = u.transition(request.StatePath, state, phase, message)
	_ = u.report(request, "INSTALL_FAILED", message)
	return fmt.Errorf("OTA updater %s: %s", phase, message)
}

func (u *Updater) persist(path string, state *State) error {
	state.UpdatedAt = nowOrDefault(u.Now)
	return writeJSONAtomic(path, state)
}

func (u *Updater) transition(path string, state *State, phase, errorMessage string) error {
	state.Phase = phase
	state.Error = strings.TrimSpace(errorMessage)
	return u.persist(path, state)
}

func (u *Updater) report(request Request, state, errorMessage string) error {
	if u.Report != nil {
		return u.Report(request, state, errorMessage)
	}
	body, err := json.Marshal(map[string]string{
		"operation_id":  request.OperationID,
		"version":       request.Version,
		"state":         state,
		"error_message": strings.TrimSpace(errorMessage),
	})
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 2 * time.Second}
	endpoint := strings.TrimRight(request.APIURL, "/") + "/api/v1/ota/recovery"
	for attempt := 0; attempt < 3; attempt++ {
		httpRequest, requestErr := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
		if requestErr == nil {
			httpRequest.Header.Set("content-type", "application/json")
			httpRequest.Header.Set("x-printops-ota-token", request.HealthToken)
			response, doErr := client.Do(httpRequest)
			if doErr == nil {
				_, _ = response.Body.Read(make([]byte, 1))
				_ = response.Body.Close()
				if response.StatusCode == http.StatusNoContent || response.StatusCode == http.StatusOK {
					return nil
				}
			}
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("could not report updater outcome to API")
}

func restoreBackup(installRoot, backup string) error {
	info, err := os.Stat(backup)
	if err != nil {
		return fmt.Errorf("backup is unavailable: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("backup is not a directory")
	}
	// Keep the backup intact and prepare the replacement beside it. This makes
	// a failed copy harmless: the current install tree is untouched until the
	// complete previous tree is ready to swap in.
	restorePart := backup + ".restore.part"
	failedInstall := backup + ".failed-install"
	if err := os.RemoveAll(restorePart); err != nil {
		return fmt.Errorf("clear restore staging tree: %w", err)
	}
	if err := copyDirectory(backup, restorePart); err != nil {
		_ = os.RemoveAll(restorePart)
		return fmt.Errorf("stage backup for restore: %w", err)
	}
	if err := os.RemoveAll(failedInstall); err != nil {
		_ = os.RemoveAll(restorePart)
		return fmt.Errorf("clear failed install tree: %w", err)
	}
	if _, err := os.Stat(installRoot); err == nil {
		if err := os.Rename(installRoot, failedInstall); err != nil {
			_ = os.RemoveAll(restorePart)
			return fmt.Errorf("move incomplete install aside: %w", err)
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		_ = os.RemoveAll(restorePart)
		return fmt.Errorf("inspect incomplete install: %w", err)
	}
	if err := os.Rename(restorePart, installRoot); err != nil {
		// Best-effort repair if the second half of the directory swap fails.
		if _, failedErr := os.Stat(failedInstall); failedErr == nil {
			_ = os.Rename(failedInstall, installRoot)
		}
		return fmt.Errorf("restore staged backup: %w", err)
	}
	_ = os.RemoveAll(failedInstall)
	return nil
}

func samePath(left, right string) bool {
	return strings.EqualFold(filepath.Clean(left), filepath.Clean(right))
}

func sleepContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
