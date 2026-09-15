# Runner: Local Network Architecture

## Role

The **Local Runner** is the bridge between PrintOps API and the physical printer attached to a PC Client.

```
[External Integration Program]
        ↓
[PrintOps API]  ←→  [PostgreSQL / Queue]
        ↓
[Local Runner] ←— runs on PC / server with printer access
        ↓
[Printer (USB / LAN port 9100 / Windows Spooler / CUPS)]
```

## Runner Does NOT Connect to HIS

The runner knows nothing about HIS, clinical data, or orders.
It receives a `print job` from the API and executes it via an **adapter**.

## Registration & Heartbeat

```bash
# Runner registers on startup
POST /runners/register
{
  "name": "ward-3-runner",
  "hostname": "pc-ward-3",
  "supportedProtocols": ["raw_tcp_9100", "windows_spooler", "fake"],
  "metadata": {}
}

# Heartbeat every 10s (configurable)
POST /runners/:id/heartbeat
```

The API marks a runner `offline` if no heartbeat is received for > 60s (implement in future).

## Job Polling Flow

```
1. Runner → GET /runners/:id/poll        (returns next QUEUED job or null)
2. Runner → POST /jobs/:id/execute       (API executes via adapter, returns result)
3. Runner logs result with timing
4. Repeat after pollIntervalMs (default: 2s)
```

## Adapter Selection

The runner (via the API's AdapterRegistry) selects the adapter based on `printer.protocol`:

| Protocol | Adapter | Status |
|----------|---------|--------|
| fake | FakePrinterAdapter | ✅ Implemented |
| raw_tcp_9100 | RawTcp9100Adapter | 🔧 Skeleton |
| windows_spooler | WindowsSpoolerAdapter | 🔧 Skeleton |
| cups | CupsPrinterAdapter | 🔧 Skeleton |
| ipp | IppPrinterAdapter | 🔧 Skeleton |

## Configuration

```env
API_URL=http://printops-server:3001
RUNNER_API_TOKEN=<jwt_token>
RUNNER_NAME=ward-3-runner
HOSTNAME=pc-ward-3
SUPPORTED_PROTOCOLS=raw_tcp_9100,windows_spooler,fake
POLL_INTERVAL_MS=2000
HEARTBEAT_INTERVAL_MS=10000
```

## Reconnect / Offline Behavior

The runner:
1. Retries registration up to 10 times with 3s delay
2. Heartbeat failures are logged but do not stop the runner
3. Poll failures are logged and retried on next interval

## Security Notes

- Runner authenticates with a JWT token (set via `RUNNER_API_TOKEN` env)
- Token should be a long-lived service account JWT for production
- Runner should NOT be exposed to external networks — it operates on the LAN only

## Adding a New Adapter

1. Implement `PrinterAdapterPort` in `packages/adapters/src/<name>/<name>.adapter.ts`
2. Register in `apps/api/src/app.ts`: `registry.registerAdapter(new MyAdapter())`
3. Create a printer with `protocol: '<name>'` in the DB/seed
4. The runner will automatically use the new adapter when it processes a job for that printer
