# Local Windows Runner Guide

**Last updated:** 2026-07-07  
**Branch:** mvp_nippon

---

## Prerequisites

- Node.js 20+
- Windows 10/11 with Print Spooler service running
- Network access to the PrinterOps API (default: http://localhost:3001)

---

## Starting the runner

```powershell
# Install dependencies (first time only, from repo root)
npm install

# Start the runner (Go; the TypeScript runner no longer exists)
cd apps\runner-go
go run ./cmd/printops-runner run
```

The runner will:
1. Auto-login with dev credentials (`admin@printerops.local`)
2. Register itself with the API (10 retry attempts)
3. Start heartbeat loop (every 10s)
4. Start print job poll loop (every 2s)
5. Start printer discovery loop (every 60s — configurable)

---

## Printer discovery

Discovery runs automatically every 60 seconds using PowerShell:

```powershell
Get-Printer | Select-Object Name,DriverName,PortName,Shared,Default | ConvertTo-Json -Compress
```

**Safety constraints (these are hard rules):**
- Read-only — no changes to printer configuration
- Spooler is never restarted
- No test prints are sent from discovered printers
- Discovery results are synced to API; human review required before a printer can be used

---

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `API_URL` | `http://localhost:3001` | PrinterOps API URL |
| `RUNNER_API_TOKEN` | (empty) | Static JWT token. If empty, runner auto-logs in with dev credentials |
| `RUNNER_NAME` | `runner-{hostname}` | Runner display name in dashboard |
| `DISCOVERY_INTERVAL_MS` | `60000` | Discovery interval in milliseconds |
| `DISCOVERY_ADAPTER` | `auto` | `auto`, `windows`, `macos`, `fake` |
| `POLL_INTERVAL_MS` | `2000` | Job poll interval |
| `HEARTBEAT_INTERVAL_MS` | `10000` | Heartbeat interval |

---

## Running as a Windows Service (future)

For production, the runner should run as a Windows Service so it starts automatically and survives user logout.

Options (not yet implemented):
1. **NSSM** (Non-Sucking Service Manager) — wrap the Node.js process
2. **WinSW** — XML-configured Windows Service wrapper
3. **Tauri sidecar** — launch runner as a sidecar from the desktop app

See `docs/decisions/0002-windows-runner-service.md` for the discovery architecture.

---

## Registering discovered printers

After discovery syncs printers to the API:
1. Open the dashboard (`http://localhost:3000` or the Tauri desktop app)
2. Go to **Discovery** page
3. Find the printer you want to register
4. Click **Register** (requires Admin or Owner role)
5. The printer is now available for print jobs via its `printer_code`

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `Register attempt 1 failed` on start | Check API is running on :3001 |
| No printers discovered | Check Print Spooler service is running: `Get-Service Spooler` |
| `powershell.exe` not found | Verify PowerShell is in PATH |
| Discovery returns empty list | Verify at least one printer is installed: `Get-Printer` in PowerShell |
