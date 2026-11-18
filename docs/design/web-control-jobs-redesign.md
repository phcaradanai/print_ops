# Incoming Jobs (PrintOps Web Control) - redesign

**Status:** implemented and verified (2026-11-17); the layout was fixed by the
Lead, and this document records it and the copy deck.
**Route:** `/control/jobs` (`apps/web/src/pages/WebControlJobs.tsx`).
**Evidence:** `artifacts/browser/web-control-jobs/verification.md`.
**Cinema mode:** the page also has a fullscreen presentation mode, documented
separately in `incoming-jobs-cinema-mode.md` (it does not change this page's
light layout or its filters). It adds three secondary controls to the station
bar: **Columns** (which list columns the page shows), and a framed **Cinema
display** group holding **Display data** (which incoming values the cinema rows
show) and **Cinema mode**. The two cinema controls share a hairline frame and a
light tint because they configure the wall board rather than this list.
**Scope of this change:** this document plus `control.jobs.*` strings in
`apps/web/src/i18n/controlTranslations.ts`. Page code, tests, styles and E2E
specs are changed separately.

## 1. Goal

Give an operator one screen that answers, in order, what came in, where it went,
whether it printed, and what to do next. The page is still PrintOps Web Control,
but the job list is the page: one title, one description, one compact station
bar, one row per job, and a short summary drawer.

The design deliberately removes the previous fleet dashboard: no metric tiles,
no fleet error-breakdown table, no station-directory cards, no payload chips in
rows, no template column, no per-row reprint button, and no wall of filters
above the list.

**Non-goals:** new components, new stylesheets, new colours, a second page frame,
or changes to the `/v1/control/jobs` API contract.

## 2. The four operator questions

| Question | Where the page answers it |
|---|---|
| What came in? | Job reference (`requestId` or `id`), received time, search, date presets, status counts. |
| Where did it go? | Destination printer in every row; station as a secondary line only in All stations; full destination in the drawer and reprint dialog. |
| Did it print? | The literal server status in `StatusBadge`, plus a plain-language verdict for statuses that need review and in the drawer. |
| What do I do next? | Needs-review jobs sort first, the counts show the size of each bucket, empty states name the next action, and the drawer states the next step. Reprint stays behind an explicit, permission-gated confirmation. |

## 3. Final layout

### 3.1 Desktop and tablet (1024px and above; checked at 1440x900 and 1024x768)

The page keeps the existing `PageLayout` frame: `width="full"`, `density="compact"`,
one `h1`, one description, no header action row. The station bar carries the
actions so the header stays one line of text.

1. **Page frame.** `h1` is always `control.jobs.title` ("Incoming Jobs"). The
   description is:
   - All stations: `control.jobs.description`.
   - One station: `control.jobs.stationSubtitle` with `{name}`.
   There are no metric cards, no station cards and no fleet error table.
2. **Station bar (one region).** A single `Panel` with `padding="md"`, laid out
   as two wrapping `Inline` groups in one row:
   - Station selector: `SelectFilter` with `hideLabel`, labelled
     `control.jobs.stationBarLabel`. Options are `control.jobs.allStationsWithCount`
     (`All stations ({count})`) followed by one option per station using
     `control.jobs.stationOption` (`{name} – {count} jobs`). One selection moves
     between JOHN, another station and All stations. The URL keeps the existing
     `?deviceId=` contract: a station selection writes `?deviceId=<id>`, All
     stations removes the parameter. No `deviceId` means All stations.
   - Connection for the current scope: `StatusIndicator` (device-condition dot
     plus text) for one station, using `control.jobs.connectionOnline` or
     `control.jobs.connectionOffline`; for All stations, the same dot plus
     `control.jobs.stationSummary` (`{online} of {total} online`). The dot uses
     the device axis, never a job-status colour.
   - App version, only when one station is selected: muted mono `v{appVersion}`.
   - `Freshness` with `lastSuccessAt`, `stale`, `refreshing` and `onRefresh`.
   - Sync: primary `Button`, busy while syncing. Label is
     `control.jobs.syncAll` for All stations and `control.jobs.syncStation` for
     one station. It calls `POST /v1/control/jobs/sync` and refreshes the feed.
   - `control.jobs.manageDevices`, a secondary `Button` to `/control/devices`.
3. **Status counts.** A `Toolbar` labelled `control.jobs.countsLabel` holding
   34px `Chip` buttons in this order: All, Needs review, In progress, Printed,
   and Other only when its count is above zero. Selected state is `aria-pressed`.
   Counts come from the current station/date/search/payload-filtered set while
   ignoring the status bucket itself, so a count always equals what a click
   shows (section 4). When at least one job needs review and grouping is off,
   `control.jobs.needsReviewFirstHint` sits at the end of the same row, muted.
