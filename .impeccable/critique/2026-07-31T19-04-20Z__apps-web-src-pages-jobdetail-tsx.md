---
target: apps/web/src/pages/JobDetail.tsx
total_score: 36
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
timestamp: 2026-07-31T19-04-20Z
slug: apps-web-src-pages-jobdetail-tsx
---
Method: dual-agent (A: df991113-b479-4ec4-8045-910c5ef5727f · B: 5cc0c739-e638-471b-8010-f280307182c5)

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4/4 | Live polling, Freshness timer, explicit status badges, auto-stop on terminal state |
| 2 | Match System / Real World | 4/4 | Translates system enums into physical operator realities (paper counter, printer ACK, IPP endpoint) |
| 3 | User Control and Freedom | 3/4 | Easy reprint workflow and job links; missing inline cancel CTA for in-flight jobs |
| 4 | Consistency and Standards | 4/4 | Unified outlined-pill status badges across queue, detail, and fleet views |
| 5 | Error Prevention | 4/4 | `mayReprint` permission gate, `identityComplete` validation, caution dialog for unverified duplicate risk |
| 6 | Recognition Rather Than Recall | 4/4 | Clear labeled facts, explicit delivery status descriptions with symbols, hyperlinked job IDs |
| 7 | Flexibility and Efficiency | 3/4 | Hides deep forensics for casual operators; lacks keyboard shortcuts for power users |
| 8 | Aesthetic and Minimalist Design | 4/4 | Clean spacing, high contrast, zero visual clutter around primary verdict |
| 9 | Error Recovery | 3/4 | Clear error banner messages and explicit retry actions; missing plain-language physical fix tips |
| 10 | Help and Documentation | 3/4 | Contextual explanations for disabled actions and callback intents; missing tooltips on complex IPP state codes |
| **Total** | | **36/40** | **Excellent** |

#### Design Specificity Verdict

**LLM Assessment:**  
High domain grounding (9.5/10). The composition is purpose-built for physical print operations. It explicitly tracks hardware-level evidence—such as IPP endpoints (`ippEndpoint`), spooler IDs (`spoolerJobIds`), hardware paper/impression counters (`pagesBefore` → `pagesAfter`), paper profiles, and IPP job state reason codes. `JobVerdictBand` translates abstract system enums into operator-focused outcomes (*Page came out*, *No page came out*, *Nobody can say / Check Printer*), while cleanly separating Physical Print Status from Webhook Callback Delivery Status.

**Deterministic Scan (`detect.mjs`):**  
5 total findings (4 Warnings, 1 Advisory) in `styles.css`:
- `side-tab` (4 warnings): `border-left: 3px solid #ba3253` (failed row), `border-left: 3px solid #1e66f5` (running row), `border-left: 4px solid` (verdict band), and `border-left: 3px solid` (trace timeline card). *Note: Left-stripe accents were added in live mode for status visual signaling; the detector flags them as potential AI slop.*
- `codex-grid-background` (1 advisory): `.sandbox-proof-workbench` dot grid background (*Contextual exemption: actual print proof canvas surface*).

#### Overall Impression
A highly grounded, domain-specific print operations interface that translates complex hardware and queue states into immediate operator verdicts. Visually disciplined with WCAG AA compliance, though detector scan highlights that the 3px/4px left accent borders (applied during live visual refinement) trigger `side-tab` warnings.

#### What's Working
1. **Physical Grounding & Verdict Architecture**: Maps 10 raw backend status codes into 3 clear physical realities, protecting operators against double-printing high-stakes labels.
2. **Callback vs. Print Disambiguation**: Intelligently separates physical paper execution from webhook delivery status with independent polling lifecycles.
3. **Rigorous WCAG AA Color Palette**: Outlined pill design with high-contrast text and custom border colors guarantees 4.5:1 contrast across light backgrounds.

#### Priority Issues

- **[P1] Technical Forensics Accessibility & Quick-Copy Action**
  - **Why it matters**: Incident responders (power users) cannot copy all technical details in one click and must manually expand `<details>` on every investigation.
  - **Fix**: Add a "Copy Debug JSON" button in the forensics panel and support a `?debug=true` URL parameter to keep `<details>` expanded by default.
  - **Suggested command**: `/impeccable layout`

- **[P2] Human-Readable Action Tips for Error Codes**
  - **Why it matters**: `job.errorCode` displays raw system strings (`PRINTER_ACK_TIMEOUT`) without plain-language operator advice, leaving floor operators unsure what physical action to take.
  - **Fix**: Map technical error codes to operator advice (e.g., *"Check printer power, cable connection, or paper tray"*).
  - **Suggested command**: `/impeccable clarify`

- **[P2] Detector `side-tab` Antipattern Cleanup**
  - **Why it matters**: Colored 3px/4px left borders on `.job-verdict` and `.job-trace__card` trigger AI-slop detector warnings (`side-tab`).
  - **Fix**: Replace left-stripe borders on step cards with an exterior vertical timeline connector track line and status dot.
  - **Suggested command**: `/impeccable quieter`

- **[P2] IPP Table Keyboard Scroll & Header Accessibility**
  - **Why it matters**: `.print-evidence__table-wrap` lacks keyboard focus (`tabIndex={0}`) and table rows lack `scope="row"` headers.
  - **Fix**: Add `tabIndex={0}` and `aria-label="IPP Observed Jobs"` to the scroll wrapper, and assign `th scope="row"` to IPP Job IDs.
  - **Suggested command**: `/impeccable audit`

- **[P3] Missing Inline Cancel CTA for Active Jobs**
  - **Why it matters**: Jobs in `QUEUED`, `ACCEPTED`, or `DISPATCHED` state do not display a "Cancel Job" button in the detail view header/verdict.
  - **Fix**: Render a conditional `[Cancel Job]` button when `job.status` is in an active non-terminal state.
  - **Suggested command**: `/impeccable harden`

#### Persona Red Flags

- **Alex (Power User)**: Technical details (latency metrics, trace timeline, NATS stream sequence, raw payload snapshot) are hidden inside a collapsed `<details>` tag by default. Alex must manually click expand on every single job investigation. No single-click "Copy Debug JSON" button.
- **Jordan (First-Timer)**: Technical terms like `ippObservedJobs`, `NATSMode`, `JETSTREAM`, and raw error codes (e.g. `SPOOLER_TIMEOUT`) lack plain-language physical troubleshooting guidance (*"Check if paper tray is empty"*).
- **Sam (Accessibility-Dependent User)**: Custom CSS styling on `<details className="job-technical">` summary replaces default disclosure marker (`::-webkit-details-marker { display: none; }`). IPP Jobs table wrapper (`.print-evidence__table-wrap`) lacks `tabIndex={0}` for keyboard-only horizontal scrolling on small screens.

#### Minor Observations
- Timestamps format dates using local time without explicit timezone abbreviation (e.g., `EST` / `UTC`), which could cause minor confusion in multi-region deployments.

#### Questions to Consider
- Should physical print label previews or rendered PDF thumbnails be incorporated into Tier 0b (`Document Info`) so operators can visually inspect what was printed before reprinting?
- Should `ResultDelivery` support an immediate "Retry Delivery Now" manual action for failed webhooks?
