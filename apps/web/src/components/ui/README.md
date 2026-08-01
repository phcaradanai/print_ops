# PrintOps shared UI

This folder is the single component vocabulary for application surfaces. Pages compose these pieces; they do not recreate controls, spacing, panels, tables, tabs, or overlays with page-local markup and colors.

Import public components from `components/ui/index.ts`. Keep feature-specific behavior in the feature and visual rules in the shared component that owns them.

## Composition levels

### Primitives

- Actions: `Button`, `IconButton`, `ActionIcon`, `TransferIcon`
- Form controls: `Label`, `Input`, `Select`, `Textarea`, `Checkbox`
- Layout: `Stack`, `Inline`, `Grid`, `Spacer`, `Divider`
- State: `Badge`, `StatusBadge`

Primitives own size, focus, disabled, invalid, and coarse-pointer behavior. Avoid raw form controls unless the browser-native behavior is the feature itself.

### Molecules

- `FormField` connects a label, hint, error, and control ARIA attributes.
- An `Input` with `leading` or `trailing` content forms an input group.
- `Toolbar` groups related search, filter, refresh, and bulk controls.
- `TabList`, `Tab`, and `TabPanel` provide the tab roles and selection state.
- `FactList` and `Fact` provide compact label/value evidence.

### Composites

- Structure: `PageLayout`, `PageSection`, `Panel`, `Card`, `Fieldset`
- Data: `DataTable`, `RecordList`, `RecordCard`
- Overlays: `Dialog`, `Drawer`
- Feedback: `Alert` and the shared page loading, empty, and error states

Use `DataTable responsive` when the same record can become a labelled card on narrow screens. It keeps one DOM tree, so controls and focus state are never duplicated between desktop and mobile.

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
