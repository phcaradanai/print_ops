package network

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/api"
)

func TestLoopClaimsFromRunnerAndRetriesOnlyResultReporting(t *testing.T) {
	claims, reports, dials := 0, 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("wrong request method/auth")
		}
		switch r.URL.Path {
		case "/api/v1/runners/vpn/printer-searches/claim":
			claims++
			json.NewEncoder(w).Encode(map[string]any{"id": "s1", "claimToken": "secret", "targets": []string{"10.0.0.1"}, "expiresAt": time.Now().Add(75 * time.Second)})
		case "/api/v1/runners/vpn/printer-searches/s1/results":
			reports++
			var payload struct {
				ClaimToken string   `json:"claimToken"`
				Addresses  []string `json:"addresses"`
				Incomplete bool     `json:"incomplete"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Error(err)
			}
			if payload.ClaimToken != "secret" || payload.Addresses == nil || len(payload.Addresses) != 0 || payload.Incomplete {
				t.Errorf("bad result %+v", payload)
			}
			if reports == 1 {
				w.WriteHeader(503)
			} else {
				w.Write([]byte(`{}`))
			}
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	client := api.NewClient(server.URL)
	client.Token = "test-token"
	loop := Looper{Client: client, RunnerID: "vpn", Scanner: Scanner{Dial: func(context.Context, string, string) (net.Conn, error) { dials++; return nil, errors.New("closed") }}}
	if err := loop.Once(context.Background()); err != nil {
		t.Fatal(err)
	}
	if claims != 1 || reports != 2 || dials != 1 {
		t.Fatalf("unexpected repeats claims=%d reports=%d dials=%d", claims, reports, dials)
	}
}

func TestLoopAcceptsNoPendingSearch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`null`)) }))
	defer server.Close()
	loop := Looper{Client: api.NewClient(server.URL), RunnerID: "vpn"}
	if err := loop.Once(context.Background()); err != nil {
		t.Fatal(err)
	}
}
