/**
 * The print-verification invariant, exercised without a printer.
 *
 * SUCCESS is reported only when a device-level channel proved a page came out.
 * The spooler may DISPROVE a print but may never PROVE one, and a device-channel
 * failure must never demote a print a device reading already confirmed.
 *
 * Both `executeCommand` and `printTestPage` run the same chain, so these drive
 * it mostly through `printTestPage` — the route that was reporting success on
 * the spooler's word alone, and the one that reaches the chain with the least
 * around it.
 */
import { describe, it, expect } from 'vitest';
import { WindowsSpoolerAdapter, type WindowsSpoolerDeps } from './windows-spooler.adapter.js';
import type { PrinterDeviceState } from '../snmp/printer-mib.js';
import type { IppRemoteJob } from './ipp-printer-client.js';
import type { PrintCommand } from '@printerops/domain';

const CONNECTION_URI = 'spooler://runner-1/EPSON%20L15160';
const PRINTER_NAME = 'EPSON L15160';
const SNMP_HOST = '192.0.2.10';

type SpoolerJob = { Id: number; JobStatus: string };

interface Scenario {
  /** Successive `Get-Printer` answers; the last one repeats. */
  printerStatus?: string[];
  /** Successive `Get-PrintJob` answers; the last one repeats. */
  jobs?: SpoolerJob[][];
  /** What the Windows port resolves to, or undefined when it exposes nothing. */
  snmpHost?: string;
  /** Successive SNMP device readings; undefined means the printer did not answer. */
  deviceStates?: Array<PrinterDeviceState | undefined>;
  /** Successive page-counter readings. */
  pageCounts?: Array<number | undefined>;
  /** Dedicated pre-submit counter baseline; null simulates no response. */
  baselinePageCount?: number | null;
  /**
   * Milliseconds the injected clock advances on every `now()` call. Lets a
   * timeout branch (waitForSpooler's `timeout`, waitForDeviceConfirmation's
   * `not-confirmed` / `unverifiable`) resolve after a handful of scripted
   * polls instead of the real 30s/90s deadline — without this, those branches
   * had zero coverage because a test that reached one would spin at full CPU
   * for the real wall-clock duration.
   */
  nowStepMs?: number;
  /** Make the Nth text/raw submission fail after earlier copies were accepted. */
  failPipeAt?: number;
  /** Simulated result from the WebView2 PowerShell watcher. */
  htmlSubmission?: { helperStatus: string; observedAt: string; jobs: Array<{ id: number; status: string; documentName: string }> };
  htmlSubmissionError?: string;
  /** 1-based Get-PrintJob query attempts that should fail. */
  jobQueryFailures?: number[];
  /** Return a completed exact-name printer-side IPP job after the baseline. */
  ippConfirmed?: boolean;
  /** Fully scripted IPP Get-Jobs answers; undefined entries are query errors. */
  ippJobs?: Array<IppRemoteJob[] | undefined>;
}

/** Read a scripted series, repeating the final entry once it runs out. */
function series<T>(values: T[]): () => T {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] as T;
}

function deviceState(overrides: Partial<PrinterDeviceState> = {}): PrinterDeviceState {
  return { host: SNMP_HOST, pageCount: 100, errors: [], blocked: false, ...overrides };
}

/**
 * Build an adapter whose whole outside world is scripted. `emitted` collects
 * what was actually handed to the spooler, so a refusal can be told apart from
 * a print that went out and was then disowned.
 *
 * Dispatch caveat (MEDIUM-9): the PowerShell stub keys on the EXACT command
 * verb, checked in specificity order (Get-Printer before Get-PrintJob), not on
 * a loose includes() that a rename could silently misroute — e.g. a future
 * Get-PrinterStatus must not fall into the Get-PrintJob branch. The device-state
 * series is shared across pre-flight, baseline, and the confirmation loop:
 * adding an SNMP read anywhere shifts every later index. Most scenarios below
 * are written to resolve on their first poll (the nextStatus/nextJobs/
 * nextDeviceState readers repeat their last entry, which is why that works);
 * the ones that deliberately run to a timeout instead rely on the scripted
 * `now()` clock above to get there in a few scripted polls.
 */
