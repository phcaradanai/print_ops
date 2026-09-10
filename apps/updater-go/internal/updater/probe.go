package updater

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type HTTPHealthProbe struct {
	Client *http.Client
}

func (p HTTPHealthProbe) Wait(apiURL, token, expectedVersion string, timeout time.Duration) error {
	base, err := localAPIBase(apiURL)
	if err != nil {
		return err
	}
	client := p.Client
	if client == nil {
		client = &http.Client{Timeout: 3 * time.Second}
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if err := probeEndpoint(client, base+"/health", token, expectedVersion, false); err == nil {
			if err := probeEndpoint(client, base+"/api/v1/system/readiness", token, expectedVersion, true); err == nil {
				return nil
			}
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("health/readiness did not become available within %s", timeout)
}

func localAPIBase(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", fmt.Errorf("API URL must be http(s)")
	}
	host := parsed.Hostname()
	if host != "127.0.0.1" && host != "localhost" && host != "::1" {
		return "", fmt.Errorf("updater health probes must target loopback")
	}
	return strings.TrimRight(parsed.String(), "/"), nil
}

func probeEndpoint(client *http.Client, endpoint, token, expectedVersion string, readiness bool) error {
	request, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	if token != "" {
		request.Header.Set("x-printops-ota-token", token)
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("%s returned HTTP %d", endpoint, response.StatusCode)
	}
	var body struct {
		Status  string `json:"status"`
		Version string `json:"version"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 256*1024)).Decode(&body); err != nil {
		return fmt.Errorf("health response is not JSON: %w", err)
	}
	if readiness {
		if body.Status != "READY" && body.Status != "DEGRADED" {
			return fmt.Errorf("readiness response has no valid status")
		}
	} else if body.Status != "ok" {
		return fmt.Errorf("health response has no valid status")
	}
	if !readiness && expectedVersion != "" && body.Version != expectedVersion {
		return fmt.Errorf("health response version %q does not match expected %q", body.Version, expectedVersion)
	}
	return nil
}
