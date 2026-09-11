package updater

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHTTPHealthProbeRequiresTargetVersionAndReadiness(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("x-printops-ota-token") != "local-token" {
			response.WriteHeader(http.StatusUnauthorized)
			return
		}
		response.Header().Set("content-type", "application/json")
		switch request.URL.Path {
		case "/health":
			_, _ = response.Write([]byte(`{"status":"ok","version":"0.1.29"}`))
		case "/api/v1/system/readiness":
			_, _ = response.Write([]byte(`{"contractVersion":1,"applicationVersion":"0.1.29","ota":{"contract":"printops-ota-v1","status":"READY","requiredComponents":{"localApi":{"state":"READY"},"database":{"state":"READY"},"localPrintWorker":{"state":"READY"}}},"status":"DEGRADED"}`))
		default:
			response.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	probe := HTTPHealthProbe{Client: server.Client()}
	if err := probe.Wait(server.URL, "local-token", "0.1.29", time.Second); err != nil {
		t.Fatalf("health probe failed: %v", err)
	}
	if err := probeEndpoint(server.Client(), server.URL+"/health", "local-token", "0.1.30", false); err == nil {
		t.Fatal("expected a health version mismatch to be rejected")
	}
}

func TestHTTPHealthProbeRejectsDegradedOTAContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("content-type", "application/json")
		if request.URL.Path == "/health" {
			_, _ = response.Write([]byte(`{"status":"ok","version":"0.1.29"}`))
			return
		}
		_, _ = response.Write([]byte(`{"contractVersion":1,"applicationVersion":"0.1.29","ota":{"contract":"printops-ota-v1","status":"NOT_READY","requiredComponents":{"localApi":{"state":"READY"},"database":{"state":"READY"},"localPrintWorker":{"state":"UNAVAILABLE"}}},"status":"DEGRADED"}`))
	}))
	defer server.Close()

	probe := HTTPHealthProbe{Client: server.Client()}
	if err := probe.Wait(server.URL, "", "0.1.29", 100*time.Millisecond); err == nil {
		t.Fatal("expected degraded OTA readiness to be rejected")
	}
}
