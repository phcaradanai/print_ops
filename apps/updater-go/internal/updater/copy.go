package updater

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

func createBackup(source, backup string) error {
	if err := os.RemoveAll(backup + ".part"); err != nil {
		return err
	}
	part := backup + ".part"
	if err := copyDirectory(source, part); err != nil {
		_ = os.RemoveAll(part)
		return err
	}
	if err := os.RemoveAll(backup); err != nil {
		_ = os.RemoveAll(part)
		return err
	}
	if err := os.Rename(part, backup); err != nil {
		_ = os.RemoveAll(part)
		return err
	}
	return nil
}

// createDatabaseBackup snapshots the persistent DB separately from the
// install tree. Packaged PrintOps keeps the DB in per-user app data, so an
// application rollback must restore both trees when the candidate migrates it.
func createDatabaseBackup(source, backup string) error {
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("database path is not a regular file")
	}
	if err := os.MkdirAll(filepath.Dir(backup), 0o755); err != nil {
		return err
	}
	part := backup + ".part"
	if err := os.Remove(part); err != nil && !os.IsNotExist(err) {
		return err
	}
	entry := fileInfoDirEntry{info: info}
	if err := copyFile(source, part, entry); err != nil {
		_ = os.Remove(part)
		return err
	}
	if err := os.Remove(backup); err != nil && !os.IsNotExist(err) {
		_ = os.Remove(part)
		return err
	}
	if err := os.Rename(part, backup); err != nil {
		_ = os.Remove(part)
		return err
	}
	return nil
}

// restoreDatabaseBackup prepares the old DB completely before replacing the
// candidate DB. The previous file is kept until the replacement is in place.
func restoreDatabaseBackup(backup, target string) error {
	info, err := os.Stat(backup)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("database backup is not a regular file")
	}
	part := target + ".restore.part"
	if err := os.Remove(part); err != nil && !os.IsNotExist(err) {
		return err
	}
	entry := fileInfoDirEntry{info: info}
	if err := copyFile(backup, part, entry); err != nil {
		_ = os.Remove(part)
		return err
	}
	previous := target + ".failed-restore"
	_ = os.Remove(previous)
	if _, err := os.Stat(target); err == nil {
		if err := os.Rename(target, previous); err != nil {
			_ = os.Remove(part)
			return err
		}
	} else if !os.IsNotExist(err) {
		_ = os.Remove(part)
		return err
	}
	if err := os.Rename(part, target); err != nil {
		if _, restoreErr := os.Stat(previous); restoreErr == nil {
			_ = os.Rename(previous, target)
		}
		_ = os.Remove(part)
		return err
	}
	_ = os.Remove(previous)
	return nil
}

type fileInfoDirEntry struct{ info os.FileInfo }

func (entry fileInfoDirEntry) Name() string               { return entry.info.Name() }
func (entry fileInfoDirEntry) IsDir() bool                { return entry.info.IsDir() }
func (entry fileInfoDirEntry) Type() fs.FileMode          { return entry.info.Mode().Type() }
func (entry fileInfoDirEntry) Info() (fs.FileInfo, error) { return entry.info, nil }

func copyDirectory(source, destination string) error {
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("%s is not a directory", source)
	}
	if err := os.MkdirAll(destination, 0o755); err != nil {
		return err
	}
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("refusing symlink in install tree: %s", path)
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return copyFile(path, target, entry)
	})
}

func copyFile(source, destination string, entry fs.DirEntry) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		_ = output.Close()
		return err
	}
	if err := output.Sync(); err != nil {
		_ = output.Close()
		return err
	}
	if err := output.Close(); err != nil {
		return err
	}
	if info, err := entry.Info(); err == nil {
		_ = os.Chmod(destination, info.Mode())
	}
	return nil
}
