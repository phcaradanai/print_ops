---
title: Explicit resize must preserve anchors and preview must retain print graphics
author: Phcaradanai
date: 2026-11-19
branch: main
id: l-6270f025
scope: repo
status: active
src: agent
touches:
  - apps/web/e2e/paper-profile-ux.spec.ts
  - apps/web/src/__tests__/previewHtml.test.ts
  - apps/web/src/features/paper-profiles/__tests__/editorReducer.test.ts
  - apps/web/src/features/paper-profiles/components/DimensionsSection.tsx
  - apps/web/src/features/paper-profiles/state/editorReducer.ts
  - apps/web/src/lib/previewHtml.ts
  - docs/design/refinement-progress.md
---

## Decided
Explicit paper-profile width/height edits must not reinterpret existing fields through an inferred 90-degree orientation change when dimensions cross a square. Keep visual anchors stable in editorReducer PATCH_FORM and change orientation/dimensions together in a single action. Preview sanitization must retain renderer-generated base64 SVG images in img context and restore the trusted bundled PrintOps font, not arbitrary authored style blocks.
## Tried and ruled out
Do not globally change getOrientedPaperGeometry: imported legacy profiles and print adapters intentionally share its orientation contract. Fix the editor mutation boundary. Do not add invisible bottom marks to force TM-L100 feed: the inspected Epson CUPS queue uses TmxPaperReduction=Bottom, and WriteRaster omits trailing blank raster feeds under that option. Set the queue's reduction Off for fixed page height instead of modifying the vendor filter.
## Watch out
apps/web/src/lib/previewHtml.ts is shared by Sandbox and template previews. The exact CHG profile was absent from the inspected local database, so screenshot data mismatch is not proven resolved. docs/tm-l100-fixed-length.md records read-only queue evidence; queue defaults were not changed and no physical print was submitted.
