# UI System Audit & Verification Report

## 1. CSS Architecture & System Consolidation

### Problems Identified & Resolved
1. **Duplicate Layout System**: `styles.css` previously contained 6181 lines with overlapping `.ops-page*` and `.ui-page-scaffold*` definitions. `PageScaffold.tsx` and `PageLayout.tsx` emitted dual namespaces (`ops-page` + `ui-page-scaffold`).
   - *Fix*: Standardized on `ui-page-scaffold` and `ui-page-header`. Removed duplicate `.ops-page*` rules from `styles.css`. Updated `PageScaffold.tsx` and `PageLayout.tsx` to emit canonical `ui-*` classes only.
2. **Global Overrides**: `styles.css` had aggressive global rules (`.app-main table { width: 100% !important; table-layout: fixed; }` and `.app-main div:has(> table)`).
   - *Fix*: Removed forced global table rules. Table layout and responsiveness are now cleanly owned by `<DataTable responsive>`.
3. **Hardcoded Hex Colors & Overrides**: Extensive inline hex values and 38 `!important` flags degraded theme resilience.
   - *Fix*: Replaced hardcoded hex colors with CSS variable tokens (`var(--primary)`, `var(--neutral-border)`, `var(--neutral-surface)`, etc.). Removed unnecessary `!important` flags while preserving required accessibility media queries.
4. **Z-Index Scale**: Inconsistent z-indexes (101, 49, 200, 2, 99, 300) scattered without hierarchy.
   - *Fix*: Standardized on a formal z-index scale: `--z-sticky: 10`, `--z-dropdown: 50`, `--z-overlay: 100`, `--z-drawer: 120`, `--z-dialog: 140`, `--z-toast: 160`.
5. **Legacy Class Cleanup**: Generic `.settings-*`, `.tpl-*`, and `.pp-*` classes duplicating shared primitives (`Button`, `Panel`, `Card`, `FormField`, `Dialog`, `Toolbar`) were cleaned up. Genuine domain-specific geometry (e.g. paper profile canvas grid/rulers) remains scoped.

---

## 2. Page Inventory and Implementation Status

### 1. Dashboard (`/`)
- **Components Used**: `PageLayout`, `MetricGrid`, `MetricTile`, `DataTable`, `Badge`, `StatusIndicator`, `Freshness`
- **Fixes Applied**: Preserves `UNVERIFIED` as caution tone (amber), not failure rose. Table converts to responsive cards on mobile viewports.
- **Status**: Migrated & Verified

### 2. Printers (`/printers`)
- **Components Used**: `PageLayout`, `DataTable`, `StatusIndicator`, `Badge`, `Button`, `SearchField`
- **Fixes Applied**: Centralized status mapping. Responsive table-to-card conversion. Long printer names and connection URIs wrap without page overflow.
- **Status**: Migrated & Verified

### 3. Printer Detail (`/printers/:id`)
- **Components Used**: `PageLayout`, `Panel`, `CardDetail`, `CardDetailItem`, `StatusIndicator`, `Button`, `DataTable`
- **Fixes Applied**: Configuration and live status organized into `Panel` and `CardDetail`. Physical test print actions use consequence-aware styling and confirmation.
- **Status**: Migrated & Verified

### 4. Discovered Printers (`/discovered-printers`)
- **Components Used**: `PageLayout`, `DataTable`, `Badge`, `StatusIndicator`, `Dialog`, `Button`, `ResourceToolbar`
- **Fixes Applied**: Uses shared `DataTable` and `Dialog` for printer registration confirmation. Stacks runner panels on mobile viewports.
- **Status**: Migrated & Verified

### 5. Local Diagnostics (`/diagnostics`)
- **Components Used**: `PageLayout`, `Panel`, `SectionHeading`, `CodeBlock`, `StatusIndicator`, `Button`, `Inline`
- **Fixes Applied**: Converted legacy runner panels to shared `Panel` components. Mono typography for technical identifiers and health payloads.
- **Status**: Migrated & Verified

