---
title: Printer detail CUPS tests must submit static artwork with queue defaults
author: Phcaradanai
date: 2026-11-19
branch: main
id: l-d3083236
scope: repo
status: active
src: agent
touches:
  - apps/api/src/routes/printer.routes.ts
  - packages/adapters/src/cups/cups-printer.adapter.test.ts
  - packages/adapters/src/cups/cups-printer.adapter.ts
---

## Decided
The printer-details test button must actually submit one static PrintOps PDF through CupsPrinterAdapter.printTestPage. It does not require a user template or paper profile. Keep the artwork compact, and omit media, resolution and color overrides so the selected CUPS queue supplies its own defaults. Use existing executeCommand and a single remote IPP Print-Job; preserve device verification semantics.

## Tried and ruled out
Returning PAPER_PROFILE_REQUIRED plus an HTTP error only corrected false success messages; the user explicitly clarified that the button must print. Sending CUPS accepted but physically unverified test jobs as HTTP 502 also mislabels a sent command. The route now returns HTTP 202 only when PRINT_NOT_VERIFIABLE includes spoolerAccepted=true, preserving success=false and physicalDeliveryConfirmed=false in the response. Rejected preparations remain HTTP failures.

## Watch out
The static PDF is generated in packages/adapters/src/cups/cups-printer.adapter.ts and inspected with pdfinfo/pdftoppm. A live TM-L100 test produced CUPS job14, completed by the scheduler, without physical acknowledgement. Changes were installed into the existing local printops-app container and it was restarted; this is a local container patch, not a published image. Recreating the container from the old image discards it. Tests cover local and remote single submission and queue-default options; apps/api/src/tests/printer-test-print.test.ts covers HTTP202 versus failures. Never reprint automatically because delivery remains unverified.