4. **Search and common dates.** One wrapping `Inline` row directly above the
   list:
   - `SearchField` with `control.jobs.searchLabel` and
     `control.jobs.searchPlaceholder`.
   - Date preset `Chip` buttons: `control.jobs.datePresetAll`,
     `datePresetToday`, `datePreset7d`, `datePreset30d`.
   - Advanced toggle: `Button` with `aria-expanded` and `aria-controls`. Label is
     `control.jobs.advancedFilters` when nothing advanced is active,
     `control.jobs.hideAdvancedFilters` when the panel is open, and
     `control.jobs.advancedFiltersWithCount` when advanced conditions are active.
5. **Advanced panel.** When open, a compact `Panel` (`tone="subtle"`,
   `padding="md"`) sits above the active conditions. It contains only:
   - Custom `From` / `To` date inputs (`control.jobs.dateFromLabel`,
     `dateToLabel`). Choosing a preset clears these; entering a custom date
     clears the preset.
   - Grouping (`control.jobs.groupByLabel`) with the existing options
     (`groupNone`, `groupDate`, `groupStatus`, `groupTemplate`, `groupPrinter`,
     `groupSource`, `groupKeyPrefix`).
   - Payload key/value filters, reusing the current key select, value select,
     free-text value and `addKeyFilter` control.
   Visible heading `control.jobs.advancedTitle`; one-line description
   `control.jobs.advancedHint`.
6. **Active conditions.** Directly above the results, a `Toolbar` labelled
   `control.jobs.activeFiltersLabel`, with a visible muted label of the same
   text, one removable `Chip` per active condition, and a `clearAllFilters`
   `Button` at the end. Shown only when at least one condition is active. Every
   condition is visible; none is hidden in the advanced panel.
   - Search: `filterSearch({ value })`.
   - Status bucket: `filterStatus({ value })`, using the chip label.
   - Date: `filterDate({ value })`; a custom range nests
     `filterDateRange({ from, to })` inside it.
   - Grouping: `filterGroup({ value })`.
   - Each payload filter: `filterKey({ key, value })`.
   - Remove label: `removeFilter({ filter })`; the chip's accessible name
     includes the condition, e.g. "Remove Search: 123456".
7. **Selection bar.** Only in one-station view, only with `job:retry`, and only
   while something is selected. Shows `selectedCount`, `clearSelection` and
   `reprintSelected` (existing keys). Selection is limited to rows visible under
   the current conditions; changing a filter prunes it.
8. **List.** One `DataTable` with `responsive`, inside a `Panel`
   `padding="none"`. Columns: Job, Destination, Status, Received, Actions.
   - Job: `requestId` or `id` in mono, wrapped, never truncated. No payload
     chips, no copies badge, no reprint badge.
   - Destination: `printerCode` or `printerId`. In All stations, a second muted
     line names the station. The row stays one compact block.
   - Status: `StatusBadge size="sm"` with the literal status, plus a
     plain-language verdict line for `FAILED`, `UNVERIFIED`, `TIMEOUT` and an
     unrecognised status. The verdict line is neutral text, wraps, and never
     replaces the badge.
   - Received: `formatCreatedAt(createdAt)` in muted text; the element is
     labelled `control.jobs.receivedLabel`.
   - Actions: one secondary `Button`, `control.jobs.viewJob`, opening the drawer.
   - Selection checkbox: first column only in one-station view with
     `job:retry`. The header checkbox selects the rows currently shown; grouped
     mode keeps a per-group select-all. The checkbox is narrow, with a hidden
     label (`selectJobRow` / `selectAllGroup`).
   Jobs that need review sort first in the flat list, then received newest
   first. Grouped mode keeps group order; rows inside a group use the same
   attention-first, newest-first order.
9. **Empty state.** The table is replaced by `EmptyState` when nothing shows:
   - No jobs in scope (no filters needed): `emptyNoJobsTitle`,
     `emptyNoJobsHint`, action Sync (`syncStation` for one station,
     `syncAll` for All stations).
   - Jobs exist in scope but the conditions exclude them: `emptyNoMatchTitle`,
     `emptyNoMatchHint`, action `clearAllFilters`.
