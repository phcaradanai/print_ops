// Package config loads and validates the PrintOps Go runner configuration.
//
// Configuration is sourced from environment variables (primary) with optional
// support for a simple KEY=VALUE config file whose path is provided via
// PRINTOPS_CONFIG_FILE. Environment variables always take precedence over the
// file so operators can override individual values without editing the file.
//
// Secrets (tokens) are never logged by this package. Callers should use the
// Redacted() helper when emitting the resolved configuration.
package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"runtime"
	"strings"
	"time"
)

// DiscoveryMode selects the printer discovery backend.
type DiscoveryMode string

// ExecutorMode selects the print execution backend.
type ExecutorMode string

const (
	DiscoveryAuto    DiscoveryMode = "auto"
	DiscoveryWindows DiscoveryMode = "windows"
	DiscoveryMacOS   DiscoveryMode = "macos"
	DiscoveryFake    DiscoveryMode = "fake"

	ExecutorFake           ExecutorMode = "fake"
	ExecutorWindowsSpooler ExecutorMode = "windows-spooler"
	ExecutorCUPS           ExecutorMode = "cups"
	ExecutorRawTCP         ExecutorMode = "rawtcp"
)

// Default values for optional configuration.
const (
	defaultPollIntervalMs      = 750
	defaultHeartbeatIntervalMs = 15000
	defaultDiscoveryIntervalMs = 60000
	defaultLogLevel            = "info"
	defaultAPIBaseURL          = "http://localhost:3001"
	defaultRunnerName          = "printops-go-runner"
	defaultSNMPEnabled         = true
	defaultSNMPCommunity       = "public"
	defaultJobsEnabled         = true

	// Dev auth used only when PRINTOPS_RUNNER_TOKEN is not provided. This
	// matches the API's seeded dev accounts and is NOT a production secret.
	defaultDevEmail    = "admin@printerops.local"
	defaultDevPassword = "dev-password"
)

// Config is the fully-resolved runner configuration.
type Config struct {
	APIBaseURL string
	RunnerID   string
	RunnerName string
	// Token is the runner auth bearer token. Optional in dev: when empty the
	// runner falls back to a dev login against the API.
	Token string

	PollInterval      time.Duration
	HeartbeatInterval time.Duration
	DiscoveryInterval time.Duration

	DiscoveryMode DiscoveryMode
	ExecutorMode  ExecutorMode
	LogLevel      string

	// JobsEnabled controls whether the job poll/claim loop runs. When false,
	// the runner performs discovery only: heartbeat and discovery loops still
	// run, but the runner never claims or executes print jobs. This exists so
	// deployments where another executor already owns the same job queue
	// (e.g. the desktop app, where the API executes jobs in-process via its
	// TypeScript WindowsSpoolerAdapter) can run this runner for printer
	// discovery only, without two executors racing to claim the same job.
	JobsEnabled bool

	// SNMPEnabled turns on device-level print confirmation: the Windows
	// spooler executor reads the printer's own page counter over SNMP instead
	// of trusting the spooler's "job done". Printers that do not answer SNMP
	// keep the plain spooler-acceptance behaviour.
	SNMPEnabled bool
	// SNMPCommunity is the SNMPv1 read community used for those reads.
	SNMPCommunity string

	// Derived host facts.
	Hostname string
	OS       string
	Arch     string
	Version  string

	// Dev login fallback (used only when Token is empty).
	DevEmail    string
	DevPassword string
}

// Version is the runner build version. Overridable at build time via ldflags.
var Version = "0.1.0-mvp"

