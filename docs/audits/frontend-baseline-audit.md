# Frontend Baseline Audit (FE-00)

Branch `mvp_nippon`, `apps/web` at version 0.1.9. Scope: baseline of the React
dashboard shared by the Windows Tauri desktop shell (primary production client)
and browser dev mode. Companion milestone FE-01 (shared foundation + error
visibility) is implemented; everything else listed here is recorded, not fixed.

## 1. Stack and shape

| Item | Value |
|---|---|
| Framework | React 18.3 + TypeScript 5.4 (`strict: true`), `jsx: react-jsx` |
| Router | react-router-dom 6.23, `BrowserRouter`, flat route table in `App.tsx` |
| Build | Vite 5.3, dev proxy `/api/*` → `127.0.0.1:3001` |
| Tests | Vitest 1.6, **node** environment — no jsdom, no Testing Library |
| State | Local `useState` per page. No store, no query cache, no data layer |
| Styling | One global `styles.css` (~5000 lines) + heavy inline `style={{}}` |
| i18n | Hand-rolled dict in `i18n/translations.ts`, `en` + `th`, **default `th`** |
| Desktop bridge | `tauri.ts`, dynamic `import('@tauri-apps/api/core')` with fallback |

Component rendering tests exist (`jobDetailEvidence.test.tsx`,
`pageState.test.tsx`) and work via `renderToStaticMarkup` from
`react-dom/server`. That is the only rendering technique available until a jsdom
environment is added — no test can click, type or assert on effects today.

## 2. Size distribution (source lines)

| File | Lines | Note |
|---|---|---|
| `styles.css` | 4872 (now ~5000) | single stylesheet, 626 token references |
| `pages/PaperProfiles.tsx` | 2994 | out of scope this milestone |
| `i18n/translations.ts` | 1779 | both locales in one file |
| `pages/Webhooks.tsx` | 1470 | |
| `pages/Templates.tsx` | 1101 | |
| `App.tsx` | 629 → 598 | nav table + splash + login + shell |
| `pages/JobDetail.tsx` | 628 | |
| `pages/TemplateSandbox.tsx` | 574 | |
| `pages/PrintFlowBindings.tsx` | 457 | |
| everything else | < 410 each | |

Five files hold roughly 60% of the frontend. There is no `components/`
directory before FE-01: **zero** shared UI primitives existed, so every page
reimplemented loading, empty, error and toast surfaces inline.

## 3. Error visibility — the baseline problem

This is what FE-01 targets. Findings, in severity order.

### F-1 (high) — the transport discarded every server error
`apiFetch` did:

```ts
if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
```

The response body was never read. The API emits real diagnostics
(`{ "error": "NOT_FOUND", "message": "Printer with id 'p1' not found" }`,
`{ "error": "Missing permission: printer:control" }`, Fastify's
`{ statusCode, error, message }`), and all of it was dropped on the floor. An
operator saw `API /printers -> 403` with no way to know a permission was
missing. **Fixed in FE-01** (`api/errors.ts`, `ApiError`).

### F-2 (high) — Dashboard turned outages into "all clear"
Each of the three dashboard fetches ended in
`.catch((e) => { console.error(...); return []; })`. A dead API therefore
rendered: 0 queued, 0 failed, 0 unverified, 0 runners online — visually
identical to a healthy idle site. This is the most dangerous failure mode on the
product: the page most likely to be left on a wall display lies silently.
**Fixed in FE-01** (partial-failure banner + retry).

