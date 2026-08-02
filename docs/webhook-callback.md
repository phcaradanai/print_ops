# Webhook Callback (Dynamic Reply) — What changed

The Webhooks page can now both **receive** print jobs (via HTTP `/intake/:code` AND
NATS, using the same client-scoped routing as the print intake) and **reply to the
caller** after the job is accepted — over **HTTP, NATS, or both**.

## Endpoint callback settings (editable in the Webhooks page)
- `callbackTransport`: `NONE` | `HTTP` | `NATS` | `BOTH`
- `callbackUrl`: HTTP POST target. Can be:
  - a literal URL: `https://my.server/hook`
  - a dynamic per-request URL: `$.reply_url` (read from the intake payload)
  - a templated URL: `https://my.server/hook/$.request_id`
- `callbackNatsSubject`: NATS reply subject. Same rules as the URL:
  - literal: `medisync.reply`
  - dynamic: `$.reply_subject`
  - templated: `medisync.reply.$.branch`
- `callbackPayloadTemplate` (JSON, optional): the exact body sent back by the
  **acceptance** callback. Terminal result callbacks ignore it and always use
  the fixed versioned envelope (see
  [`docs/architecture/result-callbacks.md`](./architecture/result-callbacks.md) §5).
  A value resolves from one of two sources, by prefix:

  | Written as | Resolves from | Example |
  |---|---|---|
  | `$.field` | the **original intake payload** — what the caller sent | `"hn": "$.hn"` |
  | `$$.field` | the **intake response** PrintOps produced — system fields | `"job": "$$.print_job_id"` |

  The seven system fields are `print_job_id`, `request_id`, `trace_id`,
  `resolved_printer_code`, `resolved_template_code`, `status`, `duplicate`
  (`ACCEPTANCE_CALLBACK_SYSTEM_FIELDS` in `packages/domain`). Anything else is
  sent as a literal; a token naming a field that was not supplied is omitted
  from the body, the same as any `undefined` JSON value.

  ```json
  {
    "event_type": "print.job.accepted",
    "request_id": "$$.request_id",
    "print_job_id": "$$.print_job_id",
    "status": "$$.status",
    "hn": "$.hn"
  }
  ```

  When the template is empty, a default envelope is sent:
  `{ event_type, request_id, print_job_id, status, trace_id, duplicate }`.

  `$$.` is a separate sigil rather than a `$.result.` namespace because
  `$.result.*` and `$.payload.*` already name reachable caller data — the NATS
  intake envelope carries a top-level `payload` object — so reserving them
  would silently change what saved endpoints send. A stored `$.field` means
  today exactly what it meant before `$$.` existed.

  The Webhooks page lists both groups beside the editor: system fields with a
  one-line description each, and "your intake fields" read from the
  `payloadMapping` of the route policy bound to the endpoint. It also previews
  the resolved body, so what is shown as an example is derived from the
  template rather than written by hand.
- `callbackOnPrintResult`: if checked, the callback is deferred until the print
  result is known (success/failure) instead of firing right after job creation.
  > Note: the MVP fires on job-acceptance (`BOTH`/`HTTP`/`NATS` after
  > `createPrintJob`). The `callbackOnPrintResult` flag is stored and surfaced;
  > wiring it to the async worker-completion event is the next milestone.

## How it works (code map)
- `packages/domain/.../template.ts` — `WebhookEndpoint` gains the 5 callback fields.
- `apps/api/src/infra/db/sqlite.schema.ts` — new columns + online migration
  (`ensureColumn`) so existing DBs are upgraded in place.
- `apps/api/src/infra/repos/sqlite/sqlite-webhook-endpoint.repo.ts` — persists/reads
  the new columns.
- `apps/api/src/services/webhook-callback.service.ts` — resolves the dynamic
  URL/subject, renders the payload template, and fires HTTP (POST) and/or NATS
  (publish) transports. Best-effort: failures are logged, never fail the accept.
- `apps/api/src/services/dynamic-intake.service.ts` — fires the callback right
  after the job is created (HTTP intake path; the NATS intake path reuses the same
  `DynamicIntakeService`, so it fires for NATS-sourced jobs too).
- `apps/api/src/routes/v1/webhook.routes.ts` — `POST /webhook-endpoints/:id/callback-test`
  lets you fire a sample callback from the UI (button "Test callback").
- `apps/web/src/pages/Webhooks.tsx` + i18n EN/TH — edit form + test button.

## Tests added
- `apps/api/src/tests/webhook-callback.test.ts` — transport matrix, dynamic URL,
  templated NATS subject, payload template interpolation, BOTH fan-out.
- `apps/api/src/tests/webhook-endpoint.repo.test.ts` — sqlite persistence round-trip
  of all callback fields (defaults + patch).

## Installer
`apps/desktop/src-tauri/target/release/bundle/nsis/PrinterOps_0.1.4_x64-setup.exe`
(built from this change). Deploy only this installer — server/runner/helper are
bundled by the Tauri build, do not copy them manually.
