# ADR 0003 — Tauri Desktop Shell Wraps Existing Web Frontend

**Status:** Accepted  
**Date:** 2026-07-07  
**Branch:** mvp_nippon

---

## Context

PrinterOps has a React web dashboard (`apps/web`) served from a browser.  
Operators on Windows PCs need a native desktop app that:
- Starts without opening a browser manually
- Can be distributed as a single installer
- Runs alongside the local Runner service

Two options were considered: clone the React pages into a new Tauri project, or shell-wrap the existing web app.

---

## Decision

`apps/desktop` contains **only a Rust shell** (`src-tauri/`). No React source lives there.

Tauri's `tauri.conf.json` points `devUrl` at `http://localhost:3000` (the web app's Vite dev server) and `frontendDist` at `../../apps/web/dist` (its production build output).

The single source of truth for all UI is `apps/web`. New pages (e.g., Local Diagnostics) are added to `apps/web` and automatically appear in both the browser dashboard and the desktop app.

---

## Consequences

| Trade-off | Notes |
|---|---|
| No duplicate page components | Any UI change is made once |
| Desktop requires web app running in dev mode | Use `beforeDevCommand: npm run dev -w apps/web` |
| Desktop build requires web app built first | Use `beforeBuildCommand: npm run build -w apps/web` |
| Tauri Rust commands not available in browser | Only needed if we later add native OS APIs (file system, tray, etc.) |
| Desktop has no `test` script | Excluded from `npm test --workspaces --if-present` chain |

---

## Configuration

```
apps/desktop/src-tauri/tauri.conf.json
  build.devUrl        = "http://localhost:3000"   ← web Vite port (3000, not 5173)
  build.frontendDist  = "../../apps/web/dist"
  app.windows[0].title = "PrinterOps"
```

---

## Running in Dev Mode

```bash
# Terminal 1: start web app
npm run dev -w apps/web

# Terminal 2: start Tauri shell (opens native window loading localhost:3000)
npm run tauri:dev -w apps/desktop
```

---

## Rejected alternatives

| Alternative | Reason rejected |
|---|---|
| Copy web pages into apps/desktop/src | Two sources of truth; all future UI changes need to be made twice |
| Electron instead of Tauri | Bundles a full Chromium (~150 MB); Tauri uses the OS WebView (~5 MB) |
| PWA / browser shortcut | No native packaging; can't be installed as a proper Windows application |
