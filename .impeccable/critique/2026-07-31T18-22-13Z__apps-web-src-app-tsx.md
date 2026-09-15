---
target: apps/web/src/App.tsx
total_score: 31
max_score: 36
na_heuristics: 10
p0_count: 1
p1_count: 2
timestamp: 2026-07-31T18-22-13Z
slug: apps-web-src-app-tsx
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Excellent. Splash screen tracks startup status, progress count (up to 120s), and service feedback |
| 2 | Match System / Real World | 4 | High match. Operational terms (Printers, Job Queue, Runners, Paper Profiles) directly mirror hospital workflow |
| 3 | User Control and Freedom | 3 | Mobile nav dismissible with Escape/overlay, but lacks prominent 'Cancel' or 'Back' pattern in main shell |
| 4 | Consistency and Standards | 3 | Inconsistent route protection: `/print-flow` uses `<RequireRoles>`, others rely on `pageAllowed` calculation |
| 5 | Error Prevention | 3 | Password confirmation on setup, but Operations nav contains configuration items (Templates/Profiles), risking misclicks |
| 6 | Recognition Rather Than Recall | 4 | Persistent grouped sidebar ensures users don't need to memorize URLs |
| 7 | Flexibility and Efficiency | 2 | Admin group contains 11 flat items, causing choice overload for administrators |
| 8 | Aesthetic and Minimalist Design | 4 | "Lab Notebook" aesthetic is highly restrained, eliminating SaaS fluff in favor of clinical precision |
| 9 | Error Recovery | 4 | Robust `<RouteErrorBoundary>` and clean login session expiration handling |
| 10 | Help and Documentation | n/a | Surface mode (Operate shell) omits external help links from primary navigation |
| **Total** | | **31/36** | **Good** |

#### Design Specificity Verdict

**Grounded & Context-Aware.** The design is explicitly grounded in its clinical, operational context. The "Lab Notebook" aesthetic (Catppuccin pastels, system fonts, flat UI) actively rejects SaaS tropes in favor of low eye-strain, high-legibility interfaces suited for fluorescent hospital environments. The navigation clearly delineates the operational monitor from system administration, though template/profile Placement in Operations misaligns with administrator vs. operator roles.

**Deterministic scan**: Run against `apps/web/src` via `detect.mjs`. **2 static findings**:
1. [`styles.css:L6705`](file:///Users/Projects/adm-chura3inter/print_ops/apps/web/src/styles.css#L6705): `side-tab` warning (thick 3px side accent border on card).
2. [`styles.css:L5376`](file:///Users/Projects/adm-chura3inter/print_ops/apps/web/src/styles.css#L5376): `codex-grid-background` advisory (tiled hairline grid background).

**Visual overlays**: No browser overlay active. Live static detection completed.

#### Overall Impression

PrintOps demonstrates impressive clinical discipline, flat visual hierarchy, and resilient startup state management. However, information architecture flaws—placing administrative configuration tools under Operations and exposing 11 flat links in the Admin section—introduce cognitive load and RBAC risks.

#### What's Working

1. **Resilient Startup Flow**: The `SplashScreen` component actively polls for API health for up to 120 seconds, handling slow-booting local Go runners gracefully.
2. **Clinical Aesthetic Fidelity**: Strict adherence to flat, system-font, low-motion "Lab Notebook" principles.
3. **Role-Gated Visibility**: Navigation dynamically prunes options based on user role.

#### Priority Issues

- **[P0] Information Architecture Misalignment**
  - **Why it matters**: `PRODUCT.md` defines "Templates" and "Paper Profiles" as Administrator configuration tasks. Placing them in Operations increases cognitive load for print operators and risks accidental modification during clinical monitoring.
  - **Fix**: Move `nav.templates` and `nav.paperProfiles` to the `admin` group in `NAV_ITEMS` and restrict roles to `['OWNER', 'ADMIN']`.
  - **Suggested command**: `/impeccable layout`

- **[P1] Choice Overload in Admin Navigation**
  - **Why it matters**: 11 flat items in Admin violate cognitive load limits ($\le 4$ items per group).
  - **Fix**: Sub-divide the Admin group into sub-categories (Device Setup, Integrations, System) or consolidate related pages.
  - **Suggested command**: `/impeccable layout`

- **[P1] Inconsistent Route Protection Logic**
  - **Why it matters**: `/print-flow` uses `<RequireRoles>`, while other routes rely on client-side array checks, risking URL bypass.
  - **Fix**: Wrap all protected routes with a unified `<ProtectedRoute>` component.
  - **Suggested command**: `/impeccable harden`

- **[P2] AI-Generated UI Antipatterns in CSS**
  - **Why it matters**: `detect.mjs` identified a 3px side-tab border (`L6705`) and hairline grid background (`L5376`) in `styles.css`.
  - **Fix**: Remove side-tab borders and hairline grid backgrounds to maintain pure flat surfaces.
  - **Suggested command**: `/impeccable quieter`

#### Persona Red Flags

- **Alex (Power User)**: Lack of keyboard shortcuts for jumping between admin pages slows down rapid triage.
- **Jordan (First-Timer)**: Overwhelmed seeing Templates, Profiles, Bindings, and Policies all presented without a guided setup flow.
- **Sam (Accessibility)**: Mobile menu overlay lacks a focus trap, allowing keyboard focus to bleed into hidden main content.
- **Riley (Stress Tester)**: Might bypass UI restrictions by typing protected URLs directly if route protection is inconsistent.

#### Minor Observations

- Pre-filled dev credentials facilitate local testing.
- Scrollbar on `AppNav` should be explicitly styled for low-resolution laptop displays.

#### Questions to Consider

- Should 'Templates' and 'Paper Profiles' have a read-only view for Operators, or be hidden entirely as specified in `PRODUCT.md`?
- Should product branding ("PrintOps" vs "PrinterOps") be dynamic via translation keys?
