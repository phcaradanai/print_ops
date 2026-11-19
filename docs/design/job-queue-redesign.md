# Job Queue (PrintOps Station) - Incoming Jobs parity redesign

**Status:** implemented in this change; layout fixed by the Lead, copy deck below.
**Route:** `/jobs` (`apps/web/src/pages/JobQueue.tsx`).
**Reference page:** `/control/jobs` (`apps/web/src/pages/WebControlJobs.tsx`), documented in
`web-control-jobs-redesign.md` and `incoming-jobs-cinema-mode.md`.
**Scope of this change:** `apps/web` only. The list UI that both pages now share lives in
`features/job-list/` and `features/cinema/`.

## 1. Goal

The station operator and the control-plane operator should read the same page: same frame,
same counts, same filters, same row, same drawer. The only difference is **scope**: the station
shows *its own* jobs and nothing else, because a station is not the system of record and has
never known about another station's work.

Re-implementing the Web Control list for the dashboard would have produced a second definition
of the same row, the same verdict vocabulary and the same bucket arithmetic, which is exactly
how the two views would drift. So the list is one implementation
(`features/job-list/`, `features/cinema/`) and the two pages differ in what they fetch and
which controls they offer.

**Non-goals:** a new component library, a new palette, a second page frame, or any change to
`/control/jobs`.

## 2. What the station keeps from Incoming Jobs

| Region | Contract |
|---|---|
| Page frame | `PageLayout` `width="full"` `density="compact"`, one `h1` + one description, **no header action row**. Actions live in the scope bar. |
| Scope bar | One `Panel padding="md"` with a wrapping `Inline`: job count, `Freshness` (last success, stale, refreshing, paused, manual refresh), `Export CSV`, `Columns`, and the framed cinema group (`Display data`, `Cinema mode`). |
| Counts | `Toolbar` of 34px `Chip` buttons in the order All, Needs review, In progress, Printed, and Other only when its count is above zero. `aria-pressed` carries selection. Counts are computed after search/date/payload filters and before the bucket, so a count always equals what a click shows. |
| Sort | Compact `SelectFilter` with Needs review first (default), Newest first, Oldest first. |
| Search | `SearchField` with `key = value` support, plus date preset chips and an Advanced filters toggle. |
| Advanced panel | Exact status, custom From/To dates, grouping, "search technical details" switch, and incoming-key filters with value suggestions. Hidden behind the toggle. |
| Active conditions | A `Toolbar` of removable chips, one per condition, plus `Clear all`. |
| Selection | Pinned `SelectionBar` at the viewport bottom, with a measured spacer so it never covers the last row or the pagination. |
| List | `DataTable` + `JobTable` with column picker, pointer/keyboard column resizing, incoming-value columns, grouped rendering, and `Pagination` at 50 rows per page. Record cards below 768px. |
| Row | Job reference, destination, status, received, and one View action. Payload chips, template column, error text and per-row reprint are **not** row content; they are columns you can switch on and a drawer you can open. |
| Drawer | Short answer first (`JobDetailDrawer`): reference, destination, status, received, copies, then What happened / Next step, then collapsed Incoming data and Technical details with copy affordances. |
| Empty / loading / error | `EmptyState`, `LoadingState`, `ErrorState`, `ErrorBanner`, `Freshness`. No hand-rolled state panels. |
| Cinema mode | `?cinema=1` fullscreen board with the same display-data dialog, label width and optional panels. |

## 3. What the station deliberately does not have

| Fleet concept | Why it is absent | Station replacement |
|---|---|---|
| Station selector / "All stations" | A station has exactly one scope. | The page description states the scope. |
| Station column | Every row is this station. | Column excluded from the picker via `visibleJobColumns(selection, ['station'])`. |
| Station connection, app version | The operator is standing at the station. | `Freshness` still reports feed health. |
| Sync stations, Manage devices | There is nothing to sync from here. | `Freshness` refresh. |
| Reviewed / acknowledged outcomes, Reviewed-only filter, Outcome filter | `reviewed_at` is a control-plane triage column (`control_device_jobs`); the station has no such storage and must not pretend to. | Verdict + the unconfirmed-output warning stay; the drawer's review buttons are switched off with `canReview={false}`. |
| `POST /control/...` reprint | Wrong API surface for a station. | `POST /jobs/:id/reprint`, unchanged, with the runner/request safety gates. |

