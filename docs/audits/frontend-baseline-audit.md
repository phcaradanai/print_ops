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

## 6. FE-02 migration list (not started)

Pages still on ad-hoc error handling, roughly by operator impact:

1. `JobDetail.tsx` — job-level failures matter most after the queue
2. `Templates.tsx`, `Webhooks.tsx` — 4 generic `actionFailed` strings each
3. `PrintFlowBindings.tsx` — one fully silent catch on load
4. `Runners.tsx`, `AuditLogs.tsx`, `UsersRoles.tsx`, `PrinterDetail.tsx`,
   `DiscoveredPrinters.tsx`, `LocalDiagnostics.tsx`, `RoutePolicies.tsx`,
   `PrinterBindings.tsx`, `ExportCenter.tsx`, `TemplateSandbox.tsx`
5. `Settings.tsx` — keep the `localStorage` guards, convert the save paths
6. `PaperProfiles.tsx` — explicitly deferred; it is being restructured separately

Also queued: a shared toast/notification primitive (mutation feedback is
currently three different hand-rolled implementations — `JobQueue`'s `message`,
`Webhooks`' `showToast`, `Settings`' `message`), i18n for `tauri.ts` and the
reprint dialog, and jsdom-based interaction tests.
