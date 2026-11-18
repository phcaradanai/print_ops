/**
 * Web Control "Incoming Jobs" redesign — rendered-app acceptance suite.
 *
 * Spec: docs/design/web-control-jobs-redesign.md (sections 3, 4, 7 and 9).
 *
 * Everything here is asserted against the built bundle in `apps/web/dist`
 * through the shared harness (`support.ts`), so it proves the *rendered* page,
 * not the JSX. Two rules shaped the selectors:
 *
 *   - roles and accessible names first (`getByRole`, `getByLabel`, row text).
 *     Class selectors appear only where the design doc names a measurement
 *     target (`.ui-data-table-frame`, `.ui-code-block`) plus `.ui-drawer__body`,
 *     the element that owns the drawer's own scroll;
 *   - the fixture is the contract: a fleet with every status the page reasons
 *     about, a long-value job for wrap/no-overflow proof, a second station with
 *     a 60+ character name, and an offline station with no jobs.
 *
 * The suite runs against the Web Control build (`VITE_CONTROL_APP=true`),
 * because `/control/jobs` only exists in that build (App.tsx registers the
 * `/control/*` routes inside `{CONTROL_APP && …}`). It detects that build from
 * the served `apps/web/dist` bundle and skips itself on the plain dashboard
 * build, so the regular suite stays honest instead of reporting a missing route
 * as a page defect. `PRINTOPS_CONTROL_E2E=1` overrides the detection.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import { hasHorizontalPageScroll, installHarness, overflowReport } from './support.js';

const ARTIFACTS = 'artifacts/browser/web-control-jobs';
mkdirSync(ARTIFACTS, { recursive: true });

/**
 * `/control/jobs` is only registered in the Web Control build
 * (`VITE_CONTROL_APP=true`): App.tsx puts the `/control/*` routes inside
 * `{CONTROL_APP && …}`. Detect which bundle the Playwright server is serving
 * from `apps/web/dist` instead of assuming: the dashboard build must skip this
 * file (the route genuinely does not exist there, which is not a page defect),
 * while a Control build runs every test. `PRINTOPS_CONTROL_E2E=1` forces it on.
 */
function detectsControlBuild(): boolean {
  try {
    const dist = join(process.cwd(), 'apps', 'web', 'dist');
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    const entry = /<script[^>]+src="\/assets\/(index-[^"]+\.js)"/.exec(html)?.[1];
    if (!entry) return true; // Cannot tell: let the tests speak instead of hiding.
    const bundle = readFileSync(join(dist, 'assets', entry), 'utf8');
    const hasControlRoute = bundle.includes('path:"/control/jobs"');
    const hasDashboardRoutes = bundle.includes('path:"/printers"');
    // A bundle with neither marker means the minifier changed shape; run the
    // suite rather than silently skipping it.
    return hasControlRoute || !hasDashboardRoutes;
  } catch {
    return true;
  }
}

const CONTROL_BUILD = process.env['PRINTOPS_CONTROL_E2E'] === '1' || detectsControlBuild();

test.beforeEach(() => {
  test.skip(
    !CONTROL_BUILD,
    'the served apps/web/dist bundle is the dashboard build; /control/jobs only exists in the Web Control build (VITE_CONTROL_APP=true npm run build -w apps/web)',
  );
});

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FIXTURE_BASE = new Date();

/** Local wall-clock timestamp, so the page's `Today` preset can see it. */
function atLocal(dayOffset: number, hour: number, minute: number): string {
  return new Date(
    FIXTURE_BASE.getFullYear(),
    FIXTURE_BASE.getMonth(),
    FIXTURE_BASE.getDate() + dayOffset,
    hour,
    minute,
    0,
    0,
  ).toISOString();
}

/** `YYYY-MM-DD` in the browser's local zone (the From/To input format). */
function localYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

const CREATED = {
  unverified: atLocal(0, 9, 30),
  long: atLocal(0, 9, 20),
  opd2: atLocal(0, 8, 45),
  failed: atLocal(-2, 11, 0),
  printing: atLocal(0, 9, 10),
  success: atLocal(-3, 12, 0),
  cancelled: atLocal(-4, 13, 0),
} as const;

const LONG_PRINTER_CODE = 'ZEBRA_OPD_01_EXTENDED_LABEL_STATION_PRINTER_01';
const LONG_REFERENCE = 'a1b2c3d4-e5f6-4a7b-8c9d-0f0e0d0c0b0a-EXTENDED-REFERENCE-XYZZY';
const LONG_PAYLOAD_KEY = 'long_payload_key_for_very_long_incoming_value';
const LONG_PAYLOAD_VALUE = `{"allergy":"${'penicillin '.repeat(20).trim()}","note":"${'wrap-me '.repeat(20).trim()}","flags":["urgent","recheck"]}`;
const FAILED_MESSAGE =
  'Printer ZEBRA_OPD_01 did not answer on TCP port 9100 after three connect attempts.\n' +
  'Check the network cable and printer power, then confirm the printer is online before retrying this job from the station.';

interface FixtureJob {
  id: string;
  requestId: string;
  deviceId: string;
  status: string;
  printerCode: string;
  printerId: string;
  copies: number;
  templateCode: string;
  paperProfileId: string;
  runnerId: string;
  createdAt: string;
  payload: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  reviewedAt?: string;
}

const JOHN_JOBS: FixtureJob[] = [
  {
    id: '3f7a1c2e-91b4-4d6f-8a01-000000000001',
    requestId: 'REQ-UNVERIFIED-0001',
    deviceId: 'dev-john',
    status: 'UNVERIFIED',
    printerCode: 'ZEBRA_OPD_01',
    printerId: 'printer-john-01',
    copies: 1,
    templateCode: 'PATIENT_LABEL',
    paperProfileId: 'pp-zebra-58x40',
    runnerId: 'runner-john-01',
    createdAt: CREATED.unverified,
    payload: { hn: '123456', prescription: '213456', patient_name: 'Somchai Dee' },
  },
  {
    id: '3f7a1c2e-91b4-4d6f-8a01-000000000002',
    requestId: 'REQ-FAILED-0002',
    deviceId: 'dev-john',
    status: 'FAILED',
    printerCode: 'ZEBRA_OPD_01',
    printerId: 'printer-john-01',
    copies: 1,
    templateCode: 'PATIENT_LABEL',
    paperProfileId: 'pp-zebra-58x40',
    runnerId: 'runner-john-01',
    createdAt: CREATED.failed,
    payload: { hn: '998877', patient_name: 'Failed Patient' },
    errorCode: 'PRINTER_OFFLINE',
    errorMessage: FAILED_MESSAGE,
  },
  {
    id: '3f7a1c2e-91b4-4d6f-8a01-000000000003',
    requestId: 'REQ-SUCCESS-0003',
    deviceId: 'dev-john',
    status: 'SUCCESS',
    printerCode: 'ZEBRA_OPD_01',
    printerId: 'printer-john-01',
    copies: 2,
    templateCode: 'PATIENT_LABEL',
    paperProfileId: 'pp-zebra-58x40',
    runnerId: 'runner-john-01',
    createdAt: CREATED.success,
    payload: { hn: '445566', patient_name: 'Printed Patient' },
  },
  {
    id: '3f7a1c2e-91b4-4d6f-8a01-000000000004',
    requestId: 'REQ-PRINTING-0004',
    deviceId: 'dev-john',
    status: 'PRINTING',
    printerCode: 'ZEBRA_OPD_01',
    printerId: 'printer-john-01',
    copies: 1,
    templateCode: 'PATIENT_LABEL',
    paperProfileId: 'pp-zebra-58x40',
    runnerId: 'runner-john-01',
    createdAt: CREATED.printing,
    payload: { hn: '778899', patient_name: 'Printing Patient' },
  },
  {
    id: '3f7a1c2e-91b4-4d6f-8a01-000000000005',
    requestId: 'REQ-CANCELLED-0005',
    deviceId: 'dev-john',
    status: 'CANCELLED',
    printerCode: 'ZEBRA_OPD_01',
    printerId: 'printer-john-01',
    copies: 1,
    templateCode: 'PATIENT_LABEL',
    paperProfileId: 'pp-zebra-58x40',
    runnerId: 'runner-john-01',
    createdAt: CREATED.cancelled,
    payload: { hn: '112233', patient_name: 'Cancelled Patient' },
  },
  {
    id: '3f7a1c2e-91b4-4d6f-8a01-000000000006',
    requestId: LONG_REFERENCE,
    deviceId: 'dev-john',
    status: 'UNVERIFIED',
    printerCode: LONG_PRINTER_CODE,
    printerId: 'printer-john-long-01',
    copies: 1,
    templateCode: 'PATIENT_LABEL',
    paperProfileId: 'pp-zebra-58x40',
    runnerId: 'runner-john-01',
    createdAt: CREATED.long,
    payload: { [LONG_PAYLOAD_KEY]: LONG_PAYLOAD_VALUE, hn: '909090' },
  },
];

const OPD2_JOB: FixtureJob = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01',
  requestId: 'REQ-OPD2-0006',
  deviceId: 'dev-opd-2',
  status: 'UNVERIFIED',
  printerCode: 'ZEBRA_OPD_02',
  printerId: 'printer-opd2-01',
  copies: 1,
  templateCode: 'PATIENT_LABEL',
  paperProfileId: 'pp-zebra-58x40',
  runnerId: 'runner-opd2-01',
  createdAt: CREATED.opd2,
  payload: { hn: '554433', patient_name: 'Opd Two Patient' },
};

const OPD2_STATION_NAME =
  'OPD-2 · อาคารผู้ป่วยนอก ชั้น 2 เคาน์เตอร์พิมพ์ใบสั่งยา (Building B, Counter 2)';

const ALL_JOBS = [...JOHN_JOBS, OPD2_JOB];

function stationStats(jobs: FixtureJob[], latestError: unknown) {
  return {
    totalJobs: jobs.length,
    queuedJobs: jobs.filter((job) => job.status === 'PRINTING').length,
    successJobs: jobs.filter((job) => job.status === 'SUCCESS').length,
    attentionJobs: jobs.filter((job) =>
      ['FAILED', 'UNVERIFIED', 'TIMEOUT'].includes(job.status),
    ).length,
    failedJobs: jobs.filter((job) => job.status === 'FAILED').length,
    lastJobAt: jobs[0]?.createdAt ?? null,
    latestError,
  };
}

function fleetResponse() {
  return {
    syncedAt: atLocal(0, 9, 45),
    summary: {
      totalDevices: 3,
      onlineDevices: 2,
      offlineDevices: 1,
      totalJobs: ALL_JOBS.length,
      queuedJobs: ALL_JOBS.filter((job) => job.status === 'PRINTING').length,
      successJobs: ALL_JOBS.filter((job) => job.status === 'SUCCESS').length,
      attentionJobs: ALL_JOBS.filter((job) =>
        ['FAILED', 'UNVERIFIED', 'TIMEOUT'].includes(job.status),
      ).length,
      failedJobs: ALL_JOBS.filter((job) => job.status === 'FAILED').length,
      errorBreakdown: [],
    },
    devices: [
      {
        deviceId: 'dev-john',
        installationId: 'install-john',
        siteId: 'bkk-opd',
        displayName: 'JOHN',
        hostname: 'john-printops-01',
        platform: 'win32',
        appVersion: '1.0.12',
        connectionState: 'ONLINE',
        lastSeenAt: atLocal(0, 9, 44),
        stats: stationStats(JOHN_JOBS, {
          jobId: JOHN_JOBS[1]!.id,
          status: 'FAILED',
          errorCode: 'PRINTER_OFFLINE',
          errorMessage: FAILED_MESSAGE,
          occurredAt: CREATED.failed,
        }),
        payloadKeys: ['hn', 'prescription', 'patient_name'],
        jobs: JOHN_JOBS,
      },
      {
        deviceId: 'dev-opd-2',
        installationId: 'install-opd-2',
        siteId: 'bkk-opd',
        displayName: OPD2_STATION_NAME,
        hostname: 'opd2-printops-01',
        platform: 'win32',
        appVersion: '1.0.11',
        connectionState: 'ONLINE',
        lastSeenAt: atLocal(0, 9, 40),
        stats: stationStats([OPD2_JOB], null),
        payloadKeys: ['hn', 'patient_name'],
        jobs: [OPD2_JOB],
      },
      {
        deviceId: 'dev-lab',
        installationId: 'install-lab',
        siteId: 'bkk-lab',
        displayName: 'LAB',
        hostname: 'lab-printops-01',
        platform: 'linux',
        appVersion: '1.0.9',
        connectionState: 'OFFLINE',
        lastSeenAt: atLocal(-1, 18, 0),
        stats: stationStats([], null),
        payloadKeys: [],
        jobs: [],
      },
    ],
  };
}

/** Every API call the page makes is answered explicitly; anything else is a bug. */
interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

function apiHandler(calls: ApiCall[]) {
  return async (url: URL, route: Route, method: string): Promise<boolean> => {
    const path = url.pathname;

    if (path === '/api/v1/control/jobs' && method === 'GET') {
      await route.fulfill({ json: fleetResponse() });
      return true;
    }

    if (path === '/api/v1/control/jobs/sync' && method === 'POST') {
      calls.push({ method, path, body: null });
      await route.fulfill({ json: { ok: true } });
      return true;
    }

    const reprint = /^\/api\/v1\/control\/devices\/([^/]+)\/jobs\/([^/]+)\/reprint$/.exec(path);
    if (reprint && method === 'POST') {
      calls.push({ method, path, body: JSON.parse(route.request().postData() ?? 'null') });
      await route.fulfill({ status: 201, json: { id: 'reprint-1' } });
      return true;
    }

    return false;
  };
}

