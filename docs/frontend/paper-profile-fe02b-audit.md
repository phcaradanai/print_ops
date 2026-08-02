# FE-02B Paper Profile Structural Modularization Audit

## Initial Working-Tree State

Recorded on 2026-07-30 before source edits.

| Check | Result |
|---|---|
| `git fetch origin` | PASS |
| Current branch | `mvp_nippon` |
| Tracked changes | None |
| User-owned untracked paths | `FE-02A-Paper-Profile-UX-Stabilization.md`, `FE-02B-Paper-Profile-Structural-Modularization.md`, `artifacts/browser/` |
| Pull decision | Not run because the worktree contains user-owned untracked content |
| Safety decision | Preserve all existing paths; no reset, clean, force checkout, commit, or push |

The baseline page contained 3,113 lines. The FE-02A CSS regression files
contained 484 and 267 lines respectively. The requested
`apps/web/src/__tests__/apiDeleteResponse.test.ts` path was not present at
baseline; the available API tests are documented in the verification section.

## Original Responsibility Map

| Responsibility | Original lines | Dependencies / side effects | Candidate destination | Existing coverage | Risk |
|---|---:|---|---|---|---|
| Validation types and profile validation | 12-50 | Pure | `model/validation.ts` | Unit helpers in page tests | Medium |
| Field selection, centering, nudge helpers | 52-91 | Pure geometry types | `model/fieldGeometry.ts` | Unit helpers in page tests | High |
| Artwork/import types and normalization | 93-252 | File metadata, pure validation | `model/importDesign.ts` | Unit helpers in page tests | High |
| Persisted profile/form types | 254-301 | Transport schema | `model/types.ts` | API/E2E | High |
| Orientation and coordinate mapping | 302-390 | Pure | `model/geometry.ts` | Unit helpers in page tests | Critical |
| UX/field types and constants/defaults | 392-520 | Barcode constants | `model/types.ts`, `model/defaults.ts` | Snapshot/unit behavior | High |
| Unit conversion | 521-532 | Pure | `model/units.ts` | Unit helpers in page tests | Medium |
| Shared local UI primitives | 534-644 | React, accessibility | feature components | UX E2E | Medium |
| Ruler/canvas rendering helpers | 645-1173 | React, barcode SVG, geometry | `components/PaperCanvas.tsx` | UX/layout E2E | Critical |
| Editor/resource/import/modal state | 1175-1263 | React hooks, DOM refs, API hooks | editor/persistence/import hooks | E2E | Critical |
| Section navigation and form mutations | 1264-1416 | React state | editor hook/components | UX E2E | High |
| Profile API resource and persistence | 1417-1464 | API, shared hooks, feedback | `api/`, persistence hook | delete/API E2E | Critical |
| Preset popup and JSON import/export | 1465-1605 | DOM listeners, browser/Tauri files | popup hook, serialization | UX E2E | High |
| Artwork import flow | 1606-1811 | object URLs, async API, Tauri/browser | import hook + model | UX E2E | Critical |
| Edit/preset/derived preview state | 1812-1847 | editor state, geometry | editor hook/selectors | E2E | High |
| Viewport/full-preview behavior | 1848-1974 | ResizeObserver, focus trap, keyboard | canvas/popup hooks | layout/UX E2E | Critical |
| Pointer drag interaction | 1975-1993 | document pointer listeners | canvas interaction hook | drag E2E | Critical |
| Drawer focus behavior | 1994-2045 | DOM focus trap/listeners | popup/import hook | UX E2E | High |
| Header, command bar, forms, canvas, tables, dialogs and drawers | 2047-3112 | React, i18n, all controller state | focused components/workspace | UX/layout/delete E2E | Critical |

Dependency direction target:

```text
pages -> feature workspace/hooks -> components/state/api -> pure model
```

Pure model modules must have no React, DOM, translation, or transport
dependencies. The API module may depend on the shared transport but not React.
Components receive explicit intent-oriented props and do not issue requests.

## Baseline Verification