10. **Drawer.** Opened by View job: **50vw on desktop** (720px at 1440px) and
    full width at 1024px and below, with `control.jobs.detailTitle` as its title:
    - Summary: reference in mono; `CardDetail` with destination
      (`destinationOnStation`), status (`StatusBadge`), received
      (`detailReceived`) and copies (`detailCopies`).
    - What happened: `detailWhatHappened` label, then the verdict headline from
      `page.jobDetail.verdict.<copyKey>.headline`.
    - Next step: `detailNextStep` label, then the verdict detail from
      `page.jobDetail.verdict.<copyKey>.detail`. That string is already written
      to answer "what do I do?", so it is reused verbatim.
    - Unconfirmed callout: an `Alert tone="warning"` with
      `detailUnconfirmedTitle` and `detailUnconfirmedBody` whenever the verdict
      has `outcomeUnknown` (`UNVERIFIED`, `TIMEOUT`, and an unrecognised
      status).
    - `CollapsibleSection` "Incoming data" (`detailIncomingData`,
      `defaultOpen={false}`): key/value pairs from `extractJobPayload`, values
      wrapped mono. `detailNoIncoming` when empty.
    - `CollapsibleSection` "Technical details" (`detailTechnical`,
      `defaultOpen={false}`): job ID, request ID, source, template, paper
      profile, printer, runner, error code, error message, timestamps, raw JSON
      and any mirrored error log. Timestamps use the existing
      `page.jobDetail.created`, `.finished`, `.updated`, `.received` and
      `.started` labels with full ISO values, so no new timestamp keys are
      needed. Each value is copyable with `detailCopy` / `detailCopied` and an
      accessible `detailCopyField({ field })` label. Long values wrap inside the
      panel. Raw JSON uses `CodeBlock scroll={false}`. `detailNoTechnical` when
      there is nothing to show; `detailNoLogs` when no log is mirrored.
    - Footer: Close, and Reprint when `job:retry` is permitted.
11. **Reprint dialog.** Existing `Dialog`, opened from the drawer or the batch
    bar, never from a row. It keeps the reason field, the explicit confirmation
    checkbox, the copies field, cancel closing without sending, and a busy
    submit. It identifies the destination with `detailDestination` and
    `destinationOnStation` for every target (batch lists the distinct
    destinations). Title is `reprintDialogTitle({ name })` in one-station view
    and `reprintDialogTitleGeneric` in All stations. Warning:
    - Any target with an unknown outcome: `reprintUnconfirmedWarning`.
    - Otherwise, any target that already printed: `reprintDuplicateWarning`.
    The confirmation label stays `reprintConfirmDuplicateLabel`. Cancel closes
    without a request.

**Vertical budget (1024x768, default state, no active conditions).** This is a
layout budget to protect the acceptance target, not a set of measured CSS
values: topbar 56 + main padding 16 + page header about 100 + region gap 16 +
station bar 58 + section gap 16 + count chips 34 + gap 12 + search row 34 + gap
12 + table head 40 = about 394px before the first row, which ends around 442px.
At 1440x900 the station bar stays on one line, so the first row starts no lower.
An open advanced panel or active-condition row adds 40 to 80px; even then the
first row remains above the 768px fold. Verify in the rendered app, in both
languages, at both target sizes.

### 3.3 Column picker (2026-11-18)

The five-column row above is the shipped default, not a hard constraint. A
**Columns** control in the station bar opens a picker for the optional columns:
the job reference, Destination, Station, Received, Copies, Template, Source,
Runner, Error code, and **any incoming payload key** in the current scope.
Defaults stay reference + Destination + Received, so the page looks unchanged
until someone opts in, which also keeps the "no template column" decision above
intact by default.

- **Only Status and Actions are fixed.** A row without its verdict or a way into
  the drawer is not a row. The job reference is optional: sites that do not need
  it drop the column and read the incoming values instead.
- **Canonical job-field order.** Optional job fields render in a fixed order
  between Status and Actions, never in click order, so toggling cannot reshuffle
  the table.
- **Incoming-value columns** keep the order they were added, sit after the job
  fields and before Actions, and are capped at three: the table is not a payload
  browser, and the drawer still shows every key. Each key is offered with a
  sample value and the number of jobs that carry it, from the same
  `extractJobPayload` projection the drawer uses.
- **A key that leaves the scope stays selected** (rendering em dashes, listed
  first in the picker) instead of silently disappearing from the table.
- **Station duplication.** When All stations shows the station under the printer
  in the Destination cell, adding the Station column removes that second line
  instead of printing it twice.
- **Empty values.** An optional column with no value renders an em dash, not a
  blank cell; a long incoming value is clamped to two lines with the full value
  in the title.
- **Widths are arranged live.** Dragging a header divider grows one column and
  takes the same width from its right neighbour, so the table keeps its total
  width and never overflows. Arrow keys nudge by 16px, Home/Delete or a
  double-click resets a column. Widths are session state and are never
  persisted: the operator arranges the table and sees the result immediately.
  Below 768px the table is a stack of record cards, so the handles disappear.
- **Persistence.** Column visibility is a workstation preference stored in
  `localStorage` (`printops-control-jobs-columns`), like the locale. It is not a
  filter, so it never enters the URL; unreadable or unknown stored ids fall back
  to the shipped default, while valid payload column ids survive.

### 3.2 390px

No horizontal page overflow and no nested content scrollbars. The page stacks in
this order:

1. Header: `h1` (21.6px at 390), then the description. No header actions.
2. Station bar: selector on its own full-width row; below it, a wrapping line
   with connection, app version and freshness; below that, Sync and Manage
   devices as full-width buttons in a two-row stack. Still one region.
