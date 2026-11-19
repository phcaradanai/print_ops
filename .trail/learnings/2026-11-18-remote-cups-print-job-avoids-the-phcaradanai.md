---
title: Remote CUPS Print-Job avoids the owner-only Send-Document step
author: Phcaradanai
date: 2026-11-18
branch: main
id: l-887b10fa
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
Remote CUPS in the Linux app submits the document and options in one IPP Print-Job request. A real isolated CUPS container accepted it with an IPP job ID under the stock Print-Job policy. See packages/adapters/src/cups/cups-printer.adapter.ts and infra/docker/Dockerfile.app.

## Tried and ruled out
The remote lp command used Create-Job followed by Send-Document. CUPS returned HTTP 200 for Create-Job and 401 for Send-Document because the default policy authenticates job-owner operations. This left a zero-byte job-incoming record. Sharing the queue only made the queue visible to lpstat.

## Watch out
The CUPS receipt only proves spooler acceptance. Preserve UNVERIFIED and avoid automatic retry. The current external intake intentionally treats resubmission as a new print, even with the same request_id, per apps/api/src/services/accept-external-job.service.ts.