| Command | Result | Duration | Notes |
|---|---|---:|---|
| `npm test` | PASS | 15.3s | 428 web tests passed, including 210 Paper Profile tests and 5 DELETE compatibility tests; all other workspace and Go tests passed |
| `npm run typecheck` | PASS | 10.6s | All TypeScript workspaces and Go packages passed |
| `npm run build -w @printerops/web` | PASS | 11.7s | Production bundle built; existing large-chunk warning only |
| `npx playwright test apps/web/e2e/paper-profile-ux.spec.ts` | PASS | 29.3s | 39 Chromium tests passed |
| `npx playwright test apps/web/e2e/paper-profile-layout-regression.spec.ts` | FAIL | 4.0s | 1/2 failed: the short-window test inspected `documentElement`, although `.app-main` is the documented application scroll owner |
| `npx playwright test apps/web/e2e/delete-flows.spec.ts` | PASS | 3.8s | 2/2 passed, including Paper Profile HTTP 204 deletion |

The brief named `apiDeleteResponse.test.ts`; the repository contains the
equivalent and broader `apiDeleteCompatibility.test.ts`, whose five tests
passed. Baseline browser evidence is Chromium against the production web
bundle. No Tauri/WebView2 runtime evidence was collected at baseline.

## Defects Discovered During Refactor

| ID | Severity | Pre-existing/New | Resolution | Evidence |
|---|---|---|---|---|
| FE02B-B01 | Medium (test false-negative) | Pre-existing | Updated the existing short-window regression to assert the documented `.app-main` scroll owner and prove that scrolling actually moves, instead of checking the intentionally non-scrolling `documentElement` | Baseline failed only the old assertion while panel non-overlap passed; focused rerun recorded below |
| FE02B-B02 | Medium | Pre-existing | Added `pointercancel` termination and cleanup alongside `pointerup`; cancelled pointer sequences can no longer leave the field in a dragging state | Source inspection showed the drag effect registered only `pointermove` and `pointerup`, contrary to pointer lifecycle requirements |

## 1. Structural Result

| Area | Before | After | Result |
|---|---|---|---|
| Page composition | 3,113-line page owned all behavior | 69-line route compatibility/composition module | PASS |
| Domain model | Types, defaults, validation, units, geometry and import helpers embedded in page | React/API-free modules under `model/` | PASS |
| API layer | Raw endpoint strings in page | One typed `api/paperProfilesApi.ts`; DELETE retains empty-response-compatible `apiFetch<void>` | PASS |
| Editor state | Coupled local state with transition helpers in page | Pure typed reducer/state/selectors plus five transition tests; runtime migration remains incomplete | PARTIAL |
| Canvas interaction | Page-owned geometry, rendering and pointer lifecycle | One shared 546-line `PaperCanvas` for inline/full rendering; interaction effect remains in workspace | PARTIAL |
| Import flow | Page-owned validation and request shaping | Types, validation and request shaping extracted; browser/Tauri side effects remain in workspace | PARTIAL |
| Components | All component markup in page | Canvas, rulers, field rendering and editor primitives extracted | PARTIAL |
| Tests | 210 Paper Profile unit tests and FE-02A browser suites | 217 Paper Profile/model/state tests; full 47-test Playwright suite green | PASS |

### Feature directory tree

```text
apps/web/src/features/paper-profiles/
├── index.ts
├── PaperProfileWorkspace.tsx
├── api/
│   └── paperProfilesApi.ts
├── components/
│   ├── editorPrimitives.tsx
│   └── PaperCanvas.tsx
├── model/
│   ├── defaults.ts
│   ├── fieldGeometry.ts
│   ├── geometry.ts
│   ├── importDesign.ts
│   ├── serialization.ts
│   ├── types.ts
│   ├── units.ts
│   └── validation.ts
├── state/
│   ├── editorReducer.ts
│   ├── editorState.ts
│   └── selectors.ts
└── __tests__/
    ├── editorReducer.test.ts
    └── serialization.test.ts
```

Dependency direction is enforced for extracted modules:

```text
pages -> workspace -> components/state/api -> model
```

`model/` has no React, DOM, i18n or API imports. `api/` depends only on the
shared transport and model types. The shared canvas depends on pure geometry,
domain defaults/types, barcode rendering and locale presentation.

## 2. File Size Gate

| File | Lines | Limit | Result |
|---|---:|---:|---|
| `pages/PaperProfiles.tsx` | 69 | 400 | PASS |
| `components/PaperCanvas.tsx` | 546 | 600 | PASS |
| `components/editorPrimitives.tsx` | 126 | 600 | PASS |
| `state/editorReducer.ts` | 147 | 600 | PASS |
| All model/API/test modules | 17-147 | 600 | PASS |
| `PaperProfileWorkspace.tsx` | 1,989 | 600 | FAIL |

