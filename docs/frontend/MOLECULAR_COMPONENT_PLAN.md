# Molecular Component Migration Plan

## Goal

Refactor the PrintOps web UI into small, composable, page-agnostic components that can be assembled consistently across all routes without encoding one page's business rules into shared UI.

The target composition model is:

```text
design tokens
  -> atoms
    -> molecules
      -> organisms
        -> page compositions
```

This is an incremental migration. Existing page APIs and production behavior stay stable while shared structure moves behind compatibility facades.

## Why this is needed

The current UI already has useful shared components, but several files group many unrelated responsibilities together:

- `components/ui/data-display.tsx`
- `components/ui/layout.tsx`
- `components/ui/surfaces.tsx`
- `components/ui/typography.tsx`
- `components/ui/ui.css`
- route-specific and hotfix CSS loaded globally

This makes ownership unclear and creates broad CSS blast radius. A change intended for one presentation can affect every table, header, card, or mobile layout.

The migration must reduce that risk without producing a second disconnected component library.

## Component boundaries

### Tokens

Source of truth remains `DESIGN.md` and the CSS custom properties already exposed by the web app.

Rules:

- components consume semantic tokens, never invent local brand colors;
- physical-output consequence remains rose/danger;
- `UNVERIFIED` remains warning/caution, never failure;
- component CSS may define layout values but not duplicate the product palette;
- Thai text is never globally uppercased or letter-spaced.

### Atoms

Atoms are the smallest interactive or typographic units. They do not know page context.

Initial atom inventory:

- `Button`
- `IconButton`
- `Input`
- `Select`
- `Textarea`
- `Checkbox`
- `Chip`
- `Text`
- `Heading`
- `Mono`
- `Divider`
- `StatusBadge`
- `StatusDot`
- `Label`

Migration rule: keep current public imports working while each atom moves to a colocated directory.

```text
components/atoms/Button/
  Button.tsx
  Button.css
  Button.test.tsx
  index.ts
```

### Molecules

Molecules combine a small number of atoms into a reusable interaction or information pattern. They must not fetch data or contain route-specific decisions.

Priority molecules:

1. `PageHeader`
2. `SectionHeading`
3. `SearchField`
4. `FilterGroup`
5. `ResourceToolbar`
6. `KeyValueList`
7. `StatusSummary`
8. `MetricCard`
9. `Pagination`
10. `ActionBar`
11. `SelectionSummary`
12. `InlineFeedback`

A molecule may own local responsive behavior, labels, focus management, and layout. It may not know what a job, printer, template, patient, or webhook means.

### Organisms

Organisms combine molecules into a complete reusable region. They receive data and callbacks through props but do not own API requests.

Priority organisms:

1. `PageScaffold`
2. `ResourceListSection`
3. `ResourceTableSection`
4. `MasterDetailWorkspace`
5. `FormWorkspace`
6. `EvidencePanel`
7. `TraceTimeline`
8. `ConfirmationFlow`
9. `EmptyResourcePanel`
10. `ResponsiveDataView`

Organisms may express generic concepts such as loading, stale data, selection, detail, evidence, confirmation, and pagination. They may not contain route-specific API paths or business-status transitions.

### Page compositions

Pages own:

- API hooks and mutations;
- domain-specific view models;
- permission decisions;
- route navigation;
- product wording through i18n;
- which molecules and organisms are composed;
- consequential-action eligibility.

A page should become mostly orchestration and data mapping rather than local layout markup.

## File rules

Every new component uses a colocated folder:

```text
ComponentName/
  ComponentName.tsx
  ComponentName.css
  ComponentName.test.tsx
  index.ts
```

Additional rules:

- one primary component per `.tsx` file;
- helper components may remain private only when they cannot be reused independently;
- no component file should exceed 300 lines without a documented reason;
- no CSS file should contain selectors for another component;
- page CSS may style composition only, never reach into a shared component's internals;
- shared components expose variants through props or data attributes instead of page selectors;
- public imports use barrel files, but implementation files never import back through the same barrel;
- tests render the component in isolation and cover keyboard, disabled, loading, empty, Thai-width, and consequential states where relevant.

## Compatibility strategy

Do not rename all imports in one change.

1. Build the new component in its final folder.
2. Preserve the existing public export from `components/ui/index.ts`.
3. Convert the old file into a compatibility facade or remove only the extracted implementation.
4. Migrate pages by cluster.
5. Delete the compatibility export only after repository-wide usage is gone.
6. Remove old global CSS only after the owning component imports its colocated stylesheet.

This avoids a high-risk repository-wide rewrite and keeps changes reviewable.

## Delivery phases

### M0 — Boundaries and guardrails

Deliverables:

- this migration plan;
- folder and naming conventions;
- compatibility policy;
- page migration matrix;
- dependency direction documented and enforced in review.

Acceptance:

- no new page-specific selectors are added to shared CSS;
- no shared component imports a page or API module.

### M1 — Canonical page anatomy

Extract and compose:

- `PageHeader` molecule;
- `SectionHeading` molecule;
- `PageScaffold` organism;
- `PageLayout` compatibility facade.

