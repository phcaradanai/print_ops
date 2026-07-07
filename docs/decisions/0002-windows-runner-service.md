# ADR 0002 — Windows Runner Printer Discovery

**Status:** Accepted  
**Date:** 2026-07-07  
**Branch:** mvp_nippon

---

## Context

PrintOps Runner is a Node.js service that runs on the local PC and bridges it to the PrintOps API.  
Before a printer can be used via PrintOps, it must exist in the Printer Registry.  
Sysadmins need a way to see which printers are installed on each runner machine without leaving the dashboard.

---

## Decision

Implement **read-only printer discovery** via PowerShell `Get-Printer` on Windows.

Key constraints (hard rules, not negotiable for this phase):

| Constraint | Rationale |
|---|---|
| Read-only — no spooler restart | Restarting Print Spooler drops all active print jobs; forbidden in clinical environments |
| No printer config changes | Discovery must be safe to run continuously without side effects |
| No direct print from discovered printers | A printer must be registered first; discovery ≠ authorization to print |
| Discovery does not block the print path | Print polling loop runs independently; a slow or failed discovery must not delay jobs |
| Admin/Owner role required to register | Reduces risk of unauthorized printers entering the registry |

---

## Discovery mechanism

- **Windows:** `powershell.exe -NonInteractive -NoProfile -Command "Get-Printer | Select-Object Name,DriverName,PortName,Shared,Default | ConvertTo-Json -Compress"`
- **Linux/macOS (dev/fallback):** `lpstat -a` — returns printer names only
- **Timeout:** 10 seconds; on timeout or error, returns empty list silently
- **Frequency:** Every 60 seconds (configurable via `DISCOVERY_INTERVAL_MS` env var)

Connection type is detected from `PortName`:

| Pattern | Type |
|---|---|
| `USB*` | usb |
| `WSD-*` | wsd |
| `LPT*`, `COM*` | lpt_com |
| IP address or `IP_*` | tcp_ip |
| `\\server\...` | network_share |
| anything else | unknown |

---

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/runners/:id/printers/discovery` | JWT | Runner syncs discovered printer list |
| GET | `/api/v1/runners/:id/printers` | JWT | List discovered printers for a runner |
| GET | `/api/v1/discovered-printers` | JWT | List all discovered printers (all runners) |
| POST | `/api/v1/discovered-printers/:id/register` | JWT + ADMIN/OWNER | Register as real Printer |

---

## Idempotency

Discovery sync uses upsert keyed on `(runner_id, local_printer_name)`.  
Re-running the same discovery updates `last_seen_at` only — no duplicates created.

---

## Rejected alternatives

| Alternative | Reason rejected |
|---|---|
| WMI/CIM query directly | `Get-Printer` already uses WMI internally; no benefit to going lower |
| Run discovery on API server | API runs on a different machine; only the runner can see local printers |
| Store discovery result as a print Job | Would poison the print queue; discovery is not a print operation |
| Auto-register all discovered printers | Too risky for unknown or legacy printers; requires human review |