### F-3 (high) — JobQueue's 1.5s poll swallowed everything
`.catch(() => {})` inside a `setInterval` loop. When the API dropped, the table
froze on the last successful snapshot with no indication it was stale, while
still looking live. **Fixed in FE-01** (`ErrorBanner` with "live updates
stopped", stale rows deliberately kept).

### F-4 (medium) — two error boundaries, the inner one deaf
`main.tsx` mounts `ErrorBoundary` (outside `LocaleProvider`, hence its manual
`detectLocale()`); `App.tsx` mounted a second, separate class boundary inside
the provider. The inner one had **no `componentDidCatch`** — a crashing page
logged nothing at all — and no reset key, so once it caught, navigating
elsewhere kept showing the fallback until a full reload.
**Fixed in FE-01**: the inner one became `components/RouteErrorBoundary.tsx`
(logs, and resets on `location.pathname`). The outer one is deliberately kept:
it is the only thing that can catch a throw from `LocaleProvider` itself.

### F-5 (medium) — the server's reason is replaced by a constant sentence
27 `catch { … }` blocks across `pages/`. Split honestly:

* ~6 are **intentional guards**, not swallowed failures — `localStorage`
  availability (`Settings.tsx:24,38`), `JSON.parse` validation
  (`TemplateSandbox.tsx:176`), date formatting (`Webhooks.tsx:612`), and the
  same pattern in `api/client.ts` / `tauri.ts` (7 more). Leave these alone.
* ~15 show the operator a **fixed generic string** and discard the cause:
  `t('page.templates.actionFailed')` (×4), `t('settings.savedError')` (×2),
  `t('page.printFlow.saveError')` (×2), `page.webhooks.toast*Failed` (×4),
  `PrinterDetail` "Failed to update status.", `LocalDiagnostics`
  `requestFailed`, `TemplateSandbox` `renderFailed`. Every distinct cause looks
  identical on screen.
* ~6 are **fully silent**: `PrintFlowBindings.tsx:85`, `Templates.tsx:352,526`,
  `Webhooks.tsx:495,520`, `Templates.tsx:572` (counts a failure but never says
  why).

Two of these (both in `JobQueue`) were converted in FE-01 as the pattern to
follow: append `errorMessage(err)` to the human sentence. The rest is the FE-02
migration list below.

### F-6 (medium) — one unguarded `localStorage` read poisoned every request
`getApiKey()` wrapped its `localStorage` access in try/catch; `token()` did not
(`localStorage.getItem('token') ?? ''`). Where the store is unavailable —
private/partitioned browsing contexts, a WebView started on a restricted scheme,
or any non-browser render — **every** `apiFetch` died with
`ReferenceError: localStorage is not defined` before the request was built, i.e.
an unrelated error message for a working API. Found by the FE-01 client tests.
**Fixed in FE-01**: `storageGet` / `storageSet` / `storageRemove` helpers, used
by `token()`, `login()`, `logout()`, `getApiKey()` and `saveApiKey()`.

### F-7 (low) — four different console prefixes
`[apiFetch]`, `[Printers] API failed`, `[Dashboard] /jobs failed`,
`[PrintOps] React render error`. Nothing to grep for when walking a hospital
operator through the console. **Fixed in FE-01**: `lib/logError.ts`, everything
is `[PrintOps][<scope>]`, plus a bounded in-memory ring buffer a future
diagnostics view can read.

### F-8 (low) — no trace id anywhere in the UI
The backend threads `traceId` through jobs, traces and audit logs, but no error
surface ever showed one, so a support request could not be tied to a server-side
trace. `ApiError` now reads `traceId` / `trace_id` from the body and
`x-trace-id` / `x-request-id` from headers, and `ErrorState` exposes it behind a
"technical details" disclosure. **Caveat:** the API does not currently *emit*
trace ids on error responses — the frontend is ready, the backend side is a
separate (out-of-scope) change.

## 4. Other baseline findings (recorded, NOT fixed)

* **Hardcoded Thai outside i18n.** `tauri.ts` builds user-facing strings
  directly: `บันทึกไฟล์เรียบร้อยแล้ว`, `ไม่สามารถส่งออกไฟล์ได้`,
  `ส่งออกไฟล์ ... เรียบร้อยแล้ว`. An English user gets Thai. Same class of
  problem inline in `JobQueue` (`เลขที่เอกสาร:`) and the entire reprint dialog,
  which is hardcoded **English** prose in a Thai-default app.
* **501 inline `style={{}}` sites** across `pages/`, many re-declaring colors
  that already exist as tokens (`#1e66f5`, `#888`, `#f38ba8`, `#1e1e2e`). The
  token layer is good (626 references, full color/typography/spacing/radius
  scale) — it is simply bypassed half the time.
* **No route-level code splitting.** All 19 pages, including the 2994-line
  `PaperProfiles`, are in the initial bundle via static imports — one
  **1458 kB** JS chunk (400 kB gzip), over Vite's 500 kB warning threshold on
  every build.
* **Auth gating is inconsistent.** Only `/print-flow` is wrapped in
  `RequireRoles`; every other admin route relies on nav visibility alone, so
  direct-URL access is not blocked client-side (the API still enforces
  permissions, so this is a UX defect, not a security hole).
* **`getApiKey()` falls back to the hardcoded dev key** `printops-dev-apikey-2026`
  when nothing is configured — in production builds too.
* **Polling everywhere, no shared scheduler.** `JobQueue` polls every 1.5s
  unconditionally, including when the tab is hidden and when the API is known
  down; there is no backoff.
* **Accessibility gaps.** The nav is in good shape (`aria-expanded`,
  `aria-controls`, Escape handling), but data tables use `<th>` without
  consistent `scope`, and status is often conveyed by color plus an uppercase
  code with no text alternative.
* **`vitest` runs in the node environment**, so no page can be tested through
  user interaction. Adding jsdom + Testing Library is the prerequisite for
  testing anything stateful.

## 5. What FE-01 added

| File | Purpose |
|---|---|
| `src/api/errors.ts` | `ApiError` (status/code/message/details/traceId), `apiErrorFromResponse`, `networkApiError`, `errorMessage`, `errorTechnicalSummary` |
| `src/lib/logError.ts` | single `[PrintOps][scope]` console channel + bounded ring buffer |
| `src/components/PageState.tsx` | `LoadingState`, `EmptyState`, `ErrorState`, `ErrorBanner` |
| `src/components/RouteErrorBoundary.tsx` | localized, logging, route-resetting boundary |
| `src/__tests__/apiError.test.ts` | 12 tests over the real wire shapes emitted by `apps/api` |
| `src/__tests__/apiClient.test.ts` | 8 tests: `apiFetch`/`login` wiring, 401 masking, log dedupe |
| `src/__tests__/pageState.test.tsx` | 8 tests: roles, disclosure, retry affordance, headline selection |

`logError` collapses consecutive identical failures into a `repeats` counter:
`JobQueue` polls every 1.5s, so an outage would otherwise emit ~40 console lines
a minute and fill the whole ring buffer with one repeated network error.

Wired into `client.ts` (`apiFetch`, `login`, `apiDownload` all throw
`ApiError`), `App.tsx`, and three representative pages: `Dashboard`, `JobQueue`,
`Printers`. New i18n keys added to **both** locales.

## 5b. What FE-01.1 added (closure gate)

FE-01 typed the transport and built the error surfaces; FE-01.1 closed the
behavioural gaps a static review found in the pages themselves.

| File | Purpose |
|---|---|
| `src/lib/pollController.ts` | Framework-free polling core: overlap suppression, visibility pause/resume, `lastSuccessAt` / `stale` / `refreshing` bookkeeping. Owns no React state, so it is testable in the node environment |
| `src/hooks/useApiResource.ts` | React binding for the controller — one-shot (`refresh()` only) or polled (`intervalMs`) |
| `src/hooks/useApiAction.ts` | Mutations: `run`, `pending`, `error`, `result`, `reset`; keeps the thrown `ApiError` intact |
| `src/lib/relativeTime.ts` | `formatRelativeTime`, extracted from the byte-identical copies in `Runners` and `LocalDiagnostics` |
| `src/components/Button.tsx` | `type="button"` by default, busy state that blocks double-submit, `aria-busy` |
| `src/components/Alert.tsx` | One inline-message implementation; assertive for error/warning, polite for success/info |
| `src/components/Dialog.tsx` | Native `<dialog>` + `showModal()` (platform focus trap), `onCancel` wired so Escape cannot desync React state |
| `src/components/FormField.tsx` | Generates ids and wires `htmlFor` / `aria-describedby` / `aria-invalid` |
| `src/components/StatusBadge.tsx` | The only place a job status is painted |
| `src/__tests__/pollController.test.ts` | 10 fake-timer tests: overlap, hidden-pause, resume-refetch, retain-on-failure, stop |
| `src/__tests__/primitives.test.tsx` | 13 tests over the primitives + relative time |

Behavioural fixes, per gate:

* **Dashboard** — three independent resources instead of `Promise.all` +
  `catch(() => [])`. A failed endpoint no longer renders as zeroes, a retry no
  longer wipes the panels that still work, the banner says how many endpoints
  failed, and the header carries the oldest last-success timestamp.
* **JobQueue** — polling moved onto the controller (no overlapping requests, no
  polling while hidden), manual retry on the failure banner, `Freshness` header,
  first-load failure gets an `ErrorState` instead of an empty table.
* **JobDetail** — the three `.catch(() => {})` are gone. A failed first load
  renders an error with retry instead of spinning forever; a failed *trace* and
  a job with *no* trace are now different messages (a 404 from
  `/jobs/:id/trace` resolves to "no trace", not an error); a failed deliveries
  fetch no longer renders as "no delivery", which read as "the callback never
  fired".
* **Session expiry** — `apiFetch` notifies subscribers on **401** only (403 is a
  permission decision on a valid session and must not sign anyone out); `App`
  returns to Login with "Your session expired". A rejected sign-in does not go
  through this path.
* **Status rendering** — `JobDetail`'s page-local `STATUS_COLORS` (saturated
  backgrounds + white text) is deleted. It contradicted the WCAG contrast audit
  at the top of `statusColors.ts` — which measured that white text fails on
  every one of those backgrounds — and painted the same status differently than
  the queue. `Dashboard`, `JobQueue`, `JobDetail` and `PrinterDetail` now share
  `<StatusBadge />`. `DELIVERY_PRESENTATION` in `JobDetail` is deliberately NOT
  absorbed: callback delivery is a different axis from print status.
