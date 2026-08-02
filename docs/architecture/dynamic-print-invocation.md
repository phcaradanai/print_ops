# Dynamic Print Invocation

A caller may invoke PrintOps over **two interchangeable transports** — HTTP or
NATS JetStream — chosen per request. Both resolve the printer from a
`(code_template, code_profile)` pair and funnel into the same
`AcceptExternalJobService`, so idempotency, trace, and audit are identical
regardless of transport.

`code_profile` is a **paper-profile code** (an existing PaperProfile). The
printer is resolved from the `PrinterTemplateBinding` that ties that template +
paper profile to a printer.

## Printer resolution

```
code_profile  → PaperProfile.findByCode → paper.id      (404 if unknown)
code_template → PrintTemplate.findByCode                (404 if unknown)
bindings.findAll({ templateCode })
  → keep enabled && paperProfileId === paper.id          (404 if none match)
  → prefer isDefault, else first
  → printer_code
```

An explicit `printer_code` in the body/envelope skips binding resolution.

## Transport 1 — HTTP

```
POST /api/v1/printer/{{code_template}}/{{code_profile}}
X-Api-Key: <service-account-key>
```

Body (template/profile travel in the path):

```json
{
  "request_id": "REQ-...",
  "source_system": "medisync",
  "source_reference": "RX-...",
  "printer_code": "LAB_LABEL_01",   // optional override
  "payload": { "...": "..." },
  "copies": 1,
  "priority": "normal",
  "metadata": {}
}
```

Responses match `POST /api/v1/print-jobs`: `201` new job, `200` duplicate.

## Transport 2 — NATS JetStream

**No auth header.** The intake is open to any publisher that can reach the NATS
server — it is an internal-network trust boundary. Never expose the NATS port
outside that network. (The HTTP transport keeps `X-Api-Key`.)

Enabled only when `NATS_URL` (or `PRINTOPS_NATS_URL`) and an immutable
`PRINTOPS_NATS_CLIENT_ID` are set. Each installed PrintOps workstation owns a
different client ID, subject, and durable consumer. The stream is **not**
created by PrintOps (the publisher's environment owns it — here medisync-core
ensures `MEDISYNC`).

For `PRINTOPS_NATS_CLIENT_ID=pharmacy-counter-01`, publish only to
`medisync.print.intake.pharmacy-counter-01` (or the configured prefix plus
that client ID). The envelope must repeat the target ID as a defence-in-depth
check:

```json
{
  "target_client_id": "pharmacy-counter-01",
  "request_id": "REQ-...",
  "source_system": "medisync",
  "source_reference": "RX-...",
  "code_template": "prescription-sticker",
  "code_profile": "sticker-profile",
  "printer_code": "",
  "payload": { "...": "..." },
  "copies": 1,
  "metadata": {}
}
```

Ack semantics: success → `ack`; a 4xx resolution error (bad template/profile/
binding, missing fields) is a poison message → dead-lettered to
`PRINTOPS_NATS_DLQ_PREFIX + subject` and `term`ed; anything else is transient →
`nak` for redelivery up to `PRINTOPS_NATS_MAX_DELIVER` (default 5).

## Configuration

### PrintOps (consumer)

| Env | Default | Purpose |
|---|---|---|
| `NATS_URL` / `PRINTOPS_NATS_URL` | *(unset)* | Enables the consumer when paired with a client ID |
| `PRINTOPS_NATS_STREAM` | `MEDISYNC` | Stream to attach the durable consumer to |
| `PRINTOPS_NATS_CLIENT_ID` | *(required)* | Stable deployment/workstation identity; provision it, do not derive it from hostname |
| `PRINTOPS_NATS_SUBJECT_PREFIX` | `medisync.print.intake` | Prefix; effective subject is `<prefix>.<client-id>` |
| `PRINTOPS_NATS_DURABLE` | `printops-print-intake-<client-id>` | Durable name; custom value must end in `-<client-id>` |
| `PRINTOPS_NATS_DLQ_PREFIX` | `medisync.dlq.` | Dead-letter subject prefix |
| `PRINTOPS_NATS_MAX_DELIVER` | `5` | Max redeliveries before give-up |

### medisync (caller)

| Env | Default | Purpose |
|---|---|---|
| `PRINT_OPS_TRANSPORT` | `http` | Default transport (`http`\|`nats`); per-request `Transport` field wins |
| `PRINT_OPS_PATH_TEMPLATE` | `/api/v1/print-jobs` | HTTP path; add `{{code_template}}`/`{{code_profile}}` for the dynamic endpoint |
| `PRINT_OPS_NATS_SUBJECT` | *(per target client)* | Effective subject `<prefix>.<target-client-id>`; never publish to the old shared subject |
| `PRINT_OPS_TARGET_CLIENT_ID` | *(required for NATS)* | Must match the target workstation's `PRINTOPS_NATS_CLIENT_ID` and envelope `target_client_id` |
| `PRINT_OPS_PAPER_PROFILE` | `sticker-profile` | Default `code_profile` when a request omits it |

## Idempotency

`source_system + request_id` guarantees a request never prints twice, across
both transports. The NATS publisher additionally sets the JetStream `MsgId` to
`request_id` for publish-level dedup.

## Multi-client safety

Do not configure multiple installations with the old shared
`medisync.print.intake` subject and `printops-print-intake` durable. Those
installations compete for one message, so a label can be accepted by the wrong
local PrintOps database and printer. Changing only the durable is also unsafe:
it fans the same message out to every workstation.

Provision a stable opaque client ID per workstation, migrate the publisher to
the matching scoped subject, and restrict NATS credentials so each workstation
may subscribe only to its own `medisync.print.intake.<client-id>` subject. If a
NATS URL is present but the client ID is absent or invalid, PrintOps fails
closed by disabling NATS intake while keeping the authenticated HTTP transport
available.
