# Defect investigation — 2026-08-05: QR physical size, HTML dispatch throughput, callback final statuses

Three defects from the print-workflow brief, root-caused and fixed:

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| DEFECT-01 | Printed QR is ~0.5 mm smaller than configured (a 20 mm QR prints ≈19.5 mm) | The WebView2 helper left `CoreWebView2PrintSettings.MediaSize` at its default (`Default`), so the printer DRIVER substituted its default form for the paper profile's exact page size and the Windows print pipeline scaled the page to fit the form's printable area (~2.5 % shrink). `ScaleFactor = 1.0` (added earlier) only disables Chromium's own scaling; it cannot stop the driver substituting its form. The renderer math was already exact (SVG module matrix in a CSS-mm box; `^GF` rounded once to device dots) — verified by a Chromium print-layout measurement of 19.997 mm. | `apps/windows-print-helper/Program.cs`: `MediaSize = CoreWebView2PrintMediaSize.Custom` so `PageWidth/PageHeight` reach the driver unchanged. Extracted the request→settings mapping into a pure `PrintSettingsSpec` (unit-tested). |
| DEFECT-05 | Batches of HTML jobs print slowly; every job cold-starts a fresh print process | `printHtml` spawned a NEW `printops-html-print.exe` with a NEW WebView2 user-data folder PER JOB. WebView2 environment initialisation (~1-2 s) is the dominant per-job cost, paid once per label. | Helper gained `--serve <dir> [--idle-ms N]` mode: ONE process, ONE WebView2 environment, many sequential requests via a file protocol (`request-<id>.json` → `result-<id>.json`). The TS adapter keeps one serve-mode helper per printer (cross-printer concurrency preserved by the existing per-printer locks/chains), recycles a wedged helper on `WEBVIEW2_PRINT_TIMEOUT`, and kills helpers on process exit; helpers self-exit after 180 s idle so a crashed parent leaves no orphan. |
| DEFECT-09 | Only the QUEUED acceptance callback fires; the real final status (SUCCESS / FAILED / UNVERIFIED / TIMEOUT / CANCELLED) is never reported | `buildCallbackIntent` disabled the terminal-result intent whenever `callbackOnPrintResult` was off — which is the DEFAULT for new endpoints — so default-configured endpoints only ever received `print.job.accepted` with `status: "QUEUED"`. | Terminal-result callback now fires for EVERY job whose endpoint resolved a destination. `callbackOnPrintResult` only decides whether the acceptance callback ALSO fires. Docs, UI help text (EN/TH), and tests updated. |

## Verification

- `dotnet test apps/windows-print-helper.tests` — 9/9 (MediaSize=Custom mapping, exact mm→inch geometry, printable-box CSS, serve protocol).
- `npx vitest run --root apps/api` — 437/438; the single failure (`dashboard-api-namespace.test.ts`, SPA deep-link returns 401 for `/jobs`) is pre-existing and unrelated (legacy `/jobs` API route collides with the SPA fallback).
- `npx vitest run packages/adapters` — 79/79 (including the new serve-mode suite: one helper per printer, reuse across jobs, recycle after timeout, serve-mode request wire format).
- `npx vitest run --root apps/web` — 647/647; `npm run typecheck` — PASS (repo-wide); `npm run build -w apps/web` — PASS; `go build ./...` + `go test ./internal/printer/... ./internal/jobs/...` — PASS.
- Helper republished to `apps/windows-print-helper/publish/` (the folder `apps/desktop/src-tauri/scripts/build-all.js` copies into `resources/print-helper/` for the NSIS/MSI installer).

## Remaining limitation

No physical 203/300/600 DPI printer was available, so the MediaSize=Custom fix is verified at the code/geometry level and in the published binary, not on paper. The dark module matrix (excluding its outside quiet zone) must be measured on the target printer, and the installed driver should be left at 100 %/actual size — MediaSize=Custom makes the driver use the requested form exactly, so a driver-side "fit to page" has nothing left to fit.
