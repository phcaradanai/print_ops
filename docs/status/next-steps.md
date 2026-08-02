# Next Steps

## Priority 1: Real Windows Service

Implement actual Windows Service registration using `golang.org/x/sys/windows/svc`.

- [ ] Build-tag-gated `service/windows` package
- [ ] `install-service` creates Windows Service entry via `mgr`
- [ ] `uninstall-service` removes the entry
- [ ] `run` detects service context vs interactive
- [ ] Service recovery options (restart on failure)
- [ ] Event log integration

## Priority 2: Windows Spooler Executor

Real printing via Windows Print Spooler (PowerShell or Win32 API).

- [ ] `printer/windows` package with `PrintExecutor` impl
- [ ] Use `Out-Printer` or `AddJob`/`ScheduleJob` Win32 APIs
- [ ] Paper size / tray selection
- [ ] Status feedback from spooler
- [ ] Error mapping (offline, paper out, jam)

## Priority 3: Raw TCP 9100 Production

Promote `printer/rawtcp` from skeleton to production for label printers.

- [ ] Connection pooling per printer
- [ ] Configurable retry policy
- [ ] ZPL payload validation
- [ ] TSPL payload validation
- [ ] Printer status query (optional `~HQ` for Zebra)
- [ ] Template + variable substitution

## Priority 4: macOS CUPS Executor

- [ ] `printer/cups` via `lp` / `lpr` command
- [ ] PPD-aware options
- [ ] Status feedback via `lpstat`

## Priority 5: Observability

- [ ] Prometheus metrics endpoint
- [ ] OpenTelemetry trace export
- [ ] Structured log shipping (JSON to file/syslog/Event Log)

## Priority 6: Deployment

- [ ] MSI installer for Windows
- [ ] pkg .deb / .rpm for Linux
- [ ] Homebrew formula for macOS
- [ ] Auto-update mechanism
- [ ] Config management templates

## Priority 7: Security Hardening

- [ ] mTLS between runner and API
- [ ] Runner token rotation
- [ ] Signed job payloads
- [ ] Audit log local cache + forward on reconnect