* **Reprint dialog** — moved to `Dialog` + `FormField` + `Button` and fully
  translated (it was English-only in a Thai-default app). Safety semantics are
  untouched: submission still requires the duplicate-risk acknowledgement, a
  reason, a runner id and the original request id, and the request body is
  unchanged (`printerId`, `copies`, `reason`, `confirmedDuplicateRisk`).

**Adoption status, stated precisely:** the primitives exist and are consumed by
`Dashboard`, `JobQueue`, `JobDetail` and `PrinterDetail`. `Settings`,
`Webhooks`, `PrintFlowBindings`, `Templates` and `PrinterDetail`'s own
`actionMessage` strip still carry hand-rolled buttons and coloured message divs;
converting them is FE-02 work, not part of this gate.

Retention rule adopted with these changes: **wherever data is retained through a
failure, its age must be on screen.** Keeping the last rows visible during a
blip is right; letting them look live is the defect this milestone closes, so
`Freshness` (updated / not current / refreshing / paused) is mandatory next to
retained data, not optional polish.

## 5c. What FE-01.2 added (final closure)

FE-01.1 built the machinery and converted three pages. FE-01.2 migrated the
rest of the dashboard onto it, in three verified waves.

**Converted to `useApiResource` / `useApiAction` / the shared primitives:**
`AuditLogs`, `Printers`, `Runners`, `RoutePolicies`, `PrinterBindings`,
`ExportCenter`, `PrinterDetail`, `DiscoveredPrinters`, `LocalDiagnostics`,
`UsersRoles`, `Settings`, `PrintFlowBindings`, `TemplateSandbox`, `Templates`,
`Webhooks`. Every page in `pages/` except `PaperProfiles.tsx` (deferred by
instruction — it is being restructured separately) now goes through the
foundation.