The original page was 3,113 lines. The route is now 69 lines and 1,124 lines
were separated into focused modules, but the remaining workspace still combines
controller effects and several presentation regions. This is not claimed as a
justified exception: further extraction would improve cohesion and is required
before FE-02B can be marked complete.

## 3. Compatibility Matrix

| Contract | Result | Evidence |
|---|---|---|
| API paths | PASS | Centralized paths match the original seven endpoints |
| Persisted schema | PASS | Shared model property names and request construction unchanged |
| JSON import/export | PASS | Version/type/envelope retained; serialization tests pin all exported fields |
| Barcode output | PASS | Existing renderer and sample/symbology branches moved without alteration; unit/E2E green |
| QR output | PASS | Existing renderer and 20 mm default retained; unit/E2E green |
| Orientation | PASS | Existing 210 geometry tests green |
| Geometry | PASS | Pure geometry module is exercised through the compatibility exports; tests green |
| Drag/snap/nudge | PASS | Existing behavior retained; `pointercancel` cleanup added; Paper Profile browser suite green |
| DELETE 204 | PASS | API compatibility tests and two delete-flow browser tests green |
| Responsive layout | PASS | 39 UX plus two layout regressions green, including 900×360 scroll ownership |

## Extracted Pure Model Test Matrix

| Area | Evidence |
|---|---|
| Validation | Existing Paper Profile unit matrix through model compatibility exports |
| Unit conversion | Existing Paper Profile unit matrix |
| Orientation/rotated mapping | Existing Paper Profile unit matrix |
| Field center/nudge/selection | Existing Paper Profile unit matrix |
| Zoom/grid/font clamps | Existing Paper Profile unit matrix |
| Import MIME/size/DPI/phase/request | Existing Paper Profile unit matrix |
| Serialization envelope and field compatibility | `serialization.test.ts` (2 tests) |

## Editor-State Transition Matrix

| Transition | Test |
|---|---|
| Form patch -> dirty, immutable previous state | PASS |
| Add field -> select new field | PASS |
| Delete selected field -> deterministic first survivor | PASS |
| Load profile -> clear stale selection/error | PASS |
| Reset editor -> defaults and no editing ID | PASS |
| Save failure -> actionable error -> dismiss | PASS |

## Component Ownership

| Component/module | Ownership |
|---|---|
| `PaperCanvas` | Inline/full sheet, rulers, grid, guides, fields, barcode/QR preview, selection |
| `editorPrimitives` | Section disclosure, icon button accessibility, color input and local style tokens |
| `PaperProfileWorkspace` | Remaining controller effects, forms, popups, drawers, dialogs and saved list |
| `pages/PaperProfiles.tsx` | Route compatibility exports and feature entry |

## 4. Verification Commands

| Command | Result | Notes |
|---|---|---|
| `git fetch origin` | PASS | Branch `mvp_nippon`; pull skipped to preserve user-owned untracked paths |
| `npm test` | PASS | All workspaces and Go packages; web has 435 tests |
| `npm run typecheck` | PASS | All TypeScript workspaces and Go packages |
| `npm run build -w @printerops/web` | PASS | Production bundle built; pre-existing large chunk warning |
| `npx playwright test apps/web/e2e/paper-profile-ux.spec.ts` | PASS | 39/39 |
| `npx playwright test apps/web/e2e/paper-profile-layout-regression.spec.ts` | PASS | 2/2 |
| `npx playwright test apps/web/e2e/delete-flows.spec.ts` | PASS | 2/2 |
| `npx playwright test` | PASS | 47/47 Chromium tests |
| `git diff --check` | PASS | Line-ending conversion warnings only |
| Tauri/WebView2 packaged runtime | NOT RUN | Packaged Desktop was not launched; no desktop PASS is claimed |

## Browser/Tauri Runtime Matrix

| Runtime / viewport | Result | Evidence |
|---|---|---|
| Chromium 1440×900 | PASS | Paper Profile UX suite |
| Chromium 1280×800 | PASS | Paper Profile UX suite |
| Chromium 1100×720 | PASS | Paper Profile UX suite |
| Chromium 1024×768 | PASS | Paper Profile UX suite |
| Chromium 900×600 | PASS | Layout regression |
| Chromium 900×360 | PASS | Layout regression; app-shell movement asserted |
| Tauri/WebView2 | NOT RUN | No packaged runtime launch in this session |

