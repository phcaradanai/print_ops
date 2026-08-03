# Job Detail — verdict copy and reprint provenance

Status: **draft, blocked in part.** Covers two things the Job Detail redesign
cannot invent: the verdict wording an operator acts on, and the reprint
relationship between jobs.

- Section 1 is a **copy deck** requiring native-Thai review before release.
- Section 2 is a **verified investigation** of the reprint relationship, ending
  in one frontend bug fix and one backend dependency.

---

## 1. Verdict copy deck

### Why this exists

`packages/domain/src/models/job.ts` models ten job statuses. Three of them mean
materially different things to a person holding a label printer:

| Reality | Statuses | What the operator should do |
|---|---|---|
| A page came out | `SUCCESS` | Nothing |
| No page came out | `FAILED` `CANCELLED` `DUPLICATE_RETURNED` | Reprint freely |
| **Unknown** | `UNVERIFIED` `TIMEOUT` | **Check the printer first** |

The third row is why `UNVERIFIED` exists as a distinct status rather than being
folded into `FAILED`. From `job.ts:12-17`:

> Sent, and nothing reported a fault, but no device channel could confirm a page
> came out. Distinct from FAILED on purpose: a page may well exist, so
> reprinting is an operator decision rather than a safe automatic retry.

Today the UI renders all ten as an uppercase enum name in a colored badge. The
distinction is modeled in the domain and lost in the interface.

### Authoring rules

1. **Each verdict is one complete string per language.** Never assemble a
   verdict from fragments — Thai word order will not survive English
   concatenation, and these are the sentences an operator acts on.
2. **Headline answers "did it print?" Detail answers "what do I do?"**
3. **Thai leads with the action** in the ambiguous cases. Under time pressure
   the instruction must arrive before the explanation.
4. Match house style in `translations.ts`: no politeness particles, `กรุณา` for
   instructions, technical nouns left in English (`Request ID`, `callback`).

### The deck

Key namespace: `page.jobDetail.verdict.<STATUS>.headline` / `.detail`

---

#### `SUCCESS` — confirmed printed

| | |
|---|---|
| EN headline | Printed |
| EN detail | The printer confirmed this page came out. |
| TH headline | พิมพ์แล้ว |
| TH detail | เครื่องพิมพ์ยืนยันแล้วว่าพิมพ์ออกมาจริง |

Reprint stance: available, de-emphasized. A page already exists.

---

#### `PRINTING` — in progress

| | |
|---|---|
| EN headline | Printing now |
| EN detail | The printer is working on this job. |
| TH headline | กำลังพิมพ์ |
| TH detail | เครื่องพิมพ์กำลังทำงานอยู่ |

Reprint stance: none. The job is not over.

---

#### `ACCEPTED` `VALIDATED` `QUEUED` — waiting

| | |
|---|---|
| EN headline | Not printed yet |
| EN detail | This job is waiting in the queue. It has not reached the printer. |
| TH headline | ยังไม่ได้พิมพ์ |
| TH detail | งานนี้อยู่ในคิว ยังไม่ถึงเครื่องพิมพ์ |

Reprint stance: none. The job is not over.

---

#### `DISPATCHED` — sent to runner

| | |
|---|---|
| EN headline | Sent to the printer |
| EN detail | The job has left the queue and is on its way to the printer. |
| TH headline | ส่งไปยังเครื่องพิมพ์แล้ว |
| TH detail | งานออกจากคิวแล้วและกำลังส่งไปยังเครื่องพิมพ์ |

Reprint stance: none. Kept separate from `QUEUED` because "still in the queue"
and "already handed off" are different answers to "can I still stop this?"

---

#### `UNVERIFIED` — **the hinge**

| | |
|---|---|
| EN headline | May have printed — not verified |
| EN detail | Check the printer before reprinting — a label may already exist. The job was sent and nothing reported a fault, but no printer confirmed a page came out. |
| TH headline | อาจพิมพ์ออกมาแล้ว — ยืนยันไม่ได้ |
| TH detail | ตรวจสอบที่เครื่องพิมพ์ก่อนสั่งพิมพ์ซ้ำ อาจมีสติกเกอร์ออกมาแล้ว ระบบส่งงานไปแล้วและไม่พบข้อผิดพลาด แต่ไม่มีการยืนยันจากเครื่องพิมพ์ว่าพิมพ์ออกมาจริง |

Reprint stance: danger-weighted. Duplicate-risk acknowledgement is the emphasis
of the dialog, not a checkbox to clear.

**This is the single most important string in the product.** Misread as
"failed," it produces a duplicate clinical label. Misread as "printed," it
produces a missing one.

---

#### `TIMEOUT` — no response

