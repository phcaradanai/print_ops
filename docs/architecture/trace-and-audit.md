# Trace & Audit

## Trace

Every job gets a `JobTrace` with:
- `traceId` + `correlationId` (generated at job creation, threaded through all systems)
- `steps[]` – `TraceStep` records added at each lifecycle stage
- Full timing: `queuedAt`, `startedAt`, `finishedAt`, `durationMs`
- `evidence` – arbitrary key/value for debugging

Trace steps:
```
job_created    → when CreatePrintJobService runs
adapter_execute → when ExecuteJobService calls the adapter
```

## Audit Log

`AuditLog` is written for all significant actions:

| Action | Trigger |
|--------|---------|
| printer.created | CreatePrinterService |
| job.created | CreatePrintJobService |
| job.succeeded | ExecuteJobService (success) |
| job.failed | ExecuteJobService (failure) |
| runner.registered | RegisterRunnerService |

All audit logs contain `traceId`, `actorId`, `resourceType`, `resourceId`, before/after snapshots.

## Rule

Every service that mutates state MUST:
1. Write an `AuditLog` entry
2. Publish the corresponding `DomainEvent`
3. Include `traceId` in both
