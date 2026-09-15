# PrintOps MCP

This is a tool-only Model Context Protocol server for the local PrintOps API.
It provides read-only printer/job inspection and a guarded Datamax-O'Neil I-4208
validation batch. It does not bypass PrintOps authentication and it does not
render labels itself.

## Tools

- `list_printers` reads the authenticated active-printer list.
- `get_printer_status` reads one printer status.
- `get_print_job` reads one existing job.
- `run_datamax_validation_batch` submits one authenticated sandbox batch with
  exactly three numeric values, so a 3-up Datamax label is emitted as one row.

The validation tool requires `confirm: true`, a unique `batchId`, and uses the
configured Datamax printer/template/profile only. Values stay dynamic: the
default test set is `12345678`, `1234`, and `1234567890`; no value is padded.

## Local setup

Start the PrintOps desktop/API service first, then set credentials in the shell
that starts this server. Do not commit or print credentials.

```powershell
$env:PRINTOPS_API_URL = "http://127.0.0.1:31415"
$env:PRINTOPS_API_KEY = "<service-account-api-key>" # list/status/job tools
$env:PRINTOPS_JWT = "<short-lived-dashboard-jwt>"   # required for 3-up sandbox batch
$env:PRINTOPS_MCP_TOKEN = "<local-or-tunnel-token>"  # required off loopback
npm run --workspace @printerops/mcp build
npm run --workspace @printerops/mcp start
```

The local endpoint is `http://127.0.0.1:31888/mcp`. The server binds to
loopback by default. If it is exposed through a tunnel, set
`PRINTOPS_MCP_HOST` and `PRINTOPS_MCP_TOKEN` and keep the tunnel authenticated.

For an actual validation print, call `run_datamax_validation_batch` with a new
`batchId`, the three baseline values, and `confirm: true`. The API's sandbox
batch route is used so all three scenarios are consolidated into one physical
3-up row. The tool returns only batch identifiers and status fields, never
credentials.

## Verification

```powershell
npm run --workspace @printerops/mcp typecheck
npm run --workspace @printerops/mcp test
npx @modelcontextprotocol/inspector
```

In MCP Inspector choose Streamable HTTP and enter
`http://127.0.0.1:31888/mcp`. Initialization, tool metadata, confirmation
behavior, authentication failures, and representative values should be
checked before any physical print.