### 6. Templates (`/templates`)
- **Architecture**: Split into feature module `features/templates/` (`TemplateWorkspace.tsx`, `TemplateLibrary.tsx`, `TemplateEditor.tsx`, `TemplatePreview.tsx`, `TemplateRowMenu.tsx`, `useTemplateWorkspace.ts`). `pages/Templates.tsx` re-exports the workspace facade.
- **Components Used**: `PageLayout`, `Card`, `Panel`, `FormField`, `Input`, `Select`, `Textarea`, `Button`, `Dialog`, `Toolbar`, `Inline`, `Grid`
- **Fixes Applied**: Removed generic `tpl-*` classes. Form controls use `Grid` / `Toolbar`. Full-page preview dialog uses native `<Dialog>`. Scrollable code editor stays bounded.
- **Status**: Migrated & Verified

### 7. Template Sandbox (`/template-sandbox`)
- **Components Used**: `PageLayout`, `Panel`, `SectionHeading`, `FormField`, `Input`, `Select`, `Textarea`, `Button`, `Dialog`, `Checkbox`, `Alert`, `CardDetail`, `CodeBlock`
- **Fixes Applied**: Removed all inline style objects (`sectionStyle`, `cardStyle`). Removed all hardcoded English strings ('Confirm physical test print', 'Expert payload', etc.) into `i18n/translations.ts` (both EN and TH). Preserved 5-point physical print safety confirmation gate.
- **Status**: Migrated & Verified

### 8. Paper Profiles (`/paper-profiles`)
- **Architecture**: Facade to `features/paper-profiles/` feature module (`PaperProfileWorkspace.tsx`).
- **Components Used**: `PageLayout`, `Toolbar`, `FormField`, `DataTable`, `Dialog`, `Drawer`, `Alert`, `Button`, `Panel`
- **Fixes Applied**: Scoped `.pp-*` classes to genuine paper geometry, rulers, grid rendering, and canvas selection. Generic UI delegates to shared component vocabulary.
- **Status**: Migrated & Verified

### 9. Webhooks (`/webhooks`)
- **Architecture**: Split 1517-line monolith into `features/webhooks/` (`WebhookWorkspace.tsx`, `WebhookTable.tsx`, `WebhookEditor.tsx`, `WebhookDetailDialog.tsx`). `pages/Webhooks.tsx` re-exports the workspace facade.
- **Components Used**: `PageLayout`, `Panel`, `DataTable`, `FormField`, `Input`, `Select`, `Textarea`, `Button`, `Dialog`, `Badge`, `Alert`, `ResourceToolbar`
- **Fixes Applied**: Removed legacy `wh-*` styles. Replaced hardcoded labels ('Callback URL', 'Callback Target URL') with translation keys (`page.webhooks.callbackUrlLabel`, `page.webhooks.callbackTargetUrl`). Sticky batch selection bar.
- **Status**: Migrated & Verified

### 10. Route Policies (`/route-policies`)
- **Components Used**: `PageLayout`, `DataTable`, `Panel`, `FormField`, `Input`, `Button`, `Dialog`, `Badge`
- **Fixes Applied**: Standard configuration page anatomy. Mono formatting for policy codes and rule evaluation criteria.
- **Status**: Migrated & Verified

### 11. Printer Bindings (`/printer-bindings`)
- **Components Used**: `PageLayout`, `DataTable`, `Panel`, `FormField`, `Select`, `Button`, `Dialog`, `Badge`
- **Fixes Applied**: Shared toolbar and filter bar patterns. Mobile cards for binding definitions.
- **Status**: Migrated & Verified

### 12. Print Flow Bindings (`/print-flow`)
- **Components Used**: `PageLayout`, `Panel`, `FormField`, `Select`, `Button`, `DataTable`, `Badge`, `Alert`, `Inline`
- **Fixes Applied**: Sysadmin (OWNER) role protection. Configuration and live intake log presented via shared `Panel` and `DataTable`.
- **Status**: Migrated & Verified

