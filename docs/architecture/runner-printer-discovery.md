# Runner Printer Discovery

## On-demand network search (LAN / VPN)

The Discovered Printers page also supports a network search from a selected Go
Runner. Update the API, dashboard, and Runner together; only Runners advertising
`metadata.network_printer_search: true` can accept this search. It runs even when
`PRINTOPS_JOBS_ENABLED=false`, as in the desktop discovery-only configuration.

1. Select the Runner whose machine can reach the printer through LAN or VPN.
2. Enter a single IPv4 address (`192.168.1.50`), CIDR (`192.168.1.0/24`), or inclusive
   range (`192.168.1.10-192.168.1.50`). Separate multiple targets with commas. Up to
   256 distinct addresses are accepted; CIDR includes all addresses in its block.
3. Start the search. The Runner checks TCP port **9100** with at most 16 concurrent
   connections, a 1.5-second per-address timeout, and a 60-second overall deadline.
   It sends no print bytes. An open TCP port is only a candidate; printer model and
   physical output are not verified.
4. Register a candidate in the discovery table to create a `raw_tcp_9100` printer
   with `tcp://<address>:9100`, preserving the selected Runner association. Choose
   compatible templates/paper settings before actual printing. Registration sends
   no test page. IPP-only/LPD-only devices and IPv6 are not scanned in this release.

The API persists commands and results in `network_printer_searches` (schema 10).
Only one queued/running search is permitted per Runner. Queued work expires after
120 seconds; a claim expires after 75 seconds. The Runner polls using outbound
authenticated HTTP, so no incoming VPN connection to the Runner is required.
Late results are rejected; retries of an identical completed report are idempotent.
Partial results are retained when the scan times out. Revisiting the page restores
the latest search for the selected Runner. Repeated scans retain registration links.

API routes (prefix `/api/v1`):

- `POST /runners/:runnerId/printer-searches` with `{ "targets": "192.168.1.0/24" }`
  requires `printer:create`; returns HTTP 202 with a search ID.
- `GET /runners/:runnerId/printer-searches/latest` and `GET /printer-searches/:id`
  require `printer:read`. Dashboard responses omit the claim credential.
- `POST /runners/:runnerId/printer-searches/claim` and
  `POST /runners/:runnerId/printer-searches/:id/results` require `runner:manage`.
  The result includes `claimToken`, a subset of requested `addresses`, and a boolean
  `incomplete`. Claims are checked against the Runner and search on every report.

Ping success does not establish TCP 9100 reachability. If nothing is found, check
the target range, VPN routes, printer protocol, and firewall **from the selected
Runner machine**. A completed empty result differs from an expired search, which
means the Runner did not report in time. Repository tests use simulated endpoints;
verify discovery and printing separately against the actual VPN before deployment.

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
