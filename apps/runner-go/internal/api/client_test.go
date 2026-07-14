package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery"
)

// newTestClient returns an api.Client pointed at a test server and the server's
// URL. The server records the last request body into lastBody (JSON string).
func newTestClient(t *testing.T, handler http.HandlerFunc) (*Client, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	c.Token = "test-token"
	return c, srv
}

func TestRegister_BuildsCorrectPayload(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/runners/register" {
			t.Errorf("path = %q, want /runners/register", r.URL.Path)
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		_, _ = w.Write([]byte(`{"id":"runner-123","name":"test","hostname":"h","status":"ONLINE"}`))
	}))
	t.Cleanup(srv.Close)

	c := NewClient(srv.URL)
	resp, err := c.Register(context.Background(), RegisterRequest{
		Name:               "test-runner",
		Hostname:           "host-1",
		SupportedProtocols: []string{"RAW_TCP_9100"},
		Metadata:           map[string]any{"os": "darwin"},
		Os:                 "darwin",
		Arch:               "arm64",
		Version:            "0.1.0",
	})
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}
	if resp.ID != "runner-123" {
		t.Errorf("resp.ID = %q, want runner-123", resp.ID)
	}
	if gotBody["name"] != "test-runner" {
		t.Errorf("payload name = %v, want test-runner", gotBody["name"])
	}
	if gotBody["hostname"] != "host-1" {
		t.Errorf("payload hostname = %v, want host-1", gotBody["hostname"])
	}
	if gotBody["os"] != "darwin" {
		t.Errorf("payload os = %v, want darwin", gotBody["os"])
	}
	protos, _ := gotBody["supportedProtocols"].([]any)
	if len(protos) != 1 || protos[0] != "RAW_TCP_9100" {
		t.Errorf("payload supportedProtocols = %v, want [RAW_TCP_9100]", protos)
	}
}

func TestRegister_SendsBearerToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth != "Bearer my-jwt" {
			t.Errorf("Authorization = %q, want Bearer my-jwt", auth)
		}
		_, _ = w.Write([]byte(`{"id":"r1","name":"n"}`))
	}))
	t.Cleanup(srv.Close)

	c := NewClient(srv.URL)
	c.Token = "my-jwt"
	_, err := c.Register(context.Background(), RegisterRequest{Name: "n"})
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}
}

func TestHeartbeat_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/runners/r-1/heartbeat" {
			t.Errorf("path = %q", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	if err := c.Heartbeat(context.Background(), "r-1"); err != nil {
		t.Fatalf("Heartbeat failed: %v", err)
	}
}

func TestPollJob_ReturnsJobOnOK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"id":"job-1","status":"QUEUED","printer_code":"LAB_LABEL_01"}`))
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	job, err := c.PollJob(context.Background(), "r-1")
	if err != nil {
		t.Fatalf("PollJob failed: %v", err)
	}
	if job == nil {
		t.Fatal("expected job, got nil")
	}
	if job.ID != "job-1" {
		t.Errorf("job.ID = %q, want job-1", job.ID)
	}
}

func TestPollJob_EmptyBodyReturnsNil(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`null`))
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	job, err := c.PollJob(context.Background(), "r-1")
	if err != nil {
		t.Fatalf("PollJob failed: %v", err)
	}
	if job != nil {
		t.Errorf("expected nil job on null body, got %+v", job)
	}
}

func TestPollJob_NonOKReturnsNil(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	job, err := c.PollJob(context.Background(), "r-1")
	if err != nil {
		t.Fatalf("PollJob failed: %v", err)
	}
	if job != nil {
		t.Error("expected nil job on 204")
	}
}

func TestNextJob_ReturnsJob(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		_, _ = w.Write([]byte(`{"job":{"id":"job-2","status":"QUEUED"}}`))
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	job, _, err := c.NextJob(context.Background(), "r-1", 500)
	if err != nil {
		t.Fatalf("NextJob failed: %v", err)
	}
	if job == nil || job.ID != "job-2" {
		t.Fatalf("expected job job-2, got %+v", job)
	}
	if gotBody["wait_ms"] != float64(500) {
		t.Errorf("payload wait_ms = %v, want 500", gotBody["wait_ms"])
	}
}

func TestNextJob_ReturnsPrinterInfo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"job":{"id":"job-3","status":"QUEUED"},"printer":{"id":"p1","code":"LAB_LABEL_01","protocol":"raw-tcp-9100","connectionUri":"tcp://192.168.1.50:9100"}}`))
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	job, printer, err := c.NextJob(context.Background(), "r-1", 0)
	if err != nil {
		t.Fatalf("NextJob failed: %v", err)
	}
	if job == nil || job.ID != "job-3" {
		t.Fatalf("expected job job-3, got %+v", job)
	}
	if printer == nil {
		t.Fatal("expected printer info, got nil")
	}
	if printer.Protocol != "raw-tcp-9100" {
		t.Errorf("printer.Protocol = %q, want raw-tcp-9100", printer.Protocol)
	}
	if printer.ConnectionURI != "tcp://192.168.1.50:9100" {
		t.Errorf("printer.ConnectionURI = %q", printer.ConnectionURI)
	}
}