// Load resolves configuration from the optional config file then environment.
func Load() (*Config, error) {
	fileVals, err := loadFile(os.Getenv("PRINTOPS_CONFIG_FILE"))
	if err != nil {
		return nil, err
	}

	get := func(key string) string {
		if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
		return strings.TrimSpace(fileVals[key])
	}

	hostname, _ := os.Hostname()

	cfg := &Config{
		APIBaseURL:    firstNonEmpty(get("PRINTOPS_API_BASE_URL"), defaultAPIBaseURL),
		RunnerID:      get("PRINTOPS_RUNNER_ID"),
		RunnerName:    firstNonEmpty(get("PRINTOPS_RUNNER_NAME"), defaultRunnerName),
		Token:         get("PRINTOPS_RUNNER_TOKEN"),
		DiscoveryMode: DiscoveryMode(firstNonEmpty(strings.ToLower(get("PRINTOPS_DISCOVERY_MODE")), string(DiscoveryAuto))),
		ExecutorMode:  ExecutorMode(firstNonEmpty(strings.ToLower(get("PRINTOPS_EXECUTOR_MODE")), string(ExecutorFake))),
		LogLevel:      firstNonEmpty(get("PRINTOPS_LOG_LEVEL"), defaultLogLevel),
		SNMPCommunity: firstNonEmpty(get("PRINTOPS_SNMP_COMMUNITY"), defaultSNMPCommunity),
		Hostname:      firstNonEmpty(get("PRINTOPS_HOSTNAME"), hostname, "unknown-host"),
		OS:            runtime.GOOS,
		Arch:          runtime.GOARCH,
		Version:       Version,
		DevEmail:      firstNonEmpty(get("PRINTOPS_DEV_EMAIL"), defaultDevEmail),
		DevPassword:   firstNonEmpty(get("PRINTOPS_DEV_PASSWORD"), defaultDevPassword),
	}

	cfg.PollInterval, err = durationMs(get("PRINTOPS_POLL_INTERVAL_MS"), defaultPollIntervalMs)
	if err != nil {
		return nil, fmt.Errorf("PRINTOPS_POLL_INTERVAL_MS: %w", err)
	}
	cfg.HeartbeatInterval, err = durationMs(get("PRINTOPS_HEARTBEAT_INTERVAL_MS"), defaultHeartbeatIntervalMs)
	if err != nil {
		return nil, fmt.Errorf("PRINTOPS_HEARTBEAT_INTERVAL_MS: %w", err)
	}
	cfg.DiscoveryInterval, err = durationMs(get("PRINTOPS_DISCOVERY_INTERVAL_MS"), defaultDiscoveryIntervalMs)
	if err != nil {
		return nil, fmt.Errorf("PRINTOPS_DISCOVERY_INTERVAL_MS: %w", err)
	}

	cfg.SNMPEnabled, err = parseBool(get("PRINTOPS_SNMP_ENABLED"), defaultSNMPEnabled)
	if err != nil {
		return nil, fmt.Errorf("PRINTOPS_SNMP_ENABLED: %w", err)
	}

	cfg.JobsEnabled, err = parseBool(get("PRINTOPS_JOBS_ENABLED"), defaultJobsEnabled)
	if err != nil {
		return nil, fmt.Errorf("PRINTOPS_JOBS_ENABLED: %w", err)
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// validate enforces required fields and allowed enum values with clear errors.
func (c *Config) validate() error {
	var problems []string

	if c.APIBaseURL == "" {
		problems = append(problems, "PRINTOPS_API_BASE_URL is required (e.g. http://localhost:3001)")
	}
	if c.RunnerName == "" {
		problems = append(problems, "PRINTOPS_RUNNER_NAME is required")
	}

	switch c.DiscoveryMode {
	case DiscoveryAuto, DiscoveryWindows, DiscoveryMacOS, DiscoveryFake:
	default:
		problems = append(problems, fmt.Sprintf(
			"PRINTOPS_DISCOVERY_MODE %q is invalid (allowed: auto|windows|macos|fake)", c.DiscoveryMode))
	}

	switch c.ExecutorMode {
	case ExecutorFake, ExecutorWindowsSpooler, ExecutorCUPS, ExecutorRawTCP:
	default:
		problems = append(problems, fmt.Sprintf(
			"PRINTOPS_EXECUTOR_MODE %q is invalid (allowed: fake|windows-spooler|cups|rawtcp)", c.ExecutorMode))
	}

	if c.PollInterval <= 0 {
		problems = append(problems, "PRINTOPS_POLL_INTERVAL_MS must be > 0")
	}
	if c.HeartbeatInterval <= 0 {
		problems = append(problems, "PRINTOPS_HEARTBEAT_INTERVAL_MS must be > 0")
	}
	if c.SNMPEnabled && c.SNMPCommunity == "" {
		problems = append(problems, "PRINTOPS_SNMP_COMMUNITY must not be empty when SNMP is enabled")
	}

	if len(problems) > 0 {
		return fmt.Errorf("invalid runner configuration:\n  - %s", strings.Join(problems, "\n  - "))
	}
	return nil
}

// Redacted returns a copy safe for logging (token replaced with a marker).
func (c *Config) Redacted() map[string]any {
	tokenState := "unset(dev-login)"
	if c.Token != "" {
		tokenState = "set(redacted)"
	}
	return map[string]any{
		"api_base_url":          c.APIBaseURL,
		"runner_id":             c.RunnerID,
		"runner_name":           c.RunnerName,
		"token":                 tokenState,
		"poll_interval_ms":      c.PollInterval.Milliseconds(),
		"heartbeat_interval_ms": c.HeartbeatInterval.Milliseconds(),
		"discovery_interval_ms": c.DiscoveryInterval.Milliseconds(),
		"discovery_mode":        string(c.DiscoveryMode),
		"executor_mode":         string(c.ExecutorMode),
		"jobs_enabled":          c.JobsEnabled,
		"log_level":             c.LogLevel,
		"snmp_enabled":          c.SNMPEnabled,
		"snmp_community":        communityState(c.SNMPCommunity),
		"hostname":              c.Hostname,
		"os":                    c.OS,
		"arch":                  c.Arch,
		"version":               c.Version,
	}
}

// communityState describes the SNMP community without emitting a custom one:
// the default is public knowledge, anything else is site-specific.
func communityState(community string) string {
	switch community {
	case "":
		return "unset"
	case defaultSNMPCommunity:
		return defaultSNMPCommunity
	default:
		return "custom(redacted)"
	}
}

// ResolveDiscoveryMode maps "auto" to the concrete mode for the current OS.
func (c *Config) ResolveDiscoveryMode() DiscoveryMode {
	if c.DiscoveryMode != DiscoveryAuto {
		return c.DiscoveryMode
	}
	switch c.OS {
	case "windows":
		return DiscoveryWindows
	case "darwin":
		return DiscoveryMacOS
	default:
		return DiscoveryFake
	}
}

// loadFile parses a simple KEY=VALUE file. Lines starting with '#' and blank
// lines are ignored. Returns an empty map if path is empty.
func loadFile(path string) (map[string]string, error) {
	vals := map[string]string{}
	if strings.TrimSpace(path) == "" {
		return vals, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open config file %q: %w", path, err)
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			return nil, fmt.Errorf("config file %q: invalid line (expected KEY=VALUE): %q", path, line)
		}
		vals[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), `"'`)
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("read config file %q: %w", path, err)
	}
	return vals, nil
}

// durationMs parses an integer millisecond string into a Duration, using def
// when the string is empty.
func durationMs(raw string, def int) (time.Duration, error) {
	if raw == "" {
		return time.Duration(def) * time.Millisecond, nil
	}
	var ms int
	if _, err := fmt.Sscanf(raw, "%d", &ms); err != nil {
		return 0, errors.New("must be an integer number of milliseconds")
	}
	if ms < 0 {
		return 0, errors.New("must be >= 0")
	}
	return time.Duration(ms) * time.Millisecond, nil
}

// parseBool parses a permissive boolean ("true"/"false", "1"/"0", "yes"/"no",
// "on"/"off"), using def when the string is empty.
func parseBool(raw string, def bool) (bool, error) {
	if raw == "" {
		return def, nil
	}
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "y", "on":
		return true, nil
	case "0", "false", "no", "n", "off":
		return false, nil
	default:
		return false, errors.New("must be one of true|false|1|0|yes|no|on|off")
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
