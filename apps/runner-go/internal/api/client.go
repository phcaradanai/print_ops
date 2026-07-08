// Package api implements the PrintOps API client used by the Go runner.
//
// The client is HTTP/JSON based and talks to the existing Fastify API. It
// supports two authentication modes:
//   - Bearer JWT (preferred): obtained via POST /auth/login using dev creds
//     when PRINTOPS_RUNNER_TOKEN is unset.
//   - Static bearer token from PRINTOPS_RUNNER_TOKEN (preferred when provided).
//
// All requests have a timeout via the shared HTTP client; no call may hang.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery"
)

// Client is the PrintOps API client.
type Client struct {
	BaseURL string
	HTTP    *http.Client
	// Token is the bearer token used for auth. May be empty until login().
	Token string
}

// NewClient returns a client with conservative timeouts.
func NewClient(baseURL string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTP: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// Login authenticates with email/password and stores the JWT in Token.
func (c *Client) Login(ctx context.Context, email, password string) error {
	body := map[string]string{"email": email, "password": password}
	var resp struct {
		Token string `json:"token"`
	}
	if _, err := c.doJSON(ctx, http.MethodPost, "/auth/login", body, &resp, false); err != nil {
		return fmt.Errorf("login: %w", err)
	}
	if resp.Token == "" {
		return errors.New("login: empty token in response")
	}
	c.Token = resp.Token
	return nil
}

// RegisterRequest is the payload for POST /runners/register (legacy route,
// backward compatible). The existing API expects name/hostname/protocols/metadata.
type RegisterRequest struct {
	Name               string         `json:"name"`
	Hostname           string         `json:"hostname"`
	SupportedProtocols []string       `json:"supportedProtocols"`
	Metadata           map[string]any `json:"metadata"`
	Os                 string         `json:"os,omitempty"`
	Arch               string         `json:"arch,omitempty"`
	Version            string         `json:"version,omitempty"`
	RunnerID           string         `json:"runner_id,omitempty"`
}

// RegisterResponse mirrors the Runner domain object.
type RegisterResponse struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Hostname  string    `json:"hostname"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

// Register registers the runner with the API and returns the stored Runner.
func (c *Client) Register(ctx context.Context, req RegisterRequest) (*RegisterResponse, error) {
	var resp RegisterResponse
	if _, err := c.doJSON(ctx, http.MethodPost, "/runners/register", req, &resp, true); err != nil {
		return nil, fmt.Errorf("register: %w", err)
	}
	return &resp, nil
}

// Heartbeat pings the API to signal liveness.
func (c *Client) Heartbeat(ctx context.Context, runnerID string) error {
	if _, err := c.doJSON(ctx, http.MethodPost, fmt.Sprintf("/runners/%s/heartbeat", runnerID), nil, nil, true); err != nil {
		return fmt.Errorf("heartbeat: %w", err)
	}
	return nil
}

// DiscoverySyncRequest is the payload for
// POST /api/v1/runners/:runnerId/printers/discovery (existing endpoint).
type DiscoverySyncRequest struct {
	Items []discovery.DiscoveredPrinter `json:"items"`
}

// SyncDiscovery syncs discovered printers to the API.
func (c *Client) SyncDiscovery(ctx context.Context, runnerID string, items []discovery.DiscoveredPrinter) error {
	body := DiscoverySyncRequest{Items: items}
	if _, err := c.doJSON(ctx, http.MethodPost, fmt.Sprintf("/api/v1/runners/%s/printers/discovery", runnerID), body, nil, true); err != nil {
		return fmt.Errorf("sync discovery: %w", err)
	}
	return nil
}

// PollJob fetches the next queued job for this runner via the existing
// GET /runners/:id/poll endpoint. Returns (nil, nil) when no job is available.
func (c *Client) PollJob(ctx context.Context, runnerID string) (*Job, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+fmt.Sprintf("/runners/%s/poll", runnerID), nil)
	if err != nil {
		return nil, err
	}
	c.applyAuth(req)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusOK {
		raw, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("read poll body: %w", err)
		}
		if len(bytes.TrimSpace(raw)) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return nil, nil
		}
		var job Job
		if err := json.Unmarshal(raw, &job); err != nil {
			return nil, fmt.Errorf("decode poll job: %w", err)
		}
		return &job, nil
	}
	// Non-OK: treat as no job, but signal transient errors via separate checks.
	return nil, nil
}

// ReportExecution calls the existing POST /jobs/:id/execute endpoint (legacy
// route) to mark a job executed by this runner. The body shape matches the TS
// runner: { runnerId }. This keeps the API backward compatible.
func (c *Client) ReportExecution(ctx context.Context, jobID, runnerID string) error {
	body := map[string]string{"runnerId": runnerID}
	if _, err := c.doJSON(ctx, http.MethodPost, fmt.Sprintf("/jobs/%s/execute", jobID), body, nil, true); err != nil {
		return fmt.Errorf("report execution: %w", err)
	}
	return nil
}

// NextJob claims the next queued job via the new runner-scoped endpoint
// POST /api/v1/runners/:runnerId/jobs/next. Returns (nil, nil, nil) when no job
// is available. This endpoint is backward compatible (added alongside the legacy
// poll route; the TS runner is unaffected).
func (c *Client) NextJob(ctx context.Context, runnerID string, waitMillis int) (*Job, *PrinterInfo, error) {
	body := NextJobRequest{RunnerID: runnerID, WaitMillis: waitMillis}
	var resp NextJobResponse
	if _, err := c.doJSON(ctx, http.MethodPost, fmt.Sprintf("/api/v1/runners/%s/jobs/next", runnerID), body, &resp, true); err != nil {
		// Treat 404/409 as "no job available" to avoid noisy logs.
		if strings.Contains(err.Error(), "HTTP 204") || strings.Contains(err.Error(), "HTTP 404") {
			return nil, nil, nil
		}
		return nil, nil, fmt.Errorf("next job: %w", err)
	}
	return resp.Job, resp.Printer, nil
}

// ReportEvent sends a trace/timing/audit event for a job.
// POST /api/v1/runners/:runnerId/jobs/:jobId/events
func (c *Client) ReportEvent(ctx context.Context, runnerID string, req JobEventRequest) error {
	path := fmt.Sprintf("/api/v1/runners/%s/jobs/%s/events", runnerID, req.JobID)
	if _, err := c.doJSON(ctx, http.MethodPost, path, req, nil, true); err != nil {
		return fmt.Errorf("report event: %w", err)
	}
	return nil
}

// ReportResult sends the terminal job result.
// POST /api/v1/runners/:runnerId/jobs/:jobId/result
func (c *Client) ReportResult(ctx context.Context, runnerID string, req JobResultRequest) error {
	path := fmt.Sprintf("/api/v1/runners/%s/jobs/%s/result", runnerID, req.JobID)
	if _, err := c.doJSON(ctx, http.MethodPost, path, req, nil, true); err != nil {
		return fmt.Errorf("report result: %w", err)
	}
	return nil
}

// doJSON is the shared request helper. When auth=true it adds the bearer token.
func (c *Client) doJSON(ctx context.Context, method, path string, body any, out any, auth bool) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal body: %w", err)
		}
		reader = bytes.NewReader(buf)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if auth {
		c.applyAuth(req)
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return resp, fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode >= 400 {
		return resp, fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(string(raw), 200))
	}
	if out != nil && len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return resp, fmt.Errorf("decode body: %w", err)
		}
	}
	return resp, nil
}

func (c *Client) applyAuth(req *http.Request) {
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