| | |
|---|---|
| EN headline | No response — may have printed |
| EN detail | Check the printer before reprinting — a label may already exist. The printer never responded, so the outcome is unknown. |
| TH headline | ไม่มีการตอบกลับ — อาจพิมพ์ออกมาแล้ว |
| TH detail | ตรวจสอบที่เครื่องพิมพ์ก่อนสั่งพิมพ์ซ้ำ อาจมีสติกเกอร์ออกมาแล้ว เครื่องพิมพ์ไม่ตอบกลับ จึงไม่ทราบผลลัพธ์ |

Reprint stance: danger-weighted, same as `UNVERIFIED`.

Kept textually distinct from `UNVERIFIED` on purpose: "nothing came back at
all" and "something came back but confirmed nothing" lead an operator to check
different things at the device.

---

#### `FAILED` — confirmed not printed

| | |
|---|---|
| EN headline | Did not print |
| EN detail | This job failed before a page came out. Reprinting is safe. |
| TH headline | ไม่ได้พิมพ์ |
| TH detail | งานล้มเหลวก่อนที่จะพิมพ์ออกมา สั่งพิมพ์ซ้ำได้ |

Reprint stance: routine, primary action, low ceremony.

The existing `errorCode` / `errorMessage` banner stays and sits under this
verdict — it explains the failure, it does not replace the verdict.

---

#### `CANCELLED` — confirmed not printed

| | |
|---|---|
| EN headline | Cancelled |
| EN detail | This job was cancelled before printing. Reprinting is safe. |
| TH headline | ยกเลิกแล้ว |
| TH detail | งานถูกยกเลิกก่อนพิมพ์ สั่งพิมพ์ซ้ำได้ |

Reprint stance: routine.

---

#### `DUPLICATE_RETURNED` — confirmed not printed

| | |
|---|---|
| EN headline | Not printed — duplicate request |
| EN detail | An identical request had already been accepted, so this one did not print. Open the original job to see what happened to it. |
| TH headline | ไม่ได้พิมพ์ — คำขอซ้ำ |
| TH detail | มีคำขอเดียวกันถูกรับไว้ก่อนแล้ว งานนี้จึงไม่ได้พิมพ์ เปิดงานต้นฉบับเพื่อดูผลลัพธ์ |

Reprint stance: none on this job. Route the operator to the original request
instead — reprinting *this* job is never the right move.

---

### ⚠ Review gate

**The Thai above is a draft and is not production wording.** It requires review
by a native Thai speaker, ideally one who has watched a nurse use this system.
Specific points to put in front of the reviewer:

1. **`UNVERIFIED` and `TIMEOUT` headlines.** Does `อาจพิมพ์ออกมาแล้ว` read as
   genuine uncertainty, or could it be skimmed as "printed"? If there is any
   risk of the latter, the headline must change — this is the failure mode with
   clinical consequences.
2. **`สติกเกอร์`** — is this the word ward staff actually use for the output, or
   is `ฉลาก`, `ป้าย`, or a site-specific term correct? Confirm against the real
   deployment, not general usage.
3. **Register.** Verdicts are drafted without `กรุณา` in the headline and with
   `กรุณา` omitted even in the instruction ("ตรวจสอบ...ก่อน" rather than
   "กรุณาตรวจสอบ"), on the reasoning that a bare imperative is faster to parse
   under pressure. Confirm this does not read as curt to hospital staff.
4. **Length under layout.** The `UNVERIFIED` and `TIMEOUT` details are the
   longest strings; check they hold in the verdict band at 320px width without
   pushing the reprint action below the fold.

Until this review is signed off, treat the Thai as placeholder. The English is
also draft, but carries less risk.

---

## 2. Reprint provenance — investigation result

Two questions, investigated against the code. They have different answers.

### Q1: "Is this job a reprint of another?" — **data exists, frontend is broken**

The API writes the parent id under one key and the web reads a different one:

| | |
|---|---|
| Written by API | `metadata.reprintOfJobId` — `apps/api/src/services/reprint-job.service.ts:71` |
| Read by web | `metadata.isReprintOf` — `apps/web/src/pages/JobDetail.tsx:125, 552, 652` |

`isReprintOf` is **written nowhere in the repository.** Verified across
`apps/`, `packages/`, excluding `node_modules` and `dist` — the only four
occurrences are the four reads in `JobDetail.tsx`.

Consequences in the shipped UI:

- `const isReprint = Boolean(job.metadata?.isReprintOf)` (`JobDetail.tsx:552`)
  is **always `false`**.
- The `↻ REPRINT` header chip (`JobDetail.tsx:561-568`) never renders.
- The "Reprint of →" provenance link (`JobDetail.tsx:649-656`) never renders.
- `page.jobDetail.reprintOf` is translated into both languages
  (`translations.ts:249` EN, `translations.ts:1338` TH) and never displayed.