## 4. Layout

### 4.1 Desktop and tablet (1024px and above; verified at 1440x900 and 1024x768)

1. Page frame: `h1` = `page.jobQueue.title` ("Job Queue" / "คิวงาน"), description =
   `page.jobQueue.subtitle` ("Every print job this station has accepted" / "งานพิมพ์ทุกงานที่เครื่องนี้รับเข้า").
2. The physical-output warning `Alert` (`page.jobQueue.physicalOutputWarning`) stays directly
   under the header: it is the one thing an operator must read before reprinting.
3. Truncation warning when the feed is at its 1,000-row cap (`page.jobQueue.truncatedTitle` /
   `truncatedDetail`).
4. One scope bar (see section 2).
5. Counts, then sort + search + date presets + advanced toggle, then the hidden-match hint,
   then the advanced panel, then the active-conditions toolbar.
6. The list, then pagination. The selection bar floats above both once a row is checked.

### 4.2 390px

Identical to Incoming Jobs: the sort and search fields go full width, date preset chips wrap,
the advanced toggle is full width, the advanced panel stacks one field per row, the table
becomes record cards with the same information in the same order and a full-width View action,
and the drawer is full width with its body scrolling over the page (no nested list scrollbar).

## 5. Status buckets

The rule is imported, not restated: `matchesStatusBucket(status, bucket, false)` and
`countStatusBuckets` from `lib/controlJobsView.ts`, with `reviewed` always `false`. The verdict
boundary is `jobNeedsAttention` from `jobQueueView.ts`, so the station page cannot disagree
with the control plane about what "Needs review" means.

| Bucket | Definition |
|---|---|
| All | Every job in scope. Never hides a job. |
| Needs review | `jobNeedsAttention(status)`: `FAILED`, `UNVERIFIED`, `TIMEOUT`, and any status this build does not recognise. |
| In progress | `ACCEPTED`, `VALIDATED`, `QUEUED`, `DISPATCHED`, `PRINTING`. |
| Printed | `SUCCESS`. |
| Other | The remainder: `CANCELLED`, `DUPLICATE_RETURNED`. Rendered only when above zero. |

Sort order in the flat list: attention first, then received newest first, then `id` for a
stable tie-break (`sortJobs` from `lib/controlJobsView.ts`).

## 6. Search, dates, grouping

Search, `key = value` filters, date presets, custom dates and grouping are one shared pipeline:
`filterAndGroupJobs` from `lib/jobPayload.ts`, followed by the bucket filter, then `sortJobs`.
The "why did this row match" explanation comes from `describeJobSearchMatches` +
`hiddenSearchMatches` and is rendered through `control.jobs.searchMatchLabel` in the row hint
slot `JobTable` provides.

Grouping options: none, received date, status, template, printer, source, plus one per incoming
payload key (`key:<name>`). There is no station grouping because there is one station.

## 7. Deep links

`/jobs?status=UNVERIFIED`, `?status=TIMEOUT`, `?status=FAILED` come from the dashboard's
attention strip, and `?status=NEEDS_ATTENTION` is also accepted.

- `NEEDS_ATTENTION` selects the **Needs review** bucket.
- A literal `JobStatus` sets the **exact status** filter (advanced condition) and shows it as a
  removable chip in the active-conditions toolbar, so the state is never invisible.
- Changing either control writes the URL back (`replace`), so a filtered queue stays shareable.
- `?cinema=1` opens the board, exactly as on `/control/jobs`.

## 8. Columns

`lib/jobColumns.ts` is the single source: status and actions are fixed, job reference /
destination / received are the shipped default, and copies, template, source, runner, error
code and up to eight incoming values are opt-in behind the picker. The picker is the same
`JobColumnsDialog`; the station passes the option list without `station`. Column widths are
per-visit and reset from the toolbar once the operator has dragged something.

## 9. Cinema mode

`CinemaBoard` receives the station's own jobs mapped to a single synthetic station
(`deviceId: 'local'`, label `page.jobQueue.cinemaScope`), so the wall board shows this station's
queue and its own throughput. The Display-data dialog is the shared one; the station page
passes `panelChoices={['flow', 'ticker']}` because a one-row station panel would say nothing.
Feed health, staleness and failure are reported from the same resource the list uses.

## 10. Reprint safety (unchanged from the previous station page)