func TestNextJob_204ReturnsNil(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	job, _, err := c.NextJob(context.Background(), "r-1", 0)
	if err != nil {
		t.Fatalf("NextJob should not error on 204: %v", err)
	}
	if job != nil {
		t.Error("expected nil job on 204")
	}
}

func TestNextJob_404ReturnsNil(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	job, _, err := c.NextJob(context.Background(), "r-1", 0)
	if err != nil {
		t.Fatalf("NextJob should not error on 404: %v", err)
	}
	if job != nil {
		t.Error("expected nil job on 404")
	}
}

func TestReportEvent_SendsCorrectPayload(t *testing.T) {
	var gotBody JobEventRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wantPath := "/api/v1/runners/r-1/jobs/job-9/events"
		if r.URL.Path != wantPath {
			t.Errorf("path = %q, want %q", r.URL.Path, wantPath)
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	err := c.ReportEvent(context.Background(), "r-1", JobEventRequest{
		EventType: "RUNNER_JOB_RECEIVED",
		TraceID:   "trace-9",
		JobID:     "job-9",
		RunnerID:  "r-1",
		Status:    "received",
	})
	if err != nil {
		t.Fatalf("ReportEvent failed: %v", err)
	}
	if gotBody.EventType != "RUNNER_JOB_RECEIVED" {
		t.Errorf("event_type = %q", gotBody.EventType)
	}
	if gotBody.JobID != "job-9" {
		t.Errorf("job_id = %q", gotBody.JobID)
	}
}

func TestReportResult_SendsCorrectPayload(t *testing.T) {
	var gotBody JobResultRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wantPath := "/api/v1/runners/r-1/jobs/job-9/result"
		if r.URL.Path != wantPath {
			t.Errorf("path = %q, want %q", r.URL.Path, wantPath)
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	err := c.ReportResult(context.Background(), "r-1", JobResultRequest{
		TraceID:  "trace-9",
		JobID:    "job-9",
		RunnerID: "r-1",
		Status:   "SUCCESS",
		Executor: "fake",
	})
	if err != nil {
		t.Fatalf("ReportResult failed: %v", err)
	}
	if gotBody.Status != "SUCCESS" {
		t.Errorf("status = %q", gotBody.Status)
	}
}

func TestSyncDiscovery_SendsItems(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wantPath := "/api/v1/runners/r-1/printers/discovery"
		if r.URL.Path != wantPath {
			t.Errorf("path = %q, want %q", r.URL.Path, wantPath)
		}
		raw, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(raw), `"items"`) {
			t.Errorf("body should contain items: %s", raw)
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	err := c.SyncDiscovery(context.Background(), "r-1", nil)
	if err != nil {
		t.Fatalf("SyncDiscovery failed: %v", err)
	}
}

func TestReportExecution_LegacyEndpoint(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/jobs/job-1/execute" {
			t.Errorf("path = %q, want /jobs/job-1/execute", r.URL.Path)
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	err := c.ReportExecution(context.Background(), "job-1", "r-1")
	if err != nil {
		t.Fatalf("ReportExecution failed: %v", err)
	}
	if gotBody["runnerId"] != "r-1" {
		t.Errorf("runnerId = %v, want r-1", gotBody["runnerId"])
	}
}

func TestLogin_StoresToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"token":"jwt-abc"}`))
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	if err := c.Login(context.Background(), "a@b.c", "pw"); err != nil {
		t.Fatalf("Login failed: %v", err)
	}
	if c.Token != "jwt-abc" {
		t.Errorf("Token = %q, want jwt-abc", c.Token)
	}
}

func TestLogin_EmptyTokenErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"token":""}`))
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	if err := c.Login(context.Background(), "a@b.c", "pw"); err == nil {
		t.Error("expected error on empty token")
	}
}

