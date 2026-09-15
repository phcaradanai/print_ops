package updater

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var sha256Pattern = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)

func validateRequest(request Request) error {
	if request.Mode != "apply" {
		return fmt.Errorf("unsupported updater mode %q", request.Mode)
	}
	if strings.TrimSpace(request.OperationID) == "" || strings.ContainsAny(request.OperationID, `/\\`) {
		return fmt.Errorf("operation_id is invalid")
	}
	if strings.TrimSpace(request.Version) == "" {
		return fmt.Errorf("version is required")
	}
	if strings.TrimSpace(request.PreviousVersion) == "" {
		return fmt.Errorf("previous_version is required for rollback health verification")
	}
	comparison, err := compareNativeVersions(request.Version, request.PreviousVersion)
	if err != nil {
		return err
	}
	if comparison <= 0 {
		return fmt.Errorf("updater refuses a downgrade or same-version install")
	}
	if request.ArtifactFormat != "nsis-installer" {
		return fmt.Errorf("artifact format %q is not supported", request.ArtifactFormat)
	}
	if !sha256Pattern.MatchString(request.ArtifactSHA256) {
		return fmt.Errorf("artifact SHA-256 is invalid")
	}
	if request.RequireSignature && (strings.TrimSpace(request.ArtifactSignature) == "" || strings.TrimSpace(request.PublicKey) == "") {
		return fmt.Errorf("signed production update requires artifact signature and public key")
	}
	for name, path := range map[string]string{
		"artifact_path": request.ArtifactPath,
		"install_root":  request.InstallRoot,
		"desktop_path":  request.DesktopPath,
		"state_path":    request.StatePath,
	} {
		if !filepath.IsAbs(path) {
			return fmt.Errorf("%s must be absolute", name)
		}
	}
	installRoot, err := filepath.Abs(filepath.Clean(request.InstallRoot))
	if err != nil || installRoot == filepath.VolumeName(installRoot)+string(filepath.Separator) {
		return fmt.Errorf("install_root is unsafe")
	}
	if !withinRoot(request.DesktopPath, installRoot) {
		return fmt.Errorf("desktop_path must be inside install_root")
	}
	if withinRoot(request.StatePath, installRoot) {
		return fmt.Errorf("state_path must be outside install_root")
	}
	if withinRoot(request.ArtifactPath, installRoot) {
		return fmt.Errorf("artifact_path must be outside install_root")
	}
	if err := validateLocalAPIURL(request.APIURL); err != nil {
		return err
	}
	if request.HealthToken == "" {
		return fmt.Errorf("local API URL and health token are required")
	}
	if request.TargetSchemaVersion < request.DatabaseSchemaVersion {
		return fmt.Errorf("target database schema cannot be older than the current schema")
	}
	if request.TargetSchemaVersion > request.DatabaseSchemaVersion {
		if strings.TrimSpace(request.DatabasePath) == "" {
			return fmt.Errorf("schema-changing update requires database_path")
		}
		if !filepath.IsAbs(request.DatabasePath) || withinRoot(request.DatabasePath, installRoot) {
			return fmt.Errorf("database_path must be absolute and outside install_root")
		}
		if info, err := os.Stat(request.DatabasePath); err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("database_path is unavailable")
		}
	}
	if request.HealthTimeoutMs <= 0 || request.ShutdownTimeoutMs <= 0 || request.HandoffDelayMs < 0 {
		return fmt.Errorf("updater timeouts are invalid")
	}
	if _, err := os.Stat(request.ArtifactPath); err != nil {
		return fmt.Errorf("staged artifact is unavailable: %w", err)
	}
	return nil
}

func validateRecoveryRequest(request Request, backupPath, databaseBackupPath string) error {
	if request.Mode != "apply" {
		return fmt.Errorf("unsupported updater recovery mode %q", request.Mode)
	}
	if strings.TrimSpace(request.PreviousVersion) == "" {
		return fmt.Errorf("previous_version is required for recovery health verification")
	}
	paths := map[string]string{
		"install_root": request.InstallRoot,
		"desktop_path": request.DesktopPath,
		"state_path":   request.StatePath,
	}
	if backupPath != "" {
		paths["backup_path"] = backupPath
	}
	if databaseBackupPath != "" {
		paths["database_backup_path"] = databaseBackupPath
	}
	for name, path := range paths {
		if !filepath.IsAbs(path) {
			return fmt.Errorf("%s must be absolute", name)
		}
	}
	installRoot, err := filepath.Abs(filepath.Clean(request.InstallRoot))
	if err != nil || installRoot == filepath.VolumeName(installRoot)+string(filepath.Separator) {
		return fmt.Errorf("install_root is unsafe")
	}
	if !withinRoot(request.DesktopPath, installRoot) {
		return fmt.Errorf("desktop_path must be inside install_root")
	}
	if withinRoot(request.StatePath, installRoot) || (backupPath != "" && withinRoot(backupPath, installRoot)) || (databaseBackupPath != "" && withinRoot(databaseBackupPath, installRoot)) {
		return fmt.Errorf("recovery state and backup must be outside install_root")
	}
	if request.TargetSchemaVersion < request.DatabaseSchemaVersion {
		return fmt.Errorf("target database schema cannot be older than the current schema")
	}
	if request.TargetSchemaVersion > request.DatabaseSchemaVersion {
		if strings.TrimSpace(request.DatabasePath) == "" {
			return fmt.Errorf("schema-changing recovery is missing database path")
		}
		// A crash before the backup path was assigned leaves the original
		// application and DB untouched; the pre-install recovery branch can
		// safely restart them without a snapshot. Once an install-tree backup
		// exists, a DB snapshot is mandatory before restoring the tree.
		if backupPath != "" && databaseBackupPath == "" {
			return fmt.Errorf("schema-changing recovery is missing database backup metadata")
		}
		if !filepath.IsAbs(request.DatabasePath) || withinRoot(request.DatabasePath, installRoot) {
			return fmt.Errorf("database_path must be absolute and outside install_root")
		}
	}
	if err := validateLocalAPIURL(request.APIURL); err != nil {
		return err
	}
	if request.HealthToken == "" {
		return fmt.Errorf("local API URL and health token are required")
	}
	if request.HealthTimeoutMs <= 0 || request.ShutdownTimeoutMs <= 0 {
		return fmt.Errorf("updater timeouts are invalid")
	}
	return nil
}

func validateLocalAPIURL(raw string) error {
	trimmed := strings.TrimRight(strings.TrimSpace(raw), "/")
	parsed, err := url.Parse(trimmed)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return fmt.Errorf("local API URL must be an http(s) URL")
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "127.0.0.1" && host != "localhost" && host != "::1" {
		return fmt.Errorf("updater callbacks must target loopback")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("local API URL must not contain credentials, query, or fragment")
	}
	return nil
}

func withinRoot(path, root string) bool {
	pathAbs, errPath := filepath.Abs(filepath.Clean(path))
	rootAbs, errRoot := filepath.Abs(filepath.Clean(root))
	if errPath != nil || errRoot != nil {
		return false
	}
	relative, err := filepath.Rel(rootAbs, pathAbs)
	if err != nil {
		return false
	}
	return relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)))
}
