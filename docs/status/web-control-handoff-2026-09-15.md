# Web Control Handoff — 2026-09-15

## Stable starting point

- Release version: `0.1.28`
- Final stable `main` SHA: `4ea6cdd76f19f2f4babdc2a7de0311dd0a6fec51`
- Release tag: [`v0.1.28`](https://github.com/phcaradanai/print_ops/tree/v0.1.28)
- Integration PR: [#22](https://github.com/phcaradanai/print_ops/pull/22), merged at `2026-09-15T13:52:58Z`
- Web Control branch: `feature/web-control`
- Web Control starting SHA: `4ea6cdd76f19f2f4babdc2a7de0311dd0a6fec51`
- Frozen implementation SHA before integration: `c29ce1b1578ff797945ae934847dee66d321bd72`
- Frozen historical branch: `mvp_nippon` at `753acda7cc90addb3cda7d16a42f140a1487fbaf`; do not continue feature work there.
- The new branch starts from final `main`; it contains no Web Control implementation.

## Post-merge evidence

- [Webhooks verification run 34978001551](https://github.com/phcaradanai/print_ops/actions/runs/34978001551), final retry job `104411529625`: API workspace, callback/Webhook API contracts, builds, and browser verification all passed.
- [Web quality run 34978001348](https://github.com/phcaradanai/print_ops/actions/runs/34978001348), job `104410617761`: typecheck, web tests, and build passed.
- Local merged-main API, callback-contract tests, and web build passed.
- OTA remains accepted under [run 34964251184](https://github.com/phcaradanai/print_ops/actions/runs/34964251184); no OTA files changed in the merge, so native OTA acceptance was not reopened.

## Contracts to preserve

- Existing Webhooks API routes, callback fields, payload shapes, validation, retry/delivery evidence, and import/export scopes.
- Printing admission and queue lifecycle invariants, including idle/settled gating and durable callback behavior.
- NATS client identity and callback contracts already accepted by the current version.
- Paper-profile geometry, rotated companion-template behavior, preview fidelity, and persisted profile fields.
- OTA admission, rollback, signature, schema, and print-safety gates. OTA is closed; do not reopen it as part of Web Control.

## Deferred items

- [SQLite race technical debt #25](https://github.com/phcaradanai/print_ops/issues/25): investigate the intermittent hosted `PRINTOPS_DB_LOCKED` race in `sqlite-persistence.test.ts`; production impact is unproven, and reproduction is required before changing locking behavior.
- PR #22 is merged and no branch-protection approval gate was configured for `main`; there is no remaining release-governance blocker.
- Web Control itself: no implementation, routes, UI, or schema changes are included in this handoff.

Use the final stable `main` SHA above as the authoritative baseline; begin Web Control implementation only on `feature/web-control`.
