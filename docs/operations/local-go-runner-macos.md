# Local Go Runner — macOS

## Prerequisites

- Go 1.21+
- PrintOps API running on `http://localhost:3001`

## Quick Start

```bash
cd apps/runner-go

# Run in fake mode (default — no real printing)
go run ./cmd/printops-runner
```

## macOS-Specific Discovery

```bash
# Use macOS lpstat discovery
PRINTOPS_DISCOVERY_MODE=macos go run ./cmd/printops-runner
```

This runs:
- `lpstat -p` — list printers
- `lpstat -v` — list printer URIs
- `lpoptions -d` — default printer

5-second timeout per command. If CUPS is not running, falls back to empty results with a warning.

## Override to Fake Mode on macOS

```bash
# Force fake discovery even on macOS
PRINTOPS_DISCOVERY_MODE=fake go run ./cmd/printops-runner
```

## Debug Mode

```bash
PRINTOPS_LOG_LEVEL=debug go run ./cmd/printops-runner
```

## Testing Fake Discovery

```bash
# Verify fake discovery returns sample printers
PRINTOPS_DISCOVERY_MODE=fake PRINTOPS_LOG_LEVEL=debug go run ./cmd/printops-runner

# Watch logs for:
# {"level":"info","msg":"discovery complete","count":3,"duration_ms":0}
# {"level":"debug","printer":"LAB_LABEL_01",...}
```

## Testing Fake Print Job

1. Ensure API is running and runner is registered
2. Create a job:

```bash
curl -X POST http://localhost:3001/api/v1/jobs \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"printer_code":"LAB_LABEL_01","payload":"SGVsbG8=","copies":1}'
```

3. Watch runner logs for job pickup, execution, and result reporting

## Building a Binary

```bash
cd apps/runner-go
go build -o printops-runner ./cmd/printops-runner
./printops-runner run
```

## Future: launchd Integration

macOS service management via `launchd` is planned (see `service/macos` stub). For now, run in Terminal or use `nohup`:

```bash
nohup ./printops-runner run > runner.log 2>&1 &
```

## Troubleshooting

| Problem | Solution |
|---|---|
| `lpstat: command not found` | Install CUPS: `brew install cups` (pre-installed on macOS) |
| API connection refused | Ensure `apps/api` is running on port 3001 |
| Permission denied | macOS may prompt for Local Network access; allow it |
| No printers discovered | Check `lpstat -p` manually; use `PRINTOPS_DISCOVERY_MODE=fake` for testing |