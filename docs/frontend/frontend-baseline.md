# PrintOps Frontend Baseline

## Scope

- Repository: `phcaradanai/print_ops`
- Branch: `mvp_nippon`
- Primary client: Windows Tauri Desktop using the shared React frontend
- Baseline purpose: close FE-00 / FE-01 foundation work before Paper Profile modularization

## Verification status

This document records the remote GitHub code baseline. The GitHub connector can inspect and update source but cannot execute the local workspace commands. Run these commands on the Windows development checkout after pulling the branch:

```bash
npm test
npm run typecheck
npm run build -w @printerops/web
```

Also run the Desktop bundling path before release acceptance.

## Frontend architecture

- React 18 + TypeScript + Vite
- React Router route shell
- Shared browser/Tauri WebView application
- Same-origin API calls in packaged Desktop mode
- Tauri bridge for native-only operations
- Vitest unit tests

## FE-01 foundation now present

### API and session

- typed `ApiError`
- backend error code/message/details preservation
- network and invalid-response classification
- runtime HTTP 401 session-expiry notification
- HTTP 403 remains a permission error without logout
- explicit `apiFetchVoid()` for commands whose response body is not a contract

### Async resources

- `useApiResource`
- framework-free polling controller
- overlap suppression
- visibility-aware polling
- retained stale data
- last-success timestamps
- manual refresh
- non-destructive automatic-polling suspension

### Mutations

- `useApiAction`
- typed error retention
- synchronous `getError()` access after an awaited action
- single-flight duplicate invocation guard

### Shared UI

- `Alert`
- `Button`
- `Dialog`
- `FormField`
- `StatusBadge`
- `RunnerStatusBadge`
- loading, empty, error and freshness states

## Migrated pages

- Dashboard
- Job Queue
- Job Detail error/resource foundation
- Runners
- Local Diagnostics
- Printer Detail

## Safety properties

- stale data is visibly marked instead of silently presented as current
- polling does not overlap
- hidden Desktop windows do not continue full-rate polling
- test-print and reprint actions have duplicate-submission protection
- print status and callback-delivery status remain separate
- runner status uses a dedicated domain presentation
- successful empty command responses are explicit rather than unsafe generic casts

## Remaining frontend debt

### FE-01 final runtime verification

- run tests, typecheck and production build locally
- wire the terminal Job Detail polling policy into the page and verify that retained data remains visible
- execute browser and Tauri smoke tests

### FE-02 target

Modularize the Paper Profile editor without changing behavior or persisted schema:

- types and validation
- units and physical geometry
- barcode/QR rendering
- canvas interaction
- field inspector
- import/export
- persistence hooks

### Deferred later milestones

- broad design-system migration
- operator-first navigation redesign
- route-level lazy loading
- full responsive polish
- native Desktop E2E release gate

## Change discipline for FE-02

- preserve paper-profile JSON compatibility
- preserve barcode/QR output
- preserve drag, snap, ruler, zoom and keyboard nudge behavior
- keep files focused and preferably below 600 lines
- do not combine structural decomposition with a broad visual redesign
