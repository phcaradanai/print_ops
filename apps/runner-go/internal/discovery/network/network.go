// Package network searches explicit IPv4 targets without writing print data.
package network

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"sort"
	"sync"
	"time"
)

type Scanner struct {
	Dial func(context.Context, string, string) (net.Conn, error)
}

// Scan only connects to TCP 9100 and closes. An open port is a candidate,
// not proof of printer identity or successful physical printing.
func (s Scanner) Scan(ctx context.Context, targets []string) ([]string, bool, error) {
	if len(targets) == 0 || len(targets) > 256 {
		return nil, false, fmt.Errorf("expected 1 to 256 IPv4 addresses")
	}
	unique := make(map[string]bool)
	for _, target := range targets {
		address, err := netip.ParseAddr(target)
		if err != nil || !address.Is4() || address.String() != target {
			return nil, false, fmt.Errorf("invalid IPv4 target %q", target)
		}
		unique[target] = true
	}
	dial := s.Dial
	if dial == nil {
		dial = (&net.Dialer{}).DialContext
	}
	scanCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	jobs := make(chan string, len(unique))
	for target := range unique {
		jobs <- target
	}
	close(jobs)
	results := make([]string, 0)
	var mu sync.Mutex
	var workers sync.WaitGroup
	for i := 0; i < 16 && i < len(unique); i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for target := range jobs {
				if scanCtx.Err() != nil {
					return
				}
				dialCtx, stop := context.WithTimeout(scanCtx, 1500*time.Millisecond)
				conn, err := dial(dialCtx, "tcp", net.JoinHostPort(target, "9100"))
				stop()
				if err == nil {
					conn.Close()
					mu.Lock()
					results = append(results, target)
					mu.Unlock()
				}
			}
		}()
	}
	workers.Wait()
	sort.Strings(results)
	return results, scanCtx.Err() != nil, nil
}