// ---------------------------------------------------------------------------
// Copy deck (only the strings the assertions need, from controlTranslations.ts)
// ---------------------------------------------------------------------------

type Locale = 'en' | 'th';

const STRINGS = {
  en: {
    title: 'Incoming Jobs',
    description:
      'Jobs that arrived at your PrintOps stations, the printer each one went to, and what needs review first.',
    stationSubtitle:
      'Jobs received by JOHN, where they were sent, and what needs review first.',
    stationBar: 'Station and connection',
    summary: '2 of 3 online',
    syncAll: 'Sync all',
    syncStation: 'Sync this station',
    manageDevices: 'Manage Devices',
    countsLabel: 'Filter by status',
    needsReview: 'Needs review',
    inProgress: 'In progress',
    printed: 'Printed',
    allCount: 'All',
    searchLabel: 'Search jobs',
    searchMatchLabel: 'Matched:',
    allDates: 'All dates',
    today: 'Today',
    advanced: 'Advanced filters',
    hideAdvanced: 'Hide advanced filters',
    activeFilters: 'Active filters',
    clearAll: 'Clear all',
    addKeyFilter: 'Add Key Filter',
    groupBy: 'Group by',
    fromDate: 'From date',
    toDate: 'To date',
    payloadKey: 'Filter by payload key',
    payloadValue: 'Payload value',
    viewJob: 'View job',
    jobSummary: 'Job summary',
    destination: 'Destination',
    copies: 'Copies',
    whatHappened: 'What happened',
    nextStep: 'Next step',
    outputUnconfirmed: 'Print output is unconfirmed',
    checkDestination: 'Check whether a copy already came out at the destination printer before reprinting.',
    incomingData: 'Incoming data',
    technical: 'Technical details',
    copyJobId: 'Copy Job ID',
    copyRequestId: 'Copy Request ID',
    copyRawJson: 'Copy Raw JSON',
    noJobsMatch: 'No jobs match these filters',
    reprint: 'Reprint',
    sendReprint: 'Send Re-print Command',
    reprintReason: 'Reason for re-print',
    confirmReprint: 'I verified the physical output and confirm this remote re-print',
    cancel: 'Cancel',
    duplicateWarning: 'already printed',
    unconfirmedWarning: 'Print output is unconfirmed. A copy may have already come out.',
    successNotice: 'Submitted remote re-print command',
    reprintDialogTitle: 'Remote Re-print to JOHN',
    cinemaEnter: 'Cinema mode',
    cinemaLabel: 'Cinema board',
    cinemaExitHint: 'Press any key or click to exit',
    cinemaLive: 'Live',
    cinemaTotal: 'Total jobs',
    cinemaStations: 'PrintOps stations',
    cinemaStationsOnline: 'Stations online',
    cinemaFeed: 'Latest jobs',
    connectionOnline: 'Online',
    fieldsButton: 'Display data',
    fieldsTitle: 'Data shown in cinema mode',
    columnsButton: 'Columns',
    columnsTitle: 'List columns',
    columnsReset: 'Reset to default',
    clearSelection: 'Clear selection',
    reprintSelected: 'Re-print Selected',
    reprintDialogGeneric: 'Reprint job',
    markReviewed: 'Mark as reviewed',
    unmarkReviewed: 'Undo review',
    sortLabel: 'Sort',
    needsReviewFirstHint: 'Jobs that need review are shown first.',
    reviewedHint:
      'Marking this job reviewed clears it from Needs review. Its status and evidence stay exactly as the station reported them.',
    reviewedNotice: 'Marked this job as reviewed.',
    reviewedOnly: 'Reviewed only',
    reviewSelected: 'Mark',
    reviewSelectedNotice: 'Marked',
    unreviewSelected: 'Undo review',
    unreviewSelectedNotice: 'Removed the review mark',
    panelsTitle: 'Panels',
    panelFlow: 'Throughput chart',
    panelTicker: 'Scrolling ticker',
    staleCopy: ['Fleet Errors & Warnings', 'Total incoming jobs', 'Select a PrintOps Station'],
  },
  th: {
    title: 'งานที่เข้ามา',
    description: 'งานที่เข้ามายังเครื่อง PrintOps ปลายทางที่พิมพ์ และรายการที่ควรตรวจสอบก่อน',
    stationSubtitle: 'งานที่ JOHN รับเข้ามา ปลายทางการพิมพ์ และรายการที่ควรตรวจสอบก่อน',
    stationBar: 'เครื่องและสถานะการเชื่อมต่อ',
    summary: 'ออนไลน์ 2 จาก 3 เครื่อง',
    syncAll: 'ซิงค์ทั้งหมด',
    syncStation: 'ซิงค์เครื่องนี้',
    manageDevices: 'จัดการเครื่อง',
    countsLabel: 'กรองตามสถานะ',
    needsReview: 'ต้องตรวจสอบ',
    inProgress: 'กำลังดำเนินการ',
    printed: 'พิมพ์แล้ว',
    allCount: 'ทั้งหมด',
    searchLabel: 'ค้นหางาน',
    searchMatchLabel: 'ตรงกับ:',
    allDates: 'ทั้งหมด',
    today: 'วันนี้',
    advanced: 'ตัวกรองขั้นสูง',
    hideAdvanced: 'ซ่อนตัวกรองขั้นสูง',
    activeFilters: 'ตัวกรองที่ใช้อยู่',
    clearAll: 'ล้างทั้งหมด',
    addKeyFilter: 'เพิ่มเงื่อนไข Key',
    groupBy: 'จัดกลุ่มตาม',
    fromDate: 'ตั้งแต่วันที่',
    toDate: 'ถึงวันที่',
    payloadKey: 'เลือก Key ที่ต้องการกรอง',
    payloadValue: 'ค่าของ Key',
    viewJob: 'ดูงาน',
    jobSummary: 'สรุปงาน',
    destination: 'ปลายทาง',
    copies: 'จำนวนชุด',
    whatHappened: 'เกิดอะไรขึ้น',
    nextStep: 'ขั้นตอนถัดไป',
    outputUnconfirmed: 'ยังไม่ยืนยันผลการพิมพ์',
    checkDestination: 'ตรวจสอบว่ามีสติกเกอร์ออกมาที่เครื่องพิมพ์ปลายทางแล้วหรือไม่ ก่อนสั่งพิมพ์ซ้ำ',
    incomingData: 'ข้อมูลที่ส่งเข้ามา',
    technical: 'รายละเอียดทางเทคนิค',
    copyJobId: 'คัดลอก รหัสงาน',
    copyRequestId: 'คัดลอก รหัสคำขอ',
    copyRawJson: 'คัดลอก JSON ดิบ',
    noJobsMatch: 'ไม่พบงานที่ตรงกับตัวกรองนี้',
    reprint: 'พิมพ์ซ้ำ',
    sendReprint: 'ยืนยันส่งคำสั่ง Re-print',
    reprintReason: 'เหตุผลในการสั่งพิมพ์ซ้ำ',
    confirmReprint: 'ตรวจสอบหน้างานจริงแล้ว และยืนยันสั่งพิมพ์ซ้ำไปยัง PrintOps นี้',
    cancel: 'ยกเลิก',
    duplicateWarning: 'พิมพ์ออกมาแล้ว',
    unconfirmedWarning: 'ยังไม่ยืนยันผลการพิมพ์ อาจมีสติกเกอร์ออกมาแล้ว',
    successNotice: 'ส่งคำสั่งพิมพ์ซ้ำสำหรับงาน',
    reprintDialogTitle: 'ยืนยันสั่งพิมพ์ซ้ำไปยัง JOHN',
    cinemaEnter: 'โหมดจอใหญ่',
    cinemaLabel: 'บอร์ดจอใหญ่',
    cinemaExitHint: 'กดปุ่มใดก็ได้ หรือคลิกเพื่อออก',
    cinemaLive: 'สด',
    cinemaTotal: 'งานทั้งหมด',
    cinemaStations: 'เครื่อง PrintOps',
    cinemaStationsOnline: 'เครื่องออนไลน์',
    cinemaFeed: 'งานล่าสุด',
    connectionOnline: 'ออนไลน์',
    fieldsButton: 'ข้อมูลที่แสดง',
    fieldsTitle: 'ข้อมูลที่แสดงในโหมดจอใหญ่',
    columnsButton: 'คอลัมน์',
    columnsTitle: 'คอลัมน์ในรายการงาน',
    columnsReset: 'กลับค่าเริ่มต้น',
    clearSelection: 'ยกเลิกการเลือก',
    reprintSelected: 'สั่งพิมพ์ซ้ำที่เลือก',
    reprintDialogGeneric: 'พิมพ์งานซ้ำ',
    markReviewed: 'ทำเครื่องหมายว่าตรวจสอบแล้ว',
    unmarkReviewed: 'ยกเลิกเครื่องหมายตรวจสอบ',
    sortLabel: 'เรียงลำดับ',
    needsReviewFirstHint: 'งานที่ต้องตรวจสอบจะแสดงก่อน',
    reviewedHint:
      'การทำเครื่องหมายว่าตรวจสอบแล้วจะเอาตัวนี้ออกจาก Need review โดยสถานะและหลักฐานของงานยังเป็นอย่างที่เครื่องรายงานไว้ทุกอย่าง',
    reviewedNotice: 'ทำเครื่องหมายว่าตรวจสอบแล้ว',
    reviewedOnly: 'ตรวจแล้วเท่านั้น',
    reviewSelected: 'ทำเครื่องหมายว่าตรวจแล้ว',
    reviewSelectedNotice: 'ทำเครื่องหมายว่าตรวจแล้ว',
    unreviewSelected: 'ยกเลิกเครื่องหมายตรวจสอบ',
    unreviewSelectedNotice: 'ยกเลิกเครื่องหมายตรวจสอบแล้ว',
    panelsTitle: 'แผงข้อมูล',
    panelFlow: 'กราฟปริมาณงาน',
    panelTicker: 'แถบเลื่อนด้านล่าง',
    staleCopy: ['สรุป Error ที่พบในระบบ', 'เลือกเครื่อง PrintOps เพื่อดูข้อมูล'],
  },
} as const;

function s(locale: Locale) {
  return STRINGS[locale];
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

interface LoadOptions {
  locale?: Locale;
  role?: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
  deviceId?: string;
  viewport?: { width: number; height: number };
  calls?: ApiCall[];
}

async function loadJobs(page: Page, options: LoadOptions = {}) {
  const { locale = 'en', role = 'OWNER', deviceId, viewport, calls = [] } = options;
  if (viewport) await page.setViewportSize(viewport);
  await installHarness(page, { locale, role, api: apiHandler(calls) });
  const query = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
  await page.goto(`/control/jobs${query}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return calls;
}

function rows(page: Page) {
  return page.locator('tbody tr');
}

async function rowTexts(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((elements) =>
    elements.map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim()),
  );
}

function rowFor(page: Page, reference: string) {
  return rows(page).filter({ hasText: reference });
}

async function waitForList(page: Page, locale: Locale = 'en') {
  await expect(page.getByRole('toolbar', { name: s(locale).countsLabel })).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
}

async function openDetails(page: Page, reference: string, locale: Locale = 'en') {
  await rowFor(page, reference).getByRole('button', { name: s(locale).viewJob, exact: true }).click();
  const drawer = page.getByRole('dialog', { name: s(locale).jobSummary });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${ARTIFACTS}/${name}.png`, fullPage: false });
}

const RECEIVED_TIME = /\d{1,2}:\d{2}\s?[AP]M/;

// ---------------------------------------------------------------------------
// A. Layout and visibility (1440x900, 1024x768; EN and TH)
// ---------------------------------------------------------------------------

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const) {
  for (const locale of ['en', 'th'] as const) {
    test(`A. layout and visibility ${viewport.width}x${viewport.height} ${locale}`, async ({ page }) => {
      await loadJobs(page, { locale, viewport });
      await waitForList(page, locale);
      const copy = s(locale);

      // The Needs review count is visible without scrolling.
      const countsToolbar = page.getByRole('toolbar', { name: copy.countsLabel });
      await expect(countsToolbar).toBeVisible();
      const needsReviewChip = countsToolbar.getByRole('button', { name: /Needs review|ต้องตรวจสอบ/ });
      await expect(needsReviewChip).toBeVisible();
      await expect(needsReviewChip).toHaveAttribute('aria-pressed', 'false');
      // All stations scope: 3 attention jobs on JOHN + 1 on OPD-2.
      await expect(needsReviewChip).toContainText('4');

      // The first job row is above the fold, and actually on screen.
      const firstRowBox = await rows(page).first().boundingBox();
      expect(firstRowBox, 'first row has no box').not.toBeNull();
      const firstRowY = Math.round(firstRowBox!.y);
      // eslint-disable-next-line no-console
      console.log(
        `MEASURE first-row-y ${viewport.width}x${viewport.height} ${locale}: ${firstRowY}px (viewport ${viewport.height}px)`,
      );
      expect(firstRowY, 'first row starts above the viewport top').toBeGreaterThan(0);
      expect(firstRowY, 'first row starts below the fold').toBeLessThan(viewport.height);

      // Header: exactly one localized h1 plus the description.
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.title);
      await expect(page.getByText(copy.description, { exact: true })).toBeVisible();

      // The fleet dashboard is gone: no metric tiles, error table or station cards.
      for (const stale of copy.staleCopy) {
        await expect(page.getByText(stale, { exact: false })).toHaveCount(0);
      }
      await expect(page.getByRole('table')).toHaveCount(1);

      // Station bar: one region holding selector + connection + Sync + Manage.
      const stationBar = page.getByRole('region', { name: copy.stationBar });
      await expect(stationBar).toBeVisible();
      await expect(stationBar.getByRole('combobox', { name: copy.stationBar })).toBeVisible();
      await expect(stationBar.getByText(copy.summary, { exact: true })).toBeVisible();
      await expect(stationBar.getByRole('button', { name: copy.syncAll, exact: true })).toBeVisible();
      await expect(
        stationBar.getByRole('button', { name: copy.manageDevices, exact: true }),
      ).toBeVisible();

      // Options: All stations plus every discovered station.
      const options = await stationBar
        .getByRole('combobox')
        .locator('option')
        .evaluateAll((elements) => elements.map((element) => (element.textContent ?? '').trim()));
      expect(options[0]).toMatch(locale === 'th' ? /ทุกสถานี/ : /All stations/);
      expect(options[0]).toContain('7');
      expect(options.some((label) => label.includes('JOHN'))).toBe(true);
      expect(options.some((label) => label.includes('LAB'))).toBe(true);
    });
  }
}

