# Web Control Handoff — 2026-09-15

## Stable starting point

- Recommended branch: `mvp_nippon`
- Recommended SHA: `06c6e0b2906b9999f988cd286a5d08edb89fdfd3` (documentation-only closeout head; implementation SHA `c29ce1b1578ff797945ae934847dee66d321bd72`)
- Recommended workspace version: `0.1.28`
- Integration PR: #22, base `main`, currently ready for review and not merged
- Do not start from a moving worktree or from an earlier failed Webhooks run.

## Contracts to preserve

- Existing Webhooks API routes, callback fields, payload shapes, validation, retry/delivery evidence, and import/export scopes.
- Printing admission and queue lifecycle invariants, including idle/settled gating and durable callback behavior.
- NATS client identity and callback contracts already accepted by the current version.
- Paper-profile geometry, rotated companion-template behavior, preview fidelity, and persisted profile fields.
- OTA admission, rollback, signature, schema, and print-safety gates. OTA is closed; do not reopen it as part of Web Control.

## Deferred items

- Formal GitHub review/approval and merge of PR #22.
- The hosted SQLite exclusive-lock test showed a transient `PRINTOPS_DB_LOCKED` race during two retries; the final complete workflow passed and no test was weakened.
- Web Control itself: no implementation, routes, UI, or schema changes are included in this handoff.

Use the exact frozen SHA above until PR #22 is formally merged; if it is merged first, record the merge commit before beginning Web Control.
