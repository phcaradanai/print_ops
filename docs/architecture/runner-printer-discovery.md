# Runner Printer Discovery

**Phase:** MVP Nippon  
**Status:** Implemented

---

## Flow

```
[Runner on Windows PC]
  ↓  every 60s (DISCOVERY_INTERVAL_MS)
discoverPrinters()
  → powershell.exe Get-Printer → JSON
  → parseGetPrinterOutput(raw) → DiscoveryItem[]
  ↓  POST /api/v1/runners/:id/printers/discovery
[PrintOps API]
  → SyncPrinterDiscoveryService
  → DiscoveredPrinterRepository.upsert(runner_id, local_printer_name)
  ↓  stored in discovered_printers table

[Admin Dashboard]  GET /api/v1/discovered-printers
  → shows all discovered printers with runner, driver, port, connection type
  → Register button → POST /api/v1/discovered-printers/:id/register
  → RegisterDiscoveredPrinterService (requires ADMIN/OWNER)
  → creates Printer with protocol=windows_spooler
  → audits action
```

---

## Data model

```
DiscoveredPrinter {
  id                  UUID
  runnerId            string
  localPrinterName    string       # Windows spooler name (unique per runner)
  driverName?         string
  portName?           string
  connectionType      usb|tcp_ip|wsd|lpt_com|network_share|unknown
  isDefault           boolean
  isShared            boolean
  attributes          JSON         # raw metadata
  firstSeenAt         timestamp
  lastSeenAt          timestamp    # updated on every sync
  registeredPrinterId? string      # set when registered as real Printer
}
```

---

## Safety boundaries

| Action | Allowed |
|---|---|
| Read printer list via Get-Printer | YES |
| Restart Print Spooler | NO |
| Change printer config | NO |
| Send test print from discovered printer | NO |
| Register discovered printer (Admin only) | YES |
| Automatically register all | NO |

---

## Parser design

`parseGetPrinterOutput(raw: string): DiscoveryItem[]` is a **pure function** — it takes the raw PowerShell JSON string and returns parsed items with no side effects. This makes it fully testable on any platform (including macOS CI).

`discoverPrinters(): Promise<DiscoveryItem[]>` is the platform-aware wrapper that calls PowerShell on Windows or `lpstat` on Unix.

---

## Runner configuration

| Env var | Default | Description |
|---|---|---|
| `DISCOVERY_INTERVAL_MS` | `60000` | How often to run discovery (ms) |

---

## Connection type detection

| PortName pattern | connectionType |
|---|---|
| `USB*` | usb |
| `WSD-*` | wsd |
| `LPT*`, `COM*` | lpt_com |
| `192.168.*`, `IP_*` | tcp_ip |
| `\\server\printer` | network_share |
| anything else | unknown |
