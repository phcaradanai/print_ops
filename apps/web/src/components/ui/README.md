# PrintOps shared UI

This folder is the single component vocabulary for application surfaces. Pages compose these pieces; they do not recreate controls, spacing, panels, tables, tabs, or overlays with page-local markup and colors.

Import public components from `components/ui/index.ts`. Keep feature-specific behavior in the feature and visual rules in the shared component that owns them.

## Composition levels

### Atoms

- Actions: `Button`, `IconButton`, `ActionIcon`, `TransferIcon`
- Form controls: `Label`, `Input`, `Select`, `Textarea`, `Checkbox`, `Chip`
- Layout: `Stack`, `Inline`, `Grid`, `Spacer`, `Divider`
- Text: `Text`, `Mono`, `Heading`
- State: `Badge`, `StatusBadge`, `StatusDot`

Atoms own size, focus, disabled, invalid, and coarse-pointer behavior. Avoid raw form controls unless the browser-native behavior is the feature itself.

`Text` replaces the inline-style habit — `tone`, `size`, `weight`, `mono`, `truncate`, `nowrap` cover what pages used to spell as `style={{ color: 'var(--neutral-text-muted)' }}`. Its `caps` prop is opt-in and Latin-only: never apply it to localized copy, because Thai glyph clusters must not be transformed.

`Chip` is the pill the system reserves for filtering and toggling; it exposes `aria-pressed`. Pills are never primary buttons.

### Molecules

- `FormField` connects a label, hint, error, and control ARIA attributes.
- An `Input` with `leading` or `trailing` content forms an input group.
- `Toolbar` groups related search, filter, refresh, and bulk controls.
- `TabList`, `Tab`, and `TabPanel` provide the tab roles and selection state.
- `FactList` and `Fact` provide compact label/value evidence.
- `SectionHeading` is a heading plus optional description and actions on one baseline.
- `StatusIndicator` pairs a device-condition dot with the condition as text.
- `MetricTile` / `MetricGrid` render at-a-glance counts; tone comes from the value, not the concept, so a zero UNVERIFIED count never looks like an alarm.
- `CodeBlock` is the multi-line evidence surface — payloads, curl examples, rendered template source.

### Composites

- Structure: `PageLayout`, `PageSection`, `Panel`, `Card`, `Fieldset`
- Data: `DataTable`, `TableEmpty`, `RecordList`, `RecordCard`
- Overlays: `Dialog`, `Drawer`
- Feedback: `Alert` and the shared page loading, empty, and error states

Use `DataTable responsive` when the same record can become a labelled card on narrow screens. It keeps one DOM tree, so controls and focus state are never duplicated between desktop and mobile. Several pages previously mounted a `<table>` **and** a parallel `<ul>` of the same rows, which put every checkbox and every action button in the accessibility tree twice.

`TableEmpty` takes the column count so it stays next to the header row it has to span.

### Device condition vs job status

Two different things, deliberately kept apart:

- `StatusBadge` renders a **print job** status and always shows the server's literal string, from the audited palette in `statusColors.ts`.
- `StatusIndicator` / `StatusDot` render a **device or service** condition (idle / busy / offline / unknown) via the `--device-*` tokens. An unrecognised condition resolves to `unknown` rather than being guessed — a state we cannot interpret must never be painted as healthy.

## Rules

1. Start with a shared component. Add a typed variant when the same need appears in three or more places.
2. Use `Stack`, `Inline`, and `Grid` gaps instead of page-local margin chains. Gap names map to the tokens in `DESIGN.md`.
3. Keep ordinary corners within the 4–8px PrintOps vocabulary. Pills are for status and filters only.
4. Every icon-only action uses `IconButton` with a localized `label`. Emoji are not interface icons.
5. Every overlay has a labelled dialog, Escape behavior, focus containment, a visible close action, and focus restoration.
6. Keep EN/TH copy in translations. Components accept content; they do not hard-code operator-facing language.
7. Preserve explicit operational consequences. Shared composition must never combine proof generation with physical printing or weaken disabled safety states.

## Adding a component

- Confirm the pattern is repeated or is a required accessibility primitive.
- Put its public type and implementation in this folder and export it from `index.ts`.
- Add token-based styles to `ui.css`; do not introduce page-local hex colors.
- Test its semantic contract, not its implementation details.
- Migrate representative call sites in the same change and delete the replaced markup/styles when safe.
