// ota-native-broken-server-proxy is an acceptance-only process wrapper.
// It launches the real production B API on an internal port, forwards every
// normal request, and returns a failed OTA readiness response only after the
// upstream /health endpoint is alive. This proves the real B process opened
// and migrated the database before the deliberately broken candidate rolls
// back. It is never included in ordinary builds.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const listenAddress = "127.0.0.1:31415"

var upstreamAddress = "127.0.0.1:31416"

func upstreamPort() string {
	value := os.Getenv("PRINTOPS_OTA_NATIVE_BROKEN_UPSTREAM_PORT")
	if value == "" {
		return "31416"
	}
	port, err := strconv.Atoi(value)
	if err != nil || port < 1024 || port > 65535 || port == 31415 {
		fmt.Fprintln(os.Stderr, "[ota-native-broken-proxy] invalid isolated upstream port")
		os.Exit(1)
	}
	return value
}

func setEnv(environment []string, key, value string) []string {
	prefix := key + "="
	filtered := make([]string, 0, len(environment)+1)
	for _, item := range environment {
		if !strings.HasPrefix(item, prefix) {
			filtered = append(filtered, item)
		}
	}
	return append(filtered, prefix+value)
}

func waitForUpstreamHealth(client *http.Client) error {
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		response, err := client.Get("http://" + upstreamAddress + "/health")
		if err == nil {
			response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("upstream production B health did not become available")
}

func captureBrokenReadinessEvidence(request *http.Request, client *http.Client) error {
	evidencePath := os.Getenv("PRINTOPS_OTA_NATIVE_BROKEN_EVIDENCE_FILE")
	if evidencePath == "" {
		return fmt.Errorf("PRINTOPS_OTA_NATIVE_BROKEN_EVIDENCE_FILE is not configured")
	}

	healthResponse, err := client.Get("http://" + upstreamAddress + "/health")
	if err != nil {
		return fmt.Errorf("read production B health: %w", err)
	}
	healthBody, readErr := io.ReadAll(io.LimitReader(healthResponse.Body, 1<<20))
	healthResponse.Body.Close()
	if readErr != nil {
		return fmt.Errorf("read production B health body: %w", readErr)
	}
	var health struct {
		Version string `json:"version"`
	}
	_ = json.Unmarshal(healthBody, &health)

	upstreamRequest, err := http.NewRequestWithContext(
		request.Context(),
		request.Method,
		"http://"+upstreamAddress+request.URL.RequestURI(),
		nil,
	)
	if err != nil {
		return fmt.Errorf("create production B readiness request: %w", err)
	}
	upstreamRequest.Header = request.Header.Clone()
	readinessResponse, readinessErr := client.Do(upstreamRequest)
	readinessStatus := 0
	readinessBody := []byte(nil)
	if readinessErr == nil {
		readinessStatus = readinessResponse.StatusCode
		readinessBody, readErr = io.ReadAll(io.LimitReader(readinessResponse.Body, 1<<20))
		readinessResponse.Body.Close()
		if readErr != nil {
			return fmt.Errorf("read production B readiness body: %w", readErr)
		}
	}
	var readiness struct {
		OTA struct {
			Status string `json:"status"`
			RequiredComponents struct {
				Database struct {
					Details struct {
						SchemaVersion int `json:"schemaVersion"`
					} `json:"details"`
				} `json:"database"`
			} `json:"requiredComponents"`
		} `json:"ota"`
	}
	_ = json.Unmarshal(readinessBody, &readiness)
	expectedSchema, _ := strconv.Atoi(os.Getenv("PRINTOPS_OTA_NATIVE_EXPECTED_SCHEMA"))
	ready := healthResponse.StatusCode == http.StatusOK &&
		health.Version != "" &&
		readinessStatus == http.StatusOK &&
		readiness.OTA.Status == "READY" &&
		expectedSchema > 0 &&
		readiness.OTA.RequiredComponents.Database.Details.SchemaVersion == expectedSchema
	evidence := struct {
		GeneratedAt                  string `json:"generatedAt"`
		HealthStatusCode             int    `json:"healthStatusCode"`
		HealthVersion                string `json:"healthVersion"`
		UpstreamReadinessStatusCode  int    `json:"upstreamReadinessStatusCode"`
		UpstreamReadinessStatus      string `json:"upstreamReadinessStatus"`
		UpstreamSchemaVersion        int    `json:"upstreamSchemaVersion"`
		ExpectedSchemaVersion        int    `json:"expectedSchemaVersion"`
		ForcedReadinessStatusCode    int    `json:"forcedReadinessStatusCode"`
		CandidateWasReadyBeforeFault bool   `json:"candidateWasReadyBeforeFault"`
	}{
		GeneratedAt:                  time.Now().UTC().Format(time.RFC3339Nano),
		HealthStatusCode:             healthResponse.StatusCode,
		HealthVersion:                health.Version,
		UpstreamReadinessStatusCode:  readinessStatus,
		UpstreamReadinessStatus:      readiness.OTA.Status,
		UpstreamSchemaVersion:        readiness.OTA.RequiredComponents.Database.Details.SchemaVersion,
		ExpectedSchemaVersion:        expectedSchema,
		ForcedReadinessStatusCode:    http.StatusServiceUnavailable,
		CandidateWasReadyBeforeFault: ready,
	}
	if err := os.MkdirAll(filepath.Dir(evidencePath), 0o700); err != nil {
		return fmt.Errorf("create broken-B evidence directory: %w", err)
	}
	encoded, err := json.MarshalIndent(evidence, "", "  ")
	if err != nil {
		return fmt.Errorf("encode broken-B evidence: %w", err)
	}
	if err := os.WriteFile(evidencePath, append(encoded, '\n'), 0o600); err != nil {
		return fmt.Errorf("write broken-B evidence: %w", err)
	}
	return nil
}

func copyHeaders(destination http.ResponseWriter, source http.Header) {
	for key, values := range source {
		for _, value := range values {
			destination.Header().Add(key, value)
		}
	}
}

func forwardRequest(destination http.ResponseWriter, request *http.Request, client *http.Client) {
	body, err := io.ReadAll(io.LimitReader(request.Body, 16*1024*1024))
	if err != nil {
		http.Error(destination, "could not read upstream request", http.StatusBadRequest)
		return
	}
	target := "http://" + upstreamAddress + request.URL.RequestURI()
	upstreamRequest, err := http.NewRequestWithContext(
		request.Context(),
		request.Method,
		target,
		bytes.NewReader(body),
	)
	if err != nil {
		http.Error(destination, "could not create upstream request", http.StatusBadGateway)
		return
	}
	upstreamRequest.Header = request.Header.Clone()
	upstreamResponse, err := client.Do(upstreamRequest)
	if err != nil {
		http.Error(destination, "production B upstream unavailable", http.StatusBadGateway)
		return
	}
	defer upstreamResponse.Body.Close()
	copyHeaders(destination, upstreamResponse.Header)
	destination.WriteHeader(upstreamResponse.StatusCode)
	_, _ = io.Copy(destination, upstreamResponse.Body)
}

func main() {
	port := upstreamPort()
	upstreamAddress = "127.0.0.1:" + port
	executable, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[ota-native-broken-proxy] resolve executable: %v\n", err)
		os.Exit(1)
	}
	resourceDir := filepath.Dir(executable)
	serverPath := filepath.Join(resourceDir, "server-real.exe")

	command := exec.Command(serverPath)
	command.Dir = resourceDir
	command.Env = setEnv(os.Environ(), "PORT", port)
	command.Env = setEnv(command.Env, "HOST", "127.0.0.1")
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "[ota-native-broken-proxy] start production B server: %v\n", err)
		os.Exit(1)
	}

	client := &http.Client{Timeout: 2 * time.Second}
	forwardClient := &http.Client{Timeout: 30 * time.Second}
	var evidenceOnce sync.Once
	handler := http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/api/v1/system/readiness" {
			if err := waitForUpstreamHealth(client); err != nil {
				http.Error(response, err.Error(), http.StatusServiceUnavailable)
				return
			}
			evidenceOnce.Do(func() {
				if err := captureBrokenReadinessEvidence(request, forwardClient); err != nil {
					fmt.Fprintf(os.Stderr, "[ota-native-broken-proxy] readiness evidence: %v\n", err)
				} else {
					fmt.Fprintln(os.Stdout, "[ota-native-broken-proxy] production B health and readiness are live; intentionally returning HTTP 503")
				}
			})
			response.Header().Set("content-type", "application/json")
			response.WriteHeader(http.StatusServiceUnavailable)
			_, _ = response.Write([]byte(`{"error":"acceptance-only broken B readiness failure","contract":"printops-ota-v1","status":"NOT_READY"}`))
			return
		}
		forwardRequest(response, request, forwardClient)
	})

	server := &http.Server{Addr: listenAddress, Handler: handler}
	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-shutdown
		_ = server.Shutdown(context.Background())
	}()
	childDone := make(chan struct{})
	go func() {
		if err := command.Wait(); err != nil {
			fmt.Fprintf(os.Stderr, "[ota-native-broken-proxy] production B server exited: %v\n", err)
		}
		close(childDone)
		_ = server.Close()
	}()

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		fmt.Fprintf(os.Stderr, "[ota-native-broken-proxy] listen: %v\n", err)
		_ = command.Process.Kill()
		<-childDone
		os.Exit(1)
	}
	_ = command.Process.Kill()
	<-childDone
}
