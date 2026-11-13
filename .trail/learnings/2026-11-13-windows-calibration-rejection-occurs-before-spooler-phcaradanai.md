---
title: Windows calibration rejection occurs before spooler submission
author: Phcaradanai
date: 2026-11-13
branch: main
id: l-459a85c8
scope: repo
status: active
src: agent
touches:
  - apps/api/src/routes/v1/webhook.routes.ts
  - apps/api/src/services/execute-job.service.ts
  - apps/api/src/services/reprint-job.service.ts
  - apps/api/src/tests/reprint-job.test.ts
  - apps/api/src/tests/template-system.test.ts
  - packages/adapters/src/windows/windows-spooler.adapter.ts
  - packages/adapters/src/windows/windows-spooler.html-serve.test.ts
  - packages/domain/src/models/printer.ts
---

## Decided
- Carry Job.paperProfileId into the local adapter command so persisted sandbox jobs with a missing nested profile ID can validate against their own saved job identity. Prefer the paper snapshot DPI for calibration over top-level printer metadata DPI. Keep job-specific output confirmation after submission.

## Tried and ruled out
- Do not translate INVALID_PRINTER_CALIBRATION into SUCCESS or relax printer/profile/DPI matching. The error is thrown during HTML or DPL preparation before sending a copy to Windows.

## Watch out
- apps/api/src/routes/v1/webhook.routes.ts sandbox test-print used to save profile dimensions and DPI without the profile ID. apps/api/src/services/reprint-job.service.ts used to drop the media snapshot. Preserve it on reprint while resolving calibration for the new destination.
- packages/adapters/src/windows/windows-spooler.adapter.ts must still report PRINT_NOT_VERIFIABLE if an earlier copy was submitted and a later copy fails.