Why first: every route uses the same header/body/detail/footer anatomy, so this produces immediate consistency without touching domain behavior.

Acceptance:

- existing `PageLayout` props still work;
- custom headers remain supported;
- mobile action wrapping and Thai copy remain intact;
- page width and density variants remain stable.

### M2 — Query and list controls

Extract:

- `SearchField`;
- `FilterGroup`;
- `ResourceToolbar`;
- `Pagination`;
- `SelectionSummary`;
- `ResponsiveDataView`.

First consumers:

- Job Queue;
- Printers;
- Templates;
- Paper Profiles;
- Audit Logs;
- Users & Roles.

Acceptance:

- keyboard navigation is complete;
- selected count is always visible;
- responsive tables do not duplicate controls in the accessibility tree;
- filters survive refresh and pagination transitions.

### M3 — Detail and evidence patterns

Extract:

- `KeyValueList`;
- `StatusSummary`;
- `EvidencePanel`;
- `TraceTimeline`;
- `ActionBar`.

First consumers:

- Job Detail;
- Printer Detail;
- Runner detail regions;
- Local Diagnostics;
- Webhook delivery evidence.

Acceptance:

- exact identifiers use the monospace evidence layer;
- state is never communicated by color alone;
- primary evidence appears before secondary metadata;
- terminal and `UNVERIFIED` outcomes remain literal.

### M4 — Form workspaces

Extract:

- `FormWorkspace`;
- `FormSection`;
- `FieldGrid`;
- `StickyFormActions`;
- `ValidationSummary`.

First consumers:

- Templates;
- Paper Profiles;
- Route Policies;
- Printer Bindings;
- Print Flow Bindings;
- Webhooks;
- Settings;
- Users & Roles.

Acceptance:

- forms reduce columns progressively;
- field errors are connected with `aria-describedby`;
- save state and unsaved changes are explicit;
- mobile displays one focused task at a time.

### M5 — Consequential and physical-output flows

Extract:

- `ConfirmationFlow`;
- `ConsequenceSummary`;
- `AcknowledgementField`;
- `ResultReceipt`.

First consumers:

- Template Sandbox test print;
- Job Queue reprint;
- Job Detail reprint/cancel;
- printer registration or destructive removal;
- restore/backup actions.

Acceptance:

- consequence, destination, copies, and evidence appear before confirmation;
- dangerous buttons are not used for ordinary emphasis;
- disabled controls explain the missing prerequisite;
- successful submission retains a durable Job ID or result link.

### M6 — Remove legacy style layers

Work:

- retire selectors moved into component CSS;
- remove redundant route styles and Paper Profiles hotfix sheets;
- split remaining bundled component files;
- add a guard against component CSS cross-targeting.

Acceptance:

- `experienceSystem.css` contains tokens/global policy only, not component patches;
- each shared component is visually owned by its colocated CSS;
- no unused compatibility facade remains.

## Page migration order

### Cluster A — Operational monitoring

1. Dashboard
2. Job Queue
3. Job Detail
4. Printers
5. Printer Detail
6. Runners
7. Local Diagnostics

Shared focus: freshness, state, responsive data views, evidence, actions.

### Cluster B — Printable content

8. Templates
9. Template Sandbox
10. Paper Profiles

Shared focus: master/detail, editing, preview, physical-output confirmation.

### Cluster C — Routing and integration

11. Discovered Printers
12. Webhooks
13. Route Policies
14. Printer Bindings
15. Print Flow Bindings

Shared focus: discovery, mappings, conditions, health, callback evidence.

### Cluster D — Governance

16. Audit Logs
17. Export Center
18. Users & Roles
19. Settings

Shared focus: filtering, permissions, sensitive actions, exports, configuration.

## Per-page migration loop

Each page is migrated in a bounded pull request or commit sequence:

1. identify the page's primary operator task;
2. list duplicated layout and interaction patterns;
3. select or build the smallest reusable molecule;
4. build an organism only when at least two pages share the region;
5. add isolated component tests;
6. migrate one page without changing API behavior;
7. verify English, Thai, desktop, tablet, mobile, keyboard, reduced motion;
8. remove only the legacy CSS proven unused by that page;
9. record the next page that can reuse the component.

## Definition of done for a component

A shared component is complete only when:

- its name describes a UI responsibility, not a page;
- it accepts content and behavior through typed props;
- it has its own `.tsx`, `.css`, test, and export file;
- it does not import API, routing, session, page, or domain-specific modules unless explicitly classified as an organism adapter;
- focus, disabled, loading, empty, error, and narrow-width behavior are defined;
- Thai copy can wrap without overlap or truncation;
- destructive or physical-output states are semantically explicit;
- at least one production page uses it;
- old selectors or implementations are removed or marked as compatibility-only.

## First implementation slice

The first slice is M1:

- create `components/molecules/PageHeader/`;
- create `components/molecules/SectionHeading/`;
- create `components/organisms/PageScaffold/`;
- refactor `PageLayout` to compose those components while preserving its current API;
- keep current page imports unchanged;
- add isolated server-render tests for component structure and optional regions.

This gives all pages a stable compositional root before list, detail, form, and consequential workflows are migrated.