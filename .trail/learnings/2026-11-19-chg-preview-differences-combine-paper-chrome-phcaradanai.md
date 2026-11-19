---
title: CHG preview differences combine paper chrome and missing payload defaults
author: Phcaradanai
date: 2026-11-19
branch: main
id: l-e83f29ee
scope: repo
status: active
replaces: l-6270f025
src: agent
touches:
  - apps/web/e2e/paper-profile-ux.spec.ts
  - apps/web/src/__tests__/previewHtml.test.ts
  - apps/web/src/features/paper-profiles/__tests__/editorReducer.test.ts
  - apps/web/src/features/paper-profiles/components/DimensionsSection.tsx
  - apps/web/src/features/paper-profiles/state/editorReducer.ts
  - apps/web/src/lib/previewHtml.ts
  - apps/web/src/styles.css
  - docs/design/refinement-progress.md
---

## Decided
Explicit width/height edits preserve visual field anchors when crossing a square; multi-column media edits must keep the unchanged cell orientation. Keep getOrientedPaperGeometry's legacy/print contract and normalize mutations at editorReducer instead. HTML preview must retain renderer-generated base64 SVG images only in img context and restore the trusted bundled font after sanitizing. Sandbox paper chrome must not add padding or border area to the physical page; the workbench owns narrow-screen scrolling.
## Tried and ruled out
A correct rendered page size alone cannot fix Epson cuts after last ink when rastertotmtr uses TmxPaperReduction=Bottom: WriteRaster omits trailing blank raster feeds. Use reduction Off for fixed height instead of invisible bottom marks or vendor filter changes. Do not turn editor sample labels into production defaults to hide missing payload fields.
## Watch out
The authorized live CHG profile and CHG_auto markup have matching coordinates. Most defaults are empty; editor uses labels for samples, while Sandbox uses payload/defaults. Payload omits some expected keys and uses drug_unit while the profile expects unit. The live Sandbox had20px padding plus1px border, showing an80mm page as344.36px instead of302.36px. docs/tm-l100-fixed-length.md records read-only local queue evidence and remediation. No physical job, remote profile edit, deployment, or CUPS setting change was made.
