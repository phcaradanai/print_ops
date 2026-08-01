# Frontend design primitives

The dashboard uses `apps/web/src/styles.css` as its design-token source and
`apps/web/src/components/` for accessible React primitives.

Use `Button` for new React-owned actions. Use `ds-btn` only where a page must
keep a native button or link shape. Existing page-local action classes
(`tpl-btn`, `wh-action-btn`, and Settings action buttons) share the same
action-control core; new classes should not duplicate it.

Use semantic component tokens rather than literal feedback colours:

- `--state-danger-surface` / `--state-danger-text` for destructive feedback.
- `--state-success-surface` / `--state-success-text` for completion feedback.
- `--state-info-surface` / `--state-info-text` for informational feedback.
- `--control-height-compact` and `--control-height-standard` for controls.
- `--shadow-subtle` and `--shadow-floating` for the approved elevation levels.

`Alert`, `FormField`, and `Dialog` supply the corresponding accessible
semantics. Prefer extending their variants over creating page-local alert,
field, or modal patterns.