**No backend dependency.** The fix is a frontend rename to `reprintOfJobId`.
The service also writes `reprintOfRequestId`, `reprintReason`, `requestedBy`
and `confirmedDuplicateRisk` (`reprint-job.service.ts:71-76`) — all currently
unused by the UI, and all genuinely useful on the verdict band. `reprintReason`
in particular answers "why did someone already reprint this?"

### Q2: "Which jobs were created from this one?" — **not answerable. Backend dependency.**

The child→parent edge is stored. The parent→child edge cannot be queried by any
existing path.

**Path A — query jobs by parent. Not available.**

`JobRepositoryPort` (`packages/domain/src/ports/repositories.port.ts:50-68`)
exposes `findById`, `findByRequestId`, `findAll`, `create`, `update`, `claim`.
`findAll` filters on `status` and `printerId` only (line 53). There is no
metadata filter and no parent filter.

**Path B — index the metadata column. Not available.**

`jobs.metadata` is `TEXT NOT NULL DEFAULT '{}'` — an unindexed JSON blob
(`apps/api/src/infra/db/sqlite.schema.ts:132`). The four indexes on `jobs` are
`printer_id`, `status`, `(request_id, source_system)`, and `created_at`
(`sqlite.schema.ts:140-143`). Nothing covers metadata.

**Path C — read it out of the audit log. Not available.**

A `job.reprint_confirmed` audit row is written on every reprint
(`reprint-job.service.ts:79-94`) and does carry `metadata.originalJobId`. But:

- its `resourceId` is the **child** job's id (`resourceId: created.id`, line 84),
  so `GET /audit-logs?resourceId=<original>` returns nothing;
- `AuditRepositoryPort.findAll` filters `resourceType` / `resourceId` /
  `actorId` only (`repositories.port.ts:85`) — no metadata filter;
- `idx_audit_resource` covers `(resource_type, resource_id)`
  (`sqlite.schema.ts:209`), not metadata.

Answering the question through audit today would mean fetching up to
`MAX_AUDIT_LOG_LIMIT` (1000) rows (`audit.routes.ts:10`) and scanning JSON
client-side. That is not a query, and it silently returns wrong answers past the
limit. **It must not be simulated in the frontend.**

### Required backend change

Smallest change that answers the question correctly:

1. **Persist the edge as a column.** Add `reprint_of_job_id TEXT` to `jobs`, via
   the existing `ensureColumn` helper used elsewhere in `sqlite.schema.ts`.
   Backfill is optional — historical jobs keep the metadata copy.
2. **Index it.** `CREATE INDEX IF NOT EXISTS idx_jobs_reprint_of ON jobs(reprint_of_job_id)`.
3. **Extend the port.** Either add `reprintOfJobId` to the `findAll` filter in
   `JobRepositoryPort`, or add an explicit `findReprintsOf(jobId): Promise<Job[]>`.
   The explicit method is preferable — it names the relationship rather than
   leaking a metadata filter into a general list API.
4. **Expose it.** `GET /jobs/:id/reprints`, guarded by `job:read`. Returns the
   child jobs with id, status, copies, `createdAt`, and reprint reason.

Estimated as small: one column, one index, one repository method, one route.
No migration risk — the column is additive and nullable.

### What the UI does with it, once available

The duplicate-risk affordance the redesign wants:

> **This job has already been reprinted twice.**
> `a3f8c1d2` — 14:02, 1 copy — "printer jam, no output"
> `b7e4f9a1` — 14:09, 1 copy — "still nothing"

Placed inside the reprint dialog, above the duplicate-risk acknowledgement, on
an `UNVERIFIED` job. That is the exact moment an operator is about to create a
third label for one patient, and the only moment the information matters.

**Until the endpoint exists, this affordance is not built.** The verdict band,
the tiering, the reprint action move, and the `reprintOfJobId` fix all ship
without it.

---

## 3. Delivery status

| Work | Status |
|---|---|
| Verdict band + verdict classes | **Built** — Thai copy still pending review before release |
| Tier 0/1/2 restructure | **Built** |
| Reprint action moved onto Job Detail | **Built** (`components/ReprintDialog.tsx`) |
| `isReprintOf` → `reprintOfJobId` fix | **Built** |
| Surfacing `reprintReason` / `reprintOfRequestId` | **Built** |
| Reprint permission gate for VIEWER | **Built** (`api/session.tsx`) |
| "Has this been reprinted?" duplicate-risk panel | **Blocked** on `GET /jobs/:id/reprints` |

Implementation notes:

- `lib/jobVerdict.ts` owns the status → verdict decision and holds no copy, so
  wording stays in `translations.ts` where both languages sit side by side.
- An unrecognised status resolves to an *unknown outcome*, never a success —
  covered by `__tests__/jobVerdict.test.ts`.
- The em dash in the three two-part headlines is preceded by ` ` so a wrap
  can never orphan it at the start of a line on a narrow screen.
