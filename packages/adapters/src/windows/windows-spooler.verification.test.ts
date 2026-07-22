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
  /**
   * Milliseconds the injected clock advances on every `now()` call. Lets a
   * timeout branch (waitForSpooler's `timeout`, waitForDeviceConfirmation's
   * `not-confirmed` / `unverifiable`) resolve after a handful of scripted
   * polls instead of the real 30s/90s deadline — without this, those branches
   * had zero coverage because a test that reached one would spin at full CPU
   * for the real wall-clock duration.
   */
  nowStepMs?: number;
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
  const nextJobs = series(scenario.jobs ?? [[]]);
  const nextDeviceState = series(scenario.deviceStates ?? [undefined]);
  const nextPageCount = series(scenario.pageCounts ?? [undefined]);
  const emitted: string[] = [];

  const deps: WindowsSpoolerDeps = {
    isWindows: true,
    async runPowerShell(command) {
      // Specificity-ordered dispatch: the most specific verb first so a
      // command that happens to contain a substring of another cannot be
      // misrouted. Get-PrinterStatus contains neither verb exactly today,
      // but check it explicitly so a rename fails loudly rather than routing
      // to Get-PrintJob or the empty fallthrough.
      if (/Get-Printer(\s|$|-)/.test(command) || command.includes('PrinterStatus')) {
        return nextStatus();
      }
      if (/Get-PrintJob(\s|$|-)/.test(command)) {
        const jobs = nextJobs();
        return jobs.length === 0 ? '' : JSON.stringify(jobs);
      }
      return '';
    },
    async pipeToPowerShell(_command, input) {
      emitted.push(input);
    },
    async readDeviceState() {
      return nextDeviceState();
    },
    async readPageCount() {
      return nextPageCount();
    },
    async resolveSnmpHost() {
      return scenario.snmpHost;
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

describe('print verification chain', () => {
  it('reports success only when the device page counter proves a page came out', async () => {
    const { adapter, emitted } = makeAdapter({
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [101],
    });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(true);
    expect(result.errorCode).toBeUndefined();
    expect(result.message).toContain('device confirmed 1 page(s) printed (counter 100 → 101)');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain('PrintOps Test Page');
  });

  it('keeps a confirmed page confirmed even when the device then reports a fault', async () => {
    // The counter moves and the printer raises noPaper in the same breath —
    // typically the next page's tray. The page that already printed stands.
    const { adapter } = makeAdapter({
      snmpHost: SNMP_HOST,
      deviceStates: [
        deviceState({ pageCount: 100 }),
        deviceState({ blocked: true, errors: ['noPaper'] }),
      ],
      pageCounts: [101],
    });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(true);
    expect(result.errorCode).toBeUndefined();
  });

  it('fails when the spooler blocks the job, even with a device that would confirm', async () => {
    const { adapter } = makeAdapter({
      jobs: [[], [{ Id: 7, JobStatus: 'Error, Retained' }]],
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [101],
    });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_JOB_ERROR');
    expect(result.message).toContain(`test page failed on "${PRINTER_NAME}"`);
    expect(result.message).toContain('job status: Error, Retained');
  });

  it('refuses to send to a printer Windows already reports as faulted', async () => {
    const { adapter, emitted } = makeAdapter({ printerStatus: ['PaperOut'] });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINTER_NOT_READY');
    expect(result.message).toContain(`Printer "${PRINTER_NAME}" is PaperOut — not sending job`);
    expect(emitted).toHaveLength(0);
  });

  it('fails when the device raises a fault before any page came out', async () => {
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
    expect(result.errorCode).toBe('PRINT_NOT_CONFIRMED_BY_DEVICE');
    expect(result.message).toContain('printer reports noPaper');
  });

  it('refuses to send to a printer the device itself reports as blocked', async () => {
    const { adapter, emitted } = makeAdapter({
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ blocked: true, errors: ['noPaper', 'doorOpen'] })],
    });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINTER_DEVICE_ERROR');
    expect(result.message).toContain('reports noPaper, doorOpen — not sending job');
    expect(emitted).toHaveLength(0);
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

  it('treats a counter that was read but never moved as a real negative', async () => {
    // The opposite of the case above: the device answers throughout, the
    // counter just never advances. That IS a proven non-print, so retrying is
    // safe and this must stay PRINT_NOT_CONFIRMED_BY_DEVICE (→ FAILED).
    const { adapter } = makeAdapter({
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: 100 })],
      pageCounts: [100],
    });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_CONFIRMED_BY_DEVICE');
    expect(result.message).toContain('page counter did not advance within');
    expect(result.message).toContain('counter 100 → 100');
  });

  it("reports the spooler's own timeout when the job never leaves the queue", async () => {
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
  it('fails when no SNMP address can be derived, and says how to get one', async () => {
    const { adapter } = makeAdapter({ snmpHost: undefined });

    const result = await adapter.printTestPage(CONNECTION_URI, 'printer-1');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.message).toContain(`No SNMP address could be derived for "${PRINTER_NAME}"`);
    expect(result.message).toContain(
      "Install the vendor driver on a Standard TCP/IP port, or set the printer's snmpHost metadata.",
    );
  });

  it('fails when the device does not answer SNMP, and says what to check', async () => {
    const { adapter } = makeAdapter({ snmpHost: SNMP_HOST, deviceStates: [undefined] });

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
      snmpHost: SNMP_HOST,
      deviceStates: [deviceState({ pageCount: undefined })],
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
  it('will not call a print verified when no device could confirm it', async () => {
    const { adapter, emitted } = makeAdapter({ snmpHost: undefined });

    const result = await adapter.executeCommand(printCommand());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.jobId).toBe('job-1');
    expect(result.message).toContain(`job job-1 on "${PRINTER_NAME}"`);
    expect(emitted).toEqual(['hello']);
  });

  it('confirms at the device before reporting success', async () => {
    const { adapter } = makeAdapter({
      snmpHost: SNMP_HOST,
      // The first reading answers executeCommand's own online check, the second
      // is the pre-send baseline.
      deviceStates: [deviceState({ printerStatus: 3 }), deviceState({ pageCount: 100 })],
      pageCounts: [102],
    });

    const result = await adapter.executeCommand(printCommand({ copies: 2 }));

    expect(result.success).toBe(true);
    expect(result.errorCode).toBeUndefined();
    expect(result.message).toContain('device confirmed 2 page(s) printed (counter 100 → 102)');
  });
});