function makeAdapter(scenario: Scenario = {}) {
  const nextStatus = series(scenario.printerStatus ?? ['Normal']);
  const nextJobs = series(scenario.jobs ?? [[], [{ Id: 1, JobStatus: 'Complete' }]]);
  const nextDeviceState = series(scenario.deviceStates ?? [undefined]);
  const nextPageCount = series(scenario.pageCounts ?? [undefined]);
  const emitted: string[] = [];
  let pipeAttempt = 0;
  let pageCountRead = 0;
  let jobQueryAttempt = 0;
  let ippQueryAttempt = 0;
  const nextIppJobs = scenario.ippJobs ? series(scenario.ippJobs) : undefined;

  const deps: WindowsSpoolerDeps = {
    isWindows: true,
    async runPowerShell(command) {
      if (scenario.htmlSubmissionError && command.includes('expectedDocumentName=')) {
        throw new Error(scenario.htmlSubmissionError);
      }
      if (scenario.htmlSubmission && command.includes('expectedDocumentName=')) {
        return JSON.stringify(scenario.htmlSubmission);
      }
      // Specificity-ordered dispatch: the most specific verb first so a
      // command that happens to contain a substring of another cannot be
      // misrouted. Get-PrinterStatus contains neither verb exactly today,
      // but check it explicitly so a rename fails loudly rather than routing
      // to Get-PrintJob or the empty fallthrough.
      if (/Get-Printer(\s|$|-)/.test(command) || command.includes('PrinterStatus')) {
        return nextStatus();
      }
      if (/Get-PrintJob(\s|$|-)/.test(command)) {
        jobQueryAttempt += 1;
        if (scenario.jobQueryFailures?.includes(jobQueryAttempt)) {
          throw new Error(`simulated Get-PrintJob telemetry failure ${jobQueryAttempt}`);
        }
        const jobs = nextJobs();
        return jobs.length === 0 ? '' : JSON.stringify(jobs);
      }
      return '';
    },
    async pipeToPowerShell(_command, input) {
      pipeAttempt += 1;
      if (scenario.failPipeAt === pipeAttempt) throw new Error(`simulated submission failure ${pipeAttempt}`);
      emitted.push(input);
    },
    async readDeviceState() {
      return nextDeviceState();
    },
    async readPageCount() {
      if (pageCountRead++ === 0) {
        if (scenario.baselinePageCount === null) return undefined;
        return scenario.baselinePageCount ?? (scenario.snmpHost ? 100 : undefined);
      }
      return nextPageCount();
    },
    async resolveSnmpHost() {
      return scenario.snmpHost;
    },
    async queryIppJobs(endpoint) {
      ippQueryAttempt += 1;
      const scripted = nextIppJobs?.();
      if (nextIppJobs && scripted === undefined) {
        return { ok: false, endpoint, jobs: [], error: `simulated IPP failure ${ippQueryAttempt}` };
      }
      if (nextIppJobs) return { ok: true, endpoint, jobs: scripted ?? [], statusCode: 0 };
      if (!scenario.ippConfirmed) {
        return { ok: false, endpoint, jobs: [], error: 'simulated IPP unavailable' };
      }
      const jobs: IppRemoteJob[] = ippQueryAttempt === 1 ? [] : [{
        key: 'ipp-job:900',
        id: 900,
        uri: 'ipp://printer/ipp/print/job-900',
        name: 'PrintOps_job-1',
        state: 9,
        stateReasons: ['completed-successfully'],
        impressionsCompleted: 1,
      }];
      return { ok: true, endpoint, jobs, statusCode: 0 };
    },
    async sleep() {},
    // A scripted clock: every read advances it by nowStepMs, so a scenario
    // that runs to a timeout gets there in a handful of scripted polls rather
    // than the real 30s/90s wall-clock wait.
    now: (() => {
      let clock = 0;
      const step = scenario.nowStepMs ?? 10_000;
      return () => {
        const t = clock;
        clock += step;
        return t;
      };
    })(),
    htmlPrintHelperPath: process.execPath,
  };

  return { adapter: new WindowsSpoolerAdapter(deps), emitted };
}

