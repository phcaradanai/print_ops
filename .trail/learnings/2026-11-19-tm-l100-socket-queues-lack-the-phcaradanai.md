---
title: TM-L100 socket queues lack the per-job evidence required by IPP verification
author: Phcaradanai
date: 2026-11-19
branch: main
id: l-e18d8377
scope: repo
status: active
src: agent
touches:
  - apps/api/src/routes/printer.routes.ts
  - packages/adapters/src/cups/cups-printer.adapter.test.ts
  - packages/adapters/src/cups/cups-printer.adapter.ts
---

## Decided
The live TM-L100 CUPS queue uses socket:// on port 9100 in both local and server CUPS. Read-only probes confirmed the printer has no IPP/IPPS listener and its SNMP status response does not expose a physical output counter. packages/adapters/src/cups/cups-printer.adapter.ts cannot correlate physical delivery for this transport; preserve UNVERIFIED and report the actual verification gap in the job result message.

## Tried and ruled out
Read-only lpstat -v and IPP Get-Printer-Attributes confirmed the socket transport. The user-supplied local CUPS job 13 and server job 9 both reported state 9, job-completed-successfully, and one impression, but these are scheduler records rather than device acknowledgements. Direct getPrinterAttributes calls to both IPP and IPPS on the physical printer refused connection; readDeviceState returned status without a page counter. A longer IPP polling window or treating idle/CUPS completion as success cannot supply evidence absent from this transport.

## Watch out
Epson lists GS ( H Function 48 process-ID response for TM-L100 (https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/tml100.html and gs_lparen_ch_fn48.html). Integrating it needs an acknowledgement tied to the same bidirectional print stream, including the CUPS filter/backend boundary; a separate post-hoc status socket does not identify the printed job. Never resend an ambiguous job or rewrite a previous terminal state solely because an operator sees paper.
