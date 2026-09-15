package jobs

import (
	"net/url"
	"strconv"
)

// parseTCPAddress extracts the host and port from a connection URI like
// "tcp://192.168.1.50:9100" or "192.168.1.50:9100". Returns ok=false if the
// URI cannot be parsed or has no port.
func parseTCPAddress(uri string) (addr string, port string, ok bool) {
	if uri == "" {
		return "", "", false
	}

	// If it starts with "tcp" scheme, parse as URL.
	if len(uri) > 6 && (uri[:3] == "tcp" || uri[:3] == "TCP") {
		u, err := url.Parse(uri)
		if err == nil && u.Host != "" {
			host := u.Hostname()
			port := u.Port()
			if host != "" && port != "" {
				return host, port, true
			}
		}
	}

	// Fallback: try "host:port" format directly.
	for i := len(uri) - 1; i >= 0; i-- {
		if uri[i] == ':' {
			host := uri[:i]
			port := uri[i+1:]
			if host != "" && port != "" {
				if _, err := strconv.Atoi(port); err == nil {
					return host, port, true
				}
			}
			break
		}
	}

	return "", "", false
}