3. Count chips: wrap onto as many lines as needed; no horizontal scroller.
4. Search field full width; date preset chips wrap; Advanced toggle full width
   so its expanded state is unambiguous.
5. Advanced panel: one field per row; From and To each full width, grouping full
   width, key/value filters stacked.
6. Active conditions: label on its own line, chips wrap, Clear all on its own
   line.
7. List: the responsive `DataTable` turns each row into a record card at 768px
   and below. Each card keeps the same information in the same order: Job,
   Destination, Status (with verdict), Received, then a full-width View job
   action. The selection checkbox, when permitted, sits at the top of the card.
8. Drawer: full width; its body scrolls vertically over the page (the overlay's
   own scroll, not a nested list scrollbar). Technical values wrap; the raw JSON
   block has no inner scrollbar.

## 4. Status buckets

The counts are computed after the station, date, search and payload filters, and
before the status bucket. That is the rule that keeps a count equal to the rows a
click shows.

```text
base          = jobs in scope filtered by date + search + payload filters
countAll      = base.length
needsReview   = base.filter(job => jobNeedsAttention(job.status)).length
inProgress    = base.filter(job => ACTIVE.has(job.status)).length
printed       = base.filter(job => job.status === 'SUCCESS').length
other         = countAll - needsReview - inProgress - printed
```

| Bucket | Definition | Notes |
|---|---|---|
| All | Every job in `base`. | Never hides a job. |
| Needs review | `jobNeedsAttention(status)` is true: verdict tone `caution` or `negative`, i.e. `FAILED`, `UNVERIFIED`, `TIMEOUT`, and any status this build does not recognise. | One definition, shared with the rest of the UI through `jobVerdict.ts`. |
| In progress | `ACCEPTED`, `VALIDATED`, `QUEUED`, `DISPATCHED`, `PRINTING`. | Matches the active-queue set in `jobPayload.ts`. |
| Printed | `SUCCESS`. | Status-based bucket. The detail verdict does not claim device confirmation (section 5). |
| Other | The remainder: currently `CANCELLED` and `DUPLICATE_RETURNED`. | Rendered only when the count is above zero. Unknown statuses belong to Needs review, not Other. |

Clicking a bucket filters to exactly those rows; clicking the selected bucket
returns to All. Counts do not change when the bucket changes.

**Sort order (flat list):** attention first, then received newest first, then
`id` for a stable tie-break. In grouped mode, groups keep the order produced by
`filterAndGroupJobs`; rows inside each group follow the same attention-first,
newest-first rule. `needsReviewFirstHint` is shown only in the flat list.

## 5. Plain-language mapping

The literal status always stays visible in `StatusBadge`. The verdict is
additional text, never a replacement. The verdict keys are the existing
`page.jobDetail.verdict.*` strings; no new verdict keys are introduced.

| Status | Bucket | Verdict key (`page.jobDetail.verdict.*`) | EN headline | TH headline | Row verdict |
|---|---|---|---|---|---|
| `ACCEPTED` | In progress | `waiting` | Not printed yet | ยังไม่ได้พิมพ์ | no |
| `VALIDATED` | In progress | `waiting` | Not printed yet | ยังไม่ได้พิมพ์ | no |
| `QUEUED` | In progress | `waiting` | Not printed yet | ยังไม่ได้พิมพ์ | no |
| `DISPATCHED` | In progress | `sent` | Sent to the printer | ส่งไปยังเครื่องพิมพ์แล้ว | no |
| `PRINTING` | In progress | `printing` | Printing now | กำลังพิมพ์ | no |
| `SUCCESS` | Printed | `reportedComplete` (see note) | Reported complete - unconfirmed | รายงานว่าเสร็จสิ้น - ยังไม่ยืนยัน | no |
| `UNVERIFIED` | Needs review | `unverified` | May have printed - not verified | อาจพิมพ์ออกมาแล้ว - ยืนยันไม่ได้ | yes |
| `TIMEOUT` | Needs review | `timeout` | No response - may have printed | ไม่มีการตอบกลับ - อาจพิมพ์ออกมาแล้ว | yes |
| `FAILED` | Needs review | `failed` | Did not print | ไม่ได้พิมพ์ | yes |
| `CANCELLED` | Other | `cancelled` | Cancelled | ยกเลิกแล้ว | no |
| `DUPLICATE_RETURNED` | Other | `duplicate` | Not printed - duplicate request | ไม่ได้พิมพ์ - คำขอซ้ำ | no |
| any unrecognised string | Needs review | `unknown` | Outcome unknown | ไม่ทราบผลลัพธ์ | yes |

The EN/TH headline cells above are paraphrases of the existing strings, with the
existing em dash shown as a hyphen here. The shipped strings are unchanged and
keep their original punctuation.