Defects fixed along the way, beyond the mechanical conversion:

* **Two manual `setInterval` loops removed** (`Runners` 15s, `LocalDiagnostics`
  30s). Both now poll through `pollController`: no overlap, suspended while the
  window is hidden, and a stale-marked table instead of a frozen one. `grep -rn
  "setInterval" pages/` is now empty.
* **Un-awaited mutations that rejected into nothing**: `RoutePolicies.create()`,
  `PrinterBindings.create()` and every `ExportCenter` download were floating
  promises. An invalid policy body or a denied export produced an unhandled
  rejection and a button that appeared to do nothing at all.
* **`Settings.saveWorkspace()` could not fail.** It swallowed the
  `localStorage` exception internally and returned `void`, so the caller's
  `catch` was unreachable and the page reported "Saved" over a write that never
  happened. It now returns a boolean and the page says so (`settings.storageUnavailable`).
* **`PrinterDetail` was showing raw translation keys.** It used
  `t('page.printerDetail.testPrintSent') ?? 'fallback'` for keys that do not
  exist — and `t()` returns the key itself when missing, which is truthy, so the
  `??` fallback was dead code and the operator saw
  `page.printerDetail.testPrintSent`. Those keys now exist in both locales,
  along with the panel labels that were hardcoded English.
* **`DiscoveredPrinters` used `window.confirm()`** for printer registration and
  inferred its message tone by string-matching the message against a translated
  prefix. Now `Dialog` + an explicit tone.
* **Bulk loops now report why.** `Templates` import, `Webhooks` import and
  `Webhooks` batch delete deliberately continue past a failed item — that part
  is correct and unchanged — but each carries the first failure's reason into
  the summary instead of reporting only a count.

* **`useApiAction.error` was unreadable from the handler that awaited it.**
  It is React state, so the `action` object a handler closed over still held the
  previous value right after `await run()`: the first failure printed the
  generic fallback and the second printed the *previous* error — a
  plausible-looking wrong reason, the exact defect class this milestone exists
  to remove. Nine call sites were affected (including two that shipped in
  FE-01.1). `useApiAction` now also exposes ref-backed `getError()` for handler
  use; `error` remains for render-time consumers, and which to use is documented
  on the type. Pinned by `__tests__/apiActionError.test.ts`.

