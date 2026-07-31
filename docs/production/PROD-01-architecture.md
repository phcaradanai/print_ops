# PROD-01 Windows production architecture

## Supported pilot boundary

PROD-01 supports **installed Windows printers through their normal Windows driver**. The packaged application uses the TypeScript `WindowsSpoolerAdapter`.

IPP, CUPS, raw TCP 9100, ZPL/TSPL runner dispatch, macOS, Linux, and remote/headless execution are deferred. Implementations or skeletons in the repository do not make those paths production-supported.

## Packaged process topology

```text
External HTTP producer ─┐
                        ├─> bundled server.exe (Fastify)
NATS JetStream intake ──┘       │
                                ├─> SQLite job + audit persistence
                                ├─> in-memory queue rebuilt under recovery rules
                                ├─> API local print worker (sole executor)
                                └─> TypeScript WindowsSpoolerAdapter
                                         │
                                         └─> installed Windows printer driver
                                                  │
                                                  └─> physical printer

printops-runner.exe
  ├─> Windows Get-Printer/Get-PrinterPort discovery
  ├─> discovery synchronization
  └─> heartbeat

PRINTOPS_JOBS_ENABLED=false
  └─> no polling, claiming, rendering, spooler submission, or result reporting
```

The Tauri shell owns both child processes. It sets one shared constant,
`DESKTOP_DISCOVERY_RUNNER_JOBS_ENABLED=false`, into:

- `server.exe` as `PRINTOPS_DISCOVERY_RUNNER_JOBS_ENABLED=false`; and
- `printops-runner.exe` as `PRINTOPS_JOBS_ENABLED=false`.

It also sets `PRINTOPS_RUNTIME_MODE=packaged-windows-desktop` and
`PRINTOPS_LOCAL_WORKER=true` for the API.

The API validates those values before creating repositories or starting a worker. Packaged startup fails with `DESKTOP_EXECUTOR_INVARIANT` if the API worker is disabled or the discovery runner is declared job-enabled. The runtime diagnostics endpoint reports `SINGLE_EXECUTOR` only after this check passes.

## Execution ownership

| Responsibility | Packaged owner | Notes |
| --- | --- | --- |
| HTTP intake | Bundled API | Authenticated external endpoint |
| NATS intake | Bundled API | Client-scoped subject and durable consumer |
| Job persistence | Bundled API / SQLite | Queue state is persisted before dispatch |
| Job claim and execution | Bundled API local worker | Sole packaged executor |
| Windows print submission | TypeScript `WindowsSpoolerAdapter` | Uses installed Windows printer and driver |
| Physical completion verdict | API execution/evidence policy | Spooler acceptance alone is not `SUCCESS`; ambiguous completion is `UNVERIFIED` |
| Printer discovery | Go runner | Read-only Windows discovery |
| Runner heartbeat | Go runner | Does not imply execution readiness |

## Persistence boundaries

- The per-user SQLite database stores configuration, registered/discovered printers, jobs, traces, audits, intake attempts, callback attempts, and callback delivery state.
- The queue is in memory. On startup, safe pre-dispatch states can be restored; uncertain `DISPATCHED` or `PRINTING` jobs become `UNVERIFIED` and are not replayed automatically.
- Tauri stores the database, settings, JWT secret, and logs outside the installation directory so an application upgrade does not replace them.
- NATS configuration is stored by the desktop shell and injected into a restarted API sidecar.

## NATS lifecycle

`NatsConnectionManager` owns the core connection, JetStream stream lookup, durable consumer compatibility, consume loop, and reconnect diagnostics.

- Consumer identity is client-scoped.
- A compatible durable is reused.
- Delivery tuning may be updated.
- Subject, durable, pull/push, or policy conflicts fail rather than silently retargeting a consumer.
- Cross-process create races re-read and validate the winning durable.
- Core callback publishing readiness is reported separately from JetStream intake readiness.

## Callback lifecycle

Acceptance callbacks and terminal result callbacks are resolved by the API. Terminal callback intent is persisted with the job. Delivery attempts and retry state are persisted in SQLite. Retryable transport/HTTP failures remain queued; ordinary non-retryable 4xx responses terminate retry. HTTP signatures are added when a callback secret is configured.

The Go discovery runner does not send packaged terminal results because it never executes packaged jobs.

## Runtime diagnostics contract

`GET /api/v1/print-flow/runtime-architecture` returns:

- runtime mode;
- active job executor owner and implementation;
- discovery owner and effective job-claim state;
- the `SINGLE_EXECUTOR` invariant;
- supported production protocol; and
- explicitly deferred protocols.

Settings → System status presents the same contract to the operator. It must not infer execution ownership from a runner heartbeat or configured executor backend.

## Future remote/headless mode

The Go runner contains polling and executor implementations for development and future remote/headless deployments. In such a deployment it may be configured with `PRINTOPS_JOBS_ENABLED=true` and become the execution owner.

That mode is not part of PROD-01. Before it can be called production-supported it requires:

- a mutually exclusive API-worker configuration;
- production runner authentication without development login;
- protocol-specific physical evidence;
- restart and uncertain-dispatch recovery evidence;
- cross-machine callback evidence; and
- its own upgrade and operations runbook.