**SUCCESS in the drawer.** Use `REPORTED_COMPLETE_COPY` from `jobVerdict.ts`,
not the `printed` verdict. The control feed carries no `printEvidence`, so the
drawer may say "reported complete" but must not claim a device confirmed the
page. The status badge still reads `SUCCESS`, and the bucket still reads
"Printed" because it counts the status. This is the existing rule for queue
lists and drawers, not a new one.

**What happened / Next step.** The drawer shows the verdict headline under
"What happened" and the verdict detail under "Next step". The detail string is
the part written to answer "what do I do?", so it is not duplicated elsewhere.
The unconfirmed callout is the only additional explanation for
`UNVERIFIED`/`TIMEOUT`/unknown.

## 6. Component choices

| Region | Component | Contract |
|---|---|---|
| Page frame | `PageLayout` | `width="full"`, `density="compact"`, title + description only. One `h1`; no header actions. |
| Station bar | `Panel` + `Inline`, `SelectFilter`, `StatusIndicator`, `Freshness`, `Button` | One region, `padding="md"`, wrapping inline groups. No new component. |
| Counts / filters | `Toolbar`, `Chip`, `Button` | Chips are 34px (`--control-height-compact`) and use `aria-pressed`. |
| Search | `SearchField` | Labelled; placeholder is `searchPlaceholder`. |
| List | `DataTable`, `DataHead`, `DataCell`, `Panel padding="none"` | `responsive`; becomes record cards at 768px and below. |
| Status | `StatusBadge` | Literal status, soft pill, verdict icon, never colour alone. |
| Verdict | `Text` | Plain sentence, wraps, neutral tone; badge carries the status colour. |
| Detail | `Drawer`, `CardDetail`, `CollapsibleSection`, `CodeBlock`, `Alert`, `Button` | Summary first; evidence collapsed. `CodeBlock scroll={false}`. |
| Empty / error | `EmptyState`, `LoadingState`, `ErrorState`, `ErrorBanner`, `Freshness` | No hand-rolled state panels. |
| Reprint | `Dialog`, `FormField`, `Input`, `Checkbox`, `Button` | Existing dialog pattern; no new overlay. |

Rules: no literal hex, no new stylesheet, no new global override, no uppercase
or letter-spacing on localisable text, no ellipsis on identifiers, and every flex
or grid child keeps `min-width: 0`. The station bar and list must not introduce
a second page frame.

## 7. States, empty, loading and permissions

| State | Behaviour |
|---|---|
| First load | Page header renders immediately; the content region shows `LoadingState`. The station bar appears with the feed. |
| Background refresh (5s) | Keep the rows; `Freshness` states when the data was last true. A failed refresh keeps the old rows and adds `ErrorBanner` with retry. |
| Load failed, no data | `ErrorState` with `control.jobs.loadFailed` and retry. |
| `?deviceId` not found | `EmptyState` with `control.jobs.stationNotFound({ id })` and a `backToOverview` action. |
| No jobs in scope | `emptyNoJobsTitle` + `emptyNoJobsHint` + Sync. |
| Filters exclude everything | `emptyNoMatchTitle` + `emptyNoMatchHint` + `clearAllFilters`. |
| Sync success / failure | Dismissible `Alert`, `syncSuccess` / `syncFailed({ message })`. The list is not blanked. |
| `job:retry` absent | No selection checkbox, no batch bar, no Reprint in the drawer. View job remains. |
| `control:manage` absent | No rename control anywhere. Rename stays on the Manage devices route and remains gated there. This compact bar does not add a rename button. |
| Reprint cancel | Closes with no request. Backdrop dismissal stays off. |
| Reprint submit | Disabled until a reason and the confirmation checkbox are present. Busy state uses `reprintSubmitting`. Max copies 20. |
| Copy | `navigator.clipboard` with the existing textarea fallback; button flips to `detailCopied` for about two seconds and the change is announced politely. |
| Raw keys | Never. Every literal `t('control.jobs.…')` string in the page must exist in both locales; verdict keys come from the closed `jobVerdict.ts` table. |

## 8. Copy rules

- Plain, direct, non-alarmist. State what happened and what the operator can do.
- Sentence case. No uppercase-only treatments for localisable text. The literal
  job status stays uppercase because it is the server's string.
- No em dash in new copy; use an ASCII hyphen or an en dash. Interpolation
  examples use `{name}`, `{count}`, `{online}`, `{total}`, `{value}`, `{from}`,
  `{to}`, `{key}`, `{filter}`, `{field}`, `{printer}` and `{station}`.
- Thai is written as Thai, not word-for-word English. Placeholders keep the same
  names and the same meaning in both locales.
- Interpolation uses the existing `formatMsg` string replacement, not ICU. Each
  placeholder is a whole token, and no sentence depends on English word order.
- The words "Needs review", "In progress", "Printed" and "Other" are the bucket
  labels everywhere. Do not call the bucket "Needs attention" on this page.

## 9. Acceptance checklist

- [x] At 1440x900 and 1024x768, in both TH and EN, the Needs review count and the
      first job row are visible without scrolling.