## Changed Files

- `apps/web/src/pages/PaperProfiles.tsx`
- `apps/web/e2e/paper-profile-layout-regression.spec.ts`
- `apps/web/src/features/paper-profiles/**`
- `docs/frontend/paper-profile-fe02b-audit.md`

The two FE milestone briefs and `artifacts/browser/` were pre-existing
user-owned untracked paths and were preserved. Playwright updated files under
the existing artifacts path.

## 5. Defects Discovered During Refactor

See the defect table above. No BLOCKER or HIGH regression remains.

## 6. Deferred Work

The following requested FE-02B work remains:

- split `PaperProfileWorkspace.tsx` below the 600-line gate;
- migrate runtime editor ownership to the extracted reducer;
- isolate persistence, import, popup and canvas-interaction hooks;
- extract the remaining form, drawer, dialog and saved-table components;
- add direct interaction coverage for pointer cancellation and reducer-backed
  runtime transitions;
- execute the complete manual scenario matrix in packaged Tauri/WebView2.

CSS consolidation was deliberately deferred; the FE-02A stylesheets and load
order remain intact.

These unrelated initiatives were not started: broad visual redesign,
application navigation redesign, route lazy loading, backend changes, new
persisted fields, new template language, or a new print renderer.

## 7. Final Verdict

FAIL

The refactor is regression-green and the route/API/model/canvas seams are
materially improved, but FE-02B acceptance is not complete because the
1,989-line workspace exceeds the mandatory file-size gate, several requested
hooks/components are not yet extracted, and Tauri evidence is absent. It is not
ready for FE-02C.

---

# FE-02B.1 Closure Evidence — 2026-07-30

This section appends closure evidence without replacing the original FE-02B
baseline and FAIL verdict above.

## Structural Matrix

| Area | Before | After | Result |
|---|---|---|---|
| Runtime state ownership | Independent `useState` values in workspace | `useReducer(editorReducer)` exposed through `usePaperProfileEditor` | PASS |
| Persistence hook | List/save/delete/import/export effects in workspace | `usePaperProfilePersistence`; shared resource/action hooks and typed API | PASS |
| Canvas interaction hook | Document pointer listeners and drag refs in workspace | `useCanvasInteraction`; move/up/cancel and cleanup isolated | PASS |
| Popup lifecycle | Preset/drawer/modal effects in workspace | `usePaperProfilePopups`; one-layer policy, Escape, focus and body lock | PASS |
| Import lifecycle | File, request generation and object URLs in workspace | `useImportDesign`; stale-generation guards and URL ownership | PASS |
| Form components | Large inline form tree | Basic, dimensions, margins, dynamic-fields and field-card components | PASS |
| Dialog/drawer components | Large inline overlay trees | Full preview, import/editor drawers and delete dialog | PASS |
| Workspace composition | 1,989-line controller/view | 102-line hook composition and layout mapping | PASS |

### Runtime ownership decision

`form`, dynamic fields, selected field, editing profile ID, section expansion,
save status and save error are reducer-owned. Dynamic fields are the only
`PaperProfileUx` member included in the save payload. `displayUnit`, font
defaults, colors, watermark and related appearance controls are local
editor/preview preferences; `PATCH_UX` therefore does not mark the profile
dirty. New fields copy the current font/color defaults and then become persisted
field data, so subsequent field mutations do mark the editor dirty.

Open popup type, drag state, DOM refs, viewport/stage measurements, raw numeric
input text, feedback strips, object URLs, import request generation and
single-flight refs remain ephemeral hook/component state.

## File Size Matrix

| File | Lines | Limit | Result |
|---|---:|---:|---|
| `pages/PaperProfiles.tsx` | 69 | 150 | PASS |
| `PaperProfileWorkspace.tsx` | 102 | 600 | PASS |
| `components/PaperCanvas.tsx` | 546 | 600 | PASS |
| `hooks/useImportDesign.ts` | 208 | 400 practical | PASS |
| `hooks/usePaperProfilePopups.ts` | 146 | 400 practical | PASS |
| `hooks/usePaperProfilePersistence.ts` | 129 | 400 practical | PASS |
| `hooks/usePaperProfileEditor.ts` | 120 | 400 practical | PASS |
| `hooks/useCanvasInteraction.ts` | 103 | 400 practical | PASS |
| Largest new component (`FullPreviewDialog.tsx`) | 139 | 400 practical | PASS |

