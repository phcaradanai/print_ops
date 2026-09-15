# Windows Printing Boundary

**Phase:** MVP Nippon  
**Status:** Defined

---

## What PrinterOps controls

```
[External System]
    ↓  POST /api/v1/print-jobs  (X-Api-Key)
[PrinterOps API]
    ↓  runner polls /runners/:id/poll
[Runner on Windows PC]
    ↓  WindowsSpoolerPrintAdapter (skeleton — not yet implemented)
[Windows Print Spooler]
    ↓
[Physical Printer]
```

PrinterOps controls: job acceptance, validation, routing, tracking, and execution trigger.  
PrinterOps does NOT control: spooler configuration, driver installation, printer sharing.

---

## Discovery boundary (read-only)

| Operation | Allowed | Implementation |
|---|---|---|
| List installed printers | YES | `Get-Printer` PowerShell — read-only |
| Read driver name | YES | `Get-Printer` output field |
| Read port name | YES | `Get-Printer` output field |
| Check default / shared flags | YES | `Get-Printer` output fields |
| Restart Print Spooler | **NO** | Forbidden — drops active print jobs |
| Change printer configuration | **NO** | Forbidden — this phase is read-only |
| Install/remove printer drivers | **NO** | Out of scope |
| Change default printer | **NO** | Out of scope |

---

## Print execution boundary (future)

When `WindowsSpoolerPrintAdapter` is implemented:

| Operation | Allowed | Notes |
|---|---|---|
| Send document to spooler via Win32 | YES | After printer is registered |
| Print from undiscovered printer | **NO** | Must be registered first |
| Print from registered printer (all users) | YES (Admin/Owner) | RBAC enforced |
| Cancel a print job via spooler | Future | Not MVP |
| Pause/resume spooler queue | **NO** | Out of scope |

---

## Connection type mapping

Windows printer connection types are detected from `PortName`:

| PortName pattern | connectionType | Example adapter |
|---|---|---|
| `USB*` | usb | WindowsSpoolerPrintAdapter |
| `192.168.*`, `IP_*` | tcp_ip | RawTcp9100PrintAdapter or WindowsSpoolerPrintAdapter |
| `WSD-*` | wsd | WindowsSpoolerPrintAdapter |
| `LPT*`, `COM*` | lpt_com | WindowsSpoolerPrintAdapter |
| `\\server\...` | network_share | WindowsSpoolerPrintAdapter |
| other | unknown | Needs manual review |

---

## macOS CUPS boundary

On macOS, discovery uses `lpstat` tools:

| Command | Purpose | Side effects |
|---|---|---|
| `lpstat -p` | List printers and status | None — read-only |
| `lpstat -v` | List device URIs | None — read-only |
| `lpstat -d` | Get default printer | None — read-only |

CUPS connection types are detected from the device URI scheme:
- `usb://` → usb
- `socket://`, `ipp://`, `ipps://`, `dnssd://`, `lpd://` → tcp_ip
- other → unknown

---

## Safety invariants

These hold throughout the codebase and must not be relaxed without a new ADR:

1. Discovery is always read-only — it cannot trigger prints or config changes
2. A printer must be registered (Admin/Owner action) before any job can target it
3. The discovery loop is isolated from the print path — a slow or failed discovery never delays a print job
4. The Windows Print Spooler is never restarted by PrinterOps code
