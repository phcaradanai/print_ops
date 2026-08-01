---
target: apps/web/src/App.tsx
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-07-31T17-25-41Z
slug: apps-web-src-app-tsx
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|:---:|-----------|
| 1 | Visibility of System Status | 2/4 | Live status polling is active, but network error alerts fail to clarify whether physical print jobs were dispatched or held. |
| 2 | Match System / Real World | 2/4 | Technical developer jargon (`"malformed response"`, `"FST_JWT_NO_AUTHORIZATION_IN_HEADER"`, `"P95 (MS)"`) leaks into clinical workflows. |
| 3 | User Control and Freedom | 2/4 | Direct page refresh on deep routes (`/printers`, `/jobs`) drops users into backend Fastify JSON 401 screens with no escape hatch. |
| 4 | Consistency and Standards | 1/4 | Dev proxy routing mismatch in `vite.config.ts`; dead code `navContent` in `App.tsx`; brand name inconsistency ("PrinterOps" vs "PrintOps"). |
| 5 | Error Prevention | 2/4 | Idempotency headers exist on backend, but UI form fields and retries do not warn before potentially printing duplicate physical labels. |
| 6 | Recognition Rather Than Recall | 2/4 | Toolbars in Paper Profiles and Templates rely on dense, unlabeled icon-only buttons (`⛶`, `⚡`, `🎨`, `📐`, `⬜`, `📋`). |
| 7 | Flexibility and Efficiency | 3/4 | Navigation cleanly separates daily "Operations" from role-gated "Admin" sections; keyboard nav is functional in forms. |
| 8 | Aesthetic and Minimalist Design | 2/4 | Dashboard displays 9 unclustered metric cards in a 5+4 layout, violating the Working Memory Rule (≤4 items per decision point). |
| 9 | Error Recovery | 1/4 | Raw error strings displayed without actionable clinical recovery steps (e.g. "Verify paper tray before re-submitting job"). |
| 10 | Help and Documentation | 3/4 | Setup and settings provide technical hints, but inline troubleshooting for offline runners or unverified jobs is missing. |
| **Total** | | **20/40** | **Acceptable (Significant improvements needed)** |

#### Design Specificity Verdict

**LLM assessment**: The design system defined in `DESIGN.md` ("The Lab Notebook") establishes a strong, clinical visual foundation with muted Catppuccin color tokens (`#1e1e2e` navy rail, `#f5f5f5` page background, `#1e66f5` action blue) tailored for hospital environments under fluorescent lighting. However, the implementation suffers from noticeable identity drift:
- Brand name mismatch: Sidebar and browser title display **"PrinterOps"** instead of **"PrintOps"**.
- Code duplication: `App.tsx` declares an unused `navContent` structure alongside a separate `d1-nav` override tree.
- Routing leak: Direct page reloads proxy to backend Fastify API endpoints returning raw JSON 401 payloads.

**Deterministic scan**: `detect.mjs` reported 0 static anti-pattern violations (`[]`) across `apps/web/src/App.tsx` and `apps/web/src`. The static regex scanner found no un-isolated glow effects or hardcoded hex styling anti-patterns.

**Visual overlays**: Live overlay helper is active on port 8400 and connected to `http://localhost:3000`.

#### Overall Impression
PrintOps has a well-thought-out clinical palette and robust role-based navigation partitioning. However, severe developer-facing leakage (Vite proxy hijacking SPA routes on refresh, raw API error strings, and dead navigation code in `App.tsx`) compromises the calm, authoritative clinical experience.

#### What's Working
1. **Disciplined Clinical Color Palette**: Muted Catppuccin dark navy (`#1e1e2e`) sidebar with soft gray canvas (`#f5f5f5`) reduces eye fatigue during long hospital shifts.
2. **Operations vs. Admin Partitioning**: Grouping daily tasks under "Operations" (always visible) and secondary controls under collapsible "Admin" keeps daily workflows uncluttered.
3. **Safety-Oriented Unverified Job Handling**: Retaining explicit `UNVERIFIED` job states prevents automated retries of sensitive patient armbands/labels.

#### Priority Issues

- **[P0] Vite Dev Proxy Hijacks SPA Deep Routes on Refresh**
  - **Why it matters**: Direct navigation or page refresh on `/printers`, `/jobs`, or `/runners` bypasses React Router and proxies to Fastify, serving un-styled JSON (`{"statusCode":401...}`) to users.
  - **Fix**: Update `apps/web/vite.config.ts` to scope dev proxies strictly to `/api/*` or verify `Accept: application/json` headers before proxying.
  - **Suggested command**: `/impeccable harden`

- **[P1] Dashboard Stat Grid Overloads Working Memory (9 Unclustered Cards)**
  - **Why it matters**: Scanning 9 metric cards simultaneously (5 in top row, 4 in bottom row) violates Miller/Cowan's Working Memory Rule (≤4 items per decision point), causing visual scanning fatigue.
  - **Fix**: Group metric cards into 3 logical domain clusters: *Device Status* (2), *Queue Status* (3), and *Performance* (2).
  - **Suggested command**: `/impeccable layout`

- **[P1] Dead Navigation JSX & Code Duplication in `App.tsx`**
  - **Why it matters**: `App.tsx` builds a full `navContent` tree that is completely unused in rendering, creating dead code and maintenance risks.
  - **Fix**: Clean up `AppNav` in `App.tsx` to standardize on a single, maintainable navigation template.
  - **Suggested command**: `/impeccable distill`

- **[P2] Raw Technical Error Strings in User Alerts**
  - **Why it matters**: Displaying `"The server returned a malformed response."` confuses hospital operators who need to know if physical labels were printed.
  - **Fix**: Replace technical error strings with clear clinical recovery guidance.
  - **Suggested command**: `/impeccable clarify`

- **[P2] Cryptic Icon-Only Toolbars in Paper Profiles & Templates**
  - **Why it matters**: Dense icon buttons (`⛶`, `⚡`, `🎨`, `📐`) lack visible text or `aria-label` tags, breaking accessibility and forcing user recall.
  - **Fix**: Add tooltips, `aria-label`s, and text labels to toolbar actions.
  - **Suggested command**: `/impeccable adapt`

#### Persona Red Flags

- **Alex (Power User / IT Admin)**: Refreshing `/printers` or `/jobs` drops Alex into a raw Fastify JSON 401 response page (`{"statusCode":401...}`) outside the SPA shell.
- **Jordan (First-Time Clinical Operator)**: Network glitches produce raw technical messages (`"The server returned a malformed response."`) with no guidance on whether patient armbands printed.
- **Sam (Accessibility-Dependent User)**: Screen readers encounter unlabeled unicode icon buttons (`⛶`, `⚡`, `🎨`, `📐`) in `PaperProfiles` and `Templates`.

#### Minor Observations
1. **Brand Name Mismatch**: Sidebar reads "PrinterOps" while documentation (`DESIGN.md`, `PRODUCT.md`) defines "PrintOps".
2. **Thai Text Tracking**: `letter-spacing: 0.05em` applied to Thai text in navigation labels causes awkward character cluster spacing.

#### Questions to Consider
- *If a hospital network glitch causes an API timeout during printing, does our UI make the operator feel safe enough to check the physical printer tray before retrying?*
- *Why are top-level client routes (`/printers`, `/jobs`) proxied directly to Fastify in `vite.config.ts` when React Router owns page navigation?*
- *If an operator opens PrintOps on a tablet standing at a ward printer, can they complete key tasks using only the top 4 decision points on screen?*
