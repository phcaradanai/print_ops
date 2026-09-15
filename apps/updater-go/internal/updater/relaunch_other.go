//go:build !windows

package updater

func EnsureBreakawayWorker() (bool, error) { return false, nil }
