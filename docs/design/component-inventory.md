# Component inventory

The authoritative list of shared components, grouped as atoms / molecules / composites with usage rules, is `apps/web/src/components/ui/README.md`. Everything public is re-exported from `apps/web/src/components/ui/index.ts` (93 exports). Pages import from there. This page adds what the README does not: **which stylesheet owns each family**, and where ownership is still split.

## Ownership map

| Family | Components | Owning stylesheet | Split ownership (debt) |
|---|---|---|---|
| Page frame | `PageScaffold`, `PageHeader`, `PageSection`, `PageFooter`, `SectionHeading`, `PageLayout` facade | `components/organisms/PageScaffold/PageScaffold.css`, `components/molecules/*/*.css` | `.ops-page`, `.ops-page__header` also in `experienceSystem.css`, `layoutSystem.css`, `styles.css` |
| App shell | nav rail, topbar, session card, mobile drawer | `styles.css` | `.app-main`, `.app-header*`, `.session-*`, `.nav-toggle` re-declared in `experienceSystem.css` |
| Actions | `Button`, `IconButton`, `ActionIcon`, `RowActionMenu` | `components/ui/ui.css`, `RowActionMenu.css` | `.ui-icon-button*` re-declared in `experienceSystem.css` |
| Inputs | `Input`, `Select`, `Textarea`, `Checkbox`, `Switch`, `FormField`, `SearchField`, `SelectFilter` | `components/ui/inputs.css`, molecule CSS | `.ui-input-group` in `experienceSystem.css` |
| Data display | `DataTable`, `DataGrid`, `CardDetail`, `Badge`, `MetricTile/Grid`, `Pagination`, `ResourceToolbar` | `components/ui/ui.css`, `CardDetail.css`, organism CSS | `.ui-data-table*`, `.ui-badge` in `experienceSystem.css` |
| Status | `StatusBadge` (jobs) | `components/StatusBadge.css` — **sole owner since 2026-11-12** | none |
| Status | `StatusIndicator`, `StatusDot` (devices) | `components/ui/ui.css` | — |
| Feedback | `Alert`, `LoadingState`, `EmptyState`, `ErrorState`, `ErrorBanner`, `Freshness`, `RouteErrorBoundary` | `styles.css` (`.state-panel*`, `.error-fallback`) | — |
| Overlays | `Dialog`, `Drawer`, `ReprintDialog` | `styles.css`, `components/dialogClose.css` | — |
| Evidence Canvas | `EditorCanvas` / workspace | `components/ui/workspace.css` | — |
| Feature-owned | Paper profiles, Templates, Webhooks workspaces | `paperProfiles*.css`, `templates*.css`, `features/webhooks/*.css` | Paper profiles: 4 hotfix layers over `paperProfilesLibrary/Editor.css` |

Run the ownership scan in `apps/web/src/__tests__/designTokens.test.ts` (it prints the full list on failure) to get the current split set.

## Rules for new UI

1. Search `components/ui/index.ts` first. A near-match gets a variant or prop, not a sibling component.
2. A new shared component needs typed props, its own stylesheet (the only place its base rule lives), a semantic test, and a line in the README.
3. Feature-specific styling stays under the feature's root class; it does not restyle a shared component globally.
