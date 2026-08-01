---
target: apps/web/src/App.tsx
total_score: 38
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
timestamp: 2026-07-31T18-11-48Z
slug: apps-web-src-app-tsx
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Excellent. Splash screen tracks boot state (`splash.progress`, `splash.ready`), errors are prominently surfaced |
| 2 | Match System / Real World | 4 | High match. "Lab Notebook" mirrors clinical environment. Terms use direct operational language |
| 3 | User Control and Freedom | 4 | `RouteErrorBoundary` provides explicit "Try Recovering" and "Restart App" actions |
| 4 | Consistency and Standards | 4 | Exceptional discipline. Single sans-serif system font, flat-by-default elevation, single accent color (`#1e66f5`) |
| 5 | Error Prevention | 4 | Prevents false positives (`UNVERIFIED` state instead of fake success). Role-gated actions |
| 6 | Recognition Rather Than Recall | 4 | Status indicators pair color with text/shape. Collapsible admin menu avoids visual clutter |
| 7 | Flexibility and Efficiency | 3 | Solid grouped navigation keeping core tasks accessible; power users could benefit from more keyboard shortcuts |
| 8 | Aesthetic and Minimalist Design | 4 | "Lab Notebook" strictly avoids SaaS tropes (gradients, dark mode defaults, entrance animations) |
| 9 | Error Recovery | 4 | Excellent handling of 401s and API timeouts. Polling splash screen retries up to 120 times |
| 10 | Help and Documentation | 3 | Good contextual hints, though complex features like Route Policies could use inline docs |
| **Total** | | **38/40** | **Excellent** |

#### Design Specificity Verdict

**Highly Specific & Context-Aware (Not Interchangeable).** The design is explicitly grounded in its hospital context. It deliberately rejects standard "modern SaaS" tropes (gradients, dark mode defaults, entrance animations, display fonts) in favor of a flat, light-first "Lab Notebook" aesthetic. Crucially, it designs around environmental constraints: fluorescent hospital lighting (using low-contrast neutral grays) and bilingual EN/TH requirements (using fast-rendering system fonts to prevent layout shifts and Thai glyph truncation).

**Deterministic scan**: Run against `apps/web/src` via `detect.mjs`. **1 advisory finding**:
- `styles.css` (L5376): `codex-grid-background` (decorative tiled hairline line-field background antipattern).

**Visual overlays**: No browser overlay active. Live static detection completed.

#### Overall Impression

PrintOps demonstrates exceptional design discipline tailored to clinical environments. The collapsible admin navigation resolved earlier cognitive overload concerns, reducing immediate choices to $\le 6$ core operational tasks. The remaining items are minor documentation token alignment and removing a decorative background grid antipattern.

#### What's Working

1. **Flat-By-Default Discipline**: Reserving shadows strictly for floating surfaces (login panel, popovers) keeps data surfaces clean under hospital lighting.
2. **Robust Initialization & Recovery**: Boot sequence gracefully handles backend initialization with up to 120 retry polls and explicit recovery options.
3. **Accessibility & Bilingual Care**: Color is paired with text/shapes for status badges, and Thai typography rules are honored.

#### Priority Issues

- **[P2] Decorative Grid-Line Background Antipattern**
  - **Why it matters**: `detect.mjs` flagged a tiled hairline grid background in `styles.css` (L5376). Decorative grid overlays violate the clean, functional "Lab Notebook" design principles.
  - **Fix**: Remove the decorative linear-gradient line-field background from `styles.css`.
  - **Suggested command**: `/impeccable quiet` or `/impeccable distill`

- **[P2] Contradictory Label Typography Tokens**
  - **Why it matters**: `DESIGN.md` specifies uppercase and tracking for label tokens, but `styles.css` correctly disables these rules to preserve Thai glyph cluster legibility.
  - **Fix**: Synchronize `DESIGN.md` label guidelines to reflect the bilingual Thai typography rules established in CSS.
  - **Suggested command**: `/impeccable document`

- **[P3] Admin Navigation Chevron Accessibility**
  - **Why it matters**: The chevron icon on the Admin section toggle visualizes state via CSS rotation; screen readers need explicit state confirmation.
  - **Fix**: Verify `aria-expanded` attributes announce toggle state changes cleanly.
  - **Suggested command**: `/impeccable audit`

#### Persona Red Flags

- **Alex (Power User)**: Keyboard shortcut navigation could further accelerate rapid triage during printer outages.
- **Jordan (First-Timer)**: Inline explanations on empty states for "Printer Bindings" and "Print Flow Bindings" would help guide first-time setup.
- **Sam (Accessibility)**: Disabling forced uppercase/tracking preserves Thai text legibility for screen readers and magnification.
- **Riley (Stress Tester)**: Resilient boot sequence (120 retries) handles delayed backend spin-ups cleanly.

#### Minor Observations

- The splash screen's progress display provides excellent transparency during app launch.
- `App.tsx` handles pre-filled dev credentials gracefully.

#### Questions to Consider

- Should inline documentation cards be added to empty states in Admin sub-pages?
- Should product naming ("PrintOps" vs "PrinterOps") be bound to an i18n key or config variable?