No feature source file exceeds 600 lines.

## Compatibility Matrix

| Contract | Result | Evidence |
|---|---|---|
| API paths | PASS | Existing typed `paperProfilesApi` retained unchanged |
| Persisted schema | PASS | Save payload remains `PaperForm + fields`; 210 compatibility tests |
| JSON import/export | PASS | Existing serializer/import API and serialization tests |
| Barcode output | PASS | Shared `PaperCanvas`/barcode renderer unchanged; unit/browser suites |
| QR output | PASS | Shared renderer and 20 mm default unchanged; unit/browser suites |
| Geometry | PASS | Existing pure geometry module and 210 compatibility tests |
| Drag/snap/nudge | PASS | Same mapping functions, 2 mm snap and 0.1 mm rounding; cancellation tests |
| DELETE 204 | PASS | `delete-flows.spec.ts` and API empty-response compatibility tests |
| Responsive layout | PASS | 39 UX tests and two layout regression tests |

## Lifecycle and Regression Coverage

| Behavior | Evidence | Result |
|---|---|---|
| Runtime reducer transitions | Eight `editorReducer.test.ts` cases | PASS |
| Persisted vs preview-only dirty behavior | Reducer tests for `PATCH_UX` vs field mutation | PASS |
| Mutation duplicate protection | Shared `useApiAction` / `singleFlight` seven-test matrix | PASS |
| Save failure reason | Paper Profile UX browser test | PASS |
| DELETE 204 / empty 200 / structured failure | Delete E2E + five API DELETE compatibility tests | PASS |
| Pointer up/cancel/unmount cleanup | `canvasInteraction.test.ts` listener lifecycle tests | PASS |
| Inline/full scale and renderer sharing | Both components use `PaperCanvas`; full browser suite | PASS |
| Popup Escape/body lock/focus reachability | Paper Profile popup browser tests | PASS |
| Import stale response and URL lifecycle | Generation checks and centralized hook cleanup; build/typecheck | PASS |

## Verification Matrix

| Command | Result | Notes |
|---|---|---|
| `git fetch origin` | PASS | Branch `mvp_nippon`; pull skipped for user-owned untracked files |
| `npm test` | PASS | All workspaces and Go packages; web 441/441 |
| `npm run typecheck` | PASS | All TypeScript workspaces and Go packages |
| `npm run build -w @printerops/web` | PASS | Production bundle; pre-existing chunk-size warning only |
| `npx playwright test apps/web/e2e/paper-profile-ux.spec.ts` | PASS | 39/39 |
| `npx playwright test apps/web/e2e/paper-profile-layout-regression.spec.ts` | PASS | 2/2 |
| `npx playwright test apps/web/e2e/delete-flows.spec.ts` | PASS | 2/2 |
| `npx playwright test` | PASS | 47/47 Chromium tests |
| `npm run tauri:build -w @printerops/desktop` | PASS | Release EXE, MSI and NSIS bundles produced |
| Packaged Tauri/WebView2 launch | PASS | Release EXE opened a `PrinterOps` window, then closed normally |
| `git diff --check` | PASS | Line-ending conversion warnings only |

## Desktop Evidence

The packaged release executable
`apps/desktop/src-tauri/target/release/printerops-desktop.exe` launched on
Windows with a non-zero native window handle and title `PrinterOps`.
`CloseMainWindow()` then closed it normally. This proves packaged
Tauri/WebView2 startup compatibility; the detailed interaction matrix remains
covered in Chromium rather than manually repeated inside WebView2.

## Deferred Work

The following remain untouched: FE-02C visual redesign, application navigation
redesign, route lazy loading, backend changes, new persisted fields, and any new
renderer/template language. The FE-02A CSS files and browser regression files
were not weakened or redesigned.

## Final Verdict

PASS

Every structural and file-size gate passes, current browser regressions are
green, the desktop bundles build, and the packaged WebView2 application
launches successfully. FE-02B is structurally closed and ready for a separately
scoped FE-02C.
