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
      // The chain asks PowerShell exactly two things; dispatch on which.
      if (command.includes('Get-PrintJob')) {
        const jobs = nextJobs();
        return jobs.length === 0 ? '' : JSON.stringify(jobs);
      }
      if (command.includes('PrinterStatus')) return nextStatus();
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
    // Real wall-clock deadlines still apply; every scenario below is terminal
    // on its first poll, so no loop here spins.
    async sleep() {},
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
