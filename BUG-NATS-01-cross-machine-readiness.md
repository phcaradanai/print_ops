# BUG-NATS-01 — Cross-Machine NATS Readiness and Callback Reliability

## Repository and branch

- Repository: `phcaradanai/print_ops`
- Branch: `mvp_nippon`
- Desktop version observed in source: `0.1.9`

## Objective

Fix the packaged Windows desktop app so that:

1. The local dashboard always starts even when NATS is unreachable.
2. Saving NATS settings never reports success unless the new configuration is actually loaded and its live state is accurately reported.
3. NATS intake and NATS result callbacks reconnect automatically after temporary network, DNS, firewall, broker, stream, or boot-order failures.
4. The UI clearly distinguishes:
   - local API unavailable,
   - no general internet access,
   - NATS disabled,
   - NATS configured but connecting,
   - NATS connected,
   - NATS degraded/disconnected,
   - JetStream stream or consumer setup failure.
5. A packaged install on another Windows machine behaves the same as the development machine.

Do not hide the failure by weakening validation, changing callback status to success, or treating a configured-but-disconnected broker as ready.

---

## Confirmed problems in the current code

### 1. Optional NATS blocks the whole API startup

Current startup flow:

```text
server.ts
  -> await buildApp()
     -> await startPrintIntakeConsumer()
        -> up to 10 attempts with delay
  -> app.listen()
```

Because `app.listen()` runs only after `buildApp()` completes, an unreachable NATS server can delay the local API and desktop dashboard. The desktop then displays a generic server/internet-style startup error even though the local app should remain usable without NATS.

Relevant files:

- `apps/api/src/server.ts`
- `apps/api/src/app.ts`
- `apps/api/src/infra/nats/print-intake.ts`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/web/src/App.tsx`

### 2. Saving NATS settings checks only local API health

`save_nats_settings` restarts `server.exe` and waits only for:

```text
GET http://127.0.0.1:31415/health
```

The current `/health` endpoint always returns HTTP 200 when the API is running and does not include NATS readiness. Meanwhile, NATS startup failure is caught and the API continues without NATS.

Result: the settings page can report success while NATS is not connected.

Relevant files:

- `apps/desktop/src-tauri/src/lib.rs`
- `apps/api/src/app.ts`
- `apps/api/src/routes/v1/print-flow.routes.ts`
- `apps/web/src/pages/Settings.tsx`

### 3. NATS can remain dead until another server restart

The current consumer has a bounded startup retry loop. If all attempts fail, the handle is discarded and no long-lived reconnect manager remains responsible for establishing the first usable connection later.

Temporary conditions such as these can therefore leave NATS unavailable:

- the broker starts after PrintOps,
- DNS becomes available later,
- a VPN or LAN interface comes up later,
- Windows Firewall is changed later,
- the JetStream stream is created later.

### 4. NATS result callbacks depend on the intake connection

Terminal NATS callbacks use a lazy sender that throws:

```text
NATS transport is not connected
```

This design is acceptable only if the shared connection is managed continuously and can recover. At present, failure during startup can leave the callback sender unavailable.

Relevant files:

- `apps/api/src/app.ts`
- `apps/api/src/services/result-callback-dispatcher.ts`
- `apps/api/src/services/webhook-callback.service.ts`

### 5. Cross-machine addresses are easy to misconfigure

Reject or prominently warn about these values when the broker is expected to be on another machine:

- `nats://localhost:4222`
- `nats://127.0.0.1:4222`
- `nats://0.0.0.0:4222`

Do not universally reject localhost because a local broker is a valid deployment. Instead, add explicit UI guidance and diagnostics explaining that `localhost` means the current PrintOps workstation.

---

## Required architecture

Introduce a single API-owned NATS connection manager instead of treating connection setup as a one-time startup function.

Suggested location:

```text
apps/api/src/infra/nats/nats-connection-manager.ts
```

The manager must own:

- current sanitized configuration,
- lifecycle state,
- connection instance,
- JetStream consumer setup,
- reconnect/backoff scheduling,
- callback publisher,
- timestamps and last error,
- shutdown/drain behavior.

### Required states

Use a typed state model similar to:

```ts
type NatsRuntimeState =
  | 'DISABLED'
  | 'CONFIGURED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'DISCONNECTED'
  | 'ERROR';
```

Expose at least:

```ts
interface NatsRuntimeStatus {
  enabled: boolean;
  state: NatsRuntimeState;
  connected: boolean;
  intakeReady: boolean;
  callbackPublishReady: boolean;
  streamReady: boolean;
  consumerReady: boolean;
  clientId?: string;
  subject?: string;
  stream?: string;
  durable?: string;
  server?: string;          // credentials redacted
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
  lastAttemptAt?: string;
  nextRetryAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
}
```