// ---------------------------------------------------------------------------
// B. Row contract
// ---------------------------------------------------------------------------

const FORBIDDEN_ROW_TOKENS = [
  'prescription',
  'patient_name',
  'Somchai',
  '213456',
  '123456',
  'PATIENT_LABEL',
  'pp-zebra',
  'PRINTER_OFFLINE',
  'runner-john',
  LONG_PAYLOAD_KEY,
  'penicillin',
];

test('B. every row is reference + destination + status + received + one View job', async ({ page }) => {
  await loadJobs(page, { role: 'OWNER', deviceId: 'dev-john' });
  await waitForList(page);

  expect(await rows(page).count()).toBe(JOHN_JOBS.length);
  // One station + job:retry => a selection checkbox on every row and in the head.
  await expect(page.locator('thead input[type="checkbox"]')).toHaveCount(1);

  for (const job of JOHN_JOBS) {
    const row = rowFor(page, job.requestId);
    await expect(row, `row for ${job.requestId}`).toHaveCount(1);
    const text = (await row.innerText()).replace(/\s+/g, ' ');
    expect(text, `${job.requestId} reference`).toContain(job.requestId);
    expect(text, `${job.requestId} destination`).toContain(job.printerCode);
    expect(text, `${job.requestId} status`).toContain(job.status);
    expect(text, `${job.requestId} received time`).toMatch(RECEIVED_TIME);

    await expect(row.getByRole('button')).toHaveCount(1);
    await expect(row.getByRole('button', { name: s('en').viewJob, exact: true })).toHaveCount(1);
    await expect(row.getByRole('button', { name: /reprint|พิมพ์ซ้ำ/i })).toHaveCount(0);
    await expect(row.getByRole('checkbox')).toHaveCount(1);

    for (const token of FORBIDDEN_ROW_TOKENS) {
      expect(text, `${job.requestId} leaks "${token}"`).not.toContain(token);
    }
  }

  // Nothing hides below the table: the row count equals the job count.
  expect(await rowTexts(page)).toHaveLength(JOHN_JOBS.length);
});

test('B. All stations rows name the station and are selectable across stations', async ({ page }) => {
  await loadJobs(page);
  await waitForList(page);

  expect(await rows(page).count()).toBe(ALL_JOBS.length);
  // Cross-station batch reprint: every row is selectable and the head selects the page.
  await expect(page.locator('thead input[type="checkbox"]')).toHaveCount(1);
  await expect(page.locator('tbody input[type="checkbox"]')).toHaveCount(ALL_JOBS.length);

  // Station as a secondary destination line.
  const johnRow = rowFor(page, 'REQ-SUCCESS-0003');
  await expect(johnRow).toContainText('JOHN');
  const opd2Row = rowFor(page, OPD2_JOB.requestId);
  await expect(opd2Row).toContainText(OPD2_STATION_NAME);

  for (const job of ALL_JOBS) {
    const row = rowFor(page, job.requestId);
    const text = (await row.innerText()).replace(/\s+/g, ' ');
    expect(text).toContain(job.requestId);
    expect(text).toContain(job.printerCode);
    expect(text).toContain(job.status);
    expect(text).toMatch(RECEIVED_TIME);
    await expect(row.getByRole('button')).toHaveCount(1);
    for (const token of FORBIDDEN_ROW_TOKENS) {
      expect(text, `${job.requestId} leaks "${token}"`).not.toContain(token);
    }
  }
});

// ---------------------------------------------------------------------------
// C. Station switching
// ---------------------------------------------------------------------------

test('C. station selector drives ?deviceId and the row scope', async ({ page }) => {
  await loadJobs(page);
  await waitForList(page);
  const select = page.getByRole('region', { name: s('en').stationBar }).getByRole('combobox');

  await select.selectOption('dev-john');
  await expect(page).toHaveURL(/deviceId=dev-john/);
  await expect(rows(page)).toHaveCount(JOHN_JOBS.length);
  await expect(page.getByText(OPD2_JOB.requestId, { exact: true })).toHaveCount(0);

  await page.getByRole('region', { name: s('en').stationBar }).getByRole('combobox').selectOption('dev-opd-2');
  await expect(page).toHaveURL(/deviceId=dev-opd-2/);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByText(OPD2_JOB.requestId, { exact: true })).toBeVisible();
  await expect(page.getByText('REQ-UNVERIFIED-0001', { exact: true })).toHaveCount(0);

  await page.getByRole('region', { name: s('en').stationBar }).getByRole('combobox').selectOption('');
  await expect(page).not.toHaveURL(/deviceId=/);
  await expect(rows(page)).toHaveCount(ALL_JOBS.length);
  // All stations only adds the secondary station line.
  await expect(rowFor(page, OPD2_JOB.requestId)).toContainText(OPD2_STATION_NAME);
  await expect(rowFor(page, 'REQ-UNVERIFIED-0001')).toContainText('JOHN');

  // A station with no jobs gets the "no jobs in scope" empty state, not a filter
  // miss, and its action syncs that station.
  await page
    .getByRole('region', { name: s('en').stationBar })
    .getByRole('combobox')
    .selectOption('dev-lab');
  await expect(page).toHaveURL(/deviceId=dev-lab/);
  await expect(page.getByText('No jobs yet', { exact: true })).toBeVisible();
  await expect(page.getByText(s('en').noJobsMatch, { exact: true })).toHaveCount(0);
  // The station bar keeps its Sync, and the empty state offers the same action,
  // so the one-station label appears twice.
  await expect(page.getByRole('button', { name: s('en').syncStation, exact: true })).toHaveCount(2);
  await expect(
    page
      .getByRole('region', { name: s('en').stationBar })
      .getByRole('button', { name: s('en').syncStation, exact: true }),
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// D. Search
// ---------------------------------------------------------------------------

test('D. search filters to one row and its chip restores the list', async ({ page }) => {
  await loadJobs(page, { deviceId: 'dev-john' });
  await waitForList(page);

  const search = page.getByRole('searchbox', { name: s('en').searchLabel });
  await search.fill('REQ-UNVERIFIED-0001');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('REQ-UNVERIFIED-0001');

  const active = page.getByRole('toolbar', { name: s('en').activeFilters });
  await expect(active).toBeVisible();
  await expect(active.getByText('Active filters', { exact: true })).toBeVisible();
  const searchChip = active.getByRole('button', { name: 'Remove Search: "REQ-UNVERIFIED-0001"' });
  await expect(searchChip).toBeVisible();
  await expect(searchChip).toContainText('Search:');

  await searchChip.click();
  await expect(search).toHaveValue('');
  await expect(rows(page)).toHaveCount(JOHN_JOBS.length);

  await search.fill('zzz-no-such-job-zzz');
  await expect(page.getByText(s('en').noJobsMatch, { exact: true })).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  // Two Clear all actions are legitimate here: the active-condition row and the
  // empty state's own next action. Both call the same reset; the empty state's
  // is the one the design doc names for this state.
  await expect(page.getByRole('button', { name: s('en').clearAll, exact: true })).toHaveCount(2);
  await page
    .getByText(s('en').noJobsMatch, { exact: true })
    .locator('..')
    .getByRole('button', { name: s('en').clearAll, exact: true })
    .click();
  await expect(rows(page)).toHaveCount(JOHN_JOBS.length);
});

test('D. a row that matched hidden data says which field matched', async ({ page }) => {
  await loadJobs(page, { deviceId: 'dev-john' });
  await waitForList(page);

  const search = page.getByRole('searchbox', { name: s('en').searchLabel });

  // "ab" lives inside the template code `PATIENT_LABEL`, which the default columns
  // do not show. Before this, all six rows came back with nothing visibly "ab" on
  // them - the reported "search does not filter" bug.
  await search.fill('ab');
  await expect(rows(page)).toHaveCount(JOHN_JOBS.length);
  const hints = page.locator('.wcj-search-match');
  await expect(hints).toHaveCount(JOHN_JOBS.length);
  await expect(hints.first()).toContainText('Matched:');
  await expect(hints.first()).toContainText('PATIENT_LABEL');
  await expect(page.getByText(/matched data these columns do not show/)).toBeVisible();

  // Turn the Template column on: the template value is on screen now, so the five
  // rows that matched only through it need no explanation. The failed job keeps
  // its hint because "ab" is also inside its error message ("cable"), which no
  // column shows - the hint tracks what is actually on screen, not the query.
  await page.getByRole('button', { name: s('en').columnsButton, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: s('en').columnsTitle });
  await dialog.getByRole('checkbox', { name: /Template/ }).check();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wcj-search-match')).toHaveCount(1);
  await expect(page.locator('.wcj-search-match').first()).toContainText('Error code');

  // A term that no row carries really does filter everything out.
  await search.fill('do');
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText(s('en').noJobsMatch, { exact: true })).toBeVisible();
});

// ---------------------------------------------------------------------------
// E. Dates, advanced panel, grouping, payload filters
// ---------------------------------------------------------------------------

test('D. the flat list pages at 50 rows and a filter reset returns to page 1', async ({ page }) => {
  const jobs: FixtureJob[] = Array.from({ length: 120 }, (_, index) => ({
    ...JOHN_JOBS[0]!,
    id: `page-job-${String(index).padStart(3, '0')}`,
    requestId: `PAGE-${String(index).padStart(3, '0')}`,
    status: 'SUCCESS',
    errorCode: undefined,
    errorMessage: undefined,
    createdAt: atLocal(0, 9, 30),
  }));
  const fleet = fleetResponse();
  fleet.devices[0]!.jobs = jobs;
  fleet.devices[0]!.stats = stationStats(jobs, null);
  fleet.summary.totalJobs = jobs.length + 1;
  fleet.summary.successJobs = jobs.length;
  fleet.summary.queuedJobs = 0;
  fleet.summary.attentionJobs = 0;
  fleet.summary.failedJobs = 0;

  await installHarness(page, {
    locale: 'en',
    role: 'OWNER',
    api: async (url, route, method) => {
      const path = url.pathname.replace(/^\/api/, '');
      if (path === '/v1/control/jobs' && method === 'GET') {
        await route.fulfill({ json: fleet });
        return true;
      }
      return false;
    },
  });
  await page.goto('/control/jobs?deviceId=dev-john');
  await waitForList(page);

  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByText('Page 1 of 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 2 of 3', { exact: true })).toBeVisible();
  await expect(rows(page)).toHaveCount(50);

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 3 of 3', { exact: true })).toBeVisible();
  await expect(rows(page)).toHaveCount(20);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();

  // A filter change starts the result set at page 1 again; one page needs no pager.
  await page.getByRole('searchbox').fill('PAGE-010');
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByText(/^Page \d+ of \d+$/)).toHaveCount(0);
});

