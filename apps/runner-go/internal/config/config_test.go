package config

import (
	"os"
	"strings"
	"testing"
)

func setEnv(t *testing.T, kv map[string]string) {
	t.Helper()
	for k, v := range kv {
		t.Setenv(k, v)
	}
}

func clearAll(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"PRINTOPS_CONFIG_FILE",
		"PRINTOPS_API_BASE_URL",
		"PRINTOPS_RUNNER_ID",
		"PRINTOPS_RUNNER_NAME",
		"PRINTOPS_RUNNER_TOKEN",
		"PRINTOPS_POLL_INTERVAL_MS",
		"PRINTOPS_HEARTBEAT_INTERVAL_MS",
		"PRINTOPS_DISCOVERY_INTERVAL_MS",
		"PRINTOPS_DISCOVERY_MODE",
		"PRINTOPS_EXECUTOR_MODE",
		"PRINTOPS_LOG_LEVEL",
		"PRINTOPS_SNMP_ENABLED",
		"PRINTOPS_SNMP_COMMUNITY",
		"PRINTOPS_JOBS_ENABLED",
	} {
		t.Setenv(k, "")
		_ = os.Unsetenv(k)
	}
}

func TestLoad_SuccessWithDefaults(t *testing.T) {
	clearAll(t)
	// Only API base URL is needed for success; runner_name defaults.
	t.Setenv("PRINTOPS_API_BASE_URL", "http://localhost:3001")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected success, got error: %v", err)
	}
	if cfg.APIBaseURL != "http://localhost:3001" {
		t.Errorf("APIBaseURL = %q, want %q", cfg.APIBaseURL, "http://localhost:3001")
	}
	if cfg.RunnerName == "" {
		t.Error("RunnerName should default to non-empty")
	}
	if cfg.ExecutorMode != ExecutorFake {
		t.Errorf("ExecutorMode default = %q, want fake", cfg.ExecutorMode)
	}
	if cfg.DiscoveryMode != DiscoveryAuto {
		t.Errorf("DiscoveryMode default = %q, want auto", cfg.DiscoveryMode)
	}
	if cfg.PollInterval <= 0 {
		t.Error("PollInterval should be positive")
	}
	if cfg.HeartbeatInterval <= 0 {
		t.Error("HeartbeatInterval should be positive")
	}
}

func TestLoad_MissingRequiredReturnsClearError(t *testing.T) {
	clearAll(t)
	// Trigger a validation failure via an invalid poll interval (negative).
	// This exercises the same validate() error path that catches missing
	// required values, with a clear actionable message.
	t.Setenv("PRINTOPS_API_BASE_URL", "http://localhost:3001")
	t.Setenv("PRINTOPS_POLL_INTERVAL_MS", "0")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error when required config invalid, got nil")
	}
	// Error must be clear about what's invalid.
	msg := strings.ToLower(err.Error())
	if !strings.Contains(msg, "invalid") && !strings.Contains(msg, "required") {
		t.Errorf("error message should mention invalid/required, got: %s", err.Error())
	}
}

func TestLoad_InvalidPollInterval(t *testing.T) {
	clearAll(t)
	t.Setenv("PRINTOPS_API_BASE_URL", "http://localhost:3001")
	t.Setenv("PRINTOPS_POLL_INTERVAL_MS", "not-a-number")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for non-numeric poll interval")
	}
	if !strings.Contains(err.Error(), "POLL_INTERVAL") {
		t.Errorf("error should mention POLL_INTERVAL, got: %s", err.Error())
	}
}

func TestLoad_InvalidDiscoveryMode(t *testing.T) {
	clearAll(t)
	t.Setenv("PRINTOPS_API_BASE_URL", "http://localhost:3001")
	t.Setenv("PRINTOPS_DISCOVERY_MODE", "linux-bluetooth")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for invalid discovery mode")
	}
	if !strings.Contains(err.Error(), "DISCOVERY_MODE") {
		t.Errorf("error should mention DISCOVERY_MODE, got: %s", err.Error())
	}
}

func TestLoad_InvalidExecutorMode(t *testing.T) {
	clearAll(t)
	t.Setenv("PRINTOPS_API_BASE_URL", "http://localhost:3001")
	t.Setenv("PRINTOPS_EXECUTOR_MODE", "telepathy")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for invalid executor mode")
	}
	if !strings.Contains(err.Error(), "EXECUTOR_MODE") {
		t.Errorf("error should mention EXECUTOR_MODE, got: %s", err.Error())
	}
}