Never expose NATS credentials in API responses or logs.

### Startup behavior

The local API must listen first.

Expected sequence:

```text
1. Build repositories and routes.
2. Start local HTTP API on 127.0.0.1:31415.
3. Let the desktop dashboard load.
4. Start NATS connection asynchronously.
5. Continuously update NATS runtime status.
```

An unreachable NATS server must not prevent:

- `/health` from responding,
- login,
- settings,
- printer discovery,
- HTTP printing,
- job history,
- local printing.

### Connection behavior

Use connection and reconnect options supported by the installed `nats` package version.

Requirements:

- finite first-connect timeout,
- background retry with capped exponential backoff and jitter,
- automatic reconnect after an established connection drops,
- no busy loop,
- no permanent death after a bounded number of startup attempts,
- idempotent consumer creation,
- recovery when the stream appears later,
- clean drain on API shutdown,
- no duplicate consumers or message loops after reconnect.

The manager must differentiate:

1. TCP/DNS/auth connection failure.
2. Core NATS connected but JetStream unavailable.
3. JetStream available but stream missing.
4. Stream exists but durable consumer setup failed.
5. Fully ready.

Core NATS callback publishing may be ready even when JetStream intake is not. Represent those separately.

### Publisher behavior

Both callback systems must resolve the current publisher through the manager:

- acceptance-time webhook callback service,
- terminal result callback dispatcher.

Do not snapshot an undefined publisher at construction time.

Publishing while disconnected must:

- return a typed/retryable error,
- preserve the callback delivery record,
- allow the existing retry worker to retry after NATS reconnects,
- never mark the print itself failed.

---

## API changes

### Keep liveness local

Keep:

```http
GET /health
```

as local API liveness only.

Suggested response:

```json
{
  "status": "ok",
  "uptime": 123.4
}
```

Do not make `/health` fail just because optional NATS is unavailable.

### Add operational readiness

Add one authenticated endpoint or extend the existing endpoint:

```http
GET /api/v1/print-flow/config
```

Return the full runtime status rather than only `enabled` and `connected`.

Preferred additional endpoint:

```http
GET /api/v1/print-flow/nats-status
```

It must report the typed state and sanitized diagnostic fields.

### Add active connection test

Add a desktop-safe command or authenticated API action:

```http
POST /api/v1/print-flow/nats-test
```

It must test the current or submitted settings without creating a print job.

Return structured results:

```json
{
  "ok": false,
  "stage": "TCP_CONNECT",
  "code": "CONNECTION_REFUSED",
  "message": "Could not reach 192.168.1.20:4222",
  "durationMs": 3012
}
```

Possible stages:

- `URL_VALIDATION`
- `DNS`
- `TCP_CONNECT`
- `NATS_AUTH`
- `JETSTREAM`
- `STREAM_LOOKUP`
- `CONSUMER_SETUP`
- `READY`

Do not return only `could not connect`.

---

## Desktop settings behavior

Update `save_nats_settings` and the Settings page.

### Saving

A save operation must mean:

1. Validate settings.
2. Persist settings atomically.
3. Apply the settings.
4. Confirm that the local API is back.
5. Fetch the NATS runtime status.
6. Show the truthful state.

It is valid to save a currently unreachable broker, but the UI must say:

```text
Settings saved, but NATS is not connected.
```

Do not show a green generic “Settings saved” message that implies readiness.

Recommended result shape from the Tauri command:

```rust
struct SaveNatsSettingsResult {
    saved: bool,
    api_healthy: bool,
    nats_state: String,
    connected: bool,
    message: String,
}
```

Prefer hot-reloading the manager without restarting `server.exe`. If process restart remains necessary, preserve the same truthful result contract.

### Settings UI

Add:

- connection status badge,
- “Test connection” button,
- last error,
- last attempt time,
- next retry time,
- resolved sanitized server,
- expected intake subject,
- stream and durable consumer,
- explicit localhost warning,
- copyable PowerShell diagnostic command using only the host and port.

Do not store or display credentials in plain text after save. Mask credentials in URLs.

---

## Startup UI wording

The splash screen is checking a local API, not general internet access.

Replace ambiguous wording with exact states such as:

```text
Starting local PrintOps service…
Local PrintOps service is not responding.
NATS is disconnected; local printing remains available.
```

Never say “No internet connection” unless an actual internet-specific test was performed and internet access is required for that action.

---

## Logging and diagnostics

Write structured diagnostic events to `desktop-server.log` and expose the latest safe state in the UI.

Log:

