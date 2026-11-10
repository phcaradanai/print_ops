---
title: Desktop NATS settings freeze (white screen) and 0.1.35 merge
author: Phcaradanai
date: 2026-11-10
branch: mvp_nippon
cost: { minutes: 32, tokens: 162248 }
touches:
  - apps/api/package.json
  - apps/desktop/package.json
  - apps/desktop/src-tauri/Cargo.lock
  - apps/desktop/src-tauri/Cargo.toml
  - apps/desktop/src-tauri/tauri.conf.json
  - apps/web/package.json
  - package-lock.json
  - package.json
  - apps/desktop/src-tauri/src/lib.rs
---

## Decided
- Root cause of white/frozen window on NATS "apply": `save_nats_settings` in apps/desktop/src-tauri/src/lib.rs was a sync `#[tauri::command]`, which Tauri v2 runs on the UI thread; it kills/respawns server.exe and polls /health up to 20s. Fixed with `#[tauri::command(async)]`.
- Kill + respawn of server.exe now happens under one `server_child` lock hold; the supervisor thread treats an empty slot as "exited" and would spawn a duplicate in the gap.
- Version bumped to 0.1.35 (root/api/web/desktop package.json, tauri.conf.json, Cargo.toml, Cargo.lock, package-lock.json). Merge of feature/web-control kept 0.1.35 and re-applied the NATS fix onto the feature branch's lib.rs.

## Tried and ruled out
- API crashing with NATS enabled: ran dist/server.js with unresolvable host, unreachable IP and no local broker; /health stays 200. NATS start is non-blocking (`natsManager.start()`), `nats` is a static import so pkg bundling is not the cause.
- Settings.tsx render crash on toggle: draft fields are defaulted via DEFAULT_NATS_SETTINGS; no obvious throw.

## Watch out
- Windows installers (MSI/NSIS) cannot be built on macOS; run `npm run desktop:bundle` on a Windows x64 host.
- `cargo check` needs bundle resources (resources/server.exe, printops-control-agent.exe, ...); use temporary placeholders and revert gen/schemas afterwards.
- Edit tool normalized mixed CRLF/LF in the pre-merge lib.rs; check `git diff --stat` for whole-file churn.
- macOS: kill -9'd API leaves a stale sqlite lock socket in tmpdir -> PRINTOPS_DB_LOCKED; use a fresh DB path in repros.
- After merging feature/web-control, run `npm run build:packages` before typecheck (stale packages/domain dist).
- `enroll_control_device` (from feature/web-control) has the same sync-command freeze and kill/respawn gap; not fixed yet.

## Correction (same day, after user's screen recording on v0.1.35)
- The white screen was NOT the NATS save path. It happens on clicking the Switch itself (before Apply). Cause: `.ui-switch > input` is `position:absolute` (visually hidden) but `.ui-switch` was `position:static`, so the input sat ~3363px down the document; focusing it scrolled the whole document and pushed `.app-shell` out of view (body is overflow:hidden, so no scrollbar, just a white page; Refresh fixes it). Fix: `position: relative` on `.ui-switch` in apps/web/src/components/ui/inputs.css, test in src/__tests__/switchLayout.test.ts.
- Reproduced in plain Chrome via Vite dev (the NATS panel renders there because the tauri import resolves); signature is `document.documentElement.scrollHeight` >> `innerHeight`.
- The async `save_nats_settings` change is still valid hardening but did not fix the reported symptom. Ask for/inspect the recording before theorising about the backend.