function printCommand(overrides: Partial<PrintCommand> = {}): PrintCommand {
  return {
    jobId: 'job-1',
    printerId: 'printer-1',
    traceId: 'trace-1',
    connectionUri: CONNECTION_URI,
    renderedPrintPayload: 'hello',
    mimeType: 'text/plain',
    copies: 1,
    duplex: false,
    colorMode: 'auto',
    metadata: {},
    ...overrides,
  };
}

function htmlPrintCommand(overrides: Partial<PrintCommand> = {}): PrintCommand {
  return printCommand({
    mimeType: 'text/html',
    renderedPrintPayload: '<main style="width:70mm;height:30mm">label</main>',
    metadata: { paperProfile: { widthMm: 70, heightMm: 30, orientation: 'landscape' } },
    ...overrides,
  });
}

function exactHtmlSubmission(id = 77) {
  return {
    helperStatus: 'Succeeded',
    observedAt: '2026-07-22T12:00:00.000Z',
    jobs: [{ id, status: 'Printing', documentName: 'PrintOps:job-1' }],
  };
}

describe('print verification chain', () => {
  it('does not let an attended sandbox bypass device confirmation', async () => {
    const { adapter, emitted } = makeAdapter({
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [100],
    });

    const result = await adapter.executeCommand(printCommand({
      metadata: { sandbox: true, skipDeviceConfirmation: true },
    }));

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('page counter did not advance');
    expect(emitted).toEqual(['hello']);
  });

  it('reports success only when an exact Windows job and device counter prove output', async () => {
    const { adapter } = makeAdapter({
      htmlSubmission: exactHtmlSubmission(),
      ippConfirmed: true,
      jobs: [[], []],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [101],
    });

    const result = await adapter.executeCommand(htmlPrintCommand());

    expect(result.success).toBe(true);
    expect(result.errorCode).toBeUndefined();
    expect(result.message).toContain('printer confirmed 1 exact IPP job impression(s) completed successfully');
    expect((result.raw as Record<string, unknown>)['deviceConfirmed']).toBe(true);
  });

  it('keeps a confirmed page confirmed even when the device then reports a fault', async () => {
    // The counter moves and the printer raises noPaper in the same breath —
    // typically the next page's tray. The page that already printed stands.
    const { adapter } = makeAdapter({
      htmlSubmission: exactHtmlSubmission(),
      ippConfirmed: true,
      jobs: [[], []],
      snmpHost: SNMP_HOST,
      deviceStates: [
        deviceState({ pageCount: 100 }),
        deviceState({ blocked: true, errors: ['noPaper'] }),
      ],
      pageCounts: [101],
    });

    const result = await adapter.executeCommand(htmlPrintCommand());

    expect(result.success).toBe(true);
    expect(result.errorCode).toBeUndefined();
  });

  it('keeps device-confirmed pages successful even if Windows retains a blocked row', async () => {
    const { adapter } = makeAdapter({
      htmlSubmission: exactHtmlSubmission(7),
      ippConfirmed: true,
      jobs: [[], [{ Id: 7, JobStatus: 'Error, Retained' }]],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [101],
    });

    const result = await adapter.executeCommand(htmlPrintCommand());

    expect(result.success).toBe(true);
    expect(result.errorCode).toBeUndefined();
    expect(result.message).toContain('printer confirmed 1 exact IPP job impression(s) completed successfully');
  });

  it('keeps a blocked submitted job UNVERIFIED because it may resume later', async () => {
    const { adapter } = makeAdapter({
      jobs: [[], [{ Id: 7, JobStatus: 'Error, Retained' }]],
      snmpHost: SNMP_HOST,
      deviceStates: [
        deviceState({ pageCount: 100 }),
        deviceState({ blocked: true, errors: ['noPaper'] }),
      ],
      pageCounts: [100],
    });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('may resume later');
    expect(result.message).toContain('Do not auto-retry');
  });

  it('allows a transient Windows PaperOut to recover and confirms the physical page', async () => {
    const { adapter, emitted } = makeAdapter({
      printerStatus: ['PaperOut'],
      htmlSubmission: exactHtmlSubmission(),
      ippConfirmed: true,
      jobs: [[], []],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [101],
    });

    const result = await adapter.executeCommand(htmlPrintCommand());

    expect(result.success).toBe(true);
    expect(result.message).toContain('printer confirmed 1 exact IPP job impression(s) completed successfully');
    expect((result.raw as Record<string, unknown>)['windowsPreflightFault']).toBe('PaperOut');
    expect(emitted).toHaveLength(0);
  });

  it('keeps a post-submission device fault UNVERIFIED because buffered work may resume', async () => {
    const { adapter } = makeAdapter({
      snmpHost: SNMP_HOST,
      deviceStates: [
        deviceState({ pageCount: 100 }),
        deviceState({ blocked: true, errors: ['noPaper'] }),
      ],
      pageCounts: [100],
    });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('printer reported noPaper');
    expect(result.message).toContain('may resume later');
    expect(result.message).toContain('Do not auto-retry');
  });

  it('allows a device fault to recover after submission and confirms output', async () => {
    const { adapter, emitted } = makeAdapter({
      htmlSubmission: exactHtmlSubmission(),
      ippConfirmed: true,
      jobs: [[], []],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ blocked: true, errors: ['noPaper', 'doorOpen'] })],
      pageCounts: [101],
    });

    const result = await adapter.executeCommand(htmlPrintCommand());

    expect(result.success).toBe(true);
    expect(result.message).toContain('printer confirmed 1 exact IPP job impression(s) completed successfully');
    expect((result.raw as Record<string, unknown>)['deviceBlockedBefore']).toBe(true);
    expect(emitted).toHaveLength(0);
  });

  it('uses live SNMP hardware state when Windows has a stale PaperOut flag', async () => {
    const { adapter } = makeAdapter({
      printerStatus: ['PaperOut'],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ printerStatus: 3 })],
    });

    const status = await adapter.getStatus(CONNECTION_URI);

    expect(status.code).toBe('idle');
    expect(status.message).toContain('pages=100');
    expect(status.message).toContain('Windows spooler reports PaperOut');
  });
});