- [x] The station bar is one compact region containing selector + connection +
      Sync. JOHN, another station and All stations are each one selection away.
      `?deviceId` still selects a station; no parameter means All stations.
- [x] Rows contain only reference, destination, status, received and View job,
      plus the permitted selection checkbox. No payload chips, template column,
      error text or per-row reprint.
- [x] Search and date presets sit above the list. Custom dates, grouping and
      payload filters sit behind Advanced filters. Every active condition is
      visible and removable on its own, and Clear all is present.
- [x] Details open on a short summary. Incoming data and Technical details are
      collapsed by default. Full IDs, error code/message, timestamps and raw
      JSON are visible and copyable, and long values wrap.
- [x] `UNVERIFIED` (and `TIMEOUT`) details explain that output is unconfirmed and
      tell the operator to check the destination printer before reprinting.
      Reprint still requires reason + explicit confirmation.
- [x] No raw i18n key can render. Every new key exists in EN and TH.
- [x] No horizontal page overflow and no nested content scrollbars at 390px, in
      both languages.
- [x] `npm run test -w apps/web -- src/__tests__/i18n.test.ts` passes.

## 10. Key deck

### 10.1 Existing keys whose copy changes (13)

| Key | EN | TH | Why |
|---|---|---|---|
| `control.jobs.title` | Incoming Jobs | งานที่เข้ามา | One `h1` for the redesigned page. |
| `control.jobs.description` | Jobs that arrived at your PrintOps stations, the printer each one went to, and what needs review first. | งานที่เข้ามายังเครื่อง PrintOps ปลายทางที่พิมพ์ และรายการที่ควรตรวจสอบก่อน | What came in, where it went, what to do next. |
| `control.jobs.stationSubtitle` | Jobs received by {name}, where they were sent, and what needs review first. | งานที่ {name} รับเข้ามา ปลายทางการพิมพ์ และรายการที่ควรตรวจสอบก่อน | Same sentence for one station. |
| `control.jobs.searchLabel` | Search jobs | ค้นหางาน | Plain search label. |
| `control.jobs.searchPlaceholder` | Job reference, printer, or payload value | รหัสงาน เครื่องพิมพ์ หรือค่าที่ส่งเข้ามา | Matches what search actually matches. |
| `control.jobs.noJobs` | No jobs match these filters | ไม่พบงานที่ตรงกับตัวกรองนี้ | Empty-state title retained for compatibility. |
| `control.jobs.noJobsHint` | Remove a filter or widen the date range to see more jobs. | ลบตัวกรองออกหนึ่งรายการ หรือขยายช่วงวันที่ เพื่อดูงานเพิ่มเติม | Names the next action. |
| `control.jobs.viewPayload` | View job | ดูงาน | Key kept; copy aligned with `viewJob`. |
| `control.jobs.reprintDuplicateWarning` | One or more of these jobs already printed. Check the destination printer, then confirm below only if another label is really needed. | งานอย่างน้อยหนึ่งรายการพิมพ์ออกมาแล้ว ตรวจสอบที่เครื่องพิมพ์ปลายทาง แล้วยืนยันด้านล่างเฉพาะเมื่อจำเป็นต้องได้สติกเกอร์อีกใบจริง ๆ | Plain duplicate warning. |
| `control.jobs.syncAll` | Sync all | ซิงค์ทั้งหมด | Matches the station-bar action. |
| `control.jobs.syncStation` | Sync this station | ซิงค์เครื่องนี้ | Matches the station-bar action. |
| `control.jobs.colStatus` | Status | สถานะ | Rows no longer carry an error column, so "Status & Error" would lie. |
| `control.jobs.reprint` | Reprint | พิมพ์ซ้ำ | Plain-language verb for the drawer action. |

### 10.2 New keys (67)

#### Station bar (7)

| Key | EN | TH | Where |
|---|---|---|---|
| `control.jobs.stationBarLabel` | Station and connection | เครื่องและสถานะการเชื่อมต่อ | Accessible name of the station-bar region and the station selector. |
| `control.jobs.allStations` | All stations | ทุกสถานี | Plain scope label, and the selector fallback while counts are unavailable. |
| `control.jobs.allStationsWithCount` | All stations ({count}) | ทุกสถานี ({count}) | Normal All stations option in the selector. |
| `control.jobs.stationOption` | {name} – {count} jobs | {name} – {count} งาน | One station option in the selector. |
| `control.jobs.stationSummary` | {online} of {total} online | ออนไลน์ {online} จาก {total} เครื่อง | Connection line in All stations. |
| `control.jobs.connectionOnline` | Online | ออนไลน์ | Connection text for one station. |
| `control.jobs.connectionOffline` | Offline | ออฟไลน์ | Connection text for one station. |

#### Status counts (6)

