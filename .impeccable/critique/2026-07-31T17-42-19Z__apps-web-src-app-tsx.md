---
target: apps/web/src/App.tsx
total_score: 34
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
timestamp: 2026-07-31T17-42-19Z
slug: apps-web-src-app-tsx
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Freshness indicators, 1.5s auto-polling, and clear loading splash states |
| 2 | Match System / Real World | 3 | "Runners" exposes internal Go service terminology instead of hospital domain terms |
| 3 | User Control and Freedom | 3 | Clean dialog dismissals and collapsible admin panel, though bulk job control is absent |
| 4 | Consistency and Standards | 2 | `statusColors.ts` uses 11 status colors & navy text (to pass WCAG), diverging from `DESIGN.md` (6 colors, white text) |
| 5 | Error Prevention | 4 | High-stakes reprint dialog demands explicit acknowledgment of duplicate risk and required reason |
| 6 | Recognition Rather Than Recall | 4 | `payloadSnapshot` hints in Job Queue provide document context without drill-down |
| 7 | Flexibility and Efficiency | 3 | Standard table pagination and keyboard accessibility, missing power-user bulk actions |
| 8 | Aesthetic and Minimalist Design | 4 | "Lab Notebook" theme is highly disciplined; flat-by-default visual hierarchy |
| 9 | Error Recovery | 4 | Idempotent token handling for 401s; graceful manual retry fallback for failed API polling |
| 10 | Help and Documentation | 3 | Dialogs provide contextual help (e.g. explaining missing runner ACKs) |
| **Total** | | **34/40** | **Good** |

#### Design Specificity Verdict

**Strongly Specific.** The visual language and interaction model are tailored directly to hospital print operations ("Lab Notebook" theme). The choices—flat-by-default surfaces, system-native fonts (for zero FOUT and instant layout stability under clinical workloads), and muted, high-contrast palettes—fit hospital staff working under fluorescent lights. Furthermore, the Thai typography handling in `styles.css` (explicitly stripping forced capitalization and tracking) treats bilingual hospital operations as a first-class concern.

**Deterministic scan**: Run against `apps/web/src` via `detect.mjs`. **0 static design violations found** (`[]`).

**Visual overlays**: No browser overlay active. Live static detection passed cleanly.

#### Overall Impression

PrintOps presents an exceptionally disciplined, clinical interface designed for high-stress hospital environments. It avoids generic SaaS gradients and hyper-animated fluff in favor of clarity, safety, and rapid scannability. Its primary weaknesses stem from cognitive overload in the admin navigation structure and a drift between `DESIGN.md` specifications and actual WCAG AA visual implementations.

#### What's Working

1. **High-Stakes Safety Friction**: The reprint flow requires an explicit check for duplicate label risk and a mandatory reason before submitting, preventing expensive and dangerous duplicate prints in clinical settings.
2. **Context-Aware WCAG Compliance**: `statusColors.ts` prioritizes legibility by using Deep Navy text on status pills, ensuring contrast passes WCAG AA.
3. **Bilingual Typography Care**: CSS specifically handles Thai text rendering rules, preventing awkward line wraps or broken script glyphs.

#### Priority Issues

- **[P1] Admin Navigation Cognitive Overload**
  - **Why it matters**: The "Settings & Admin" navigation block in `App.tsx` contains 11 flat, unchunked items, violating working memory constraints (<=4 items per decision chunk) for system administrators.
  - **Fix**: Group admin navigation into 2-3 logical sub-categories (e.g., *Infrastructure & Routing*, *System Configuration*, *Diagnostics & Logs*).
  - **Suggested command**: `/impeccable layout`

- **[P2] Design System Documentation Drift**
  - **Why it matters**: `DESIGN.md` states a strict 6-color palette with white text, but `statusColors.ts` uses 11 status colors and Deep Navy text to meet WCAG contrast. This discrepancy invites future visual regressions.
  - **Fix**: Update `DESIGN.md` to reflect the 11 status color mappings and document the contrast-motivated navy text directive.
  - **Suggested command**: `/impeccable document`

- **[P3] Internal Architecture Terminology Leak**
  - **Why it matters**: Clinical operators are exposed to technical terms like "Runners" in the primary navigation and dialogs, forcing them to translate Go daemon concepts to physical print gateways.
  - **Fix**: Update user-facing copy from "Runners" to "Print Gateways" or "Connector Gateways".
  - **Suggested command**: `/impeccable clarify`

#### Persona Red Flags

- **Alex (Power User)**: Lack of bulk actions (batch reprint or cancel) in the Job Queue forces Alex to open 10 separate dialogs when a label printer jams.
- **Jordan (First-Timer)**: Overwhelmed by 11 unorganized Admin menu items and confused by backend jargon like "Runners" and "Route Policy".
- **Riley (Stress Tester)**: Rapid 1.5s queue auto-polling in `JobQueue.tsx` could cause table rows to shift dynamically while clicking an action button.

#### Minor Observations

- The product branding in `App.tsx` reads "PrinterOps", whereas `PRODUCT.md` references "PrintOps". Standardize naming across the application.
- System font stack (`system-ui`, `-apple-system`) avoids layout shifts during initial load.

#### Questions to Consider

- Should the product name be officially unified as "PrintOps"?
- Is single-job reprint confirmation an intentional safety constraint, or should bulk reprint with batch justification be enabled for power users?
