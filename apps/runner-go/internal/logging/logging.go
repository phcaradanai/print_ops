// Package logging provides a small structured logger for the PrintOps Go runner.
//
// It intentionally avoids external dependencies and wraps the standard
// library slog logger with a couple of PrintOps conventions:
//
//   - Levels are configurable via a string (debug|info|warn|error).
//   - Output is JSON so logs can be shipped/parsed downstream.
//   - Helpers never log sensitive payloads; callers are responsible for
//     passing only safe, redacted fields.
package logging

import (
	"context"
	"log/slog"
	"os"
	"strings"
)

// Logger is the structured logger used across the runner.
type Logger struct {
	*slog.Logger
}

// ParseLevel converts a string log level into an slog.Level.
// Unknown values default to Info.
func ParseLevel(level string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// New creates a JSON structured logger writing to stdout at the given level.
func New(level string) *Logger {
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: ParseLevel(level),
	})
	return &Logger{Logger: slog.New(handler)}
}

// With returns a child logger annotated with the given key/value attributes.
func (l *Logger) With(args ...any) *Logger {
	return &Logger{Logger: l.Logger.With(args...)}
}

// InfoCtx logs at info level with a context (currently unused but kept for
// forward compatibility with tracing/context propagation).
func (l *Logger) InfoCtx(_ context.Context, msg string, args ...any) {
	l.Info(msg, args...)
}