**Intentional guards deliberately left alone** (as classified in F-5): the two
`localStorage` guards in `Settings`, `JSON.parse` validation in
`TemplateSandbox`, `Templates.parseImport` and `Webhooks`' payload check, and
`Webhooks`' date-format fallback. Six `catch {}` remain in `pages/` and all six
are these.

**Freshness rule, applied uniformly:** every page converted to `useApiResource`
renders `<Freshness>`. The hook retains data through a failure by design, so
each conversion creates a retained-stale-data surface; the age of the data is
therefore shown on all of them, not only the polled ones.

Not in scope and untouched: `PaperProfiles`, navigation, route lazy loading,
visual redesign, and `Webhooks`' own `showToast` layer (a shared toast primitive
remains FE-02 work — `Webhooks` and `Templates` still have their own).

## 5d. What FE-01.2 final runtime closure added

**Job Detail polling now ends with the job.** The terminal-aware policy
(`lib/jobDetailPolling.ts`) existed but was never wired in, so three endpoints
kept firing every second on a job that could no longer change — roughly 180
requests per minute for as long as the tab stayed open, which on a shared
gateway is indistinguishable from a client bug. `JobDetail` now computes
`shouldPollJobDetail(...)` from the loaded job and its deliveries and applies it
to all three resources through `setPollingEnabled`.

Stopping is not resetting: the retained job, trace and delivery data stay on
screen and `refresh()` still works, because `pollController.setPollingEnabled`
only clears the timer.

The mapping from page state to policy input is exported as
`jobDetailPollingInput(job, deliveries)` and tested. It is the part most likely
to be got wrong later: `callbackIntent.transports` is what the job *intended* to
notify, `deliveries` is what actually happened, and reading the second as the
first would stop polling before a callback resolved.

**Known consequence, accepted:** a terminal job with callbacks enabled whose
`/v1/callback-deliveries` request fails permanently (e.g. 403) reports zero
delivery statuses, which the policy reads as "no delivery row yet" and keeps
polling. That is the same signal as a genuinely pending first delivery, and the
required behaviour for it is "continue polling", so the two cannot be separated
without a new fact from the API.

**Diagnostics no longer states an outage as a finding.** `LocalDiagnostics`
rendered "No runners connected. Start the runner app…" whenever the runner list
was empty — including when `/runners` had failed and never once succeeded. An
operator acts on that sentence by walking to a machine. Both claims are now
gated on a successful response (`data !== undefined`), per runner as well as
per page, with `page.diagnostics.runnersUnavailable` /
`page.diagnostics.printersUnavailable` for the unknown case. The partial-failure
banner is unchanged.

**Duplicate-mutation guard is now covered.** `useApiAction`'s single-flight
logic was untestable while it lived inside the hook (no jsdom). The dedupe and
release moved to `lib/singleFlight.ts` — 44 lines, framework-free — and the hook
delegates to it while keeping every React state write in place; the public
`ApiAction` contract is unchanged. Seven tests cover shared in-flight promise,
exactly-one invocation for a burst, release on success, release on failure (a
failed mutation must stay retryable), a later action with its own arguments, a
presentation-only `reset()` being unable to release the slot, and a late settle
being unable to free a newer run's slot.

Not covered: unmount not writing React state. `react-dom/server` runs no
effects, so `mounted.current` never flips and there is no unmount to trigger;
proving it needs jsdom, which this milestone was told not to add.

**Typecheck fix.** `__tests__/pollingControl.test.ts` did not compile on the
pulled branch — `vi.fn().mockResolvedValue` widened the fetcher's result to
`any`, inferring `PollSnapshot<unknown>` against a `PollSnapshot<string[]>[]`
sink. Two explicit `createPollController<string[]>` annotations; no behaviour
change.

**Desktop serving path, verified against the production bundle.** The packaged
shell loads `http://127.0.0.1:31415` from `server.exe`, which serves
`apps/web/dist` through the static/not-found handler in `apps/api/src/app.ts`.
Injecting requests against a real app instance over the built `dist`: `/` returns
the built `index.html`; the hashed JS and CSS are served with the correct
content types; the built asset extensions (`.js`, `.css`) are all inside that
handler's hardcoded MIME map; `index.html` references no external origin (the
WebView is offline).

