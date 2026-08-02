# M2 resource toolbar

This slice starts the list/query component layer without generalizing the safety-critical Job Queue table or reprint flows.

## Components

- `SearchField` — labelled search input composed from `FormField` and `Input`
- `SelectFilter` — labelled select filter composed from `FormField` and `Select`
- `ResourceToolbar` — responsive grouping for resource controls and optional actions
- `JobQueueControls` — a domain adapter that maps job statuses and counts into the shared components

## Ownership

The shared components own field wiring, responsive layout, and colocated styles. Pages retain query state, domain option mapping, translations, and reset behavior.

## Deliberately deferred

- Pagination requires keyboard and page-boundary interaction tests.
- Selection summary requires sticky positioning, live count semantics, and consequential-action review.
- Responsive data view must not hide or duplicate print actions in the accessibility tree.
- Reprint dialogs remain page-owned until the consequential-action component phase.

Legacy `.job-queue-controls*` selectors remain temporarily as dead compatibility CSS and should be removed only in a dedicated stylesheet cleanup after this slice is validated.
