# PrintOps unified UX/UI concept

Status: implemented in the shared frontend and desktop entry flow; the boards remain illustrative references. Date: 2026-10-22.

## Goal and scope

Make PrintOps easier to operate and visually consistent across the browser and Tauri desktop app. The shared React UI remains the implementation source. Desktop startup, local-service connectivity, diagnostics and recovery belong to the same design system. Reference boards do not supply live data or runtime capabilities; implementation preserves the existing printing, access-control and OTA contracts.

## Shared visual language

- Light work surface, deep ink navigation, blue primary actions; reuse the existing PrintOps primary color `#1e66f5` and navigation `#1e1e2e`.
- Use a Thai-capable sans-serif, approximately 14px body text, 24px page headings, 8px spacing rhythm, 6–8px control radii and 44px primary interaction targets.
- One page frame: breadcrumb, title and description, primary action, optional attention message, search/filter toolbar, main content and pagination or form actions.
- Match table density, field labels, toolbar order, dialog geometry, empty states and status badges across all pages. Reserve shadows for overlays.
- Pair every status color with an icon and explicit label. Maintain readable contrast, visible keyboard focus, reduced-motion support and Thai/English layouts.

## Navigation and page families

| Group | Surfaces | Shared pattern |
| --- | --- | --- |
| Operations | Overview, job queue, job detail | Attention-first summary, filtered table, detail drawer or full detail page |
| Devices | Printers, printer detail, discovery, runners, diagnostics | Health filters, device list, connection details and explicit next step |
| Configuration | Templates, sandbox, paper profiles | Searchable library and focused editing workspace; preview before save |
| Connections | Webhooks, routing policies, printer bindings, print flow bindings | Consistent list and edit form with clear source/destination relationships |
| Administration | Audit logs, export center, users/roles, account security, settings | Search/filter patterns or grouped forms, respecting existing role permissions |
| Entry and recovery | Sign-in, recovery, startup, service unavailable | Compact focused task, clear progress or error, one primary next action |

The grouped navigation is a proposal. Preserve existing routes and permissions when implementing; collapsing navigation must not remove access to any existing page.

## Operational behavior

- Lead the overview with work needing attention, followed by a compact summary, recent jobs and printer health.
- Give the queue a dedicated Needs attention filter. Keep identifiers and important timestamps discoverable without relying on clipped text.
- Selecting a row can expose a detail drawer without losing the filter or scroll position. Preserve direct navigation to full details.
- Keep SUCCESS and UNVERIFIED distinct. UNVERIFIED means physical output was not confirmed: explain this and guide the operator to inspect the printer. Never imply it failed or automatically reprint it.
- Reprint, cancellation, deletion and update actions retain existing permissions and safeguards. A visual redesign does not authorize execution changes.
- Forms use labels above fields, helper text below, inline validation, unsaved-change protection and consistent save/cancel placement.
- Specify loading, empty, no-filter-results, permission-denied, stale/offline, validation error and success states for every page family.

## Desktop adaptations

- Use the shared navigation, content components and status vocabulary inside the native window.
- Keep native window controls clear of interactive app content. At narrow window widths collapse navigation before compressing tables or labels.
- Startup should show real available lifecycle information; do not invent progress percentages or readiness signals. If only a connection probe exists, label it honestly as checking the local service.
- The unavailable state explains that the local service cannot be reached, offers Retry and an expandable diagnostic summary. Proposed additional diagnostic actions must be checked against existing capabilities before implementation.
- During a connection loss show that displayed data may be stale. Do not indicate that printing has completed merely because the app reconnects.
- Local gateway identity belongs in a small connection indicator. Printer status and runner status remain separate from gateway connectivity.
- Update and rollback surfaces must retain existing fail-closed OTA contracts. Do not introduce new update actions through visual work.

## Responsive and accessibility criteria

- Desktop/browser: review 1440px and 1280px layouts; desktop app: also review a 1024px-wide window.
- Narrow browser: 390px navigation drawer, stacked form fields, focused job/device summaries; allow contained table scrolling when necessary.
- Critical status and next action remain visible without a large decorative header.
- Test keyboard traversal, focus restoration from drawers, screen reader labels, contrast and Thai string wrapping in implementation.

## Deliverables and limits

Generated boards use synthetic operational data. Any figures, counts or names are examples, not live system evidence. Imagegen typography, particularly Thai, is illustrative: exact copy must come from the bilingual application dictionaries during implementation.

See sibling prompt text files for the exact built-in imagegen prompts. Images in this folder are design references, not UI assets to embed as screenshots in the live app.

Implementation acceptance: all page families reuse shared primitives; browser and desktop share the same visual system; desktop-specific entry/recovery states are covered; existing printing, access control and OTA behavior is preserved.

## Implementation and evidence

- Shared shell: breadcrumb/topbar, language switch, role-filtered navigation and a keyboard-trapped mobile drawer. Closed navigation is inert; dismissal restores the opener and route selection focuses main content.
- Operations: attention-first overview, a compact summary strip, queue attention filtering and a read-only job drawer that preserves list context. Unknown outcomes never become success or automatic reprints.
- Devices and configuration: shared health filters, form/table primitives and English/Thai dictionaries. Enabled printers are labelled separately from observed readiness. Numeric evidence such as DPI stays on one line; long storage paths wrap.
- Desktop: bundled entry UI is available without the API. A real health check controls the handoff to the existing HTTP origin. Retry, diagnostics, native titlebar clearance and the physical-output safety notice use the same frontend.
- Browser smoke: 18 local routes at 1440px and 390px, plus representative English and control-mode routes at 1280px/1024px/390px. All 54 route/viewport checks had no document-level horizontal overflow. Queue search/filter retention, detail dismissal, drawer focus trapping and VIEWER navigation were exercised with an isolated memory API and execution disabled.
- Native smoke: packaged `tauri.localhost` entry, unavailable-service state, expanded diagnostics, Retry, HTTP-origin handoff and successful login to Dashboard were exercised. Dashboard behavior is proven by the accessibility tree; its final pixel capture was stopped by the user.
- Regression gates passed: frontend typecheck, 667 tests, production web build, five API runtime-architecture tests and native production-asset compilation with `--features tauri/custom-protocol`. Impeccable detector returned no findings.
- Physical printing, live OTA rollout and cross-machine deployment were not exercised by this visual redesign.