test('E. date presets, custom dates, grouping and a payload filter', async ({ page }) => {
  await loadJobs(page, { deviceId: 'dev-john' });
  await waitForList(page);

  const todayChip = page.getByRole('button', { name: s('en').today, exact: true });
  await todayChip.click();
  await expect(todayChip).toHaveAttribute('aria-pressed', 'true');
  // Three of the six JOHN jobs arrived today.
  await expect(rows(page)).toHaveCount(3);

  await page.getByRole('button', { name: s('en').allDates, exact: true }).click();
  await expect(rows(page)).toHaveCount(JOHN_JOBS.length);

  // Advanced panel holds the custom dates, grouping and payload filters.
  const advancedToggle = page.getByRole('button', { name: s('en').advanced, exact: true });
  await expect(advancedToggle).toHaveAttribute('aria-expanded', 'false');
  await advancedToggle.click();
  await expect(page.getByRole('button', { name: s('en').hideAdvanced, exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByRole('heading', { name: s('en').advanced, level: 2 })).toBeVisible();
  await expect(page.getByLabel(s('en').fromDate)).toBeVisible();
  await expect(page.getByLabel(s('en').toDate)).toBeVisible();
  await expect(page.getByRole('combobox', { name: s('en').groupBy })).toBeVisible();
  await expect(page.getByRole('combobox', { name: s('en').payloadKey })).toBeVisible();
  // Both payload-value controls share one visible label: the suggestion select
  // and the free-text input (an `<input list>` is a combobox too).
  const payloadValueLabelled = page.getByLabel(s('en').payloadValue);
  await expect(payloadValueLabelled).toHaveCount(2);
  await expect(payloadValueLabelled.and(page.locator('select'))).toBeVisible();
  await expect(payloadValueLabelled.and(page.locator('input'))).toBeVisible();

  // A custom From date becomes a visible, removable condition.
  const ymd = localYmd(FIXTURE_BASE);
  await page.getByLabel(s('en').fromDate).fill(ymd);
  const active = page.getByRole('toolbar', { name: s('en').activeFilters });
  const dateChip = active.getByRole('button', { name: new RegExp(`^Remove Date: ${ymd}`) });
  await expect(dateChip).toBeVisible();
  await expect(dateChip).toContainText('Date:');
  await expect(rows(page)).toHaveCount(3);
  await dateChip.click();
  await expect(rows(page)).toHaveCount(JOHN_JOBS.length);

  // Grouping by status creates a group per status; its chip removes it.
  await page.getByRole('combobox', { name: s('en').groupBy }).selectOption({ label: 'Job status' });
  await expect(page.getByRole('region', { name: 'UNVERIFIED', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'FAILED', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'SUCCESS', exact: true })).toBeVisible();
  const groupChip = active.getByRole('button', { name: 'Remove Grouped by Job status' });
  await expect(groupChip).toBeVisible();
  await groupChip.click();
  await expect(page.getByRole('region', { name: 'Incoming jobs for PrintOps station' })).toBeVisible();

  // Payload filter: key + value + Add => one chip, one row.
  await page.getByRole('combobox', { name: s('en').payloadKey }).selectOption('hn');
  await payloadValueLabelled.and(page.locator('input')).fill('123456');
  await page.getByRole('button', { name: s('en').addKeyFilter, exact: true }).click();
  const keyChip = active.getByRole('button', { name: 'Remove hn = 123456' });
  await expect(keyChip).toBeVisible();
  await expect(keyChip).toContainText('hn = 123456');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('REQ-UNVERIFIED-0001');
  await keyChip.click();
  await expect(rows(page)).toHaveCount(JOHN_JOBS.length);

  // The suggestion select applies a picked value directly (the free-text path
  // above is the one that needs Add; picking consumes the pending value, so Add
  // is disabled at that point).
  await page.getByRole('combobox', { name: s('en').payloadKey }).selectOption('patient_name');
  const valueSelect = payloadValueLabelled.and(page.locator('select'));
  await expect(valueSelect).toBeEnabled();
  await valueSelect.selectOption({ label: 'Somchai Dee (1)' });
  const pickedChip = active.getByRole('button', { name: 'Remove patient_name = Somchai Dee' });
  await expect(pickedChip).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('REQ-UNVERIFIED-0001');
  await pickedChip.click();
  await expect(rows(page)).toHaveCount(JOHN_JOBS.length);
});

// ---------------------------------------------------------------------------
// F. Job details
// ---------------------------------------------------------------------------

test('F. UNVERIFIED details: summary, unconfirmed callout, collapsed evidence', async ({ page }) => {
  await loadJobs(page, { deviceId: 'dev-john' });
  await waitForList(page);
  const copy = s('en');
  const drawer = await openDetails(page, 'REQ-UNVERIFIED-0001');

  // Summary first.
  await expect(drawer.getByText('REQ-UNVERIFIED-0001', { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText('ZEBRA_OPD_01 on JOHN', { exact: true })).toBeVisible();
  await expect(drawer.getByText('UNVERIFIED', { exact: true })).toBeVisible();
  await expect(drawer.getByText(RECEIVED_TIME).first()).toBeVisible();
  await expect(drawer.getByText(copy.copies, { exact: true })).toBeVisible();
  await expect(drawer.locator('dd').filter({ hasText: /^1$/ })).toHaveCount(1);

  // What happened / Next step.
  await expect(drawer.getByText(copy.whatHappened, { exact: true })).toBeVisible();
  await expect(drawer.getByText(/May have printed/)).toBeVisible();
  await expect(drawer.getByText(copy.nextStep, { exact: true })).toBeVisible();
  await expect(drawer.getByText(/Check the printer before reprinting/)).toBeVisible();

  // The unconfirmed callout names the next action.
  const alert = drawer.getByRole('alert');
  await expect(alert).toContainText(copy.outputUnconfirmed);
  await expect(alert).toContainText(copy.checkDestination);

  // Evidence is collapsed by default.
  const incoming = drawer.getByRole('button', { name: copy.incomingData, exact: true });
  const technical = drawer.getByRole('button', { name: copy.technical, exact: true });
  await expect(incoming).toHaveAttribute('aria-expanded', 'false');
  await expect(technical).toHaveAttribute('aria-expanded', 'false');

  await incoming.click();
  await expect(incoming).toHaveAttribute('aria-expanded', 'true');
  await expect(drawer.getByText('hn', { exact: true })).toBeVisible();
  await expect(drawer.getByText('123456', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Copy hn' })).toBeVisible();

  await technical.click();
  await expect(technical).toHaveAttribute('aria-expanded', 'true');
  await expect(drawer.getByRole('button', { name: copy.copyJobId })).toBeVisible();
  // Two copies of the same name are intentional: the summary reference and the
  // technical Request ID field.
  await expect(drawer.getByRole('button', { name: copy.copyRequestId })).toHaveCount(2);
  await expect(drawer.getByRole('button', { name: copy.copyRawJson })).toBeVisible();
  const raw = drawer.locator('.ui-code-block').first();
  await expect(raw).toBeVisible();
  await expect(raw).toContainText('"hn": "123456"');
  await expect(raw).toContainText('"patient_name": "Somchai Dee"');

  // No horizontal overflow inside the drawer, and the JSON block never
  // introduces its own vertical scrollbar.
  const drawerOverflow = await drawer.evaluate((element) => ({
    horizontal: element.scrollWidth - element.clientWidth,
    vertical: element.scrollHeight - element.clientHeight,
  }));
  expect(drawerOverflow.horizontal, 'drawer scrolls horizontally').toBeLessThanOrEqual(1);
  const bodyOverflow = await drawer.locator('.ui-drawer__body').evaluate((element) => ({
    horizontal: element.scrollWidth - element.clientWidth,
  }));
  expect(bodyOverflow.horizontal, 'drawer body scrolls horizontally').toBeLessThanOrEqual(1);

  // `scroll={false}` on CodeBlock means no capped height and no inner scroll.
  const rawScroll = await page.evaluate(() => {
    const block = document.querySelector('.ui-code-block');
    if (!block) return null;
    const style = getComputedStyle(block);
    return {
      overflowY: style.overflowY,
      clientHeight: block.clientHeight,
      scrollHeight: block.scrollHeight,
      scrollsVertically: block.scrollHeight - block.clientHeight > 1,
    };
  });
  expect(rawScroll, 'raw JSON code block not found').not.toBeNull();
  // The base rule sets `overflow-x: auto`, which makes the computed `overflow-y`
  // resolve to `auto` even when nothing scrolls, so the height comparison is the
  // proof the block does not own a vertical scrollbar.
  expect(
    rawScroll!.scrollHeight <= rawScroll!.clientHeight + 1,
    `raw JSON has an inner vertical scrollbar: ${JSON.stringify(rawScroll)}`,
  ).toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: copy.jobSummary })).toHaveCount(0);
});

test('F. FAILED details expose error code and the multiline error message', async ({ page }) => {
  await loadJobs(page, { deviceId: 'dev-john' });
  await waitForList(page);
  const copy = s('en');
  const drawer = await openDetails(page, 'REQ-FAILED-0002');
  await drawer.getByRole('button', { name: copy.technical, exact: true }).click();

  await expect(drawer.getByText('PRINTER_OFFLINE', { exact: true })).toBeVisible();
  // The message is rendered twice on purpose: as the technical field and inside
  // the mirrored error-log block.
  await expect(drawer.getByText(/did not answer on TCP port 9100/).first()).toBeVisible();
  await expect(drawer.getByText(/Check the network cable and printer power/).first()).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Copy Error code' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Copy Error message' })).toBeVisible();
  // Both the raw payload and the mirrored error log are rendered.
  await expect(drawer.getByText('No error log recorded for this job.', { exact: true })).toHaveCount(0);
  await expect(drawer.locator('.ui-code-block')).toHaveCount(2);
  await expect(drawer.locator('.ui-code-block').nth(1)).toContainText('PRINTER_OFFLINE');
  await expect(drawer.locator('.ui-code-block').nth(1)).toContainText('did not answer on TCP port 9100');

  const drawerOverflow = await drawer.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(drawerOverflow).toBeLessThanOrEqual(1);
});

test('F. details drawer is half the desktop viewport and full width on tablet/mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadJobs(page, { deviceId: 'dev-john' });
  await waitForList(page);

  let drawer = await openDetails(page, 'REQ-UNVERIFIED-0001');
  let box = await drawer.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(718);
  expect(box?.width).toBeLessThanOrEqual(722);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.setViewportSize({ width: 1024, height: 768 });
  drawer = await openDetails(page, 'REQ-UNVERIFIED-0001');
  box = await drawer.boundingBox();
  expect(box?.width).toBe(1024);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  drawer = await openDetails(page, 'REQ-UNVERIFIED-0001');
  box = await drawer.boundingBox();
  expect(box?.width).toBe(390);
});

// ---------------------------------------------------------------------------
// G. Reprint safety
// ---------------------------------------------------------------------------

test('G. reprint needs reason + confirmation, cancel sends nothing, confirm sends once', async ({ page }) => {
  const calls: ApiCall[] = [];
  await loadJobs(page, { deviceId: 'dev-john', calls });
  await waitForList(page);
  const copy = s('en');

  const openDialog = async () => {
    const drawer = await openDetails(page, 'REQ-UNVERIFIED-0001');
    await drawer.getByRole('button', { name: copy.reprint, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.reprintDialogTitle });
    await expect(dialog).toBeVisible();
    return dialog;
  };

  let dialog = await openDialog();
  await expect(dialog.getByRole('alert')).toContainText(copy.unconfirmedWarning);
  await expect(dialog.getByRole('alert')).toContainText('destination printer');
  const submit = dialog.getByRole('button', { name: copy.sendReprint, exact: true });
  await expect(submit).toBeDisabled();
  await expect(dialog.getByText('ZEBRA_OPD_01 on JOHN', { exact: true })).toBeVisible();

  await dialog.getByLabel(copy.reprintReason).fill('QA cancel path must not print');
  await dialog.getByLabel(copy.confirmReprint).check();
  await expect(submit).toBeEnabled();
  await dialog.getByRole('button', { name: copy.cancel, exact: true }).click();
  await expect(page.getByRole('dialog', { name: copy.reprintDialogTitle })).toHaveCount(0);
  expect(calls.filter((call) => call.path.endsWith('/reprint'))).toHaveLength(0);

  dialog = await openDialog();
  await dialog.getByLabel(copy.reprintReason).fill('QA confirmed duplicate risk');
  await dialog.getByLabel(copy.confirmReprint).check();
  await dialog.getByRole('button', { name: copy.sendReprint, exact: true }).click();
  await expect(page.getByText(new RegExp(copy.successNotice))).toBeVisible();

  const reprints = calls.filter((call) => call.path.endsWith('/reprint'));
  expect(reprints).toHaveLength(1);
  expect(reprints[0]!.method).toBe('POST');
  expect(reprints[0]!.path).toBe(
    '/api/v1/control/devices/dev-john/jobs/3f7a1c2e-91b4-4d6f-8a01-000000000001/reprint',
  );
  expect(reprints[0]!.body).toMatchObject({
    confirmedDuplicateRisk: true,
    reason: 'QA confirmed duplicate risk',
    copies: 1,
  });
});

test('G. an already-printed job warns about a duplicate, not an unknown outcome', async ({ page }) => {
  const calls: ApiCall[] = [];
  await loadJobs(page, { deviceId: 'dev-john', calls });
  await waitForList(page);
  const copy = s('en');

  const drawer = await openDetails(page, 'REQ-SUCCESS-0003');
  await drawer.getByRole('button', { name: copy.reprint, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: copy.reprintDialogTitle });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText(copy.duplicateWarning);
  await expect(dialog.getByRole('alert')).not.toContainText(copy.unconfirmedWarning);
  await dialog.getByRole('button', { name: copy.cancel, exact: true }).click();
  expect(calls.filter((call) => call.path.endsWith('/reprint'))).toHaveLength(0);
});

test('G. a VIEWER sees no selection checkbox and no Reprint, but keeps View job', async ({ page }) => {
  await loadJobs(page, { role: 'VIEWER', deviceId: 'dev-john' });
  await waitForList(page);

  expect(await rows(page).count()).toBe(JOHN_JOBS.length);
  await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(rows(page).first().getByRole('button', { name: s('en').viewJob, exact: true })).toBeVisible();

  const drawer = await openDetails(page, 'REQ-UNVERIFIED-0001');
  await expect(drawer.getByRole('button', { name: s('en').viewJob, exact: true })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: /^Reprint$|^พิมพ์ซ้ำ$/ })).toHaveCount(0);
  // Header close icon and footer Close button, both labelled Close.
  await expect(drawer.getByRole('button', { name: 'Close', exact: true })).toHaveCount(2);
});

// ---------------------------------------------------------------------------
// H. 390x844 responsive
// ---------------------------------------------------------------------------