- The selection bar and the drawer open the confirmation dialog; a row never reprints directly.
- Submit stays disabled without an explicit duplicate-risk acknowledgement and a non-empty
  reason.
- The dialog loads the full job first (`GET /jobs/:id`) because the list payload does not carry
  `runnerId` / `requestId`, and the submit stays blocked when either is missing.
- Caution jobs (`UNVERIFIED`, `TIMEOUT`, unknown) stay in their own labelled region inside the
  batch dialog so a bulk acknowledgement is never given to them by accident.
- Batch results are reported in a dismissible `Alert`, one line per job.

## 11. Component map

| Region | Component | Owner stylesheet |
|---|---|---|
| Page frame, bars, panels | `PageLayout`, `Panel`, `Toolbar`, `Inline`, `Stack`, `Grid` | `components/ui/*`, `styles.css` |
| Counts, filters | `Chip`, `Button`, `SelectFilter`, `SearchField`, `FormField`, `Input`, `Select`, `Checkbox` | `components/ui/*` |
| List | `DataTable` + `JobTable` | `features/job-list/jobTable.css` |
| Selection | `SelectionBar` | `features/job-list/selectionBar.css` |
| Drawer | `JobDetailDrawer` | `features/job-list/jobDetailDrawer.css` |
| Column picker | `JobColumnsDialog` | shared `Dialog` |
| Cinema | `CinemaDisplayDialog`, `CinemaBoard` | `features/cinema/cinemaBoard.css` |

Rules: no literal hex, no literal sub-1rem `font-size`, no new global override, no `*Hotfix*`
stylesheet, every flex/grid child keeps `min-width: 0`.

## 12. Key deck

**Reused, unchanged:** the list is one surface with one vocabulary, so the station page reads
the same keys the control plane does: `control.jobs.countAll`, `countNeedsReview`,
`countInProgress`, `countPrinted`, `countOther`, `needsReviewFirstHint`, `sortLabel`,
`sortAttention`, `sortNewest`, `sortOldest`, `searchLabel`, `searchPlaceholder`,
`searchHiddenHint`, `searchMatchLabel`, `datePresetAll`, `datePresetToday`, `datePreset7d`,
`datePreset30d`, `advancedFilters`, `hideAdvancedFilters`, `advancedFiltersWithCount`,
`advancedTitle`, `advancedHint`, `exactStatusLabel`, `exactStatusAll`, `dateFromLabel`,
`dateToLabel`, `groupByLabel`, `groupNone`, `groupDate`, `groupStatus`, `groupTemplate`,
`groupPrinter`, `groupSource`, `groupKeyPrefix`, `groupSummary`, `searchTechnicalLabel`,
`searchTechnicalHint`, `keyFilterKeyLabel`, `keyFilterKeyPlaceholder`, `keyFilterValueLabel`,
`keyFilterValuePlaceholder`, `keyFilterPickValuePlaceholder`, `addKeyFilter`,
`activeFiltersLabel`, `removeFilter`, `clearAllFilters`, `filterExactStatus`, `filterGroup`,
`columnsButton`, `columnsTitle`, `columnsHint`, `columnsReset`, `columnsIncoming`,
`columnsNoIncoming`, `columnsNoValue`, `columnsValueCount`, `widthsReset`, `colJob`,
`colDestination`, `colReceived`, `colStatus`, `colActions`, `colSelect`, `selectAllGroup`,
`selectJobRow`, `resizeColumn`, `resizeColumnHint`, `detailTitle`, `detailDestination`,
`detailReceived`, `detailCopies`, `detailWhatHappened`, `detailNextStep`,
`detailIncomingData`, `detailNoIncoming`, `detailTechnical`, `detailRawJson`, `detailLogs`,
`detailNoLogs`, `detailNoTechnical`, `detailCopy`, `detailCopied`, `detailCopyField`,
`detailUnconfirmedTitle`, `detailUnconfirmedBody`, `reprint`, `reprintSubmitting`,
`reprintCopiesLabel`, `reprintReasonLabel`, `reprintConfirmDuplicateLabel`, `selectedCount`,
`clearSelection`, `reprintSelected`, `emptyNoJobsTitle`, `emptyNoMatchTitle`,
`emptyNoMatchHint`, plus the `control.cinema.*` deck.

**New in this change (`page.jobQueue.*`, EN + TH):**