describe('timeouts', () => {
  it('treats a device that never answers during verification as unverifiable, not failed', async () => {
    // The counter is readable at the pre-send baseline (so the device channel
    // is live) but goes silent for the whole confirmation window — a network
    // blip, not a "no page" answer. HIGH-2: this must land on PRINT_NOT_VERIFIABLE
    // (→ UNVERIFIED, not retryable), never PRINT_NOT_CONFIRMED_BY_DEVICE
    // (→ FAILED, retryable — which risks a duplicate page for paper that may
    // already have printed).
    const { adapter } = makeAdapter({
      snmpHost: SNMP_HOST,
      // First read is the pre-send baseline; every read after that (all of
      // them inside waitForDeviceConfirmation) returns undefined.
      deviceStates: [deviceState({ pageCount: 100 }), undefined],
      pageCounts: [undefined],
    });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('device stopped answering SNMP during verification');
    expect(result.message).toContain('Paper may have come out — do not auto-retry.');
  });

  it('keeps an unchanged counter UNVERIFIED because delayed buffered output can still occur', async () => {
    const { adapter } = makeAdapter({
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [100],
    });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('page counter did not advance within');
    expect(result.message).toContain('counter 100 → 100');
  });

  it('stays UNVERIFIED when the counter answered once but went silent before the final read', async () => {
    const { adapter } = makeAdapter({
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [100, undefined],
    });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('page counter stopped answering before final verification');
    expect(result.message).toContain('do not auto-retry');
  });

  it("keeps a spooler timeout UNVERIFIED because the queued job may print later", async () => {
    // No SNMP at all, so this isolates waitForSpooler's `timeout` outcome: a
    // job that sits at an active (non-terminal, non-blocking) status forever.
    const { adapter } = makeAdapter({
      // Empty before the print is sent (the beforeIds snapshot), then our own
      // job shows up and stays "Printing" — active, not blocking, not done —
      // for the rest of the run.
      jobs: [[], [{ Id: 99, JobStatus: 'Printing' }]],
      snmpHost: undefined,
    });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('still queued after');
    expect(result.message).toContain('last status: Printing');
  });
});

