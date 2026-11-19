---
title: Epson IPP completion history requires IPPS after HTTP 426
author: Phcaradanai
date: 2026-11-18
branch: main
id: l-bcddfaa1
scope: repo
status: active
src: agent
touches:
  - apps/api/src/app.ts
  - apps/api/src/infra/db/sqlite.schema.ts
  - apps/api/src/routes/printer.routes.ts
  - apps/api/src/routes/v1/control.routes.ts
  - apps/api/src/services/web-control-registry.service.ts
  - apps/api/src/tests/control-job-review.test.ts
  - apps/web/e2e/web-control-jobs.spec.ts
  - apps/web/src/features/control-jobs/JobDetailDrawer.tsx
  - apps/web/src/i18n/controlTranslations.ts
  - apps/web/src/i18n/translations.ts
---

## Decided
The Epson L6580 reported the same PrintOps job name in its own completed IPP jobs with one completed impression. packages/adapters/src/cups/cups-printer.adapter.ts now requires a matching per-attempt name, successful device completion, and enough impressions before returning SUCCESS.

## Tried and ruled out
The CUPS scheduler completed the same job but evidence from that queue alone is not a device acknowledgement. The Epson also rejects Get-Jobs with which-jobs=all. A plain HTTP IPP query to the Epson returned 426; the IPPS query to the same printer worked. Reuse the binary client in packages/adapters/src/windows/ipp-printer-client.ts and its standard completed/not-completed job sets.

## Watch out
lpstat -r alone reported scheduler running against a non-CUPS HTTP port. CUPS connection settings must also query queues before saving. Spooler acceptance without device evidence remains UNVERIFIED, and the adapter must never resend a submission to obtain confirmation.
