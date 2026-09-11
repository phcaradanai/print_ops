# Safety Boundary

## PrintOps is NOT connected to HIS

PrintOps receives commands from an **external integration program**. It does not know:
- Patient clinical details beyond what is in the label payload
- HIS business rules or workflows
- Whether an order has been validated clinically

PrintOps responsibility: **receive → validate print parameters → queue → deliver to printer**.

## Authentication & Authorization

### External API (service accounts)
- All `/api/v1/*` endpoints require `X-Api-Key` header
- Keys are SHA-256 hashed at rest; only the prefix is stored in plaintext
- Each service account has an explicit `allowedPrinterCodes` list
- Empty list = all printers allowed (suitable for trusted internal services only)

### Internal API (JWT)
- Dashboard, job management, runner registration require JWT
- RBAC: OWNER / ADMIN / OPERATOR / VIEWER roles
- `CheckPermissionService` emits `PermissionDenied` events for all denials

## Payload Handling

- Raw payload is **never stored** in the job record
- Only a `payload_snapshot` is stored: `keys=[field1,field2] len=N`
- Payload content passes through `metadata.payload` in memory only
- `Fastify({ logger: redact: [...] })` prevents API keys and payloads from appearing in logs

## Input Limits

| Limit | Value |
|-------|-------|
| Max copies per job | Per-printer `maxCopiesPerJob` (default 100) |
| Max payload bytes | Per-service-account `maxPayloadBytes` (default 64KB) |
| Invalid printer_code | Rejected 403/404 at API boundary |
| Invalid template_code | Rejected 400 at validation step |

## Idempotency as Safety

Duplicate print prevention is a **patient safety requirement** in HIS environments:
- Same `request_id` + `source_system` will never trigger a second print
- The original job is returned with `status: DUPLICATE_RETURNED`
- Idempotency is enforced at the service layer (in-memory) and at DB layer (UNIQUE index)

## Cancellation

- Only `ACCEPTED`, `VALIDATED`, `QUEUED`, `DISPATCHED` jobs can be cancelled
- Jobs in `PRINTING` or `SUCCESS` state cannot be cancelled
- All cancellations are audited with `cancelledBy` actor ID

## Audit Trail

Every state transition produces:
1. An `AuditLog` record (who, when, what changed)
2. A `TraceStep` in the job's trace timeline
3. A domain event on the event bus

No action on a print job is unrecorded.

## No Secrets in Logs

- `Authorization` headers are redacted in Fastify logger
- `X-Api-Key` headers are redacted in Fastify logger
- `payload` fields are redacted in Fastify logger
- Runner tokens are not logged
