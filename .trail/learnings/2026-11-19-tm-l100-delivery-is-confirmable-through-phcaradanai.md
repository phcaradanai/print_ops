---
title: "TM-L100 delivery is confirmable through the escposack CUPS backend's ESC/POS process-ID ack"
author: Phcaradanai
date: 2026-11-19
branch: main
cost: { minutes: 6, tokens: 146340 }
id: l-5a6355f7
scope: repo
status: active
src: agent
touches:
  - cups-epson/backend/escposack
  - cups-epson/backend/test_escposack.py
  - cups-epson/Dockerfile
  - packages/adapters/src/cups/cups-printer.adapter.ts
  - ".gitattributes"
  - packages/adapters/src/cups/cups-printer.adapter.test.ts
  - cups-epson/build-push-registry.md
---

## Decided
Supersedes the "cannot verify" conclusion of l-e18d8377 for Epson TM printers. cups-epson/backend/escposack (Python CUPS backend, installed by cups-epson/Dockerfile) sends the job over TCP 9100, appends GS ( H fn48 (1D 28 48 06 00 30 30 d1..d4, digits = CUPS job id mod 10000) on the same connection, and exits CUPS_BACKEND_OK only when the printer returns 37 22 d1..d4 00. A live probe of the TM-L100 at 192.168.10.164 returned exactly that on the same socket. packages/adapters/src/cups/cups-printer.adapter.ts treats a queue whose device URI is escposack:// as confirmable: it reads the CUPS scheduler's own Get-Jobs for that queue and requires the exact CUPS job id in state 9 with job-completed-successfully, then returns success with deviceConfirmation='escpos-process-id'.

## Tried and ruled out
Matching by job-name on the CUPS scheduler does not work: stock JobPrivateValues hides job-name from anonymous Get-Jobs, while job-id/state/reasons stay public. The Epson tech-reference site is behind a terms gate (WebFetch/curl get 403); the byte format was confirmed by probing the printer instead.

## Watch out
Without an ack the backend exits CUPS_BACKEND_CANCEL (job state 7), never FAILED/RETRY: the default stop-printer policy would halt the queue and retry policies would reprint. The live queue still needs `lpadmin -v escposack://...` and the CUPS image/app rebuilt; .gitattributes forces LF on cups-epson/backend/* because core.autocrlf=true would break the shebang.
