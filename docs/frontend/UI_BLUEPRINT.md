# PrintOps unified UI blueprint

This document is the implementation companion to `DESIGN.md` and `PRODUCT.md`.
It does not replace either source of truth. It turns their product and visual
commitments into a repeatable page anatomy, a shared-component contract, and a
static review surface covering every confirmed product page.

## Open the blueprint

Run the web application normally, then open:

```text
/ui-blueprint/
```

The blueprint is deliberately stored under `apps/web/public/` and makes no API
calls. It can therefore be reviewed when the API, NATS, runner, or database is
unavailable. Use the controls in the top bar to review desktop, tablet, mobile,
English, and Thai states.

Do not import blueprint mock data into production routes. The preview is a
visual and interaction contract, not a second application state model.

## What was corrected in the shared application layer

`apps/web/src/experienceSystem.css` is loaded last and establishes the current
cross-route contract while older route styles are incrementally retired.

- Data tables are compact operational reading surfaces again. Header text is not
  forcibly uppercased or letter-spaced, which protects Thai glyph integrity.
- Arbitrary first, second, and final-column widths are removed. Content and
  route-specific constraints determine column width.
- Shared surfaces are flat by default. Shadows are reserved for floating or
  consequential surfaces.
- Primary and dangerous controls use solid action colors instead of gradients.
- Disabled controls remain visibly disabled rather than looking like active
  saturated actions at reduced opacity.
- Status text has a readable 0.75rem minimum and is never communicated by color
  alone.
- Selected queue work remains visible in a sticky action bar without obscuring
  device safe areas.
- Coarse-pointer and narrow layouts have a 44px interaction floor.
- Reduced-motion and forced-colors behavior is applied globally.
- The desktop navigation rail returns to the compact form described in
  `DESIGN.md` while preserving the existing mobile navigation behavior.

New route work must use the shared primitives from `components/ui/` rather than
add another global hotfix stylesheet.

## Canonical page anatomy

Every production route should be built with `PageLayout` and read in this order:

1. **Header** — one page title, a short operational description, freshness, and
   current-page actions.
2. **Immediate truth** — partial-data, stale-data, safety, or consequence notice
   before metrics and controls.
3. **Primary task** — queue, list, editor, proof, routing map, or configuration
   form.
4. **Supporting evidence** — trace, device signals, recent output, health, or
   audit details.
5. **Consequential action** — only after the evidence required to make the
   decision is visible.

On mobile, list and focused maintenance tasks must not compete side by side.
Use an explicit back path rather than compressing both into one miniature view.

## Shared component rules

### Buttons

- Blue: routine primary action.
- White/outlined: secondary action.
- Rose: destructive action or an action that may create physical output.
- Ghost: low-emphasis navigation or dismissal.
- A disabled consequential action must be accompanied by nearby text naming the
  unmet prerequisite.

### Tables and records

- Preserve literal server statuses.
- Keep identifiers in monospace only where exact copying matters.
- Put the human-recognizable document or device description before the internal
  identifier.
- Dense tables may scroll horizontally on intermediate widths.
- Responsive tables become one semantic set of labelled record cards. Never
  mount a parallel desktop table and mobile list containing the same controls.

### Forms

- Labels are sentence case in both locales.
- Required state is explicit and does not depend on color.
- Show the effect of a change before the save action for routing, printer,
  template, paper, and callback configuration.
- A preview is not physical-output evidence.

### Status and safety

- `UNVERIFIED` means “may have printed”, not failure.
- Callback delivery state is separate from physical print outcome.
- Test print and reprint confirmation must show the printer, template/document,
  copies, and physical-output warning.
- Do not auto-retry an outcome that may already exist on paper.

## Page inventory and primary task

| Page | Primary task | Required evidence or safeguard |
| --- | --- | --- |
| Dashboard | Identify what needs attention now | Partial/stale data must not become healthy zeroes |
| Printers | Find and open a registered printer | Reachability, protocol, runner, and last job |
| Printer Detail | Decide whether the device is usable | Device signals separate from physical paper proof |
| Discovered Printers | Register an observed device | Human-readable code and physical location review |
| Local Diagnostics | Isolate a failing dependency | Endpoint, latency, last success, and raw evidence |
| Templates | Maintain printable content definitions | Draft/published state and version |
| Template Sandbox | Produce a proof, then deliberately test | Ready printer and explicit physical-output acknowledgement |
| Paper Profiles | Maintain paper geometry and printable fields | Real dimensions, DPI, field bounds, and preview |
| Webhooks | Maintain callback destinations | Delivery state must not imply print outcome |
| Route Policies | Order destination-selection rules | First-match behavior and fallback visibility |
| Printer Bindings | Bind logical destination to physical device | Printer and paper compatibility |
| Print Flow Bindings | Validate end-to-end routing | Versioning, warnings, and owner-only consequence |
| Job Queue | Triage live jobs | Literal status, readable document identity, safe bulk action |
| Job Detail | Answer “what happened?” | Verdict band, trace, IDs, printer, runner, callback |
| Runners | Assess local execution capacity | Heartbeat, version, host, discovery, assigned devices |
| Audit Logs | Reconstruct actions | Actor, exact time, target, result |
| Export Center | Produce controlled operational exports | Sensitivity warning, scope, expiry, and creator |
| Users & Roles | Manage human access | Role plus explicit allowed-page scope |
| Settings | Maintain site-level configuration | Health, connection test, and safety defaults |

## Review checklist

Review each changed page in all four conditions where they apply:

- normal data
- loading or refreshing
- empty data
- partial or failed data

Then review in English and Thai at desktop, tablet, and mobile widths. Confirm:

- no horizontal page overflow
- no clipped actions or status labels
- visible keyboard focus
- 44px targets on touch layouts
- status is understandable without color
- consequential actions name their prerequisites
- no route introduces a new visual token instead of using `DESIGN.md`

## Retirement plan for older CSS

`experienceSystem.css` is a stabilizing layer, not permission to keep stacking
styles forever. When a route is next modified:

1. replace route-specific primitive copies with `components/ui/` primitives;
2. move the route's durable layout into a route-scoped stylesheet;
3. remove declarations made redundant by `experienceSystem.css`;
4. delete obsolete Paper Profiles hotfix rules only after visual regression and
   interaction coverage prove the replacement.

The target is one token layer, one shared component layer, and small route-scoped
layout files—not another chain of global overrides.