func TestDoJSON_500ReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"boom"}`))
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)
	_, err := c.Register(context.Background(), RegisterRequest{Name: "x"})
	if err == nil {
		t.Fatal("expected error on 500")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("error should mention 500: %s", err)
	}
}

// TestSyncDiscovery_CamelCaseJSON asserts the discovery sync payload uses
// exact camelCase field names matching the TypeScript DiscoveryItem contract.
// The API stores undefined metadata when field names don't match, so this
// test is the contract guardrail.
func TestSyncDiscovery_CamelCaseJSON(t *testing.T) {
	var rawBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		rawBody = string(b)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL)

	dp := discovery.DiscoveredPrinter{
		LocalPrinterID: "ZEBRA_ZD230",
		Name:           "ZEBRA_ZD230 (Pharmacy)",
		DisplayName:    "Zebra ZD230",
		DriverName:     "ZDesigner ZD230-203dpi ZPL",
		PortName:       "USB002",
		URI:            "usb://Zebra/ZD230",
		Status:         "idle",
		IsDefault:      true,
		IsShared:       false,
		Location:       "Pharmacy Counter",
		Comment:        "Main label printer",
		ConnectionType: "usb",
		Raw:            map[string]any{"dpi": 203, "language": "ZPL"},
	}
	items := ToDiscoverySyncItems([]discovery.DiscoveredPrinter{dp}, "PC-NIPPON", "windows")

	err := c.SyncDiscovery(context.Background(), "r-1", items)
	if err != nil {
		t.Fatalf("SyncDiscovery failed: %v", err)
	}

	// Parse the JSON and assert every expected camelCase key is present
	// and NO snake_case key leaks through.
	var payload map[string]json.RawMessage
	if err := json.Unmarshal([]byte(rawBody), &payload); err != nil {
		t.Fatalf("payload is not valid JSON: %v\nraw: %s", err, rawBody)
	}

	itemsRaw, ok := payload["items"]
	if !ok {
		t.Fatalf("payload missing 'items' key: %s", rawBody)
	}
	var itemsArr []map[string]any
	if err := json.Unmarshal(itemsRaw, &itemsArr); err != nil {
		t.Fatalf("items is not an array: %v", err)
	}
	if len(itemsArr) != 1 {
		t.Fatalf("expected 1 item, got %d", len(itemsArr))
	}
	item := itemsArr[0]

	// Required camelCase fields must be present with correct values.
	if v, ok := item["localPrinterName"].(string); !ok || v != "ZEBRA_ZD230 (Pharmacy)" {
		t.Errorf("localPrinterName = %v, want 'ZEBRA_ZD230 (Pharmacy)'", item["localPrinterName"])
	}
	if v, ok := item["driverName"].(string); !ok || v != "ZDesigner ZD230-203dpi ZPL" {
		t.Errorf("driverName = %v", item["driverName"])
	}
	if v, ok := item["portName"].(string); !ok || v != "USB002" {
		t.Errorf("portName = %v", item["portName"])
	}
	if v, ok := item["connectionType"].(string); !ok || v != "usb" {
		t.Errorf("connectionType = %v", item["connectionType"])
	}
	if v, ok := item["isDefault"].(bool); !ok || !v {
		t.Errorf("isDefault = %v, want true", item["isDefault"])
	}
	if v, ok := item["isShared"].(bool); !ok || v {
		t.Errorf("isShared = %v, want false", item["isShared"])
	}
	if v, ok := item["computerName"].(string); !ok || v != "PC-NIPPON" {
		t.Errorf("computerName = %v, want 'PC-NIPPON'", item["computerName"])
	}
	if v, ok := item["osName"].(string); !ok || v != "windows" {
		t.Errorf("osName = %v, want 'windows'", item["osName"])
	}

	// Attributes must include status, location, comment, and raw fields.
	attrs, ok := item["attributes"].(map[string]any)
	if !ok {
		t.Fatalf("attributes is not an object: %T", item["attributes"])
	}
	if v := attrs["dpi"]; v != float64(203) {
		t.Errorf("attributes.dpi = %v, want 203", v)
	}
	if v := attrs["language"]; v != "ZPL" {
		t.Errorf("attributes.language = %v, want 'ZPL'", v)
	}
	if v := attrs["status"]; v != "idle" {
		t.Errorf("attributes.status = %v, want 'idle'", v)
	}
	if v := attrs["location"]; v != "Pharmacy Counter" {
		t.Errorf("attributes.location = %v, want 'Pharmacy Counter'", v)
	}
	if v := attrs["comment"]; v != "Main label printer" {
		t.Errorf("attributes.comment = %v, want 'Main label printer'", v)
	}

	// Snake_case keys must NOT appear.
	snakeKeys := []string{
		"local_printer_id", "display_name", "driver_name", "port_name",
		"is_default", "is_shared", "share_name", "connection_type",
		"computer_name", "os_name", "localPrinterId", "local_printer_name",
	}
	for _, key := range snakeKeys {
		if _, exists := item[key]; exists {
			t.Errorf("snake_case key %q leaked into sync payload: %s", key, rawBody)
		}
	}

	// Optional fields that should be absent in the default case.
	for _, key := range []string{"id", "runnerId", "firstSeenAt", "lastSeenAt"} {
		if _, exists := item[key]; exists {
			t.Errorf("unexpected key %q in payload", key)
		}
	}
}

// keep newTestClient helper reference to avoid unused warnings during edits
var _ = newTestClient
