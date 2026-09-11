# M2 Pagination Boundary

## Purpose

Provide one accessible previous/next navigation component for paged resource views without moving query or domain state into shared UI.

## Component ownership

`Pagination` owns:

- the labelled `nav` landmark
- native previous/next buttons with explicit `type="button"`
- disabled states at the first and last page
- responsive layout and 44px mobile touch targets
- a polite, atomic announcement of the localized page status

The consuming page owns:

- the current page and total-page calculation
- page clamping when data changes
- localized labels and status copy
- loading, filtering, selection, and API behavior

## Job Queue migration

The existing Job Queue pagination remains unchanged in this slice. Migration should replace only the current `job-queue-pagination` markup after this primitive is merged, preserving:

- `view.filteredCount > 0` visibility
- `view.page` and `view.totalPages`
- the existing page reset and auto-refresh clamping effects
- previous and next callbacks that update local page state

Selection and reprint behavior are outside this boundary.
