# Local Go Runner — Windows

## Prerequisites

- Go 1.21+
- PrintOps API running on `http://localhost:3001`

## Quick Start (Dev Mode)

```powershell
cd apps\runner-go

# Run in fake mode (default — no real printing)
go run .\cmd\printops-runner
```

## Windows-Specific Discovery

```powershell
# Use Windows Get-Printer discovery
$env:PRINTOPS_DISCOVERY_MODE="windows"
go run .\cmd\printops-runner
```

This runs PowerShell commands:
- `Get-Printer | ConvertTo-Json` — list installed printers
- `Get-PrinterPort | ConvertTo-Json` — list printer ports

Read-only. Never restarts the spooler or changes printer config.

## Override to Fake Mode on Windows

```powershell
$env:PRINTOPS_DISCOVERY_MODE="fake"
go run .\cmd\printops-runner
```

## Debug Mode

```powershell
$env:PRINTOPS_LOG_LEVEL="debug"
go run .\cmd\printops-runner
```

## Testing Fake Discovery

```powershell
$env:PRINTOPS_DISCOVERY_MODE="fake"
$env:PRINTOPS_LOG_LEVEL="debug"
go run .\cmd\printops-runner

# Watch logs for:
# {"level":"info","msg":"discovery complete","count":3,"duration_ms":0}
# {"level":"debug","printer":"LAB_LABEL_01",...}
```

## Testing Fake Print Job

1. Ensure API is running and runner is registered
2. Create a job via curl or PowerShell:

```powershell
$body = @{ printer_code = "LAB_LABEL_01"; payload = "SGVsbG8="; copies = 1 } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/api/v1/jobs" -Method Post -Body $body -ContentType "application/json" -Headers @{ Authorization = "Bearer <token>" }
```

3. Watch runner logs for job pickup, execution, and result reporting

## Building a Binary

```powershell
cd apps\runner-go
go build -o printops-runner.exe .\cmd\printops-runner
.\printops-runner.exe run
```

## Windows Service (Future)

CLI stubs are available:

```powershell
.\printops-runner.exe install-service     # Stub — prints instructions
.\printops-runner.exe uninstall-service   # Stub — prints instructions
```

> **Note**: These are documentation stubs. Actual Windows Service registration via `golang.org/x/sys/windows/svc` is a planned next step. For dev, run interactively with `.\printops-runner.exe run`.

For background dev usage:

```powershell
Start-Process -FilePath ".\printops-runner.exe" -ArgumentList "run" -WindowStyle Hidden
```

## Config File (Optional)

Create `runner.env`:

```ini
PRINTOPS_API_BASE_URL=http://localhost:3001
PRINTOPS_RUNNER_NAME=Windows Lab Runner
PRINTOPS_DISCOVERY_MODE=fake
PRINTOPS_EXECUTOR_MODE=fake
PRINTOPS_POLL_INTERVAL_MS=500
```

```powershell
$env:PRINTOPS_CONFIG_FILE=".\runner.env"
go run .\cmd\printops-runner
```

## Troubleshooting

| Problem | Solution |
|---|---|
| `Get-Printer` not recognized | Windows 8+ / Server 2012+ required; or use `PRINTOPS_DISCOVERY_MODE=fake` |
| PowerShell execution policy | Runner uses `-Command`, not scripts; policy should not matter |
| API connection refused | Ensure `apps/api` is running on port 3001 |
| Access denied | Run PowerShell as admin for `Get-Printer` on some Windows versions |
| Spooler not running | Start `Print Spooler` service: `Start-Service -Name Spooler` (not done by runner) |