| Key | EN | TH | Where |
|---|---|---|---|
| `control.jobs.countsLabel` | Filter by status | กรองตามสถานะ | Accessible name of the count toolbar. |
| `control.jobs.countAll` | All | ทั้งหมด | First count chip. |
| `control.jobs.countNeedsReview` | Needs review | ต้องตรวจสอบ | Attention bucket chip. |
| `control.jobs.countInProgress` | In progress | กำลังดำเนินการ | Active-queue bucket chip. |
| `control.jobs.countPrinted` | Printed | พิมพ์แล้ว | Success bucket chip. |
| `control.jobs.countOther` | Other | อื่น ๆ | Remainder chip; rendered only when above zero. |

#### Filters and conditions (14)

| Key | EN | TH | Where |
|---|---|---|---|
| `control.jobs.advancedFilters` | Advanced filters | ตัวกรองขั้นสูง | Toggle label when no advanced condition is active. |
| `control.jobs.hideAdvancedFilters` | Hide advanced filters | ซ่อนตัวกรองขั้นสูง | Toggle label while the panel is open. |
| `control.jobs.advancedFiltersWithCount` | Advanced filters ({count}) | ตัวกรองขั้นสูง ({count}) | Toggle label when advanced conditions are active. |
| `control.jobs.advancedTitle` | Advanced filters | ตัวกรองขั้นสูง | Panel heading. |
| `control.jobs.advancedHint` | Narrow the list by custom dates, grouping, or a payload key. | จำกัดรายการด้วยช่วงวันที่กำหนดเอง การจัดกลุ่ม หรือคีย์ข้อมูลที่ส่งเข้ามา | Panel description. |
| `control.jobs.activeFiltersLabel` | Active filters | ตัวกรองที่ใช้อยู่ | Visible label and accessible name of the active-conditions toolbar. |
| `control.jobs.removeFilter` | Remove {filter} | ลบตัวกรอง {filter} | Accessible name of each removable condition chip. |
| `control.jobs.filterSearch` | Search: "{value}" | ค้นหา: "{value}" | Search condition chip. |
| `control.jobs.filterStatus` | Status: {value} | สถานะ: {value} | Status bucket condition chip. |
| `control.jobs.filterDate` | Date: {value} | วันที่: {value} | Date preset condition chip. |
| `control.jobs.filterDateRange` | {from} – {to} | {from} – {to} | Nested value inside `filterDate` for a custom range. |
| `control.jobs.filterGroup` | Grouped by {value} | จัดกลุ่มตาม {value} | Grouping condition chip. |
| `control.jobs.filterKey` | {key} = {value} | {key} = {value} | One chip per payload key filter. |
| `control.jobs.clearAllFilters` | Clear all | ล้างทั้งหมด | Removes every condition. |

#### List (6)

| Key | EN | TH | Where |
|---|---|---|---|
| `control.jobs.colJob` | Job | งาน | Job column header. |
| `control.jobs.colDestination` | Destination | ปลายทาง | Destination column header. |
| `control.jobs.colReceived` | Received | เวลารับ | Received column header. |
| `control.jobs.receivedLabel` | Received | เวลารับ | Inline label for the received time in compact and mobile presentation. |
| `control.jobs.viewJob` | View job | ดูงาน | The row action. |
| `control.jobs.destinationOnStation` | {printer} on {station} | {printer} ที่ {station} | Destination in the drawer and reprint dialog. |

#### Detail (27)

