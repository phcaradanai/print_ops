package updater

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

func writeJSONAtomic(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())
	_ = os.Remove(temporary)
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(temporary, append(data, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(path)
		if err := os.Rename(temporary, path); err != nil {
			_ = os.Remove(temporary)
			return err
		}
	}
	return nil
}

func readJSON(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("decode %s: %w", path, err)
	}
	return nil
}

func nowOrDefault(now func() time.Time) time.Time {
	if now != nil {
		return now()
	}
	return time.Now().UTC()
}