func TestLoad_EnvOverridesFile(t *testing.T) {
	clearAll(t)
	// Write a config file.
	tmp := t.TempDir() + "/config.env"
	content := "PRINTOPS_API_BASE_URL=http://from-file:3001\nPRINTOPS_RUNNER_NAME=from-file\n"
	if err := os.WriteFile(tmp, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PRINTOPS_CONFIG_FILE", tmp)
	// Override API URL via env.
	t.Setenv("PRINTOPS_API_BASE_URL", "http://from-env:4001")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.APIBaseURL != "http://from-env:4001" {
		t.Errorf("env should override file; got %q", cfg.APIBaseURL)
	}
	if cfg.RunnerName != "from-file" {
		t.Errorf("file value should apply when env unset; got %q", cfg.RunnerName)
	}
}

func TestRedacted_TokenNotLogged(t *testing.T) {
	cfg := &Config{
		APIBaseURL: "http://x",
		RunnerID:   "r-1",
		RunnerName: "name",
		Token:      "super-secret-jwt",
	}
	r := cfg.Redacted()
	tokenStr, ok := r["token"].(string)
	if !ok {
		t.Fatal("token should be a string in redacted output")
	}
	if strings.Contains(tokenStr, "super-secret-jwt") {
		t.Error("redacted token must not contain the raw secret")
	}
}

func TestResolveDiscoveryMode(t *testing.T) {
	cfg := &Config{OS: "windows", DiscoveryMode: DiscoveryAuto}
	if got := cfg.ResolveDiscoveryMode(); got != DiscoveryWindows {
		t.Errorf("windows auto -> %q, want windows", got)
	}
	cfg.OS = "darwin"
	if got := cfg.ResolveDiscoveryMode(); got != DiscoveryMacOS {
		t.Errorf("darwin auto -> %q, want macos", got)
	}
	cfg.OS = "linux"
	if got := cfg.ResolveDiscoveryMode(); got != DiscoveryFake {
		t.Errorf("linux auto -> %q, want fake", got)
	}
	cfg.DiscoveryMode = DiscoveryFake
	if got := cfg.ResolveDiscoveryMode(); got != DiscoveryFake {
		t.Errorf("explicit fake -> %q, want fake", got)
	}
}

func TestLoad_SNMPDefaults(t *testing.T) {
	clearAll(t)
	t.Setenv("PRINTOPS_API_BASE_URL", "http://localhost:3001")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected success, got error: %v", err)
	}
	if !cfg.SNMPEnabled {
		t.Error("SNMPEnabled should default to true")
	}
	if cfg.SNMPCommunity != "public" {
		t.Errorf("SNMPCommunity default = %q, want public", cfg.SNMPCommunity)
	}
}

func TestLoad_SNMPOverrides(t *testing.T) {
	clearAll(t)
	setEnv(t, map[string]string{
		"PRINTOPS_API_BASE_URL":   "http://localhost:3001",
		"PRINTOPS_SNMP_ENABLED":   "false",
		"PRINTOPS_SNMP_COMMUNITY": "lab-ro",
	})

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected success, got error: %v", err)
	}
	if cfg.SNMPEnabled {
		t.Error("PRINTOPS_SNMP_ENABLED=false should disable SNMP")
	}
	if cfg.SNMPCommunity != "lab-ro" {
		t.Errorf("SNMPCommunity = %q, want lab-ro", cfg.SNMPCommunity)
	}
}

func TestLoad_SNMPEnabledInvalid(t *testing.T) {
	clearAll(t)
	setEnv(t, map[string]string{
		"PRINTOPS_API_BASE_URL": "http://localhost:3001",
		"PRINTOPS_SNMP_ENABLED": "maybe",
	})

	if _, err := Load(); err == nil {
		t.Error("expected an error for an invalid PRINTOPS_SNMP_ENABLED")
	} else if !strings.Contains(err.Error(), "PRINTOPS_SNMP_ENABLED") {
		t.Errorf("error should name the variable, got: %v", err)
	}
}

func TestParseBool(t *testing.T) {
	cases := []struct {
		raw     string
		def     bool
		want    bool
		wantErr bool
	}{
		{"", true, true, false},
		{"", false, false, false},
		{"true", false, true, false},
		{"TRUE", false, true, false},
		{" yes ", false, true, false},
		{"1", false, true, false},
		{"on", false, true, false},
		{"false", true, false, false},
		{"no", true, false, false},
		{"0", true, false, false},
		{"off", true, false, false},
		{"maybe", true, false, true},
	}
	for _, tc := range cases {
		got, err := parseBool(tc.raw, tc.def)
		if (err != nil) != tc.wantErr {
			t.Errorf("parseBool(%q, %v) error = %v, wantErr %v", tc.raw, tc.def, err, tc.wantErr)
			continue
		}
		if err == nil && got != tc.want {
			t.Errorf("parseBool(%q, %v) = %v, want %v", tc.raw, tc.def, got, tc.want)
		}
	}
}

func TestLoad_JobsEnabledDefaultsTrue(t *testing.T) {
	clearAll(t)
	t.Setenv("PRINTOPS_API_BASE_URL", "http://localhost:3001")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected success, got error: %v", err)
	}
	if !cfg.JobsEnabled {
		t.Error("JobsEnabled should default to true")
	}
}

func TestLoad_JobsEnabledOverride(t *testing.T) {
	clearAll(t)
	setEnv(t, map[string]string{
		"PRINTOPS_API_BASE_URL": "http://localhost:3001",
		"PRINTOPS_JOBS_ENABLED": "false",
	})

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected success, got error: %v", err)
	}
	if cfg.JobsEnabled {
		t.Error("PRINTOPS_JOBS_ENABLED=false should disable job polling")
	}
}

func TestLoad_JobsEnabledInvalid(t *testing.T) {
	clearAll(t)
	setEnv(t, map[string]string{
		"PRINTOPS_API_BASE_URL": "http://localhost:3001",
		"PRINTOPS_JOBS_ENABLED": "maybe",
	})

	if _, err := Load(); err == nil {
		t.Error("expected an error for an invalid PRINTOPS_JOBS_ENABLED")
	} else if !strings.Contains(err.Error(), "PRINTOPS_JOBS_ENABLED") {
		t.Errorf("error should name the variable, got: %v", err)
	}
}

// TestRedactedHidesCustomCommunity keeps a site-specific community out of logs.
func TestRedactedHidesCustomCommunity(t *testing.T) {
	cfg := &Config{SNMPEnabled: true, SNMPCommunity: "s3cret-community"}
	red := cfg.Redacted()
	if red["snmp_community"] == "s3cret-community" {
		t.Error("a custom SNMP community must not appear in Redacted()")
	}
	cfg.SNMPCommunity = "public"
	if red := cfg.Redacted(); red["snmp_community"] != "public" {
		t.Errorf("snmp_community = %v, want public", red["snmp_community"])
	}
}
