# Next Steps

Last updated: 2026-08-03. Ordered by what blocks the Windows pilot, not by
technical interest.

The previous version of this file listed the Windows Service story, a Windows
spooler executor, and an MSI installer as future work. All three now exist —
see `docs/status/current-status.md`.

---

## Done (2026-08-03)

| # | Change |
|---|---|
| I-1 | Server-side paper-profile validation on create / update / import |
| I-2 | Unrenderable jobs rejected (`RENDER_FAILED`, `TEMPLATE_PROFILE_MISSING`) instead of printing the raw payload |
| I-3 | `data_quality` / `missing_fields` / `render_warnings` in result callbacks + Job Detail banner |
| I-4 | Execution watchdog gives `TIMEOUT` a real producer; `TIMEOUT` moved to the non-executable class |
| I-5 | Cancel guaranteed pre-dispatch, best-effort (202 `CANCEL_REQUESTED`) after |
| I-6 | Product name settled as PrintOps on every user-visible surface |
| I-7 | 14-day hot retention window, archive-before-prune, idle-only sweep |

---

## Next iteration

### N-1 — JetStream at-least-once for result callbacks

Result callbacks over NATS currently use Core publish and are honestly labelled
`BEST_EFFORT`. The agreed target is at-least-once with dedupe on `event_id`.

- [ ] `js.publish()` with a PubAck; on ack mark `DELIVERED` / `ACKNOWLEDGED`
- [ ] Set `Nats-Msg-Id: <event_id>` so the broker dedupes as well
- [ ] No ack → `RETRYABLE`, reusing the existing backoff/sweep machinery
- [ ] Agree and document stream ownership for the callback subject (the
      publisher's environment owns intake streams today; the same rule should
      apply here)

Acceptance: kill the broker mid-send; deliveries sit `RETRY_SCHEDULED` and land
once it returns, with no duplicate observed by the receiver.

### N-2 — Zebra printer certification

The verification chain has only ever been exercised against an Epson. Zebra is
a real pilot device.

- [ ] ZPL through the Windows driver without the driver re-processing it
- [ ] SNMP page-counter OIDs and timing versus `winpool`'s expectations
- [ ] Physical sticker size against the paper profile
- [ ] Failure matrix: cable pulled, media out, head open, power cut mid-job

### N-3 — Postek printer certification

- [ ] **First question: USB or LAN.** USB-only means no SNMP/IPP channel exists,
      so jobs will legitimately end `UNVERIFIED` — that has to be an accepted,
      documented policy for the model, not a surprise on the ward
- [ ] TSPL (or ZPL emulation, if the unit ships with it) through the driver
- [ ] Same size and failure matrix as N-2

### N-4 — External acceptance gates

Still `BLOCKED` in `docs/production/PROD-01-gap-table.md`:

- [ ] Clean Windows install with no developer toolchain
- [ ] Cross-machine NATS + callback receiver matrix
- [ ] Upgrade / rollback / uninstall and data retention

---

## Later

- Screenshot audit of every page in EN and TH (the bilingual commitment has no
  visual evidence on record)
- Role-based navigation filtering in the dashboard
- "Open logs folder" action on Local Diagnostics
- Printer capability display from discovery data
- Required-field enforcement per template — only if the floor actually reports
  blank labels as a problem

## Deliberately not planned

CUPS / raw TCP / IPP as production executors, remote or headless runners,
macOS/Linux packaged builds, Postgres/Redis/BullMQ, and any centralized fleet
management. Each would add infrastructure a single on-premise workstation has
to run and maintain, for no benefit the current deployment has asked for.
Revisit only against a real requirement.
