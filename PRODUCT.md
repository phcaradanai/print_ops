# Product

## Register

product

## Platform

web

## Users

- **Print operators** — hospital staff monitoring job queues, printer status, and runner health via the web dashboard during clinical operations. Context: long shifts under fluorescent lights, need at-a-glance status with minimal cognitive load.
- **System administrators** — IT personnel registering printers from discovery, managing users/roles (OWNER/ADMIN/OPERATOR/VIEWER), configuring templates and paper profiles. Context: periodic configuration work, not daily monitoring.
- **Integration developers** — external teams sending print jobs via `POST /api/v1/print-jobs` with `X-Api-Key` authentication. Context: building and debugging integrations against the REST API.
- **Runner operators** — staff managing local runner processes (Node.js / Go) that bridge the API to physical printers.

## Product Purpose

PrintOps is a generic print gateway for hospital environments. It accepts print jobs from external integration systems via HTTP REST API and routes them to printers on the local network. It does NOT connect directly to HIS (Hospital Information System) — an external integration program bridges that gap.

Core capabilities:
- Accept print jobs with idempotency guarantees (`request_id` + `source_system`)
- Validate, queue, and route jobs through local runner processes to physical printers
- Record full trace/audit information for every job state transition
- Support multiple printer protocols via pluggable adapters (fake/IPP/CUPS/Windows Spooler/raw TCP 9100)
- Provide a React web dashboard and Tauri desktop app for monitoring and administration

Success means: operators trust the system at a glance, jobs flow reliably from integration to printer, and administrators can configure and troubleshoot without friction.

## Brand Personality

**Quiet, purposeful, unobtrusive.** Three words: clinical, calm, precise.

The interface should feel like a well-designed medical device — present when needed, invisible when not. No decoration for decoration's sake. Every pixel earns its place. The tool disappears into the task.

Emotional goals: confidence (the system is reliable), calm (no unnecessary urgency or alarm), precision (information is exact and trustworthy).

## Anti-references

- **No flashy SaaS gradients** — no purple-to-blue hero sections, no over-animated landing-page patterns, no consumer-app "delight" at the expense of clarity
- **No terminal-dense ops tools** — no Datadog-style dense data walls, no Grafana dashboard sprawl, no intimidating terminal-native aesthetics. Hospital operators are not SREs.
- **No generic Material Design** — no default MUI/Blueprint component library look. The interface should feel purpose-built for print operations, not a generic admin template.
- **No dark-mode-by-default** — the hospital environment is lit; dark interfaces increase eye strain under fluorescent light. Light mode primary, dark mode as an option.

## Design Principles

1. **At-a-glance trust.** Status information must be immediately readable without interpretation. Use clear visual hierarchy, not decorative emphasis.
2. **Purpose before polish.** Every UI element must serve a task. Remove before adding. The best component is the one not needed.
3. **Quiet competence.** The interface should not demand attention. It should be ready when the operator needs it and recede when they don't. No unnecessary notifications, badges, or urgency signals.
4. **Precision without density.** Information must be exact and trustworthy, but never overwhelming. Favor progressive disclosure over data walls.
5. **Hospital-grade reliability.** The UI should communicate stability. No jank, no layout shift, no loading spinners where cached data would suffice.

## Accessibility & Inclusion

- **WCAG 2.1 AA** minimum compliance
- **Prefers-reduced-motion** respected — all animations must have a reduced-motion fallback (instant or crossfade)
- **High contrast mode** supported — operators work long shifts under fluorescent hospital lighting; contrast must hold up under fatigue
- **Color not sole communicator** — status indicators must use shape/icon/text in addition to color (red/green color-blindness accommodation)
- **Keyboard navigable** — all dashboard functions accessible without mouse for power users