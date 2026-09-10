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
