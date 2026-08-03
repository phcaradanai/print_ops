# Local macOS Development Guide

**Last updated:** 2026-07-07  
**Branch:** mvp_nippon

---

## Prerequisites

```bash
# Node.js 20+
node -v   # must be >= 20

# Rust (for Tauri desktop)
rustc --version  # must be >= 1.70

# Tauri CLI
npx @tauri-apps/cli --version

# (Optional) CUPS tools for printer testing — already included on macOS
lpstat --version 2>/dev/null || echo "lpstat available in /usr/bin/lpstat"
```

---

## Starting all services

```bash
# Install dependencies (first time only)
npm install

# Terminal 1 — API on :3001
npm run dev -w apps/api

# Terminal 2 — Web dashboard on :3000
npm run dev -w apps/web

# Terminal 3 — Local runner (Go; the TypeScript runner no longer exists)
cd apps/runner-go && go run ./cmd/printops-runner run
```

Dev credentials (only seeded when `PRINTOPS_DEV_SEED=true`):
`admin@printerops.local` / `Dev-password1!`
Dev API key: `printops-dev-apikey-2026`

---

## macOS CUPS printer discovery

The runner uses `lpstat -p`, `lpstat -v`, `lpstat -d` to discover printers.

On macOS with no printers installed, discovery returns an empty list. This is expected.

To test with fake printers, set:
```bash
cd apps/runner-go && PRINTOPS_DISCOVERY_MODE=fake go run ./cmd/printops-runner run
```

This uses `discoverFake()` which returns two hardcoded printers:
- `Fake-Label-Printer` (tcp_ip, 127.0.0.1:9100, default)
- `Fake-USB-Printer` (usb, USB001)

---

## Discovery adapter modes

| `DISCOVERY_ADAPTER` | Behaviour |
|---|---|
| `auto` (default) | Windows: Get-Printer; macOS/Linux: lpstat; |
| `macos` | Force CUPS lpstat (even on Linux CI) |
| `windows` | Force PowerShell Get-Printer |
| `fake` | Return hardcoded fake printers — for dev/test |

---

## Running Tauri desktop app (macOS)

```bash
# Must have both web app and API running first
npm run dev -w apps/web    # :3000

# Then open the Tauri window
npm run tauri:dev -w apps/desktop
```

The native macOS window will open and load `http://localhost:3000`.  
All web pages are available, including the Local Diagnostics page.

---

## Running tests

```bash
# All tests
npm test

# Runner tests only (includes the CUPS/lpstat parser tests — runnable on macOS)
npm run test:runner-go

# API service tests only
npm run test -w apps/api
```

---

## Known macOS limitations

| Limitation | Notes |
|---|---|
| No real CUPS printers on dev machine | Use `DISCOVERY_ADAPTER=fake` |
| Tauri window can't launch in CI/headless | Run `cargo check` only in CI |
| No Windows Print Spooler | Windows-specific features require a Windows machine |
