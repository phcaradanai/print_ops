---
title: Live CUPS verification must wait for the Epson job history to settle
author: Phcaradanai
date: 2026-11-18
branch: main
id: l-2cc0606d
scope: repo
status: active
src: agent
touches:
  - apps/api/src/app.ts
  - apps/api/src/routes/printer.routes.ts
  - apps/web/src/i18n/translations.ts
  - apps/web/src/pages/Printers.tsx
  - docs/design/refinement-progress.md
  - infra/docker/Dockerfile.app
  - packages/adapters/src/cups/cups-printer.adapter.test.ts
  - packages/adapters/src/cups/cups-printer.adapter.ts
---

## Decided
CUPS adapter verification polls read-only IPP job history until its verification window expires when history is temporarily unavailable or output counts have not appeared. Keep the exact per-attempt title and return SUCCESS only from the matching printer job when it confirms enough output. See packages/adapters/src/cups/cups-printer.adapter.ts and its tests.

## Tried and ruled out
A historical IPPS read confirmed the Epson could expose exact job names, but it did not prove live verification. The first live test returned UNVERIFIED about one second after CUPS accepted the job. CUPS completed about 20 seconds later and the Epson subsequently reported the same attempt as completed successfully with one impression. The initial response was not recorded by the previous adapter.

## Watch out
The adapter must only repeat device-status reads, never the print submission. A late read of an already-printed job is diagnostic evidence and does not rewrite its recorded terminal status or re-send its callback.