| Key | EN | TH | Where |
|---|---|---|---|
| `control.jobs.detailTitle` | Job summary | สรุปงาน | Drawer title. |
| `control.jobs.detailWhatHappened` | What happened | เกิดอะไรขึ้น | Verdict headline label. |
| `control.jobs.detailNextStep` | Next step | ขั้นตอนถัดไป | Verdict detail label. |
| `control.jobs.detailDestination` | Destination | ปลายทาง | Summary field and reprint destination label. |
| `control.jobs.detailReceived` | Received | เวลารับ | Summary field. |
| `control.jobs.detailCopies` | Copies | จำนวนชุด | Summary field. |
| `control.jobs.detailIncomingData` | Incoming data | ข้อมูลที่ส่งเข้ามา | First collapsed section. |
| `control.jobs.detailTechnical` | Technical details | รายละเอียดทางเทคนิค | Second collapsed section. |
| `control.jobs.detailJobId` | Job ID | รหัสงาน | Technical field. |
| `control.jobs.detailRequestId` | Request ID | รหัสคำขอ | Technical field. |
| `control.jobs.detailSource` | Source | ต้นทาง | Technical field. |
| `control.jobs.detailTemplate` | Template | เทมเพลต | Technical field. |
| `control.jobs.detailPaperProfile` | Paper profile | โปรไฟล์กระดาษ | Technical field. |
| `control.jobs.detailPrinter` | Printer | เครื่องพิมพ์ | Technical field. |
| `control.jobs.detailRunner` | Runner | ตัวรับงาน | Technical field. |
| `control.jobs.detailErrorCode` | Error code | รหัสข้อผิดพลาด | Technical field. |
| `control.jobs.detailErrorMessage` | Error message | ข้อความข้อผิดพลาด | Technical field. |
| `control.jobs.detailRawJson` | Raw JSON | JSON ดิบ | Raw payload block label. |
| `control.jobs.detailLogs` | Error log | บันทึกข้อผิดพลาด | Mirrored log label. |
| `control.jobs.detailNoLogs` | No error log recorded for this job. | ไม่มีบันทึกข้อผิดพลาดสำหรับงานนี้ | Empty log state. |
| `control.jobs.detailNoIncoming` | No incoming data recorded for this job. | ไม่มีข้อมูลที่ส่งเข้ามาสำหรับงานนี้ | Empty incoming-data state. |
| `control.jobs.detailNoTechnical` | No technical details recorded for this job. | ไม่มีรายละเอียดทางเทคนิคสำหรับงานนี้ | Empty technical state. |
| `control.jobs.detailCopy` | Copy | คัดลอก | Copy button. |
| `control.jobs.detailCopied` | Copied | คัดลอกแล้ว | Copy confirmation. |
| `control.jobs.detailCopyField` | Copy {field} | คัดลอก {field} | Accessible name of a field copy button. |
| `control.jobs.detailUnconfirmedTitle` | Print output is unconfirmed | ยังไม่ยืนยันผลการพิมพ์ | Drawer callout title. |
| `control.jobs.detailUnconfirmedBody` | Check whether a copy already came out at the destination printer before reprinting. | ตรวจสอบว่ามีสติกเกอร์ออกมาที่เครื่องพิมพ์ปลายทางแล้วหรือไม่ ก่อนสั่งพิมพ์ซ้ำ | Drawer callout body. |

#### Empty, reprint and sort hint (7)

| Key | EN | TH | Where |
|---|---|---|---|
| `control.jobs.emptyNoJobsTitle` | No jobs yet | ยังไม่มีงาน | No jobs in scope. |
| `control.jobs.emptyNoJobsHint` | Jobs appear here after a station receives them. If you expect a job, sync the station. | งานจะแสดงที่นี่เมื่อเครื่องได้รับงาน หากคาดว่ามีงานเข้ามา ให้ซิงค์เครื่อง | No jobs in scope. |
| `control.jobs.emptyNoMatchTitle` | No jobs match these filters | ไม่พบงานที่ตรงกับตัวกรองนี้ | Filters exclude everything. |
| `control.jobs.emptyNoMatchHint` | Remove a filter or widen the date range. | ลบตัวกรองออกหนึ่งรายการ หรือขยายช่วงวันที่ | Filters exclude everything. |
| `control.jobs.reprintUnconfirmedWarning` | Print output is unconfirmed. A copy may have already come out. Check the destination printer before you confirm. | ยังไม่ยืนยันผลการพิมพ์ อาจมีสติกเกอร์ออกมาแล้ว ตรวจสอบที่เครื่องพิมพ์ปลายทางก่อนยืนยัน | Reprint dialog when an outcome is unknown. |
| `control.jobs.reprintDialogTitleGeneric` | Reprint job | พิมพ์งานซ้ำ | Reprint title in All stations, where no station scopes the action. |
| `control.jobs.needsReviewFirstHint` | Jobs that need review are shown first. | งานที่ต้องตรวจสอบจะแสดงก่อน | Flat list with at least one attention job. |

No keys were added beyond this list. `control.jobs.viewPayload` is retained
(updated in 10.1) so existing call sites cannot render a raw key; new code uses
`viewJob`. Technical timestamps reuse the existing `page.jobDetail.created`,
`.finished`, `.updated`, `.received` and `.started` labels, so they add no
`control.jobs.*` keys.

## 11. Notes and decisions

1. **SUCCESS does not claim confirmation.** The drawer uses
   `REPORTED_COMPLETE_COPY`; the list bucket is still "Printed" because it
   counts the server status. This mirrors the existing queue/drawer rule and
   avoids claiming device evidence the control feed does not carry.
2. **Rename lives on Manage devices.** The fixed station-bar contents do not
   include a rename button, so this page does not add one. The rename flow and
   its `control:manage` gate remain on the devices route.
3. **Unknown statuses are treated as unknown outcomes.** They land in Needs
   review, get the `unknown` verdict and the same unconfirmed callout as
   `UNVERIFIED`/`TIMEOUT`, because the app cannot say whether paper moved.
4. **The mirrored error log is optional.** `/v1/control/jobs` currently returns
   no dedicated log field. The drawer renders `detailLogs` only when the feed
   supplies a log string or array; otherwise it shows `detailNoLogs`. The raw
   JSON block is always available.
5. **The `deviceId` URL parameter is the only URL state.** Search, dates,
   grouping and payload filters stay in component state and reset when the
   station scope changes, so a URL never implies a hidden filter.