for (const locale of ['en', 'th'] as const) {
  for (const station of ['john', 'all'] as const) {
    test(`H. mobile ${locale} ${station === 'john' ? 'JOHN' : 'All stations'} stacks without overflow`, async ({
      page,
    }) => {
      const copy = s(locale);
      await loadJobs(page, {
        locale,
        viewport: { width: 390, height: 844 },
        deviceId: station === 'john' ? 'dev-john' : undefined,
      });
      await waitForList(page, locale);
      const expected = station === 'john' ? JOHN_JOBS.length : ALL_JOBS.length;
      expect(await rows(page).count()).toBe(expected);

      // No document-level horizontal scrollbar.
      expect(await hasHorizontalPageScroll(page), `${locale}/${station} scrolls the page sideways`).toBe(
        false,
      );

      // The table header is visually hidden; rows are record cards.
      const head = await page.locator('thead').first().evaluate((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { width: box.width, height: box.height, position: style.position };
      });
      expect(head.width, 'table head is not visually hidden').toBeLessThanOrEqual(2);
      expect(head.height, 'table head is not visually hidden').toBeLessThanOrEqual(2);
      expect(head.position).toBe('absolute');

      const firstRowShape = await rows(page).first().evaluate((row) => {
        const style = getComputedStyle(row);
        const cells = [...row.children].map((cell) => cell.getBoundingClientRect());
        return { display: style.display, tops: cells.map((box) => Math.round(box.top)) };
      });
      expect(firstRowShape.display).toBe('block');
      expect(firstRowShape.tops.length).toBeGreaterThanOrEqual(5);
      for (let index = 1; index < firstRowShape.tops.length; index += 1) {
        expect(
          firstRowShape.tops[index]!,
          'record-card cells are not stacked',
        ).toBeGreaterThan(firstRowShape.tops[index - 1]!);
      }

      // The list owns no vertical scrollbar of its own.
      const frame = await overflowReport(page, '.ui-data-table-frame');
      expect(frame, 'table frame missing').not.toBeNull();
      expect(frame!.scrollsVertically, `table frame scrolls vertically: ${JSON.stringify(frame)}`).toBe(
        false,
      );
      expect(['auto', 'scroll']).not.toContain(frame!.overflowY);

      // Long identifiers and the long station name wrap instead of widening the page.
      const longRow = rowFor(page, LONG_REFERENCE);
      await expect(longRow).toBeVisible();
      const longRowOverflow = await longRow.evaluate((row) => row.scrollWidth - row.clientWidth);
      expect(longRowOverflow, 'long reference row overflows its card').toBeLessThanOrEqual(1);
      if (station === 'all') {
        expect(await hasHorizontalPageScroll(page)).toBe(false);
      }

      // Details: full-width drawer, summary first, evidence collapsed.
      const drawer = await openDetails(page, LONG_REFERENCE, locale);
      const drawerBox = await drawer.boundingBox();
      expect(drawerBox).not.toBeNull();
      expect(Math.abs(drawerBox!.width - 390), 'drawer is not full width').toBeLessThanOrEqual(2);
      const incoming = drawer.getByRole('button', { name: copy.incomingData, exact: true });
      const technical = drawer.getByRole('button', { name: copy.technical, exact: true });
      await expect(incoming).toHaveAttribute('aria-expanded', 'false');
      await expect(technical).toHaveAttribute('aria-expanded', 'false');
      const destinationBox = await drawer
        .getByText(new RegExp(LONG_PRINTER_CODE), { exact: false })
        .first()
        .boundingBox();
      const incomingBox = await incoming.boundingBox();
      expect(destinationBox).not.toBeNull();
      expect(incomingBox).not.toBeNull();
      expect(
        destinationBox!.y,
        'summary is not rendered above the collapsed evidence',
      ).toBeLessThan(incomingBox!.y);
      const drawerOverflowX = await drawer.evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(drawerOverflowX, 'mobile drawer scrolls sideways').toBeLessThanOrEqual(1);
      expect(await hasHorizontalPageScroll(page)).toBe(false);

      // Expanding the long-value evidence still wraps without page overflow.
      await incoming.click();
      await technical.click();
      await expect(incoming).toHaveAttribute('aria-expanded', 'true');
      await expect(drawer.getByText(LONG_PAYLOAD_KEY, { exact: true })).toBeVisible();
      const rawJson = drawer.locator('.ui-code-block').first();
      await expect(rawJson).toContainText('penicillin');
      // The value is JSON-encoded inside the payload, so the inner quotes are escaped.
      await expect(rawJson).toContainText('recheck');
      expect(await hasHorizontalPageScroll(page), 'expanded evidence overflows the page').toBe(false);
      const codeOverflow = await drawer.locator('.ui-code-block').first().evaluate((element) => ({
        horizontal: element.scrollWidth - element.clientWidth,
      }));
      expect(codeOverflow.horizontal, 'raw JSON scrolls sideways').toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: copy.jobSummary })).toHaveCount(0);

      // The multiline error message also wraps on the narrow card layout.
      if (locale === 'en' && station === 'john') {
        const failedDrawer = await openDetails(page, 'REQ-FAILED-0002', 'en');
        await failedDrawer
          .getByRole('button', { name: s('en').technical, exact: true })
          .click();
        const messageLine = failedDrawer
          .getByText(/Check the network cable and printer power/)
          .first();
        await expect(messageLine).toBeVisible();
        expect(
          await hasHorizontalPageScroll(page),
          'multiline error message overflows the page at 390',
        ).toBe(false);
        const messageBox = await messageLine.boundingBox();
        expect(messageBox).not.toBeNull();
        expect(messageBox!.width, 'error message is wider than the drawer').toBeLessThanOrEqual(390);
        await page.keyboard.press('Escape');
      }
    });
  }
}

// ---------------------------------------------------------------------------
// I. Keyboard
// ---------------------------------------------------------------------------