**Defect found there, backend-scope, NOT fixed:** six dashboard deep links are
shadowed by legacy unprefixed API routes and return `401` JSON instead of the
SPA shell — `/printers`, `/printers/:id`, `/jobs`, `/jobs/:id`, `/runners`,
`/audit-logs`. The remaining twelve fall back to `index.html` correctly. The
Fastify route wins over `setNotFoundHandler`, so a hard reload or a pasted link
on Job Detail — this milestone's own page — shows raw JSON in the WebView.
Fixing it means moving or prefixing backend routes, which this task forbids.

## 5e. What FE-01.3 added (terminal freshness UX)

FE-01.2 stopped the polling but left the clock running. On a finished job the
line kept reading "Updated: 14 minutes ago" and growing — which is what an API
outage, a frozen WebView and a disconnected desktop client also look like. The
operator cannot tell "this job is done" from "this page has lost the server",
and the second reading is the one that gets a working printer power-cycled.

`Freshness` now takes `monitoringComplete` and derives six presentations through
an exported `freshnessState(...)`: `LIVE`, `REFRESHING_LIVE`, `PAUSED_HIDDEN`,
`STALE_ERROR`, `TERMINAL_COMPLETE`, `REFRESHING_TERMINAL`. Live wording is
byte-identical to before.

Precedence, both deliberate:

- **terminal outranks paused** — nothing is waiting to resume, so "paused while
  this window is in the background" would describe a loop that is not running.
  `pollController` still emits `paused` on visibility change regardless of
  whether polling is enabled, so without this rule a hidden finished job would
  claim to be waiting.
- **terminal does not outrank refreshing** — a manual re-check of a finished job
  is real work and must be visible, under its own wording
  (`state.refreshingFinal`) so it is not read as the live loop coming back.

Terminal + `stale` (a manual re-check that failed) keeps the final-snapshot
wording, adds `state.finalRefreshFailed`, and does **not** take the stale colour:
the page's `ErrorBanner` already carries the failure, and a finished job is not a
data-freshness problem. Colour is never the only signal — every state has text.

Four keys, both locales: `state.finalCaptured`, `state.terminalUpdatesStopped`,
`state.refreshingFinal`, `state.finalRefreshFailed`.

`JobDetail` derives `monitoringComplete = job !== null && automaticPollingNeeded
=== false`. The `job !== null` half matters: an unloaded job has no status, and
without it the page would flash a "final state" claim before the first response
arrived. `automaticPollingNeeded` remains the primary decision — the
presentation reads it, not the reverse — so a wrong sentence can never disable
polling.

Coverage: 22 tests. The state machine, each rendered state, both locales, and
the eight print/callback rows walked from `shouldPollJobDetail` through to the
rendered sentence — asserting that exactly one of "final" and "live" appears,
never both and never neither.

Re-ran the FE-01.2 desktop serving check against the rebuilt bundle: shell,
content types, MIME coverage, offline-only, and all six new strings (English and
Thai) present in the shipped chunk. The pre-existing deep-link shadowing
described in §5d is unchanged and still not fixed — backend scope.

## 6. FE-02 migration list (not started)

Pages still on ad-hoc error handling, roughly by operator impact:

The page migration is **complete** as of FE-01.2 — every page except
`PaperProfiles.tsx` is on the foundation. What remains is not page-by-page work:

1. **`PaperProfiles.tsx`** — deferred by instruction; restructured separately.
2. **A shared toast primitive.** `Webhooks` and `Templates` still own
   `showToast` / `ds-toast` implementations. `Alert` covers the inline case;
   the floating-toast case has no shared component yet.
3. **i18n for `src/tauri.ts`** — still builds Thai user-facing strings outside
   the dictionary (`บันทึกไฟล์เรียบร้อยแล้ว`, `ไม่สามารถส่งออกไฟล์ได้`), so an
   English user gets Thai. Same for the remaining hardcoded English column
   headers in `UsersRoles`.
4. **Route-level code splitting** — one 1.4 MB chunk, over Vite's warning
   threshold on every build.
5. **jsdom + interaction tests.** Until then, behaviour that must be tested
   belongs in a framework-free module (as `pollController` is), because
   `renderToStaticMarkup` cannot run effects or clicks.
6. **The API does not emit `traceId` on error responses.** The frontend reads it
   already; the backend half is a separate change.
7. **Six SPA deep links are shadowed by legacy unprefixed API routes** — see
   §5d. Backend-scope, so untouched here.
8. ~~**`Freshness` keeps counting up after polling intentionally stops.**~~
   Closed by FE-01.3 — see §5e.
