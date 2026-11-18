# Incoming Jobs - cinema mode

**Status:** implemented 2026-11-18, verified in the rendered Control build.
**Route:** `/control/jobs` (`apps/web/src/pages/WebControlJobs.tsx`), mode flag
`?cinema=1`.
**Files:** `apps/web/src/features/control-jobs/CinemaBoard.tsx`,
`cinemaBoard.css`, `cinemaModel.ts`, `apps/web/src/__tests__/cinemaModel.test.ts`,
`apps/web/e2e/web-control-jobs.spec.ts` (section J).
**Evidence:** `artifacts/browser/web-control-jobs/cinema-{1440,1024,390}-{en,th}.png`.
**Design authority:** the owner explicitly asked for a cinema-screen mode
("เต็มจอ ไม่มี tab/sidebar, เห็นการไหลของข้อมูล, realtime indicator, กดปุ่มใดก็ได้
เพื่อออก"). That requirement outranks the default no-motion / light-surface rules;
the exception is recorded in `DESIGN.md` ("Cinema mode") and scoped to this one
surface.

## 1. Goal

A display that stays on, in a room where nobody is driving it. From several
metres away it has to answer four questions without interaction:

1. How much is coming in right now, and is the feed alive?
2. What needs a human before anything else?
3. Where is the work going - which station, which printer?
4. Is any station quiet or offline?

The board is a projection of the same feed the page already reads, not a second
source of truth. It never claims confirmation: `SUCCESS` is labelled with the
status string, and the "Printed" tile means "reported complete".

## 2. Entry and exit

| Action | Result |
|---|---|
| **Cinema mode** button in the station bar | Opens the board, writes `?cinema=1`, requests fullscreen (best effort). |
| Opening `/control/jobs?cinema=1` (optionally `&deviceId=<id>`) | Opens on load, so a wall display survives a reload. |
| Any key | Exit. Listeners are attached after mount, so the opening click cannot close it. No key is `preventDefault`ed: the board has nothing to type into, and swallowing browser or assistive-technology shortcuts would be worse than the trap it prevents. |
| Tap / click without dragging | Exit on `pointerup` when the pointer moved 6px or less. On a touch screen a drag is a scroll, not an exit, so the narrow layouts stay scrollable. |
| Browser leaves fullscreen (Esc, system gesture) | Exit (`fullscreenchange`). |
| Exit | `?cinema=1` removed (replace history), body scroll restored, `#root` un-inerted, focus returned to the button. |

Fullscreen is requested on `document.documentElement` and is allowed to fail: a
packaged WebView or an iframe can refuse, and the board still covers the
viewport as a fixed overlay.

## 3. Regions

```text
┌ identity (brand, title, scope, connection)        clock        LIVE + hint ┐
├ KPI: total | needs review | in progress | printed | stations online ───────┤
├ flow ladder (30 x 1 minute, stacked by family)   ┬ stations ladder ─────────┤
│                                                  └ (all-stations scope only)│
├ latest jobs (newest first, status rail, NEW pulse) ─────────────────────────┤
└ ticker: time · reference · station · status ────────────────────────────────┘
```

- **Station scope hides the fleet ladder.** A one-station board shows that
  station's connection in the header instead, so the numbers on screen are one
  scope. All stations shows up to four stations (busiest first, offline last)
  plus an explicit "N more stations" line - never a nested scrollbar.
- **Feed** shows the eight newest jobs. On short screens fewer rows render rather
  than a row being clipped mid-height.
- **Ticker** repeats the twelve newest jobs. It is `aria-hidden`; the feed
  already carries the same information for assistive tech.

### 3.1 Display fields (the row label)

A reference such as `REQ-UNVERIFIED-0001` means nothing to the person watching
the screen; the incoming value does. **Display data** in the station bar opens a
dialog listing the incoming keys the current scope actually carries, each with a
sample value and the number of jobs behind it, in the same flattened payload the
drawer and the payload filters read (`extractJobPayload`).

- Choose up to three keys, in reading order. The limit is about wall legibility,
  not storage; a fourth checkbox is disabled rather than silently ignored.
- The selection lives in the URL (`?cinemaFields=hn,patient_name`), so a wall
  display can be opened at `/control/jobs?cinema=1&cinemaFields=hn,patient_name`
  with no interaction, and the choice survives a reload and a station switch.
- A row shows the chosen values joined with ` · ` as its main label, and keeps
  the job reference after them in smaller muted mono, so support can still find
  the job. A job missing every chosen value falls back to the reference alone -
  never a blank cell.
- The feed header names the active keys (`hn · patient_name`), so the board is
  self-describing.
- **Reference and width.** "Show job reference" drops the trailing reference when
  a value is chosen (a job with no chosen value still shows its reference), and
  the value column can be Narrow, Balanced or Wide. Both are session state,
  applied to the board without persisting - the operator arranges the screen and
  sees the result.
- No value is invented: keys are matched case-insensitively, blank values are
  skipped, and the picker only offers keys present in the loaded window.

## 4. Numbers, and where they come from

| Tile / element | Definition | Source |
|---|---|---|
| Total jobs | Every job in the current scope (the mirrored window the API returned). | `countStatusBuckets` (shared with the page's chips) |
| Needs review | `jobNeedsAttention(status)`: `FAILED`, `UNVERIFIED`, `TIMEOUT`, unknown statuses. | `jobQueueView.ts` via `controlJobsView.ts` |
| In progress | `ACCEPTED VALIDATED QUEUED DISPATCHED PRINTING`. | same |
| Printed | `SUCCESS` only. Copy says "Reported complete". | same |
| Stations online | `connectionState === 'ONLINE'`, within scope. | `ControlStationItem` |
| "last 10 minutes" / flow ladder | Arrivals by `createdAt`, one-minute buckets ending at now. | `cinemaModel.ts` |
| Station ladder | Per-station totals, review count, newest job, share of busiest. | `cinemaModel.ts` |

Bucket membership is never re-defined in the board: the tiles and the flow chart
both call `countStatusBuckets` / `cinemaTone`, so a tile cannot disagree with the
list behind it. Timestamps that do not parse are ignored rather than clamped.

## 5. Layout and breakpoints

- **Above 1100px:** fixed viewport grid - header, KPI band, body (flow + stations
  on row 1, feed full width on row 2), ticker. No scrolling.
- **1100px and below:** one column; the board itself scrolls vertically. Flow,
  stations, feed keep their order. This is the overlay's own scroll, not a nested
  list scrollbar.
- **860px and below:** KPIs two-up; feed rows become two lines (time / reference
  / status, then station → printer).
- **520px and below:** ticker hidden, flow ladder shortened; the board remains
  complete.
- **Short landscape (≤820px tall, >1100px wide):** the feed renders five rows so
  no row is cut through its middle.

Thai and English are both checked at 1440x900, 1024x768 and 390x844; the board
never scrolls sideways (`width: max-content` ticker is clipped by its own track).

## 6. Colour and contrast

The board uses `--canvas-*` (the sanctioned dark family) and derives every other
tone with `color-mix()`: `--cinema-muted`, `--cinema-ok`, `--cinema-warn`,
`--cinema-danger`, `--cinema-neutral`. Status hues are lifted toward Canvas Text
so they clear WCAG AA on Canvas Gutter; no literal hex is added. The board was
audited in the browser: every text-bearing element's effective foreground was
compared with its nearest opaque background, and no pair fell below 4.5:1.

Status is never colour alone: each row carries the literal server status inside
an outlined pill, the rail is paired with that pill, and the legend states
"Printed / In progress / Needs review / Other" in words.

## 7. Motion

Scoped to the board, and every effect stops under
`prefers-reduced-motion: reduce`:

| Effect | What it communicates |
|---|---|
| Count-up on KPI change | The number just moved. First paint shows the real value, never 0. |
| Breathing live dot (green = live, amber = syncing/delayed/loading, red = lost) | Feed health, alongside the label and the age of the last success. |
| New-row entrance + static "New" badge (<120s old) | A job just arrived. The label itself never animates, so it never drops below AA. |
| 30-minute stacked ladder | Volume over time, split by family. |
| Aurora drift behind the surface | Background only; carries no data. |
| Ticker | The recent sequence, also present in the feed. |

The count-up is skipped (final value immediately) when reduced motion is
requested. Nothing flashes, and no content depends on an animation to be read.

## 8. Accessibility

- `role="dialog"` + `aria-modal="true"` with a localized name; focus moves to the
  board on open and returns to the entry button on exit.
- `#root` carries `inert` while the board is open, and `document.body` gets
  `overflow: hidden`; both are restored on exit.
- A visually hidden sentence states the totals, so a screen-reader user gets the
  whole picture without reading tiles one by one. Before the first response it
  says "loading" instead of reporting zeroes, and the KPI values read "—".
- Each KPI is a named `group`, and the feed is a named list, so both can be
  addressed by role rather than by class.
- Offline stations are marked with the word "Offline", not only a red dot.
- Text is at least 1rem; the display ladder is used only for KPI numerals.
- The board is passive by design: there are no focusable controls inside it, and
  exiting needs no target hunting.

## 9. Copy deck (`control.cinema.*`, EN / TH)

| Key | EN | TH |
|---|---|---|
| `label` | Cinema board | บอร์ดจอใหญ่ |
| `title` | Incoming jobs · live | งานที่เข้ามา · สด |
| `enter` | Cinema mode | โหมดจอใหญ่ |
| `exitHint` | Press any key or click to exit | กดปุ่มใดก็ได้ หรือคลิกเพื่อออก |
| `live` / `updating` / `stale` / `offline` | Live / Updating / Delayed / Connection lost | สด / กำลังอัปเดต / ข้อมูลล่าช้า / ขาดการเชื่อมต่อ |
| `loading` | Loading… | กำลังโหลด… |
| `kpisLabel` | Incoming job totals | ยอดรวมงานที่เข้ามา |
| `kpiTotal` + hint | Total jobs + "{count} in the last 10 minutes" | งานทั้งหมด + "10 นาทีล่าสุด {count} งาน" |
| `kpiNeedsReview` + hints | Needs review + "Check these first" / "Nothing waiting" | ต้องตรวจสอบ + "ตรวจรายการเหล่านี้ก่อน" / "ไม่มีงานค้างตรวจ" |
| `kpiInProgress` + hint | In progress + "Queued or printing" | กำลังดำเนินการ + "รอคิวหรือกำลังพิมพ์" |
| `kpiPrinted` + hint | Printed + "Reported complete" | พิมพ์แล้ว + "รายงานว่าเสร็จสิ้น" |
| `kpiStations` + hint | Stations online + "Connected right now" | เครื่องออนไลน์ + "เชื่อมต่ออยู่ตอนนี้" |
| `flowTitle` / `flowRate` / `flowPeak` | Incoming flow / "{count} jobs in 30 minutes" / "peak {count} per minute" | การไหลของงาน / "{count} งานใน 30 นาที" / "สูงสุด {count} งาน/นาที" |
| `stationsTitle` / `stationsEmpty` / `stationsMore` | PrintOps stations / No stations connected yet / "{count} more stations" | เครื่อง PrintOps / ยังไม่มีเครื่องที่เชื่อมต่อ / "อีก {count} เครื่อง" |
| `stationAttention` / `stationNoJobs` | "{count} to review" / No jobs yet | "ต้องตรวจ {count}" / ยังไม่มีงาน |
| `feedTitle` / `feedHint` / `feedEmpty` | Latest jobs / Newest first / Waiting for the first job | งานล่าสุด / ใหม่ที่สุดก่อน / กำลังรองานแรก |
| `newBadge` | New | ใหม่ |
| `fieldsButton` | Display data | ข้อมูลที่แสดง |
| `fieldsTitle` | Data shown in cinema mode | ข้อมูลที่แสดงในโหมดจอใหญ่ |
| `fieldsHint` | Pick up to {max} incoming values to use as the main label in cinema mode. The job reference stays on the row in smaller text. | เลือกได้สูงสุด {max} ค่าจากข้อมูลที่ส่งเข้ามา เพื่อใช้เป็นชื่อหลักในโหมดจอใหญ่ โดยรหัสงานยังแสดงอยู่บนแถวด้วยตัวอักษรเล็ก |
| `fieldsLimit` | {count} of {max} selected | เลือกแล้ว {count} จาก {max} |
| `fieldsEmpty` | No incoming data to choose from yet. Cinema mode will show job references. | ยังไม่มีข้อมูลที่ส่งเข้ามาให้เลือก โหมดจอใหญ่จะแสดงรหัสงานแทน |
| `fieldsClear` | Clear selection | ล้างที่เลือก |
| `fieldsCount` | {count} jobs | {count} งาน |
| `fieldsMissing` | No value in this scope | ไม่มีค่าในขอบเขตนี้ |
| `summary` | Cinema board: {total} jobs, {review} to review, {active} in progress, {printed} printed, and {online} of {stations} stations online. | บอร์ดจอใหญ่: งานทั้งหมด {total} รายการ ต้องตรวจ {review} กำลังดำเนินการ {active} พิมพ์แล้ว {printed} และออนไลน์ {online} จาก {stations} เครื่อง |

Other strings are reused verbatim: `control.jobs.countPrinted`,
`countInProgress`, `countNeedsReview`, `countOther`, `control.jobs.stationSummary`,
`control.jobs.connectionOnline/Offline`, `control.jobs.allStations`,
`status.never`, `status.secondsAgo/minutesAgo/hoursAgo`.

## 10. Verification

```powershell
npm run typecheck -w apps/web
npm run test -w apps/web                 # incl. cinemaModel, i18n parity, designTokens, layoutContract
$env:VITE_CONTROL_APP='true'; npm run build -w apps/web
npx playwright test apps/web/e2e/web-control-jobs.spec.ts
```

- 776 web unit tests pass (24 cinema-model tests, including the display-field
  projection, and 7 server-rendered board contracts: scope branches, the
  four-station cap, the offline label, the loading state, the named KPI groups
  and the field label/fallback).
- 36 Playwright tests in the Incoming Jobs suite pass, including ten cinema
  cases (shell coverage, live totals, any-key/click exit, deep link, no fleet
  ladder in one-station scope, display fields, three widths x two locales) and
  six screenshots. The evidence screenshots wait for the real KPI value, not a
  stopwatch.
- Measured at 1440x900: header 56px, KPI band 111px, flow 287px, stations 287px,
  feed 330px; board scroll width equals client width in both languages.

## 11. Decisions and limits

1. **Scope is one scope.** Station selection filters jobs *and* the station
   ladder; a one-station board has no fleet ladder.
2. **No second status list.** `cinemaTone` classifies for colour only; counts
   come from `countStatusBuckets`.
3. **No new API.** The board reads `/v1/control/jobs` at the page's existing
   five-second cadence; "real time" means "as fresh as the last successful poll",
   and the header states the age instead of implying a push feed.
4. **Four stations.** Beyond four, the panel states how many more exist. The
   fleet KPI still covers all of them.
5. **Dark only in this mode.** The page, dialogs and drawer keep the light
   surfaces; leaving cinema mode restores the shell exactly.
6. **Timers follow the data.** The board re-renders at the feed's five-second
   cadence - the numbers cannot change between polls, so a one-second board
   timer only burned renders. The header clock keeps its own one-second timer,
   and both timers stop while the document is hidden.
7. **The row label is operator data, not an identifier.** Up to three incoming
   keys replace the raw reference as the row's main label, with the reference
   still on the row. The picker never invents a value and never hides a job: a
   job without any chosen value shows its reference as before.
