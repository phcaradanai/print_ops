# Webhooks: acceptance-callback payload editor polish

This document has two parts. Part A pins down exactly what is broken and why,
grounded in the current code (verified 2026-08-02). Part B is a ready-to-run
prompt for a coding agent to fix it. Scope covers the **acceptance callback**
end to end — whether it fires at all (it mostly doesn't today, see
"Critical" below), what it can say (the payload template editor), and which
intake transports reach it (currently HTTP-only; Task 6 wires in NATS and
the `/printer/:template/:profile` HTTP route per an explicit scope decision).
It does not touch terminal result callbacks or rejection notifications,
which are deliberately fixed-envelope by design (see
[`docs/architecture/result-callbacks.md`](./result-callbacks.md) §5, "
`callbackPayloadTemplate` does not apply here") — Task 0 changes *when* the
terminal callback fires relative to the toggle, never *what* it contains.

## Part A — what's actually wrong

### Critical — the acceptance callback does not fire for ordinary traffic today

Before anything about syntax or available keys: the callback this whole
document is about mostly doesn't fire at all, for the case operators
actually care about. `DynamicIntakeService.fireCallback()`
(`apps/api/src/services/dynamic-intake.service.ts:246-262`):

```ts
private fireCallback(endpoint, intakePayload, result) {
  if (!this.callbacks) return;
  if ((endpoint.callbackTransport ?? 'NONE') === 'NONE') return;
  // Every newly accepted command receives one FINAL outcome from the terminal
  // dispatcher, regardless of the legacy callbackOnPrintResult toggle.
  // Duplicates create no new print, so acceptance is their final outcome.
  if (result.duplicate !== true) return;
  void this.callbacks.send({ endpoint, intakePayload, result });
}
```

`if (result.duplicate !== true) return;` skips the send for every **normal,
first-time accepted request** — the send only goes through when
`result.duplicate === true`. Read the two call sites
(`dynamic-intake.service.ts:99-110` and `:190-205`): the non-duplicate path
builds `result` with `duplicate` left `undefined` (falls through to
`fireCallback`, then bails), while only the duplicate branch sets
`duplicate: true` and gets a real send. So today, an endpoint's acceptance
callback fires **only when the caller resends a `request_id` it already
used** — i.e. almost never in practice — and never on the first, successful
accept, which is the overwhelmingly common case this whole editor exists
for.

This is not the `callbackOnPrintResult` toggle working as designed — that
flag is completely unread by this method (and by `buildCallbackIntent()` in
`callback-intent.service.ts`, and by `ResultCallbackDispatcher`). Grep for
`callbackOnPrintResult` across `apps/api/src`: it is only ever written to
and read back from SQLite (`sqlite-webhook-endpoint.repo.ts`) and asserted
in round-trip tests. `result-callback.test.ts:279` is titled *"still sends
the final result when the legacy callbackOnPrintResult flag is off"* — i.e.
the terminal callback already fires unconditionally, regardless of the
toggle. So neither documented behavior in
[`result-callbacks.md`](./result-callbacks.md) §1 ("`callbackOnPrintResult
= false` → acceptance notification only, print outcome never reported")
matches what the code does: the terminal callback always fires, and the
acceptance callback almost never does.

**Why nobody caught this from the UI**: the "Test callback" button
(`POST /webhook-endpoints/:id/callback-test`, `webhook.routes.ts:93-104`)
builds its own `WebhookCallbackService` and calls `.send()` directly,
bypassing `fireCallback()` and its duplicate guard entirely
(`result: { ..., duplicate: false }` at line 100, sent anyway). Testing
from the Webhooks page always looks like it works. Live traffic doesn't
share that code path.

This is Task 0 below — it has to land before the payload-shaping polish
means anything, and before any NATS wiring reuses the same firing logic.

### Only one callback is templatable, and this is the one

`WebhookEndpoint.callbackPayloadTemplate` (`packages/domain/src/models/template.ts:153`)
only shapes the **acceptance** callback, fired from
`DynamicIntakeService` (`apps/api/src/services/dynamic-intake.service.ts:258`)
for the `POST /api/v1/intake/:endpointCode` path. Terminal results
(`ResultCallbackDispatcher`) and rejections (`IntakeOutcomeCallbackService`)
both pass a `payloadOverride`, which `WebhookCallbackService.prepare()`
(`apps/api/src/services/webhook-callback.service.ts:196`) always uses in
place of the template — untouchable by design, and out of scope here.

### NATS coverage — outbound yes, inbound no (verified against code, not the changelog)

There are two unrelated things both called "NATS" here, and they get different
answers:

- **Outbound delivery transport for this callback: covered.**
  `WebhookCallbackService.prepare()` builds one `payload` object and
  `send()` ships the same rendered payload to both `this.http()` and
  `this.nats()` (`webhook-callback.service.ts:222-304`) when
  `callbackTransport` is `HTTP`, `NATS`, or `BOTH`. Whatever this fix does to
  the template resolver applies identically to a `NATS`-transport endpoint —
  there is nothing transport-specific to fix separately.
- **Inbound intake over NATS: does not reach this callback at all.**
  `grep`ing the codebase for `DynamicIntakeService` shows exactly one call
  site outside its own file and tests: `webhook.routes.ts:202`, wiring it to
  `app.post('/intake/:endpointCode', ...)` — HTTP only. The one NATS consumer
  that exists, `apps/api/src/infra/nats/print-intake.ts`, calls
  `DynamicPrintService.submit()` (`print-intake.ts:296`), a different service
  keyed by `code_template`/`code_profile`/`printer_code` in the envelope, not
  `endpointCode`. It never constructs a `CallbackContext` or calls
  `WebhookCallbackService.send()` for acceptance; the only callback a
  NATS-submitted job can get is the fixed-envelope **terminal** result
  callback via `endpoint_code` → `JobCallbackIntent`, which this document
  already excludes by design.
  `docs/webhook-callback.md:36-38` currently claims "the NATS intake path
  reuses the same DynamicIntakeService, so it fires for NATS-sourced jobs
  too" — that line does not match the current code and should be corrected
  or removed as part of this work (Task 5 below), not relied on.

Net: fixing the template resolver, default template, and Available Variables
panel fixes this for every endpoint regardless of which outbound transport
it uses. It does **not** make NATS-submitted print jobs (via
`print-intake.ts`) start receiving an acceptance callback — today they
structurally cannot, independent of anything wrong with the template editor.
Whether that gap should be closed (wiring `print-intake.ts` to
`DynamicIntakeService`/`WebhookCallbackService` the way the HTTP route is) is
a separate, larger architectural decision, not a polish item — see the open
question at the end of Part B.

For the acceptance callback, `result` is the `IntakeResponse`
(`apps/api/src/services/dynamic-intake.service.ts:29-38`):

```ts
{
  accepted: true,
  print_job_id: string,
  request_id: string,
  trace_id: string,
  resolved_printer_code: string,
  resolved_template_code: string,
  status: string,
  duplicate?: boolean,
}
```

These are the only **system fields** that can legitimately be offered back to
an integrator for this callback. Anything else the operator wants to send
back has to come from the **intake payload** — the JSON body the caller
originally POSTed to `/intake/:endpointCode`.

### Bug 1 — the default template uses placeholder syntax the backend cannot resolve

`Webhooks.tsx:100-106`:

```ts
const DEFAULT_JSON_TEMPLATE = `{
  "event": "${.event}",
  "printerId": "${.printerId}",
  ...
}`;
```

The resolver (`webhook-callback.service.ts:71-73`) matches `$.field` —
dollar sign immediately followed by a dot. `${.event}` is dollar-brace-dot,
which matches neither `FIELD_PATH` nor `EMBEDDED_FIELD`. Every new endpoint
therefore starts from a template that sends the **literal string**
`"${.event}"` to the receiver instead of a resolved value. This is not a
style nit — it silently breaks the first thing every new endpoint tries.

### Bug 2 — the default template and variable list reference fields that don't exist

`event`, `printerId`, `jobId`, `timestamp` (`Webhooks.tsx:100-115`) are not
in `IntakeResponse`, and there is no reason to expect a caller's intake
payload to contain them either — they read like a generic "IoT device event"
example, not this system's actual print-intake contract. The "Sample
Payload" panel (`Webhooks.tsx:1035-1041`) repeats the same fabricated shape
(`"event": "PRINT_COMPLETED"`, `"printerId": "PRN-001"`, `"jobId":
"JOB-12345"`).

### Bug 3 — a custom template cannot reference system fields at all

`resolveTemplate()` (`webhook-callback.service.ts:112-126`) resolves every
`$.field` value against `intakePayload` only:

```ts
function resolveTemplate(template, intakePayload) {
  ...
  out[key] = fieldValue(intakePayload, raw); // never looks at `result`
}
```

The default envelope's useful fields (`request_id`, `print_job_id`, `status`,
`trace_id`, `duplicate`) are hard-coded in `prepare()`
(`webhook-callback.service.ts:199-211`) and used **only when the template is
empty**. The moment an operator writes any custom template — which is
exactly what "polish the return data" is asking to make easier — those
system fields become unreachable. There is no `$.` syntax that can pull them
in. This is the core of the user's request: today you can have the default
envelope, or your own fields, never both.

### Bug 4 — "Available Variables" is static and not tied to the endpoint being edited

`AVAILABLE_VARIABLES` (`Webhooks.tsx:108-115`) is a hard-coded constant
rendered as chips regardless of which endpoint is open. It doesn't reflect
system fields (Bug 3) and doesn't reflect the specific endpoint's real
intake shape. There is a source for the latter that the page already loads
and ignores for this purpose: the endpoint's bound `WebhookRoutePolicy`
(`policies` state, populated at `Webhooks.tsx:180`) carries
`payloadMapping: Record<string, string>` on the domain model
(`packages/domain/src/models/template.ts:118`) — the JSON-path field names
the operator already declared this endpoint's callers will send (e.g.
`{ "labelBarcode": "$.barcode" }`). The frontend `Policy` interface
(`Webhooks.tsx:64-68`) doesn't even type `payloadMapping` today, so it isn't
available to read client-side yet.

## Part B — prompt to hand to a coding agent

```
You are working in the PrintOps monorepo. Fix the acceptance-callback
payload template editor on the Webhooks page (apps/web/src/pages/Webhooks.tsx)
so an operator can (a) see exactly which keys are available to send back,
split clearly into "system fields" vs "your intake data fields", (b) build a
custom payload that combines both instead of losing the system fields the
moment they add a custom field, and (c) trust that what's shown as an
example actually resolves.

Read first:
- docs/architecture/webhook-callback-payload-editor.md (this file) — exact
  bugs and line references, especially the "Critical" section on why the
  acceptance callback barely fires today.
- docs/architecture/result-callbacks.md §1 and §5 — the documented
  acceptance-vs-terminal contract Task 0 must match, and why terminal/
  rejection callbacks must stay OUT of template scope (Tasks 1-4); do not
  add template support to ResultCallbackDispatcher or
  IntakeOutcomeCallbackService.
- apps/api/src/services/dynamic-intake.service.ts — fireCallback, the
  IntakeResponse shape, the only `result` passed to the HTTP-intake
  templatable callback.
- apps/api/src/services/callback-intent.service.ts — buildCallbackIntent,
  resolveEndpointCallbackIntent; shared by every intake path that accepts
  endpoint_code, and the integration point for Task 6.
- apps/api/src/services/result-callback-dispatcher.ts — where the terminal
  callback's firing condition (intent.enabled) is currently decided.
- apps/api/src/services/webhook-callback.service.ts — resolution engine
  (FIELD_PATH, EMBEDDED_FIELD, resolveTemplate, prepare).
- apps/api/src/services/dynamic-print.service.ts and
  apps/api/src/infra/nats/print-intake.ts — the shared entry point for
  both the `/printer/:code_template/:code_profile` HTTP route and the NATS
  consumer; relevant to Task 6.
- apps/web/src/pages/Webhooks.tsx — DEFAULT_JSON_TEMPLATE,
  AVAILABLE_VARIABLES, the template editor UI (~line 949) and the sidebar
  "Sample Payload" / "Available Variables" panels (~line 1032).

Do this in separate, reviewable commits, IN ORDER — Task 0 first, since
Tasks 2-6 are polishing a code path that today barely runs:

Task 0 — Fix the acceptance-callback firing gate (highest priority, do this
first).
`DynamicIntakeService.fireCallback()` (dynamic-intake.service.ts:246-262)
currently returns early unless `result.duplicate === true`, so the
acceptance callback never fires for a normal first-time accepted request —
only for a resubmitted `request_id`. Meanwhile
`callbackOnPrintResult` is persisted and shown in the UI (the "send on
print done" checkbox, Webhooks.tsx:987-997) but is never read by
`fireCallback`, `buildCallbackIntent` (callback-intent.service.ts), or
`ResultCallbackDispatcher` — the terminal callback fires unconditionally
regardless of the toggle (confirmed by the existing test
`result-callback.test.ts:279`, "still sends the final result when the
legacy callbackOnPrintResult flag is off").
Bring the code in line with the documented contract in
docs/architecture/result-callbacks.md §1 (`callbackOnPrintResult=false` →
acceptance notification fires, terminal does not; `callbackOnPrintResult=true`
→ terminal fires, acceptance does not — except duplicates, which always get
the acceptance notification since they can never reach a terminal state).
Concretely:
  - remove the `if (result.duplicate !== true) return;` early exit so a
    normal accept can fire too;
  - gate the acceptance send on `endpoint.callbackOnPrintResult !== true`
    (fire when off or unset, skip when on) EXCEPT for duplicates, which
    always fire regardless of the flag (per the existing comment's stated
    intent);
  - gate `ResultCallbackDispatcher`'s terminal send on
    `endpoint.callbackOnPrintResult === true` — right now it fires whenever
    `intent.enabled` is true, with no reference to the toggle at all, so
    review `buildCallbackIntent()` in callback-intent.service.ts and decide
    where the toggle check belongs (likely `intent.enabled` should become
    `false` there when `callbackOnPrintResult` is off, mirroring how the UI
    already implies it works).
  - Existing test `result-callback.test.ts:279`
    ("still sends the final result when the legacy callbackOnPrintResult
    flag is off") asserts the OLD, undocumented behavior. Update it (and
    its sibling around line 951) to match the corrected, documented
    contract — do not leave it passing against behavior you just changed
    without re-reading what it now asserts.
  - Add a regression test that fires a normal (non-duplicate) accept
    through DynamicIntakeService with `callbackOnPrintResult: false` and
    asserts the acceptance callback WAS sent — the gap this task closes.
This task touches live dispatch behavior for every configured endpoint;
flag it clearly in the PR description as a behavior fix, not a refactor,
since operators who were relying on (or unaware of) the current silence
will see new outbound traffic once this ships.

Task 1 — Let a template reference system fields without losing backward
compatibility.
Today `$.field` in a template resolves ONLY against the intake payload
(resolveTemplate in webhook-callback.service.ts). Some already-saved
endpoints may rely on `$.field` meaning "look this up in what the caller
sent" for a field literally named e.g. `status` or `request_id` that
happens to collide with a system field name — changing `$.field`'s meaning
silently would change what those endpoints send without anyone touching
them. Design and implement a way to add the 7 system fields
(print_job_id, request_id, trace_id, resolved_printer_code,
resolved_template_code, status, duplicate) to what a template can reference,
WITHOUT changing what an existing saved `$.field` token resolves to. Two
directions worth weighing (pick one, document why in the commit message):
  (a) a second, unambiguous prefix for system fields (e.g. `$$.field` or
      `@.field`) alongside the existing intake-payload `$.field`, resolved
      by extending `resolveTemplate`/`prepare` to also search `result`; or
  (b) namespaced payload access (`$.payload.field` for intake data,
      `$.result.field` for system data) with the bare `$.field` (no
      namespace) kept working exactly as today for one deprecation window,
      surfaced with a lint/hint in the UI rather than a silent behavior
      change.
Whichever you pick, update FIELD_PATH/EMBEDDED_FIELD accordingly and add
unit tests in apps/api/src/tests/webhook-callback.test.ts covering: a
system-field token resolves from `result`, an intake-payload token still
resolves from `intakePayload` exactly as before, and a template mixing both
kinds in one JSON object works.

Task 2 — Fix the default template and the fabricated example fields.
Replace DEFAULT_JSON_TEMPLATE (Webhooks.tsx:100) with a template that (a)
uses the correct resolver syntax decided in Task 1, and (b) demonstrates a
realistic mix — at least one system field (e.g. request_id, status) and a
placeholder intake-payload field. Replace the "Sample Payload" CodeBlock
(~Webhooks.tsx:1035) so it renders the actual resolved shape of that
default template against a synthetic sample intake payload, not a
hand-written fake ("PRINT_COMPLETED"/"PRN-001"/"JOB-12345" do not correspond
to anything this system produces).

Task 3 — Make "Available Variables" true and endpoint-specific.
Replace the static AVAILABLE_VARIABLES chip list (Webhooks.tsx:108) with two
labeled groups:
  - "System fields" — the fixed 7 keys from IntakeResponse, always shown,
    with a one-line description each (what it is, e.g. "resolved_printer_code
    — the printer this request was routed to").
  - "Your intake fields" — derived from the payloadMapping of the
    WebhookRoutePolicy currently selected in the form (form.routePolicyId),
    looked up in the `policies` list already fetched by the page. Add
    `payloadMapping: Record<string, string>` to the frontend `Policy`
    interface (Webhooks.tsx:64) so it's actually available; confirm
    GET /v1/webhook-route-policies already returns it (check
    apps/api/src/routes and the sqlite repo for the route-policy resource —
    do not assume). If no policy is selected, or its payloadMapping is
    empty, show an explicit empty state ("no fields declared on this
    policy yet — add one in Route Policies, or type $.yourField directly")
    rather than an empty or misleading list.
Keep the existing chip-click-to-insert behavior (insertVariable,
Webhooks.tsx:261) working for both groups.

Task 4 — Tests and docs.
Add/extend apps/web/src/__tests__/webhooks.test.ts to cover: the default
template resolves without leftover `${...}` or `$.` tokens in the rendered
sample, and the available-variables list renders the selected policy's
payloadMapping keys when one is selected. Update
docs/webhook-callback.md's "Endpoint callback settings" section to describe
the new system-field/intake-field split instead of the current one-line
`callbackPayloadTemplate` description (docs/webhook-callback.md:17-20).

Task 5 — Correct the stale NATS claim in docs/webhook-callback.md.
Lines 36-38 currently say "the NATS intake path reuses the same
DynamicIntakeService, so it fires for NATS-sourced jobs too." Verify against
current code (webhook.routes.ts, infra/nats/print-intake.ts,
dynamic-print.service.ts) whether this is still true. As of this audit it is
NOT: the only NATS consumer calls DynamicPrintService, not
DynamicIntakeService, and never fires the acceptance callback. Fix the line
to state plainly that the templatable acceptance callback is HTTP-intake-only
today (`POST /api/v1/intake/:endpointCode`), while noting that once fired,
delivery itself may go out over HTTP, NATS, or both per the endpoint's
`callbackTransport`. Do not silently delete the incorrect claim without
replacing it — someone relied on it enough to write it down once.

Task 6 — Wire NATS-submitted (and printer/:template/:profile HTTP-submitted)
jobs into the same acceptance callback.
Do this after Task 0 and Task 1 land, so it reuses the corrected firing
gate and the system-field resolution instead of re-implementing the
duplicate-only bug a second time. Scope, per the user's decision: extend
coverage beyond the `/intake/:endpointCode` path to the NATS print-intake
consumer AND the `/printer/:code_template/:code_profile` HTTP route, since
both share `DynamicPrintService.submit()` (dynamic-print.service.ts:66-161)
and both already accept an optional `endpoint_code`
(DynamicPrintRequest.endpoint_code, dynamic-print.service.ts:41) that today
is used ONLY to build the immutable `JobCallbackIntent` for the terminal
callback via `resolveCallbackIntent` → `resolveEndpointCallbackIntent`
(dynamic-print.service.ts:139, 168-183) — it never triggers an acceptance
send.
Concretely:
  - `resolveEndpointCallbackIntent` (callback-intent.service.ts:100-146)
    already looks up the `WebhookEndpoint` by `endpoint_code` and validates
    it (exists, enabled, belongs to `source_system`) but only returns the
    derived `JobCallbackIntent`, not the endpoint itself. Either have it
    also return the resolved `WebhookEndpoint` (change the return type — it
    has one call site outside tests, dynamic-print.service.ts:173) or do a
    second, cheap lookup in `DynamicPrintService.submit()` — do not
    duplicate the exists/enabled/source_system validation logic a second
    time by hand.
  - `DynamicPrintService` needs a `WebhookCallbackService` dependency the
    way `DynamicIntakeService` has one (constructor param, optionally
    late-bound via a `setCallbackService`-style method — see
    dynamic-intake.service.ts:55, 79-81 for the existing pattern used to
    solve the same NATS-consumer-starts-after-HTTP-wiring ordering
    problem).
  - `ExternalPrintJobResponse` (accept-external-job.service.ts:38-46) does
    NOT carry `resolved_printer_code` / `resolved_template_code`, unlike
    `IntakeResponse`. `DynamicPrintService.submit()` already resolves
    `printerCode` (line 94-121) and knows `req.code_template` — build a
    separate `result` object for the callback send (not the HTTP response)
    that includes all 7 of the same system-field names Task 1 documents
    (`print_job_id, request_id, trace_id, resolved_printer_code,
    resolved_template_code, status, duplicate`) so the "System fields"
    group in the Available Variables panel (Task 3) means the same thing
    regardless of which entry point an endpoint's traffic actually comes
    through. Do not change `ExternalPrintJobResponse`'s public shape to do
    this — that type is returned to HTTP callers of `/print-jobs` and
    `/printer/:tpl/:profile` today and is out of scope.
  - Duplicate handling: `AcceptExternalJobService.execute()`
    (accept-external-job.service.ts) has its own duplicate branch — find it
    and confirm it produces enough information (existing job id, trace id,
    printer/template code if resolvable) to build the same-shaped `result`
    for a duplicate acceptance send, mirroring
    dynamic-intake.service.ts:99-110.
  - Apply Task 0's corrected `callbackOnPrintResult` gating here too — do
    not special-case this entry point.
  - Tests: extend apps/api/src/tests/dynamic-print-http.test.ts and add
    coverage in a NATS-consumer test (check for an existing
    apps/api/src/tests/*nats* or *print-intake* test file first; the repo
    may not have one — apps/api/src/infra/nats/print-intake.ts exports
    `handlePrintIntakeMessage` specifically for unit testing, per its own
    comment at print-intake.ts:207-211) asserting a NATS-submitted job with
    `endpoint_code` set fires the acceptance callback with the correct
    system fields.
  - Update docs/architecture/dynamic-webhook-intake.md and
    docs/webhook-callback.md to describe the widened coverage once this
    ships; do not leave them describing only the `/intake/:endpointCode`
    path.

Constraints:
- Do not add template support to terminal result callbacks or rejection
  callbacks — both are intentionally fixed-envelope (see
  docs/architecture/result-callbacks.md §5). Keep the existing
  `payloadTemplateIgnoredOnResult` hint (Webhooks.tsx:958) as-is.
- Existing saved endpoints must keep behaving exactly as they do today
  until an operator edits and re-saves their template — no silent
  reinterpretation of a stored template.
- Keep EN/TH copy in translations.ts; do not hard-code operator-facing
  strings in the component (per apps/web/src/components/ui/README.md rule
  6).
- SSRF/destination-URL handling is unrelated and out of scope — do not
  touch callback-url-guard.ts.

Report back, per task:
- Task 0: the exact before/after firing conditions for acceptance vs.
  terminal callbacks, and which existing tests you had to update to match
  the corrected, documented contract.
- Task 1: which namespacing option you chose and why.
- Task 2/3: before/after of DEFAULT_JSON_TEMPLATE, and a screenshot or
  rendered-HTML snippet of the new two-group Available Variables panel for
  one endpoint with a policy selected and one without.
- Task 6: which entry points now fire the acceptance callback (confirm
  NATS print-intake and `/printer/:template/:profile`), and the result of
  the new NATS regression test.
```