### 13. Job Queue (`/jobs`)
- **Components Used**: `PageLayout`, `DataTable`, `JobQueueControls`, `Freshness`, `StatusBadge`, `Checkbox`, `Dialog`, `ReprintDialog`, `Alert`, `LoadingState`, `ErrorState`
- **Fixes Applied**: Sticky batch selection bar showing selected count. Accessible single-DOM responsive table/card transformation. Consequence-aware reprint confirmation.
- **Status**: Migrated & Verified

### 14. Job Detail (`/jobs/:id`)
- **Components Used**: `PageLayout`, `Panel`, `JobVerdictBand`, `CardDetail`, `CardDetailItem`, `DataTable`, `ReprintDialog`, `Freshness`, `Mono`, `Badge`, `Text`
- **Fixes Applied**: Honest outcome representation (`UNVERIFIED` distinct from failure). Trace timeline rendered with monospace evidence tokens and step duration indicators.
- **Status**: Migrated & Verified

### 15. Runners (`/runners`)
- **Components Used**: `PageLayout`, `Panel`, `DataTable`, `RunnerStatusBadge`, `Freshness`, `Mono`, `Text`, `Badge`
- **Fixes Applied**: Consistent runner health status indicators. Technical values formatted with `Mono`.
- **Status**: Migrated & Verified

### 16. Audit Logs (`/audit-logs`)
- **Components Used**: `PageLayout`, `DataTable`, `ResourceToolbar`, `Freshness`, `Mono`, `CodeBlock`, `SelectFilter`
- **Fixes Applied**: Monospace formatting for event payloads, trace IDs, and timestamps. Responsive record cards at 768px/390px.
- **Status**: Migrated & Verified

### 17. Export Center (`/export`)
- **Components Used**: `PageLayout`, `Panel`, `SectionHeading`, `Button`, `Alert`, `Text`, `CodeBlock`
- **Fixes Applied**: Separates routine status checks from sensitive database backup actions with consequence warnings. Persistent feedback region for export operations.
- **Status**: Migrated & Verified

### 18. Users & Roles (`/users`)
- **Components Used**: `PageLayout`, `DataTable`, `Panel`, `FormField`, `Input`, `Select`, `Checkbox`, `Button`, `Dialog`, `Badge`
- **Fixes Applied**: Scannable role hierarchy (OWNER/ADMIN/OPERATOR/VIEWER). Keyboard-accessible page permission checkboxes. Responsive table layout.
- **Status**: Migrated & Verified

### 19. Settings (`/settings`)
- **Components Used**: `PageLayout`, `Panel`, `FormField`, `Input`, `Select`, `Button`, `ServiceAccountSettings`, `Alert`, `Text`, `CodeBlock`
- **Fixes Applied**: Removed all legacy `.settings-*` CSS rules. Migrated sections to `Panel` and `FormField`. Extracted hardcoded NATS status copy into i18n keys for EN and TH.
- **Status**: Migrated & Verified

### 20. Auth & Shell (Login, Owner Setup, Splash, Error Boundary)
- **Components Used**: `AppShell`, `AppNav`, `SplashScreen`, `LoginView`, `OwnerSetupView`, `RouteErrorBoundary`, `FormField`, `Input`, `Button`, `ActionIcon`, `Stack`
- **Fixes Applied**: Removed inline styles from password toggle, button margins, and form grids. Accessible focus management on view load. Equal string length resilience for English and Thai.
- **Status**: Migrated & Verified

---

## 3. Verification & Compliance Summary

1. **TypeScript Typecheck**: `npm run typecheck` — Passed with 0 errors.
2. **Unit & Layout Contract Tests**: `npm test` — 588 passed across 49 test files.
3. **Workspace Build**: `npm run build` — Passed (domain, shared, adapters, api, runner-go).
4. **Web App Build**: `npm run build -w @printerops/web` — Production bundle generated successfully with 0 errors.
5. **i18n Audit**: Every user-visible string across all 19 pages and system dialogs is backed by `i18n/translations.ts` dictionary keys in both English (`en`) and Thai (`th`).
