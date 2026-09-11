---
target: apps/web/src/pages/PaperProfiles.tsx
total_score: 14
p0_count: 1
p1_count: 4
timestamp: 2026-07-15T03-41-41Z
slug: apps-web-src-pages-paperprofiles-tsx
---
# PaperProfiles UX Critique

**Target:** `apps/web/src/pages/PaperProfiles.tsx`  
**Assessment:** Baseline before this remediation pass  
**Method:** dual-agent independent visual/heuristic review plus Impeccable detector

## Executive Summary

The editor has a restrained clinical palette and a useful physical model based on millimetres, DPI, margins, rulers, and grid spacing. Its baseline usability score was **14/40 (Poor)** because the interface exposed three overlapping editing surfaces, provided weak state feedback, and discarded dynamic-field layout when a paper profile was saved. The font and paper also used different scale models, so zoom changed the paper without changing the text proportionally.

## Nielsen Scorecard

| Heuristic | Score | Evidence |
| --- | ---: | --- |
| System status | 1/4 | Static “Ready to save” state; limited success/error recovery. |
| Real-world match | 2/4 | Strong mm/DPI model, but layout fields are attached to a physical paper profile without persistence. |
| User control | 2/4 | Drag and delete exist; undo/redo and duplicate are absent. |
| Consistency | 2/4 | Main form, drawer, and modal duplicate field editing. |
| Error prevention | 1/4 | Missing validation for overlapping/out-of-bounds fields and destructive changes. |
| Recognition | 2/4 | Preview and rulers help, but icon-only controls depend on tooltips. |
| Efficiency | 1/4 | No multi-select, copy/paste, distribute, or complete keyboard workflow. |
| Minimalism | 2/4 | Restrained styling, but repeated controls increase cognitive load. |
| Error recovery | 0/4 | Save/API failures are not surfaced with actionable recovery. |
| Help | 1/4 | Some hints exist; shortcuts and persistence limits are not clear. |

## Priority Findings

- **P0:** `UxOptions.dynamicFields` and appearance settings are UI-only. `save()` sends only the physical `PaperForm`, so designed layouts disappear and cannot drive printing.
- **P1:** Consolidate the main field list, drawer, and modal inspector into one canonical editor state and one property inspector.
- **P1:** Add undo/redo, duplicate, copy/paste, multi-select, alignment/distribution, Delete, and complete keyboard navigation.
- **P1:** Replace static save readiness with validation, dirty/saving/saved/error states, and retry guidance.
- **P1:** Complete dialog and field-control accessibility, including focus containment, focus restoration, and named inputs.

## Strengths

- Physical dimensions, printable margins, orientation, rulers, and grid spacing match the printing domain.
- The palette is quiet and appropriate for clinical operations.
- Existing helpers and unit tests provide a foundation for deterministic coordinate behaviour.

## Remediation In This Pass

- Converted point size to physical millimetres and then screen pixels, so text and paper now share one zoom scale.
- Added 0.1 mm arrow-key nudging, 1 mm Shift nudging, Ctrl/Cmd zoom shortcuts, Ctrl/Cmd-wheel zoom, scrollable enlarged canvas, dialog focus management, and named controls.
- Browser verification passed 8/8: paper, text bounds, and computed font all scaled exactly 2.000× from 100% to 200%; zoom shortcuts, wheel zoom, nudging, focus containment, and focus restoration also passed.
- Replaced design-system drift and invalid translated markup; Impeccable findings fell from 22 to 0.
- Added focused unit tests; 173 web tests, typecheck, and production build pass.

## Recommended Next Milestone

Define a persisted layout document linked to `PrintTemplate` and `PaperProfile`, then make the full-screen editor the single authoring surface. Persistence and undo/redo should precede additional drawing tools; without them, the editor remains a preview prototype rather than a reliable production designer.