describe('unverifiable prints', () => {
  it('keeps a device-negative result UNVERIFIED when Windows never exposed the submitted job', async () => {
    const { adapter } = makeAdapter({
      jobs: [[]],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [100],
    });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('no new Windows spooler job was observed');
    expect(result.message).toContain('Do not auto-retry');
  });

  it('keeps a successful submission UNVERIFIED when Windows never exposes its job', async () => {
    const { adapter } = makeAdapter({ snmpHost: undefined, jobs: [[]] });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('no new Windows spooler job was observed');
  });

  it('fails when no SNMP address can be derived, and says how to get one', async () => {
    const { adapter } = makeAdapter({
      jobs: [[], [{ Id: 1, JobStatus: 'Complete' }]],
      snmpHost: undefined,
    });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain(`No SNMP address could be derived for "${PRINTER_NAME}"`);
    expect(result.message).toContain(
      "Install the vendor driver on a Standard TCP/IP port, or set the printer's snmpHost metadata.",
    );
  });

  it('fails when the device does not answer SNMP, and says what to check', async () => {
    const { adapter } = makeAdapter({
      jobs: [[], [{ Id: 1, JobStatus: 'Complete' }]],
      snmpHost: SNMP_HOST,
      deviceStates: [undefined],
      baselinePageCount: null,
    });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain(`The device at ${SNMP_HOST} did not answer SNMP on port 161.`);
    expect(result.message).toContain(
      'Check that the printer is powered on and on this network, and that SNMP is enabled on it.',
    );
  });

  it('fails when the device exposes no page counter, and says what to install', async () => {
    const { adapter } = makeAdapter({
      jobs: [[], [{ Id: 1, JobStatus: 'Complete' }]],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: undefined })],
      baselinePageCount: null,
    });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain(
      `The device at ${SNMP_HOST} answered SNMP but exposes no page counter (prtMarkerLifeCount).`,
    );
    expect(result.message).toContain(
      'Install the vendor driver for this model, or point snmpHost at an interface that reports it.',
    );
  });
});