test('I. tab order reaches the controls and the advanced toggle reports its state', async ({ page }) => {
  await loadJobs(page, { viewport: { width: 1440, height: 900 } });
  await waitForList(page);

  const seen = {
    stationSelect: false,
    search: false,
    dateChip: false,
    advanced: false,
    viewJob: false,
  };
  const order: string[] = [];

  for (let step = 0; step < 120 && !Object.values(seen).every(Boolean); step += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return null;
      return {
        tag: element.tagName.toLowerCase(),
        type: (element as HTMLInputElement).type ?? '',
        label: element.getAttribute('aria-label') ?? '',
        text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
      };
    });
    if (!focused) continue;
    order.push(`${focused.tag}${focused.type ? `[${focused.type}]` : ''}:${focused.label || focused.text}`);

    if (focused.tag === 'select' && focused.label === s('en').stationBar) seen.stationSelect = true;
    if (focused.tag === 'input' && focused.type === 'search') seen.search = true;
    if (focused.tag === 'button' && focused.text === s('en').today) seen.dateChip = true;
    if (focused.tag === 'button' && focused.text === s('en').advanced) seen.advanced = true;
    if (focused.tag === 'button' && focused.text === s('en').viewJob) seen.viewJob = true;
  }

  // eslint-disable-next-line no-console
  console.log(`MEASURE tab-order steps=${order.length}: ${order.slice(0, 80).join(' | ')}`);
  expect(seen, `tab order reached: ${JSON.stringify(seen)}`).toEqual({
    stationSelect: true,
    search: true,
    dateChip: true,
    advanced: true,
    viewJob: true,
  });

  // The advanced toggle is a real disclosure.
  const toggle = page.getByRole('button', { name: s('en').advanced, exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  const hide = page.getByRole('button', { name: s('en').hideAdvanced, exact: true });
  await expect(hide).toHaveAttribute('aria-expanded', 'true');
  await hide.click();
  await expect(page.getByRole('button', { name: s('en').advanced, exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );

  // Escape closes the job summary drawer from the keyboard.
  const drawer = await openDetails(page, 'REQ-UNVERIFIED-0001');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// J. Cinema mode
// ---------------------------------------------------------------------------

async function openCinema(page: Page, locale: Locale = 'en') {
  await page.getByRole('button', { name: s(locale).cinemaEnter, exact: true }).click();
  const board = page.getByRole('dialog', { name: s(locale).cinemaLabel });
  await expect(board).toBeVisible();
  return board;
}

test('J. cinema mode covers the shell, reports live totals, and any key exits', async ({ page }) => {
  await loadJobs(page, { viewport: { width: 1440, height: 900 }, deviceId: 'dev-john' });
  await waitForList(page);
  const board = await openCinema(page);

  // Full viewport, no rail, no page frame: the board is the only surface.
  const box = await board.boundingBox();
  expect(box, 'cinema board has no box').not.toBeNull();
  expect(Math.round(box!.x)).toBe(0);
  expect(Math.round(box!.y)).toBe(0);
  expect(Math.round(box!.width)).toBe(1440);
  expect(Math.round(box!.height)).toBe(900);
  expect(
    await page.evaluate(() => document.getElementById('root')?.hasAttribute('inert') ?? false),
  ).toBe(true);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await expect(page).toHaveURL(/cinema=1/);

  // Totals agree with the page's own buckets: six JOHN jobs, three to review.
  const copy = s('en');
  await expect(board.getByRole('group', { name: copy.cinemaTotal })).toContainText('6');
  await expect(board.getByRole('group', { name: copy.needsReview })).toContainText('3');
  await expect(board.getByRole('group', { name: copy.inProgress })).toContainText('1');
  await expect(board.getByRole('group', { name: copy.printed })).toContainText('1');

  // The realtime indicator and the newest job are always visible.
  await expect(board.getByText(copy.cinemaLive, { exact: true })).toBeVisible();
  await expect(board.getByText(copy.cinemaExitHint, { exact: true })).toBeVisible();
  const feed = board.getByRole('list', { name: copy.cinemaFeed });
  await expect(feed.getByRole('listitem').first()).toContainText('REQ-UNVERIFIED-0001');
  expect(await board.locator('.cinema-flow-col').count()).toBe(30);

  // Any key exits, the URL flag is cleared, the shell is usable again, and
  // focus returns to the control that opened the board.
  await page.keyboard.press('a');
  await expect(page.getByRole('dialog', { name: s('en').cinemaLabel })).toHaveCount(0);
  await expect(page).not.toHaveURL(/cinema=1/);
  expect(
    await page.evaluate(() => document.getElementById('root')?.hasAttribute('inert') ?? false),
  ).toBe(false);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  expect(await page.evaluate(() => (document.activeElement?.textContent ?? '').trim())).toBe(
    s('en').cinemaEnter,
  );
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('J. any click exits, and ?cinema=1 opens the board without the button', async ({ page }) => {
  await loadJobs(page, { deviceId: 'dev-john' });
  await waitForList(page);
  await openCinema(page);

  await page.mouse.click(720, 450);
  await expect(page.getByRole('dialog', { name: s('en').cinemaLabel })).toHaveCount(0);
  await expect(page).not.toHaveURL(/cinema=1/);

  // Reload-safe wall display: the flag is the mode.
  await page.goto('/control/jobs?deviceId=dev-john&cinema=1');
  const board = page.getByRole('dialog', { name: s('en').cinemaLabel });
  await expect(board).toBeVisible();
  await expect(board.getByRole('group', { name: s('en').cinemaTotal })).toContainText('6');
  await page.keyboard.press('Escape');
  await expect(board).toHaveCount(0);
});

test('J. reading keys do not close the board, every other key does', async ({ page }) => {
  await loadJobs(page, { deviceId: 'dev-john' });
  await waitForList(page);
  await openCinema(page);
  const board = page.getByRole('dialog', { name: s('en').cinemaLabel });

  // A screen-reader user navigates with arrows, Tab and the page keys. Those must
  // not tear the board down on the first press, or the summary can never be read.
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Tab', 'PageDown', 'Home']) {
    await page.keyboard.press(key);
    await expect(board, `${key} closed the board`).toBeVisible();
  }
  // A modifier on its own is not a keypress either.
  await page.keyboard.down('Shift');
  await page.keyboard.up('Shift');
  await expect(board).toBeVisible();

  // Anything a person would actually mash still exits, Escape included.
  await page.keyboard.press('Escape');
  await expect(board).toHaveCount(0);

  await page.goto('/control/jobs?deviceId=dev-john&cinema=1');
  await expect(board).toBeVisible();
  await page.keyboard.press('q');
  await expect(board).toHaveCount(0);
});

test('J. a one-station board drops the fleet ladder and names its connection', async ({ page }) => {
  await loadJobs(page, { deviceId: 'dev-john' });
  await waitForList(page);
  await page.goto('/control/jobs?deviceId=dev-john&cinema=1');
  const board = page.getByRole('dialog', { name: s('en').cinemaLabel });
  await expect(board).toBeVisible();
  await expect(board.getByRole('region', { name: s('en').cinemaStations })).toHaveCount(0);
  await expect(board.getByText(s('en').connectionOnline, { exact: true })).toBeVisible();
  await expect(board.getByRole('group', { name: s('en').cinemaStationsOnline })).toContainText('1/1');

  await page.keyboard.press('Escape');
  await page.goto('/control/jobs?cinema=1');
  await expect(page.getByRole('dialog', { name: s('en').cinemaLabel })).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('region', { name: s('en').cinemaStations }),
  ).toBeVisible();
});

for (const locale of ['en', 'th'] as const) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ] as const) {
    test(`J. cinema board ${viewport.width}x${viewport.height} ${locale} fits and exits cleanly`, async ({
      page,
    }) => {
      await loadJobs(page, { locale, viewport });
      await waitForList(page, locale);
      const board = await openCinema(page, locale);

      // Both languages stay inside the viewport. The body is scroll-locked and
      // the board is fixed, so the document-level check would pass even if the
      // board overflowed: measure the board's own scroll width and its regions.
      const copy = s(locale);
      const boardOverflow = await board.evaluate((element) => ({
        horizontal: element.scrollWidth - element.clientWidth,
      }));
      expect(boardOverflow.horizontal, 'cinema board scrolls sideways').toBeLessThanOrEqual(1);
      for (const region of ['.cinema-head', '.cinema-body']) {
        const overflow = await board.locator(region).evaluate((element) => ({
          horizontal: element.scrollWidth - element.clientWidth,
        }));
        expect(overflow.horizontal, `${region} scrolls sideways`).toBeLessThanOrEqual(1);
      }
      // The ticker is a clipped marquee: its track is intentionally wider than
      // the board, and the container owns the clip.
      const tickerOverflow = await board
        .locator('.cinema-ticker')
        .evaluate((element) => getComputedStyle(element).overflowX);
      expect(['hidden', 'clip']).toContain(tickerOverflow);

      // Every KPI is readable, and so are the three regions.
      for (const name of [
        copy.cinemaTotal,
        copy.needsReview,
        copy.inProgress,
        copy.printed,
        copy.cinemaStationsOnline,
      ]) {
        await expect(board.getByRole('group', { name })).toBeVisible();
      }
      await expect(board.getByText(copy.cinemaLive, { exact: true })).toBeVisible();
      await expect(board.getByText(copy.cinemaFeed, { exact: true })).toBeVisible();
      await expect(board.getByText(copy.cinemaStations, { exact: true })).toBeVisible();

      // The feed row stays inside the board at every width.
      const rowOverflow = await board
        .getByRole('list', { name: copy.cinemaFeed })
        .getByRole('listitem')
        .first()
        .evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(rowOverflow, 'feed row overflows').toBeLessThanOrEqual(1);

      await page.keyboard.press('q');
      await expect(page.getByRole('dialog', { name: s(locale).cinemaLabel })).toHaveCount(0);
    });
  }
}

// ---------------------------------------------------------------------------
// K. Cinema display fields
// ---------------------------------------------------------------------------

test('K. display fields put incoming values on the cinema rows, reference stays', async ({ page }) => {
  await loadJobs(page, { viewport: { width: 1440, height: 900 }, deviceId: 'dev-john' });
  await waitForList(page);

  const openPicker = async () => {
    await page.getByRole('button', { name: s('en').fieldsButton, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: s('en').fieldsTitle });
    await expect(dialog).toBeVisible();
    return dialog;
  };

  let dialog = await openPicker();
  await dialog.getByRole('checkbox', { name: /^hn\b/ }).check();
  await dialog.getByRole('checkbox', { name: /^patient_name/ }).check();
  await expect(page).toHaveURL(/cinemaFields=hn%2Cpatient_name/);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  const board = await openCinema(page);
  const firstRow = board
    .getByRole('list', { name: s('en').cinemaFeed })
    .getByRole('listitem')
    .first();
  // The incoming values the operator recognises, in the order they chose them.
  await expect(firstRow).toContainText('123456');
  await expect(firstRow).toContainText('Somchai Dee');
  // The reference is still on the row, quieter, so support can find the job.
  await expect(firstRow).toContainText('REQ-UNVERIFIED-0001');
  // The feed header states which values are on the board.
  await expect(board.getByText('hn · patient_name', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // A fourth value is allowed now: three left a wide screen with unused width.
  dialog = await openPicker();
  await dialog.getByRole('checkbox', { name: /^prescription/ }).check();
  await expect(page).toHaveURL(/cinemaFields=hn%2Cpatient_name%2Cprescription/);
  await dialog.getByRole('checkbox', { name: /^long_payload_key/ }).check();
  await expect(dialog.getByRole('checkbox', { name: /^long_payload_key/ })).toBeChecked();
  await page.keyboard.press('Escape');

  // A wall display can be configured entirely from the URL.
  await page.goto('/control/jobs?deviceId=dev-john&cinema=1&cinemaFields=patient_name');
  const deepBoard = page.getByRole('dialog', { name: s('en').cinemaLabel });
  await expect(deepBoard).toBeVisible();
  await expect(
    deepBoard.getByRole('list', { name: s('en').cinemaFeed }).getByRole('listitem').first(),
  ).toContainText('Somchai Dee');
});

// ---------------------------------------------------------------------------
// L. List columns
// ---------------------------------------------------------------------------

test('L. the column picker adds, removes and remembers list columns', async ({ page }) => {
  await loadJobs(page, { viewport: { width: 1440, height: 900 }, deviceId: 'dev-john' });
  await waitForList(page);

  const head = page.locator('thead tr').first();
  // Shipped default: the redesigned four-field row.
  await expect(head).toContainText('Destination');
  await expect(head).toContainText('Received');
  await expect(head).not.toContainText('Copies');

  const openPicker = async () => {
    await page.getByRole('button', { name: s('en').columnsButton, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: s('en').columnsTitle });
    await expect(dialog).toBeVisible();
    return dialog;
  };

  let dialog = await openPicker();
  await dialog.getByRole('checkbox', { name: 'Copies', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Template', exact: true }).check();
  await page.keyboard.press('Escape');

  await expect(head).toContainText('Copies');
  await expect(head).toContainText('Template');
  const row = rowFor(page, 'REQ-SUCCESS-0003');
  await expect(row.locator('td[data-label="Copies"]')).toHaveText('2');
  await expect(row.locator('td[data-label="Template"]')).toHaveText('PATIENT_LABEL');

  // It is a workstation preference, so a reload keeps it.
  await page.reload();
  await waitForList(page);
  await expect(page.locator('thead tr').first()).toContainText('Copies');

  // A default column can be turned off; the fixed ones cannot.
  dialog = await openPicker();
  await dialog.getByRole('checkbox', { name: 'Received', exact: true }).uncheck();
  await expect(dialog.getByRole('checkbox', { name: 'Status', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox', { name: 'Actions', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('thead tr').first()).not.toContainText('Received');

  // Reset returns to the shipped set.
  dialog = await openPicker();
  await dialog.getByRole('button', { name: s('en').columnsReset, exact: true }).click();
  await page.keyboard.press('Escape');
  const restored = page.locator('thead tr').first();
  await expect(restored).toContainText('Destination');
  await expect(restored).toContainText('Received');
  await expect(restored).not.toContainText('Copies');
  await expect(restored).not.toContainText('Template');
});

test('M. incoming payload keys can become list columns', async ({ page }) => {
  await loadJobs(page, { viewport: { width: 1440, height: 900 }, deviceId: 'dev-john' });
  await waitForList(page);

  const openPicker = async () => {
    await page.getByRole('button', { name: s('en').columnsButton, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: s('en').columnsTitle });
    await expect(dialog).toBeVisible();
    return dialog;
  };

  let dialog = await openPicker();
  // Incoming values are offered by key, with a sample and how many jobs carry it.
  await expect(dialog.getByText('Incoming values', { exact: true })).toBeVisible();
  await dialog.getByRole('checkbox', { name: /^hn\b/ }).check();
  await page.keyboard.press('Escape');

  const head = page.locator('thead tr').first();
  await expect(head).toContainText('hn');
  await expect(rowFor(page, 'REQ-UNVERIFIED-0001').locator('td[data-label="hn"]')).toHaveText(
    '123456',
  );

  // A payload column is a workstation preference too.
  await page.reload();
  await waitForList(page);
  await expect(page.locator('thead tr').first()).toContainText('hn');
  await expect(rowFor(page, 'REQ-UNVERIFIED-0001').locator('td[data-label="hn"]')).toHaveText(
    '123456',
  );

  // Four incoming columns are allowed: the ceiling is about stopping "select
  // everything", not rationing the width the table already has.
  dialog = await openPicker();
  await dialog.getByRole('checkbox', { name: /^patient_name/ }).check();
  await dialog.getByRole('checkbox', { name: /^prescription/ }).check();
  await dialog.getByRole('checkbox', { name: /^long_payload_key/ }).check();
  await page.keyboard.press('Escape');
  await expect(page.locator('thead tr').first()).toContainText('patient_name');
  await expect(page.locator('thead tr').first()).toContainText('prescription');
  await expect(page.locator('thead tr').first()).toContainText('long_payload_key');
});

test('L. the two cinema controls read as one framed group, apart from page actions', async ({
  page,
}) => {
  await loadJobs(page, { viewport: { width: 1440, height: 900 }, deviceId: 'dev-john' });
  await waitForList(page);

  const group = page.getByRole('group', { name: 'Cinema display' });
  await expect(group).toBeVisible();
  await expect(group.getByRole('button', { name: 'Display data', exact: true })).toBeVisible();
  await expect(group.getByRole('button', { name: 'Cinema mode', exact: true })).toBeVisible();
  // Columns changes this page's list, so it stays outside the group.
  await expect(group.getByRole('button', { name: 'Columns', exact: true })).toHaveCount(0);

  const styling = await group.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      border: style.borderTopWidth,
      radius: style.borderTopLeftRadius,
      background: style.backgroundColor,
    };
  });
  expect(parseFloat(styling.border), 'group has no frame').toBeGreaterThan(0);
  expect(parseFloat(styling.radius), 'group has no radius').toBeGreaterThan(0);
  expect(styling.background, 'group has no tint').not.toBe('rgba(0, 0, 0, 0)');

  await group.screenshot({ path: `${ARTIFACTS}/cinema-group-en.png` });
});

test('N. the reference column can go and columns resize for this session only', async ({
  page,
}) => {
  await loadJobs(page, { viewport: { width: 1440, height: 900 }, deviceId: 'dev-john' });
  await waitForList(page);

  // The job reference is no longer mandatory: operators who do not need it remove it.
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  const columns = page.getByRole('dialog', { name: 'List columns' });
  await columns.getByRole('checkbox', { name: 'Job', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  const head = page.locator('thead tr').first();
  await expect(head).not.toContainText('Job');
  await expect(rows(page).first().locator('td[data-label="Job"]')).toHaveCount(0);
  await expect(head).toContainText('Status');

  // Drag the Destination divider: it grows, its neighbour gives up the space.
  const widthOf = (index: number) =>
    head.locator('th').nth(index).evaluate((cell) => Math.round(cell.getBoundingClientRect().width));
  const resizer = page.getByRole('separator', { name: 'Resize Destination column' });
  const box = await resizer.boundingBox();
  expect(box, 'destination resizer is missing').not.toBeNull();
  const beforeDestination = await widthOf(1);
  const beforeStatus = await widthOf(2);
  await page.mouse.move(box!.x + 5, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 85, box!.y + box!.height / 2, { steps: 6 });
  await page.mouse.up();

  const afterDestination = await widthOf(1);
  const afterStatus = await widthOf(2);
  expect(afterDestination - beforeDestination).toBeGreaterThan(40);
  expect(beforeStatus - afterStatus).toBeGreaterThan(40);
  await expect(page.locator('table.wcj-jobs-table')).toHaveClass(/wcj-jobs-table--fixed/);

  // Keyboard resizing works too.
  await resizer.focus();
  await page.keyboard.press('ArrowLeft');
  expect(await widthOf(1)).toBeLessThan(afterDestination);

  // Widths are a live arrangement, not a saved preference: reload resets them.
  await page.reload();
  await waitForList(page);
  await expect(page.locator('table.wcj-jobs-table')).not.toHaveClass(/wcj-jobs-table--fixed/);
  // ... while the column choice still survives, as it is a workstation preference.
  await expect(page.locator('thead tr').first()).not.toContainText('Job');
});

test('N. cinema can hide the reference and widen the value column', async ({ page }) => {
  await loadJobs(page, { viewport: { width: 1440, height: 900 }, deviceId: 'dev-john' });
  await waitForList(page);

  await page.getByRole('button', { name: 'Display data', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Data shown in cinema mode' });
  await dialog.getByRole('checkbox', { name: /^hn\b/ }).check();
  await dialog.getByRole('checkbox', { name: /^Show job reference/ }).uncheck();
  await dialog.getByLabel('Data column width').selectOption('wide');
  await page.keyboard.press('Escape');

  const board = await openCinema(page);
  const row = board.getByRole('list', { name: 'Latest jobs' }).getByRole('listitem').first();
  await expect(row).toContainText('123456');
  await expect(row).not.toContainText('REQ-UNVERIFIED-0001');
  await expect(board.locator('.cinema-feed-list--wide')).toHaveCount(1);
});

test('N. cinema rows carry more than three incoming values and can drop the ID', async ({
  page,
}) => {
  await loadJobs(page, { viewport: { width: 1440, height: 900 }, deviceId: 'dev-john' });
  await waitForList(page);

  await page.getByRole('button', { name: 'Display data', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Data shown in cinema mode' });
  // Four values: the reported ceiling of three left the wide screen half empty.
  for (const key of ['hn', 'prescription', 'patient_name', LONG_PAYLOAD_KEY]) {
    await dialog.getByRole('checkbox', { name: new RegExp(`^${key}`) }).check();
  }
  await dialog.getByRole('checkbox', { name: /^Show job reference/ }).uncheck();
  await page.keyboard.press('Escape');

  const board = await openCinema(page);
  const firstRow = board.getByRole('list', { name: 'Latest jobs' }).getByRole('listitem').first();
  await expect(firstRow.locator('.cinema-feed-value')).toHaveCount(3);
  await expect(firstRow).toContainText('123456');
  await expect(firstRow).toContainText('Somchai Dee');
  await expect(firstRow).toContainText('213456');
  // No reference anywhere on the row.
  await expect(firstRow.locator('.cinema-feed-id')).toHaveCount(0);
  await expect(firstRow).not.toContainText('REQ-UNVERIFIED-0001');

  // The values share the row instead of overflowing it.
  const overflow = await firstRow.locator('.cinema-feed-ref').evaluate((element) => ({
    horizontal: element.scrollWidth - element.clientWidth,
  }));
  expect(overflow.horizontal).toBeLessThanOrEqual(1);
});

test('N. cinema can hide the ID even when no incoming value is chosen', async ({ page }) => {
  await loadJobs(page, { viewport: { width: 1440, height: 900 }, deviceId: 'dev-john' });
  await waitForList(page);

  await page.getByRole('button', { name: 'Display data', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Data shown in cinema mode' });
  const referenceToggle = dialog.getByRole('checkbox', { name: /^Show job reference/ });
  // The toggle no longer depends on the value list.
  await expect(referenceToggle).toBeEnabled();
  await referenceToggle.uncheck();
  await page.keyboard.press('Escape');

  const board = await openCinema(page);
  const firstRow = board.getByRole('list', { name: 'Latest jobs' }).getByRole('listitem').first();
  await expect(firstRow).not.toContainText('REQ-UNVERIFIED-0001');
  await expect(firstRow).toContainText('UNVERIFIED');
});

test('N. the list keeps four incoming columns, not three', async ({ page }) => {
  await loadJobs(page, { deviceId: 'dev-john' });
  await waitForList(page);

  await page.getByRole('button', { name: s('en').columnsButton, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: s('en').columnsTitle });
  for (const key of ['hn', 'prescription', 'patient_name', LONG_PAYLOAD_KEY]) {
    await dialog.getByRole('checkbox', { name: new RegExp(`^${key}`) }).check();
  }
  await page.keyboard.press('Escape');

  const headers = page.locator('thead tr').first();
  for (const key of ['hn', 'prescription', 'patient_name', LONG_PAYLOAD_KEY]) {
    await expect(headers).toContainText(key);
  }
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const) {
  test(`N. many cinema values still fit ${viewport.width}x${viewport.height} th`, async ({
    page,
  }) => {
    await loadJobs(page, { locale: 'th', deviceId: 'dev-john', viewport });
    await waitForList(page, 'th');

    await page.getByRole('button', { name: s('th').fieldsButton, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: s('th').fieldsTitle });
    for (const key of ['hn', 'prescription', 'patient_name', LONG_PAYLOAD_KEY]) {
      await dialog.getByRole('checkbox', { name: new RegExp(`^${key}`) }).check();
    }
    await page.keyboard.press('Escape');

    const board = await openCinema(page, 'th');
    const firstRow = board.getByRole('list').getByRole('listitem').first();
    await expect(firstRow.locator('.cinema-feed-value').first()).toBeVisible();

    // The row, the board and the page all stay inside the viewport: extra values
    // truncate, they never widen the wall display.
    for (const [name, locator] of [
      ['row', firstRow],
      ['board', board],
    ] as const) {
      const overflow = await locator.evaluate((element) => ({
        horizontal: element.scrollWidth - element.clientWidth,
      }));
      expect(overflow.horizontal, `${name} scrolls sideways`).toBeLessThanOrEqual(1);
    }
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow, 'the page scrolls sideways').toBeLessThanOrEqual(1);
  });
}

test('P. the reprint bar is pinned in the viewport as soon as rows are selected', async ({
  page,
}) => {
  await loadJobs(page, { viewport: { width: 1440, height: 900 } });
  await waitForList(page);

  // Cross-station selection: one JOHN job and one OPD-2 job.
  await rowFor(page, 'REQ-UNVERIFIED-0001').getByRole('checkbox').check();
  await rowFor(page, OPD2_JOB.requestId).getByRole('checkbox').check();

  const bar = page.getByRole('region', { name: /2 jobs selected/ });
  await expect(bar).toBeVisible();
  expect(await bar.evaluate((element) => getComputedStyle(element).position)).toBe('fixed');

  // Pinned near the bottom edge, fully inside the visual viewport.
  const box = await bar.boundingBox();
  expect(box, 'selection bar has no box').not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  expect(box!.y).toBeGreaterThan(650);

  // Scrolling the list keeps it on screen.
  await page.mouse.wheel(0, 2400);
  await expect(bar).toBeVisible();
  const scrolled = await bar.boundingBox();
  expect(scrolled!.y + scrolled!.height).toBeLessThanOrEqual(900);

  // The action opens the cross-station dialog with both destinations.
  await bar.getByRole('button', { name: new RegExp(s('en').reprintSelected) }).click();
  const dialog = page.getByRole('dialog', { name: s('en').reprintDialogGeneric });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('JOHN');
  await expect(dialog).toContainText(OPD2_STATION_NAME);
  await dialog.getByRole('button', { name: s('en').cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // Clearing the selection removes the bar.
  await bar.screenshot({ path: `${ARTIFACTS}/reprint-bar-en.png` });
  await bar.getByRole('button', { name: s('en').clearSelection, exact: true }).click();
  await expect(bar).toHaveCount(0);
});

test('P. the multi-action bar still fits a 390px screen', async ({ page }) => {
  // The bar can carry four actions at once (clear, mark, undo, reprint) when the
  // selection mixes acknowledged and open rows. A phone is where that wraps, so it
  // is measured rather than assumed.
  const fleet = fleetResponse();
  await installHarness(page, {
    locale: 'en',
    role: 'OWNER',
    api: async (url, route, method) => {
      if (url.pathname === '/api/v1/control/jobs' && method === 'GET') {
        const snapshot = JSON.parse(JSON.stringify(fleet)) as ReturnType<typeof fleetResponse>;
        const acked = snapshot.devices[0]!.jobs.find((job) => job.requestId === 'REQ-FAILED-0002');
        if (acked) acked.reviewedAt = '2026-11-18T09:31:00.000Z';
        await route.fulfill({ json: snapshot });
        return true;
      }
      return false;
    },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/control/jobs?deviceId=dev-john');
  await waitForList(page);

  await rowFor(page, 'REQ-UNVERIFIED-0001').getByRole('checkbox').check();
  await rowFor(page, 'REQ-FAILED-0002').getByRole('checkbox').check();

  const bar = page.getByRole('region', { name: /2 jobs selected/ });
  const box = await bar.boundingBox();
  expect(box, 'selection bar has no box').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const overflow = await bar.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow, 'the bar scrolls sideways on a phone').toBeLessThanOrEqual(1);

  // Every action is reachable, and the space reserved at the end of the list is at
  // least as tall as the bar, so it cannot cover the pagination.
  await expect(bar.getByRole('button')).toHaveCount(4);
  const spacer = await page.locator('.wcj-selection-spacer').boundingBox();
  expect(spacer, 'no spacer reserved for the bar').not.toBeNull();
  expect(spacer!.height).toBeGreaterThanOrEqual(box!.height);
});

test('Q. a reviewed UNVERIFIED job leaves Needs review and keeps its status', async ({ page }) => {
  let reviewed = false;
  const fleet = fleetResponse();

  await installHarness(page, {
    locale: 'en',
    role: 'OWNER',
    api: async (url, route, method) => {
      if (url.pathname === '/api/v1/control/jobs' && method === 'GET') {
        const snapshot = JSON.parse(JSON.stringify(fleet)) as ReturnType<typeof fleetResponse>;
        const target = snapshot.devices[0]!.jobs.find(
          (job) => job.requestId === 'REQ-UNVERIFIED-0001',
        );
        if (target && reviewed) target.reviewedAt = '2026-11-18T09:31:00.000Z';
        await route.fulfill({ json: snapshot });
        return true;
      }
      if (/\/api\/v1\/control\/devices\/[^/]+\/jobs\/[^/]+\/review$/.test(url.pathname) && method === 'POST') {
        const body = JSON.parse(route.request().postData() ?? '{}') as { reviewed?: boolean };
        reviewed = body.reviewed === true;
        await route.fulfill({ json: { reviewed } });
        return true;
      }
      return false;
    },
  });
  await page.goto('/control/jobs?deviceId=dev-john');
  await waitForList(page);

  const counts = page.getByRole('toolbar', { name: s('en').countsLabel });
  const needsReview = counts.getByRole('button', { name: /Needs review/ });
  await expect(needsReview).toContainText('3');

  const drawer = await openDetails(page, 'REQ-UNVERIFIED-0001');
  await expect(drawer.getByText(s('en').reviewedHint, { exact: false })).toBeVisible();
  await drawer.getByRole('button', { name: s('en').markReviewed, exact: true }).click();

  await expect(page.getByText(s('en').reviewedNotice)).toBeVisible();
  await expect(needsReview).toContainText('2');

  // The station's status and verdict stay exactly as reported; only the triage
  // bucket moved, and the row says why.
  const row = rowFor(page, 'REQ-UNVERIFIED-0001');
  await expect(row).toContainText('UNVERIFIED');
  await expect(row).toContainText('Reviewed');
  await expect(drawer.getByRole('button', { name: s('en').unmarkReviewed, exact: true })).toBeVisible();
});

test('R. the list sorts by received time when asked', async ({ page }) => {
  await loadJobs(page, { deviceId: 'dev-john' });
  await waitForList(page);

  const sort = page.getByRole('combobox', { name: s('en').sortLabel });
  await expect(sort).toHaveValue('attention');
  await expect(page.getByText(s('en').needsReviewFirstHint)).toBeVisible();

  // Oldest first: the cancelled job is the oldest of the six.
  await sort.selectOption('oldest');
  await expect(rows(page).first()).toContainText('REQ-CANCELLED-0005');
  // The triage hint must not claim an order that is no longer in effect.
  await expect(page.getByText(s('en').needsReviewFirstHint)).toHaveCount(0);

  await sort.selectOption('newest');
  await expect(rows(page).first()).toContainText('REQ-UNVERIFIED-0001');

  // Back to triage: attention rows first, newest first inside that group.
  await sort.selectOption('attention');
  const ordered = await rowTexts(page);
  expect(ordered[0]).toContain('REQ-UNVERIFIED-0001');
  expect(ordered[2]).toContain('REQ-FAILED-0002');
  await expect(page.getByText(s('en').needsReviewFirstHint)).toBeVisible();
});

test('S. the Reviewed chip narrows the list to the acknowledged outcomes', async ({ page }) => {
  const fleet = fleetResponse();
  // Two outcomes an operator has already checked, on the JOHN station. Marked on
  // the response body, never on the shared fixture - `fleetResponse()` hands back
  // the same job arrays every test uses.
  const acknowledged = new Set(['REQ-UNVERIFIED-0001', 'REQ-FAILED-0002']);

  await installHarness(page, {
    locale: 'en',
    role: 'OWNER',
    api: async (url, route, method) => {
      if (url.pathname === '/api/v1/control/jobs' && method === 'GET') {
        const snapshot = JSON.parse(JSON.stringify(fleet)) as ReturnType<typeof fleetResponse>;
        for (const job of snapshot.devices[0]!.jobs) {
          if (acknowledged.has(job.requestId)) job.reviewedAt = '2026-11-18T09:31:00.000Z';
        }
        await route.fulfill({ json: snapshot });
        return true;
      }
      return false;
    },
  });
  await page.goto('/control/jobs?deviceId=dev-john');
  await waitForList(page);

  const counts = page.getByRole('toolbar', { name: s('en').countsLabel });
  // The reviewed view cuts across the status buckets, so it lives with the
  // filters rather than inside the "filter by status" toolbar.
  const reviewed = page.getByRole('button', { name: new RegExp(s('en').reviewedOnly) });
  await expect(reviewed).toContainText('2');
  await expect(counts.getByRole('button', { name: new RegExp(s('en').reviewedOnly) })).toHaveCount(0);

  // Acknowledged rows no longer need a human, so the triage chip drops to one.
  await expect(counts.getByRole('button', { name: /Needs review/ })).toContainText('1');

  await reviewed.click();
  await expect(reviewed).toHaveAttribute('aria-pressed', 'true');
  const texts = await rowTexts(page);
  expect(texts).toHaveLength(2);
  expect(texts.join(' ')).toContain('REQ-UNVERIFIED-0001');
  expect(texts.join(' ')).toContain('REQ-FAILED-0002');
  // The status is still the station's own word, not a rewrite.
  expect(texts.join(' ')).toContain('UNVERIFIED');

  // Reviewed and Needs review are disjoint, so the two can never be on together:
  // the pair would only ever be an empty list.
  const needsReview = counts.getByRole('button', { name: /Needs review/ });
  await needsReview.click();
  await expect(needsReview).toHaveAttribute('aria-pressed', 'true');
  await expect(reviewed).toHaveAttribute('aria-pressed', 'false');
  await reviewed.click();
  await expect(reviewed).toHaveAttribute('aria-pressed', 'true');
  await expect(needsReview).toHaveAttribute('aria-pressed', 'false');
  expect(await rowTexts(page)).toHaveLength(2);

  // Turning the chip off restores the whole list.
  await reviewed.click();
  await expect(reviewed).toHaveAttribute('aria-pressed', 'false');
  expect((await rowTexts(page)).length).toBeGreaterThan(2);
});

test('S. the selection bar acknowledges several outcomes at once', async ({ page }) => {
  const reviewedIds = new Set<string>();
  const fleet = fleetResponse();

  await installHarness(page, {
    locale: 'en',
    role: 'OWNER',
    api: async (url, route, method) => {
      if (url.pathname === '/api/v1/control/jobs' && method === 'GET') {
        const snapshot = JSON.parse(JSON.stringify(fleet)) as ReturnType<typeof fleetResponse>;
        for (const job of snapshot.devices[0]!.jobs) {
          if (reviewedIds.has(job.id)) job.reviewedAt = '2026-11-18T09:31:00.000Z';
        }
        await route.fulfill({ json: snapshot });
        return true;
      }
      const match = /\/api\/v1\/control\/devices\/[^/]+\/jobs\/([^/]+)\/review$/.exec(url.pathname);
      if (match && method === 'POST') {
        const body = JSON.parse(route.request().postData() ?? '{}') as { reviewed?: boolean };
        const id = decodeURIComponent(match[1]!);
        if (body.reviewed === false) reviewedIds.delete(id);
        else reviewedIds.add(id);
        await route.fulfill({ json: { reviewed: body.reviewed === true } });
        return true;
      }
      return false;
    },
  });
  await page.goto('/control/jobs?deviceId=dev-john');
  await waitForList(page);

  // Select the two attention rows: the unverified job and the failed one.
  await rowFor(page, 'REQ-UNVERIFIED-0001').getByRole('checkbox').check();
  await rowFor(page, 'REQ-FAILED-0002').getByRole('checkbox').check();

  const bar = page.getByRole('region', { name: /2 jobs selected/ });
  const bulk = bar.getByRole('button', { name: new RegExp(s('en').reviewSelected) });
  await expect(bulk).toContainText('2');
  await bulk.click();

  await expect(page.getByText(/Marked 2 jobs as reviewed/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Needs review/ })).toContainText('1');
  // The bulk action clears its own selection so the bar cannot linger.
  await expect(page.getByRole('region', { name: /jobs selected/ })).toHaveCount(0);

  // The same bar takes it back: a mis-clicked batch is one click from undone.
  await rowFor(page, 'REQ-UNVERIFIED-0001').getByRole('checkbox').check();
  await rowFor(page, 'REQ-FAILED-0002').getByRole('checkbox').check();
  const undo = page.getByRole('region', { name: /2 jobs selected/ }).getByRole('button', {
    name: new RegExp(s('en').unreviewSelected),
  });
  await expect(undo).toContainText('2');
  await undo.click();
  await expect(page.getByText(/Removed the review mark from 2 jobs/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Needs review/ })).toContainText('3');
  // With nothing acknowledged left, the reviewed-only view is gone rather than
  // hidden-but-active.
  await expect(page.getByRole('button', { name: new RegExp(s('en').reviewedOnly) })).toHaveCount(0);
});

test('T. cinema panels can be switched off, and the URL keeps the choice', async ({ page }) => {
  await loadJobs(page, { deviceId: null });
  await waitForList(page);

  await page.getByRole('button', { name: s('en').fieldsButton }).click();
  const dialog = page.getByRole('dialog', { name: s('en').fieldsTitle });
  await expect(dialog.getByRole('checkbox', { name: s('en').panelFlow })).toBeVisible();

  // The fleet ladder and the ticker are on for a multi-station board.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: s('en').cinemaEnter }).click();
  const board = page.getByRole('dialog', { name: s('en').cinemaLabel });
  await expect(board.getByText(s('en').cinemaStations)).toBeVisible();
  await expect(board.locator('.cinema-ticker')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(board).toHaveCount(0);

  // Turn both off in the dialog: the board keeps the flow chart and the feed.
  await page.getByRole('button', { name: s('en').fieldsButton }).click();
  await dialog.getByRole('checkbox', { name: s('en').panelTicker }).uncheck();
  await expect(page).toHaveURL(/cinemaPanels=flow(%2C|,)stations/);
  await dialog.getByRole('checkbox', { name: s('en').panelFlow }).uncheck();
  await expect(page).toHaveURL(/cinemaPanels=stations/);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: s('en').cinemaEnter }).click();
  await expect(board.getByText(s('en').cinemaStations)).toBeVisible();
  await expect(board.locator('.cinema-ticker')).toHaveCount(0);
  await expect(board.locator('.cinema-flow')).toHaveCount(0);
  // The feed is never optional.
  await expect(board.getByText(s('en').cinemaFeed)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Screenshots + measured evidence
// ---------------------------------------------------------------------------
for (const locale of ['en', 'th'] as const) {
  test(`evidence ${locale}: list and details screenshots`, async ({ page }) => {
    const copy = s(locale);

    await loadJobs(page, { locale, viewport: { width: 1440, height: 900 }, deviceId: 'dev-john' });
    await waitForList(page, locale);
    await shot(page, `list-1440-${locale}`);

    let drawer = await openDetails(page, 'REQ-UNVERIFIED-0001', locale);
    const incoming = drawer.getByRole('button', { name: copy.incomingData, exact: true });
    const technical = drawer.getByRole('button', { name: copy.technical, exact: true });
    await incoming.click();
    await technical.click();
    // Guard the screenshot content: the desktop shot shows both sections open.
    await expect(incoming).toHaveAttribute('aria-expanded', 'true');
    await expect(technical).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer.locator('.ui-code-block').first()).toBeVisible();
    await shot(page, `details-1440-${locale}`);

    // 1024 list (English only; the fold is the same line in both languages).
    if (locale === 'en') {
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.goto('/control/jobs?deviceId=dev-john');
      await waitForList(page);
      await shot(page, 'list-1024-en');
    }

    // 390: list then a summary-first drawer.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/control/jobs?deviceId=dev-john');
    await waitForList(page, locale);
    await shot(page, `list-390-${locale}`);
    drawer = await openDetails(page, 'REQ-UNVERIFIED-0001', locale);
    // Mobile shot keeps the summary-first state: evidence stays collapsed.
    await expect(drawer.getByRole('button', { name: copy.incomingData, exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(drawer.getByRole('button', { name: copy.technical, exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(drawer.getByText(copy.outputUnconfirmed, { exact: true })).toBeVisible();
    await shot(page, `details-390-${locale}`);
  });
}

for (const locale of ['en', 'th'] as const) {
  test(`evidence ${locale}: cinema board screenshots`, async ({ page }) => {
    await loadJobs(page, { locale, viewport: { width: 1440, height: 900 } });
    await waitForList(page, locale);
    const board = await openCinema(page, locale);
    // Wait for the real data, not a stopwatch: the KPI text only settles at its
    // final value after the count-up, so this also settles the screenshot.
    await expect(board.getByRole('group', { name: s(locale).cinemaTotal })).toContainText('7');
    await shot(page, `cinema-1440-${locale}`);
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/control/jobs?cinema=1');
    await expect(page.getByRole('dialog', { name: s(locale).cinemaLabel })).toBeVisible();
    await expect(
      page.getByRole('dialog').getByRole('group', { name: s(locale).cinemaTotal }),
    ).toContainText('7');
    await shot(page, `cinema-1024-${locale}`);
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/control/jobs?deviceId=dev-john&cinema=1');
    await expect(page.getByRole('dialog', { name: s(locale).cinemaLabel })).toBeVisible();
    await expect(
      page.getByRole('dialog').getByRole('group', { name: s(locale).cinemaTotal }),
    ).toContainText('6');
    await shot(page, `cinema-390-${locale}`);
    await page.keyboard.press('Escape');

    // The row label with display fields chosen (EN only: the values are data).
    if (locale === 'en') {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/control/jobs?deviceId=dev-john&cinema=1&cinemaFields=patient_name,hn');
      const labelled = page.getByRole('dialog', { name: s('en').cinemaLabel });
      await expect(labelled).toBeVisible();
      await expect(
        labelled.getByRole('list', { name: s('en').cinemaFeed }).getByRole('listitem').first(),
      ).toContainText('Somchai Dee');
      await shot(page, 'cinema-1440-fields-en');
      await page.keyboard.press('Escape');
    }
  });
}

test('evidence: measured first-row y, page overflow, nested scrollbars', async ({ browser }) => {
  const evidence: Record<string, unknown> = { generatedAt: new Date().toISOString() };

  for (const locale of ['en', 'th'] as const) {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ] as const) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await installHarness(page, { locale, role: 'OWNER', api: apiHandler([]) });
      await page.goto('/control/jobs?deviceId=dev-john');
      await waitForList(page, locale);

      const box = await rows(page).first().boundingBox();
      const key = `${viewport.width}x${viewport.height}-${locale}`;
      evidence[`firstRow-${key}`] = {
        y: box ? Math.round(box.y) : null,
        viewportHeight: viewport.height,
        aboveFold: box ? box.y > 0 && box.y < viewport.height : false,
      };
      evidence[`pageOverflow-${key}`] = {
        horizontalScroll: await hasHorizontalPageScroll(page),
        documentOverflowPx: await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      };
      evidence[`tableFrame-${key}`] = await overflowReport(page, '.ui-data-table-frame');

      if (viewport.width === 390) {
        evidence[`tableHeaderHidden-${key}`] = await page.locator('thead').first().evaluate((element) => {
          const headBox = element.getBoundingClientRect();
          return {
            width: Math.round(headBox.width * 100) / 100,
            height: Math.round(headBox.height * 100) / 100,
          };
        });

        const drawer = await openDetails(page, LONG_REFERENCE, locale);
        await drawer
          .getByRole('button', { name: s(locale).incomingData, exact: true })
          .click();
        await drawer
          .getByRole('button', { name: s(locale).technical, exact: true })
          .click();
        const drawerBox = await drawer.boundingBox();
        evidence[`mobileDrawer-${key}`] = {
          width: drawerBox ? Math.round(drawerBox.width) : null,
          viewportWidth: viewport.width,
          horizontalOverflowPx: await drawer.evaluate(
            (element) => element.scrollWidth - element.clientWidth,
          ),
          pageOverflowAfterExpandPx: await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        };
        const code = await overflowReport(page, '.ui-code-block');
        evidence[`rawJsonCodeBlock-${key}`] = code;
      }

      await context.close();
    }
  }

  // Desktop drawer: raw JSON must not scroll inside its own box.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await installHarness(page, { locale: 'en', role: 'OWNER', api: apiHandler([]) });
  await page.goto('/control/jobs?deviceId=dev-john');
  await waitForList(page);
  const drawer = await openDetails(page, 'REQ-UNVERIFIED-0001');
  await drawer.getByRole('button', { name: s('en').incomingData, exact: true }).click();
  await drawer.getByRole('button', { name: s('en').technical, exact: true }).click();
  evidence['desktopDrawer-1440x900-en'] = {
    horizontalOverflowPx: await drawer.evaluate((element) => element.scrollWidth - element.clientWidth),
    bodyHorizontalOverflowPx: await drawer
      .locator('.ui-drawer__body')
      .evaluate((element) => element.scrollWidth - element.clientWidth),
  };
  const rawJson = await page.evaluate(() => {
    const block = document.querySelector('.ui-code-block');
    if (!block) return null;
    const style = getComputedStyle(block);
    return {
      overflowY: style.overflowY,
      clientHeight: block.clientHeight,
      scrollHeight: block.scrollHeight,
      innerScrollbar: block.scrollHeight - block.clientHeight > 1,
    };
  });
  evidence['desktopRawJson-1440x900-en'] = rawJson;
  expect(rawJson, 'raw JSON block missing at 1440').not.toBeNull();
  expect(
    rawJson!.innerScrollbar && ['auto', 'scroll'].includes(rawJson!.overflowY),
    'raw JSON has an inner vertical scrollbar at 1440',
  ).toBe(false);
  await context.close();

  writeFileSync(`${ARTIFACTS}/measurements.json`, `${JSON.stringify(evidence, null, 2)}\n`);
});

test('TMP screenshot search hint th', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await loadJobs(page, { locale: 'th', deviceId: 'dev-john', viewport });
    await waitForList(page, 'th');
    const search = page.getByRole('searchbox', { name: s('th').searchLabel });
    await search.fill('ab');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${ARTIFACTS}/tmp-hint-th-${viewport.width}.png`, fullPage: false });
  }
});

for (const locale of ['en', 'th'] as const) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ] as const) {
    test(`D. the search explanation fits ${viewport.width}x${viewport.height} ${locale}`, async ({
      page,
    }) => {
      await loadJobs(page, { locale, deviceId: 'dev-john', viewport });
      await waitForList(page, locale);
      const copy = s(locale);

      const search = page.getByRole('searchbox', { name: copy.searchLabel });
      await search.fill('ab');

      const hint = page.locator('.wcj-search-match').first();
      await expect(hint).toContainText(copy.searchMatchLabel.split('{detail}')[0]!.trim());
      // The hint names the field, not just the value: that is the whole point.
      await expect(hint).toContainText('PATIENT_LABEL');

      // Thai copy is longer than English; the line must wrap inside its cell
      // instead of widening the table or the page. The type size is the app's own
      // `label` rung (the muted secondary size every other cell value uses), read
      // from the token rather than hard-coded here.
      const fits = await hint.evaluate((element) => ({
        overflowsCell: element.scrollWidth - element.clientWidth,
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        labelRung: Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--font-label-size'),
        ),
      }));
      expect(fits.overflowsCell, 'the hint scrolls sideways').toBeLessThanOrEqual(1);
      expect(fits.labelRung, 'the label token is missing').toBeGreaterThan(0);
      expect(fits.fontSize, 'the hint is smaller than the label rung').toBeGreaterThanOrEqual(
        Math.round(fits.labelRung * 16),
      );

      const pageOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(pageOverflow, 'the page scrolls sideways').toBeLessThanOrEqual(1);

      // The row keeps its structure: still one row per job.
      await expect(rows(page)).toHaveCount(JOHN_JOBS.length);
    });
  }
}
