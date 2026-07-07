# Desktop App Architecture (Tauri v2)

**Status:** Implemented (shell scaffold)  
**Phase:** MVP Nippon

---

## Overview

```
┌─────────────────────────────────────────────────┐
│  PrinterOps Desktop  (Tauri v2 native window)   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  React Frontend  (apps/web/src)         │   │
│  │  loaded from http://localhost:3000 (dev)│   │
│  │  or  apps/web/dist  (prod build)        │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Rust shell  (apps/desktop/src-tauri/)          │
│  tauri::Builder::default() — no custom commands │
└─────────────────────────────────────────────────┘
        ↕ HTTP (same as browser dashboard)
┌───────────────────────────┐
│  PrinterOps API  :3001    │
└───────────────────────────┘
        ↕ Poll/Heartbeat
┌───────────────────────────┐
│  Local Runner  (Node.js)  │
└───────────────────────────┘
        ↕ OS APIs
┌───────────────────────────┐
│  Local Printers           │
└─────────────────────���─────┘
```

---

## Key design choices

**No React source in apps/desktop.** The Tauri shell is a thin OS wrapper. All UI is in `apps/web`. This means one source of truth for all pages, including the Local Diagnostics page.

**No custom Tauri commands yet.** The Rust side does nothing besides launching the window and loading the web app. Future phases can add Tauri commands for native printer access (CUPS, Windows Spooler) if needed — but for now, everything flows through the HTTP API.

**CSP null in dev.** The web app makes fetch calls to `http://localhost:3001` (API). Setting `csp: null` in `tauri.conf.json` lets this work without a custom content security policy.

---

## Directory layout

```
apps/desktop/
├── package.json              # no test script; scripts: tauri:dev, tauri:build
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json        # devUrl=localhost:3000, frontendDist=../../apps/web/dist
    ├── capabilities/
    │   └── default.json       # core:default permission
    └── src/
        ├── main.rs            # entry point
        └── lib.rs             # tauri::Builder setup
```

---

## Pages available in desktop app

All pages from `apps/web` are available:

| Page | Route |
|---|---|
| Dashboard | `/` |
| Printers | `/printers` |
| Printer Detail | `/printers/:id` |
| Discovered Printers | `/discovered-printers` |
| **Local Diagnostics** | `/diagnostics` |
| Job Queue | `/jobs` |
| Job Detail | `/jobs/:id` |
| Runners | `/runners` |
| Audit Logs | `/audit-logs` |
| Users & Roles | `/users` |
| Export | `/export` |
| Settings | `/settings` |

---

## Dev commands

```bash
# macOS dev run (requires Rust, Tauri CLI, Node.js)
npm run dev -w apps/web          # start web on port 3000
npm run tauri:dev -w apps/desktop # open Tauri window → loads localhost:3000

# Windows dev run
npm run dev -w apps/web
npm run tauri:dev -w apps/desktop

# Check Rust code without building
cd apps/desktop/src-tauri && cargo check
```

---

## Future native extensions (not MVP)

- Tauri tray icon (show runner status in system tray)
- Tauri commands for direct native print (bypass HTTP for ultra-low-latency local print)
- Windows Service installation helper via Tauri sidecar
- macOS CUPS socket access via Tauri command (instead of via runner HTTP)