describe('executeCommand shares the same chain', () => {
  it('never sends JSON layout bytes as RAW data to a Windows office driver', async () => {
    const { adapter, emitted } = makeAdapter({ snmpHost: undefined });

    const result = await adapter.executeCommand(printCommand({ mimeType: 'application/json_layout' }));

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('UNSUPPORTED_PRINT_FORMAT');
    expect(result.message).toContain('cannot be sent as RAW data');
    expect(emitted).toHaveLength(0);
  });

  it('never reports text/RAW SUCCESS from the printer-global SNMP counter alone', async () => {
    const { adapter } = makeAdapter({
      jobs: [[], [{ Id: 1, JobStatus: 'Complete' }]],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [101],
    });

    const result = await adapter.executeCommand(printCommand());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect((result.raw as Record<string, unknown>)['correlationIssues']).toContain(
      'no printer-side job-specific confirmation is available for this print format',
    );
  });

  it('will not call a print verified when no device could confirm it', async () => {
    const { adapter, emitted } = makeAdapter({
      jobs: [[], [{ Id: 1, JobStatus: 'Complete' }]],
      snmpHost: undefined,
    });

    const result = await adapter.executeCommand(printCommand());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.jobId).toBe('job-1');
    expect(result.message).toContain(`job job-1 on "${PRINTER_NAME}"`);
    expect(emitted).toEqual(['hello']);
  });

  it('confirms at the device before reporting success', async () => {
    const { adapter } = makeAdapter({
      htmlSubmission: exactHtmlSubmission(),
      ippConfirmed: true,
      jobs: [[], []],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [101],
    });

    const result = await adapter.executeCommand(htmlPrintCommand());

    expect(result.success).toBe(true);
    expect(result.errorCode).toBeUndefined();
    expect(result.message).toContain('printer confirmed 1 exact IPP job impression(s) completed successfully');
  });

  it('keeps an exact SNMP +1 UNVERIFIED when the spooler never observed our job', async () => {
    // The device counter is printer-global: an increment alone cannot prove
    // THIS document printed, and without the spooler observing our exact job
    // the spooler-delivery fallback must not fire either.
    const { adapter } = makeAdapter({
      htmlSubmission: { ...exactHtmlSubmission(), jobs: [] },
      jobs: [[], []],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [101],
    });

    const result = await adapter.executeCommand(htmlPrintCommand());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('Physical output cannot be attributed safely');
    expect((result.raw as Record<string, unknown>)['deviceCounterAdvanced']).toBe(true);
    expect((result.raw as Record<string, unknown>)['ippJobConfirmed']).toBe(false);
    expect((result.raw as Record<string, unknown>)['deviceConfirmation']).toBeUndefined();
  });

  it('does not accept a different remote IPP job when the global counter advances', async () => {
    const wrongJob: IppRemoteJob = {
      key: 'ipp-job:other',
      id: 901,
      name: 'Browser_document',
      state: 9,
      stateReasons: ['completed-successfully'],
      impressionsCompleted: 1,
    };
    const { adapter } = makeAdapter({
      htmlSubmission: exactHtmlSubmission(),
      jobs: [[], []],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [101],
      ippJobs: [[], [wrongJob]],
    });

    const result = await adapter.executeCommand(htmlPrintCommand());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('no new exact-name job was observed');
    expect((result.raw as Record<string, unknown>)['ippObservedJobs']).toEqual([]);
  });

  it('requires exact printer-side completed impressions, not completed state alone', async () => {
    const inconsistentJob: IppRemoteJob = {
      key: 'ipp-job:902',
      id: 902,
      name: 'PrintOps_job-1',
      state: 9,
      stateReasons: ['completed-successfully'],
      impressionsCompleted: 2,
    };
    const { adapter } = makeAdapter({
      htmlSubmission: exactHtmlSubmission(),
      jobs: [[], []],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [101],
      ippJobs: [[], [inconsistentJob]],
    });

    const result = await adapter.executeCommand(htmlPrintCommand());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('report 2 impression(s), expected exactly 1');
  });

  it('does not reuse a same-name completed IPP job that existed before submission', async () => {
    const oldJob: IppRemoteJob = {
      key: 'ipp-job:old',
      id: 800,
      name: 'PrintOps_job-1',
      state: 9,
      stateReasons: ['completed-successfully'],
      impressionsCompleted: 1,
    };
    const { adapter } = makeAdapter({
      htmlSubmission: exactHtmlSubmission(),
      jobs: [[], []],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [101],
      ippJobs: [[oldJob]],
    });

    const result = await adapter.executeCommand(htmlPrintCommand());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('no new exact-name job was observed');
  });

  it('records a partial page-count advance as UNVERIFIABLE so retry cannot duplicate it', async () => {
    const { adapter } = makeAdapter({
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ printerStatus: 3 }), deviceState({ pageCount: 100 })],
      pageCounts: [101],
    });

    const result = await adapter.executeCommand(printCommand({ copies: 2 }));

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('only 1 of 2 requested page(s)');
    expect(result.message).toContain('Do not auto-retry');
    expect((result.raw as Record<string, unknown>)['pagesPrintedDelta']).toBe(1);
  });

  it('preserves partial-submission evidence and makes it non-retryable', async () => {
    const { adapter, emitted } = makeAdapter({ failPipeAt: 2 });

    const result = await adapter.executeCommand(printCommand({ copies: 2 }));

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('may have printed 1 of 2');
    expect((result.raw as Record<string, unknown>)['submittedCopies']).toBe(1);
    expect(emitted).toEqual(['hello']);
  });

  it('keeps an unknown first Out-Printer failure UNVERIFIED because submission may have started', async () => {
    const { adapter, emitted } = makeAdapter({ failPipeAt: 1 });

    const result = await adapter.executeCommand(printCommand());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('Do not auto-retry');
    expect((result.raw as Record<string, unknown>)['attemptedCopies']).toBe(1);
    expect(emitted).toHaveLength(0);
  });

  it('keeps verifying when progress persistence fails after an exact HTML job was observed', async () => {
    const { adapter } = makeAdapter({
      htmlSubmission: {
        helperStatus: 'Succeeded',
        observedAt: '2026-07-22T12:00:00.000Z',
        jobs: [{ id: 77, status: 'Printing', documentName: 'PrintOps:job-1' }],
      },
      ippConfirmed: true,
      jobs: [[], []],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ printerStatus: 3 }), deviceState({ pageCount: 100 })],
      pageCounts: [101],
    });

    const result = await adapter.executeCommand(printCommand({
      mimeType: 'text/html',
      renderedPrintPayload: '<main style="width:70mm;height:30mm">label</main>',
      metadata: { paperProfile: { widthMm: 70, heightMm: 30, orientation: 'landscape' } },
      onProgress: async () => { throw new Error('database write unavailable'); },
    }));

    expect(result.success).toBe(true);
    expect((result.raw as Record<string, unknown>)['spoolerJobIds']).toEqual(['77']);
    expect((result.raw as Record<string, unknown>)['progressPersistenceError']).toContain('database write unavailable');
  });

  it('uses exact printer-side IPP proof when the short-lived Windows queue row was missed', async () => {
    const { adapter } = makeAdapter({
      htmlSubmission: {
        helperStatus: 'Succeeded',
        observedAt: '2026-07-22T12:00:00.000Z',
        jobs: [],
      },
      ippConfirmed: true,
      jobs: [[]],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [101],
    });

    const result = await adapter.executeCommand(printCommand({
      mimeType: 'text/html',
      renderedPrintPayload: '<main style="width:70mm;height:30mm">label</main>',
      metadata: { paperProfile: { widthMm: 70, heightMm: 30, orientation: 'landscape' } },
    }));

    expect(result.success).toBe(true);
    expect(result.errorCode).toBeUndefined();
    expect(result.message).toContain('printer confirmed 1 exact IPP job impression(s) completed successfully');
    expect((result.raw as Record<string, unknown>)['spoolerJobIds']).toEqual([]);
    expect((result.raw as Record<string, unknown>)['spoolerOutcome']).toBe('not-observed');
    expect((result.raw as Record<string, unknown>)['deviceConfirmation']).toBe('ipp-job');
  });

  it('does not let unrelated global-counter movement obscure exact IPP proof', async () => {
    const { adapter } = makeAdapter({
      htmlSubmission: exactHtmlSubmission(),
      ippConfirmed: true,
      jobs: [[], []],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [102],
    });

    const result = await adapter.executeCommand(htmlPrintCommand());

    expect(result.success).toBe(true);
    expect(result.errorCode).toBeUndefined();
    expect((result.raw as Record<string, unknown>)['pagesPrintedDelta']).toBe(2);
    expect((result.raw as Record<string, unknown>)['deviceConfirmation']).toBe('ipp-job');
  });

  it('keeps a pre-existing Windows job as evidence but trusts exact IPP completion', async () => {
    const { adapter } = makeAdapter({
      htmlSubmission: exactHtmlSubmission(),
      ippConfirmed: true,
      jobs: [
        [{ Id: 4, JobStatus: 'Printing' }],
        [{ Id: 4, JobStatus: 'Printing' }],
      ],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [101],
    });

    const result = await adapter.executeCommand(htmlPrintCommand());

    expect(result.success).toBe(true);
    expect((result.raw as Record<string, unknown>)['correlationIssues']).toContain(
      'pre-existing active/resumable job(s): 4',
    );
  });

  it('ignores an already completed retained history row when correlating a new page', async () => {
    const { adapter } = makeAdapter({
      htmlSubmission: exactHtmlSubmission(),
      ippConfirmed: true,
      jobs: [
        [{ Id: 4, JobStatus: 'Complete, Retained' }],
        [{ Id: 4, JobStatus: 'Complete, Retained' }],
      ],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [101],
    });

    const result = await adapter.executeCommand(htmlPrintCommand());

    expect(result.success).toBe(true);
    expect((result.raw as Record<string, unknown>)['preexistingUnsafeJobs']).toEqual([]);
    expect((result.raw as Record<string, unknown>)['deviceConfirmed']).toBe(true);
  });

  it('keeps a print-queue telemetry gap as evidence while exact IPP proof succeeds', async () => {
    const { adapter } = makeAdapter({
      htmlSubmission: exactHtmlSubmission(),
      ippConfirmed: true,
      jobs: [[], []],
      jobQueryFailures: [2],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [101],
    });

    const result = await adapter.executeCommand(htmlPrintCommand());

    expect(result.success).toBe(true);
    expect((result.raw as Record<string, unknown>)['correlationIssues']).toEqual(
      expect.arrayContaining([expect.stringContaining('queue telemetry gap')]),
    );
  });

  it('uses the dedicated immediate page-counter baseline instead of an older status value', async () => {
    const { adapter } = makeAdapter({
      htmlSubmission: exactHtmlSubmission(),
      ippConfirmed: true,
      jobs: [[], []],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 999 })],
      baselinePageCount: 100,
      pageCounts: [101],
    });

    const result = await adapter.executeCommand(htmlPrintCommand());

    expect(result.success).toBe(true);
    expect(result.message).toContain('printer confirmed 1 exact IPP job impression(s) completed successfully');
    expect((result.raw as Record<string, unknown>)['pagesBefore']).toBe(100);
  });

  it('does not treat generic octet-stream bytes as a printer language', async () => {
    const { adapter, emitted } = makeAdapter();

    const result = await adapter.executeCommand(printCommand({ mimeType: 'application/octet-stream' }));

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('UNSUPPORTED_PRINT_FORMAT');
    expect(emitted).toHaveLength(0);
  });

  it('treats an internal PrintAsync timeout as ambiguous even on the first copy', async () => {
    const { adapter } = makeAdapter({
      htmlSubmissionError: 'WEBVIEW2_PRINT_FAILED: HelperError: Timed out while submitting the document to Windows',
    });

    const result = await adapter.executeCommand(printCommand({
      mimeType: 'text/html',
      renderedPrintPayload: '<main style="width:70mm;height:30mm">label</main>',
      metadata: { paperProfile: { widthMm: 70, heightMm: 30, orientation: 'landscape' } },
    }));

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain('Do not auto-retry');
  });

  it('keeps a definite PrinterUnavailable rejection retryable', async () => {
    const { adapter } = makeAdapter({
      htmlSubmissionError: 'WEBVIEW2_PRINT_FAILED: PrinterUnavailable: selected printer does not exist',
    });

    const result = await adapter.executeCommand(printCommand({
      mimeType: 'text/html',
      renderedPrintPayload: '<main style="width:70mm;height:30mm">label</main>',
      metadata: { paperProfile: { widthMm: 70, heightMm: 30, orientation: 'landscape' } },
    }));

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('WEBVIEW2_PRINT_FAILED');
  });
});