| Key | EN | TH | Where |
|---|---|---|---|
| `subtitle` *(copy updated)* | Every print job this station has accepted | งานพิมพ์ทุกงานที่เครื่องนี้รับเข้า | Page description |
| `scopeBarLabel` | Job queue actions | การจัดการคิวงาน | Scope bar accessible name |
| `scopeCount` | `{count} jobs on this station` | งานบนเครื่องนี้ {count} รายการ | Scope bar count |
| `tableLabel` | Jobs on this station | งานบนเครื่องนี้ | Table accessible name |
| `emptyNoJobsHint` | Jobs appear here as soon as this station accepts them. | งานจะปรากฏที่นี่ทันทีที่เครื่องนี้รับงาน | Empty state (the control-plane hint talks about syncing a station) |
| `cinemaScope` | This station | เครื่องนี้ | Cinema board scope label and its synthetic station name |

Every other key already existed in both locales; no raw key can render.

## 13. States

| State | Behaviour |
|---|---|
| First load | Header renders immediately; the content region shows `LoadingState`. |
| Background refresh (1.5s) | Rows stay; `Freshness` states when the data was last true. A failed refresh keeps the rows and adds `ErrorBanner` with retry. |
| Load failed, no data | `ErrorState` with `page.jobQueue.loadFailed` and retry. |
| Feed at the 1,000-row cap | Warning alert; search and filters are the way back further. |
| No jobs at all | `emptyNoJobsTitle` + `page.jobQueue.emptyNoJobsHint`. |
| Filters exclude everything | `emptyNoMatchTitle` + `emptyNoMatchHint` + `Clear all`. |
| `job:retry` absent | No selection checkbox, no selection bar, no Reprint in the drawer. View job and Copy stay. |
| Reprint submit | Disabled until reason + confirmation; busy state uses `reprintSubmitting`; copies capped at 20. |

## 14. Acceptance checklist

- [x] At 1440x900 and 1024x768, in TH and EN, the Needs review count and the first job row are
      visible without scrolling.
- [x] There is exactly one action region on the page and it contains no station selector.
- [x] A bucket count equals the number of rows its click shows, including when a search, a date
      preset and a key filter are active together.
- [x] `/jobs?status=UNVERIFIED` arrives filtered, with a removable chip that names the status,
      and clearing it returns to every job.
- [x] The column picker offers no Station column, and a stored `station` selection cannot
      resurrect one.
- [x] Column resizing works by drag, by arrow keys, and resets by double-click and from the
      toolbar.
- [x] The drawer opens from a row and from the View action, states What happened and Next step,
      keeps Incoming data and Technical details collapsed, and its review buttons are absent.
- [x] Reprint is never one click: the dialog demands a reason and a duplicate-risk
      acknowledgement, and refuses when `runnerId`/`requestId` are missing.
- [x] Batch reprint keeps caution jobs in their own labelled region.
- [x] Cinema mode opens from the scope bar, states the scope, and reports stale/failed feeds.
- [x] No horizontal page overflow and no nested content scrollbar at 390px, in both languages.
- [x] `npm run test -w apps/web`, the web build and `npx playwright test` are green.

## 15. Verification (2026-11-19)

| Gate | Result |
|---|---|
| `npm run typecheck -w apps/web` | clean |
| `npm run test -w apps/web` | 830 passed (82 files), including `designTokens.test.ts`, `layoutContract.test.ts`, the rewritten `jobQueueFilter.test.ts` and a new excluded-column case in `jobColumns.test.ts` |
| `npm run build -w apps/web` | succeeded (JobQueue chunk 26.6 kB) |
| `npx playwright test` (dashboard build) | 177 executed, 68 skipped by the control-build gate: 176 passed. The single failure was `delete-flows.spec.ts` (Templates deletion, unrelated to this change), which passed on an isolated rerun and in the previous full run. |
| `job-queue-layout.spec.ts` | rewritten: one action region, no station selector, bucket count = rows shown, `?status=` deep link + removable chip, no Station column, keyboard resize and reset, pinned batch bar, no overflow at 1440/1024/390 in TH and EN |
| `reprint-safety.spec.ts` | repointed: row → View job → drawer → Reprint → confirmation dialog, at 1440/1280/1024/390 |
| `mobile-interactions.spec.ts` | repointed: status bucket chips, card layout, batch bar |

Screenshots: `artifacts/browser/job-queue/{1440,1024,390}-{th,en}.png`.
