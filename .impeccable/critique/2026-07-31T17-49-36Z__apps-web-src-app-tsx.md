---
target: apps/web/src/App.tsx
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 1
timestamp: 2026-07-31T17-49-36Z
slug: apps-web-src-app-tsx
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Good splash screen with polling; general status in-app could be more prominently surfaced |
| 2 | Match System / Real World | 3 | Uses domain language (Printers, Jobs, Runners), though technical terminology surfaces occasionally |
| 3 | User Control and Freedom | 3 | Standard navigation provided, though navigation structure is overwhelming |
| 4 | Consistency and Standards | 1 | Direct violation of `DESIGN.md`'s 6-color status rule: 11 unique status colors in `statusColors.ts` |
| 5 | Error Prevention | 3 | Good use of session expiration handling and explicit error boundaries |
| 6 | Recognition Rather Than Recall | 3 | Nav icons used, but unchunked list forces visual scanning over recognition |
| 7 | Flexibility and Efficiency | 2 | Power users must scan an unchunked sidebar with 17 total navigation links |
| 8 | Aesthetic and Minimalist Design | 1 | Sidebar is bloated and breaks cognitive load chunking rules ($\le 4$ items) |
| 9 | Error Recovery | 4 | `RouteErrorBoundary` provides robust recovery at the route level |
| 10 | Help and Documentation | 2 | Minimal inline hints available for complex admin configurations |
| **Total** | | **26/40** | **Acceptable** |

#### Design Specificity Verdict

**Mixed Specificity.** The visual language attempts to be clinical and precise as mandated by the "Lab Notebook" theme, but the structural composition of the navigation (17 total flat links split across 2 groups) falls back into generic, bloated SaaS patterns. It lacks the focused restraint required for a hospital print gateway.

**Deterministic scan**: Run against `apps/web/src` via `detect.mjs`. **0 static design violations found** (`[]`).

**Visual overlays**: No browser overlay active. Live static detection passed cleanly.

#### Overall Impression

PrintOps has strong technical foundations and thoughtful accessibility considerations (such as dark navy text for WCAG AA contrast). However, the sidebar visual hierarchy is severely compromised by an unchunked wall of 17 navigation links, and the application code explicitly diverges from `DESIGN.md`'s status color constraints.

#### What's Working

1. **Accessibility Remediation**: `statusColors.ts` prioritizes readability by implementing dark navy text on status badges for WCAG AA compliance.
2. **Robust Route Recovery**: `RouteErrorBoundary` and the startup polling splash screen provide reliable fault isolation during server boot.

#### Priority Issues

- **[P0] Navigation Sidebar Cognitive Overload**
  - **Why it matters**: 17 total navigation links are presented in two flat groups (6 Operations, 11 Admin), severely violating cognitive load limits ($\le 4$ items per decision chunk) and working memory bounds.
  - **Fix**: Consolidate admin routes into a unified "Admin Hub" / "Settings" hub with cards or tabs, keeping sidebar items to $\le 4$ per group.
  - **Suggested command**: `/impeccable layout`

- **[P1] Violation of the 6-Color Status Rule**
  - **Why it matters**: `DESIGN.md` explicitly mandates a maximum of 6 semantic status colors and forbids 10+ color systems. `statusColors.ts` implements 11 unique hex codes for job statuses.
  - **Fix**: Consolidate status badges into the 6 permitted semantic categories (Success, Warning, Error, Info, Progress, Neutral).
  - **Suggested command**: `/impeccable distill`

#### Persona Red Flags

- **Jordan (First-Timer)**: Overwhelmed by 17 nav links without clear visual grouping or progressive disclosure.
- **Alex (Power User)**: Experiences friction hunting for specific settings in an unchunked flat list.
- **Sam (Accessibility)**: While text contrast was fixed, the cognitive overload of the sidebar remains a significant usability obstacle.
- **Riley (Stress Tester)**: Finding the right policy or route binding under emergency print failure conditions is slow due to flat navigation.

#### Minor Observations

- Nav label CSS comments show great awareness of Thai typography constraints.
- Splash screen timeout (120s) is robust for slow backend start sequences.

#### Questions to Consider

- Could the 11 Admin routes be consolidated into a unified "Settings & System" hub page?
- Should `DESIGN.md` be updated to reflect 11 statuses, or should `statusColors.ts` be refactored down to 6 colors?
