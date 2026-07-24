# Task: Fix Print Flow page — NATS JSON body example + connection status indicator

## Context

The Print Flow page (`apps/web/src/pages/PrintFlowBindings.tsx`) already shows NATS config (subject, stream, durable, url, dlq) when NATS is enabled. But there are two problems:

### Problem 1: NATS example JSON body is WRONG — it is missing `target_client_id`

Look at `apps/web/src/pages/PrintFlowBindings.tsx` lines 133-145:

```tsx
const natsExample = JSON.stringify(
  {
    request_id: 'REQ-20260723-0001',
    source_system: 'medisync',
    source_reference: 'RX-123456',
    code_template: form.templateCode || 'prescription-sticker',
    code_profile: paperCodeById.get(form.paperProfileId) || 'sticker-profile',
    payload: { prescription_id: 'RX-123456', patient_name: 'สมชาย ใจดี', hn: 'HN-0001' },
    copies: 1,
  },
  null,
  2,
);
```

This is missing `target_client_id`. Check `apps/api/src/infra/nats/print-intake.ts` lines 205-216:

```ts
if (!env.request_id || !env.source_system) { ... dead-letter ... }
if (env.target_client_id !== cfg.clientId) {
  await deadLetter(msg, nc, cfg, deps.logger, 'target_client_id does not match this PrintOps client');
  return;
}
```

So `target_client_id` is REQUIRED and must match the PrintOps client ID, otherwise the message is dead-lettered immediately. The example the operator copies is unusable.

**FIX:** Add `target_client_id` to the `natsExample` object. The value should be `nats.clientId` (which is already available as `nats?.clientId` from `flowConfig.nats.clientId`). When NATS is not configured, fall back to the literal placeholder `'pharmacy-counter-01'` so the example still illustrates the shape.

The corrected example should look like:
```tsx
const natsExample = JSON.stringify(
  {
    target_client_id: nats?.clientId || 'pharmacy-counter-01',
    request_id: 'REQ-20260723-0001',
    source_system: 'medisync',
    source_reference: 'RX-123456',
    code_template: form.templateCode || 'prescription-sticker',
    code_profile: paperCodeById.get(form.paperProfileId) || 'sticker-profile',
    printer_code: '',
    payload: { prescription_id: 'RX-123456', patient_name: 'สมชาย ใจดี', hn: 'HN-0001' },
    copies: 1,
  },
  null,
  2,
);
```

Match the field order in `PrintIntakeEnvelope` from `apps/api/src/infra/nats/print-intake.ts` lines 86-99: `target_client_id` first, then `request_id`, `source_system`, `source_reference`, `code_template`, `code_profile`, `printer_code`, `payload`, `copies`.

### Problem 2: No "ready to send/receive" connection status indicator

The page shows NATS config but never tells the operator "NATS is connected and ready to receive print jobs." The user reports: "หน้าโฟลว์การพิมพ์ไม่แสดงอะไรของ nats เลยว่าสามารถรับส่งได้แล้ว" (the print flow page doesn't show anything indicating NATS can send/receive).

The `/v1/print-flow/config` endpoint (`apps/api/src/routes/v1/print-flow.routes.ts`) returns `nats.enabled = true` only when the env config is valid — BUT `enabled: true` in the config response does NOT guarantee the consumer actually started. Look at `apps/api/src/app.ts` lines 575-595: even when `printIntakeCfg` is set, `startPrintIntakeConsumer` can throw (line 592-594) and the API continues without NATS. In that case the config endpoint still reports `enabled: true`, which is misleading.

**FIX — two parts:**

#### Part A: Backend — report actual consumer connection state

In `apps/api/src/app.ts`, track whether the consumer actually started. Add a module-level `let printIntakeConnected = false;` flag (or similar), set it to `true` only after `startPrintIntakeConsumer` succeeds (around line 580), and pass a getter into `v1PrintFlowRoutes`.

Then in `apps/api/src/routes/v1/print-flow.routes.ts`, change the `deps` to accept a `printIntakeConnected: () => boolean` callback (in addition to the existing `printIntake?: PrintIntakeConfig`). In the response, when `nats` is configured, add a `connected: boolean` field that reflects the actual consumer state.

Example response shape change:
```json
{
  "http": { "path": "...", "method": "POST", "authHeader": "X-Api-Key" },
  "nats": {
    "enabled": true,
    "connected": true,
    "url": "nats://***@...",
    "stream": "MEDISYNC",
    "clientId": "pharmacy-counter-01",
    "subject": "medisync.print.intake.pharmacy-counter-01",
    "durable": "printops-print-intake-pharmacy-counter-01",
    "dlqPrefix": "medisync.dlq.",
    "maxDeliver": 5,
    "authRequired": false
  }
}
```

When NATS is disabled, `nats: { enabled: false, connected: false, authRequired: false }`.

#### Part B: Frontend — show a status pill in the NATS section

In `apps/web/src/pages/PrintFlowBindings.tsx`:

1. Update the `FlowConfig` interface's `nats` union type to include `connected: boolean` in the enabled branch (and `connected: false` in the disabled branch).

2. When NATS is enabled, show a status indicator near the section heading. Use the existing `.print-flow-pill` / `.print-flow-pill--on` CSS classes for visual consistency:
   - If `nats.connected === true`: green pill "พร้อมรับส่ง" (or use translation key `page.printFlow.natsConnected`)
   - If `nats.connected === false` but enabled: amber/red pill "ไม่ได้เชื่อมต่อ" (translation key `page.printFlow.natsDisconnected`)

3. Add Thai translations in `apps/web/src/i18n/translations.ts`:
   - `page.printFlow.natsConnected`: 'พร้อมรับส่ง' / EN: 'Connected — ready'
   - `page.printFlow.natsDisconnected`: 'ไม่ได้เชื่อมต่อ' / EN: 'Not connected'

There is already a Thai translation block and an English block in `translations.ts`. The English block starts near line 598 with `'page.printFlow.title': 'Print Flow'`. The Thai block has `'page.printFlow.title': 'โฟลว์การพิมพ์'` near line 1280. Add the two new keys to BOTH blocks.

## Constraints

- Do NOT change the wire contract for the actual NATS envelope (`PrintIntakeEnvelope`) — only the display example and the config endpoint response.
- Do NOT rename existing translation keys.
- Match the existing code style (2-space indent, single quotes, no semicolons in .tsx).
- Run `npm run typecheck -w apps/web` and `npm run typecheck -w apps/api` after changes and fix any errors.
- Do NOT run `npm run typecheck` at repo root — it is known to fail in `apps/web/src/pages/LocalDiagnostics.tsx` unrelated to this task.
- Do NOT commit. Leave changes staged for the user to review.

## Files to edit

1. `apps/web/src/pages/PrintFlowBindings.tsx` — fix natsExample, add connected status pill, update FlowConfig type
2. `apps/api/src/routes/v1/print-flow.routes.ts` — add `connected` field to response
3. `apps/api/src/app.ts` — track consumer start success, pass getter to v1PrintFlowRoutes
4. `apps/web/src/i18n/translations.ts` — add 2 translation keys (EN + TH)

## Verification

After changes:
- `npm run typecheck -w apps/web` must pass
- `npm run typecheck -w apps/api` must pass
- The NATS example JSON in the page must include `target_client_id` matching the displayed client ID