- sanitized server URL,
- selected client ID,
- subject,
- stream,
- durable,
- connection stage,
- state transitions,
- retry number and delay,
- disconnect/reconnect events,
- JetStream/stream/consumer errors,
- callback publish failures,
- process PID and app version.

Do not log:

- URL credentials,
- token values,
- NKey seeds,
- JWT contents,
- callback signing secrets,
- patient print payloads.

Error messages must preserve useful nested error details and codes.

---

## Windows cross-machine diagnostics

Document and expose these checks for the affected workstation.

Given a configured broker such as:

```text
nats://192.168.1.20:4222
```

PowerShell:

```powershell
Test-NetConnection 192.168.1.20 -Port 4222
```

For a DNS hostname:

```powershell
Resolve-DnsName nats.example.local
Test-NetConnection nats.example.local -Port 4222
```

Verify that the entered URL is not accidentally pointing to the workstation itself:

```text
localhost
127.0.0.1
```

Also verify:

- Windows Defender Firewall outbound rules,
- broker inbound firewall,
- NATS listener binding is reachable from LAN and not bound only to loopback,
- routing/VLAN/VPN,
- credentials and permissions,
- JetStream enabled,
- `MEDISYNC` stream exists,
- stream subjects include the configured intake subject,
- machine clocks are reasonably synchronized when auth depends on signed credentials.

---

## Required tests

### Unit tests

Add coverage for:

1. API liveness succeeds while NATS is unreachable.
2. NATS manager transitions:
   - disabled,
   - connecting,
   - connected,
   - disconnected,
   - reconnected,
   - JetStream degraded,
   - stream missing,
   - ready.
3. Credentials are redacted from status and logs.
4. A failed initial connection retries later and eventually succeeds.
5. Stream creation after API startup eventually makes intake ready.
6. Reconnect does not create duplicate consume loops.
7. Callback publish while disconnected remains retryable.
8. A due callback succeeds after NATS reconnects.
9. HTTP callbacks continue working with NATS disabled.
10. Settings save returns saved-but-disconnected truthfully.
11. Localhost warning behavior.
12. Shutdown drains the connection and stops retry timers.

### Integration tests

Use a real temporary NATS server with JetStream:

1. Start PrintOps before NATS.
2. Confirm `/health` and dashboard become available.
3. Start NATS later.
4. Create the `MEDISYNC` stream later.
5. Confirm state reaches ready without restarting PrintOps.
6. Publish a print intake message.
7. Complete the job.
8. Confirm NATS result callback publishes.
9. Stop NATS.
10. Confirm local app remains usable and state becomes disconnected.
11. Restart NATS.
12. Confirm automatic reconnection and callback retry delivery.

### Packaged Windows acceptance test

Test the actual NSIS/MSI build on a clean second Windows machine, not only a dev checkout.

Matrix:

| Scenario | Expected |
|---|---|
| No network | Dashboard starts; NATS disconnected |
| Internet unavailable but LAN NATS reachable | NATS works |
| Internet available but LAN NATS unreachable | Dashboard starts; NATS disconnected |
| NATS URL is localhost without local broker | Clear localhost warning and connection failure |
| Remote broker reachable | NATS ready |
| Broker starts after app | Automatically becomes ready |
| Stream created after app | Automatically becomes intake-ready |
| Broker restarts | Reconnects automatically |
| Invalid credentials | Clear auth error; no credential leakage |
| Windows Firewall blocks 4222 | Clear TCP timeout/refused diagnostic |
| HTTP callback only | Works independently of NATS |
| NATS callback while disconnected | Retry scheduled and delivered after reconnect |

---

## Acceptance criteria

The task is complete only when all are true:

1. A packaged app opens its local dashboard within the normal startup window even when the NATS host is unreachable.
2. The splash message never mislabels local API failure as internet failure.
3. Saving NATS settings does not imply connected status unless the broker is connected.
4. The Settings and Print Flow pages show the same live NATS state.
5. The system recovers automatically when the broker or stream becomes available later.
6. NATS callback delivery retries successfully after reconnection.
7. No callback or intake payload is duplicated by reconnect logic.
8. HTTP printing and HTTP callbacks remain available when NATS is down.
9. Credentials are redacted in UI, logs, and API status.
10. Unit, integration, web, API, Rust/Tauri, and packaged Windows smoke tests pass.
11. Provide a final report with:
    - root causes,
    - files changed,
    - state model,
    - test commands and results,
    - clean-machine reproduction evidence,
    - remaining deployment prerequisites.

---

## Commit guidance

Use a focused commit such as:

```text
fix(desktop): decouple startup from NATS and expose truthful readiness
```

Do not mix unrelated UX, template, printer, or paper-profile refactors into this change.
