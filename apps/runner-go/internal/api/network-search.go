package api

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

type NetworkPrinterSearch struct {
	ID         string    `json:"id"`
	Targets    []string  `json:"targets"`
	ClaimToken string    `json:"claimToken"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

func (c *Client) ClaimNetworkPrinterSearch(ctx context.Context, runnerID string) (*NetworkPrinterSearch, error) {
	var search *NetworkPrinterSearch
	path := fmt.Sprintf("/api/v1/runners/%s/printer-searches/claim", url.PathEscape(runnerID))
	_, err := c.doJSON(ctx, http.MethodPost, path, nil, &search, true)
	return search, err
}

func (c *Client) ReportNetworkPrinterSearch(ctx context.Context, runnerID string, search *NetworkPrinterSearch, addresses []string, incomplete bool) error {
	if addresses == nil {
		addresses = []string{}
	}
	path := fmt.Sprintf("/api/v1/runners/%s/printer-searches/%s/results", url.PathEscape(runnerID), url.PathEscape(search.ID))
	_, err := c.doJSON(ctx, http.MethodPost, path, map[string]any{"claimToken": search.ClaimToken, "addresses": addresses, "incomplete": incomplete}, nil, true)
	return err
}
