/**
 * Serve-mode HTML helper tests (DEFECT-05): the adapter keeps ONE persistent
 * `--serve` helper process per printer so WebView2 initialises once per
 * printer instead of once per job, recycles a wedged helper, and preserves
 * per-printer serialisation (the adapter's printerLocks + the helper's
 * strict one-request-at-a-time loop).
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  WindowsSpoolerAdapter,
  buildHtmlPrintServeScript,
  type WindowsSpoolerDeps,
} from './windows-spooler.adapter.js';
import type { PrinterDeviceState } from '../snmp/printer-mib.js';
import type { IppRemoteJob } from './ipp-printer-client.js';
import type { PrintCommand } from '@printerops/domain';

const CONNECTION_URI = 'spooler://runner-1/EPSON%20L15160';
const PRINTER_NAME = 'EPSON L15160';
const SNMP_HOST = '192.0.2.10';

function deviceState(overrides: Partial<PrinterDeviceState> = {}): PrinterDeviceState {
  return { host: SNMP_HOST, pageCount: 100, errors: [], blocked: false, ...overrides };
}

function htmlPrintCommand(overrides: Partial<PrintCommand> = {}): PrintCommand {
  return {
    jobId: 'job-1',
    printerId: 'printer-1',
    traceId: 'trace-1',
    connectionUri: CONNECTION_URI,
    renderedPrintPayload: '<main style="width:70mm;height:30mm">label</main>',
    mimeType: 'text/html',
    copies: 1,
    duplex: false,
    colorMode: 'auto',
    metadata: { paperProfile: { widthMm: 70, heightMm: 30, orientation: 'landscape' } },
    ...overrides,
  };
}

function exactHtmlSubmission(jobId = 'job-1') {
  return {
    helperStatus: 'Succeeded',
    observedAt: '2026-07-22T12:00:00.000Z',
    jobs: [{ id: 77, status: 'Printing', documentName: `PrintOps:${jobId}` }],
  };
}

/** A fake helper child that stays alive until killed. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { exitCode: number | null; kill: () => boolean };
  child.exitCode = null;
  child.kill = () => {
    child.exitCode = 1;
    return true;
  };
  return child;
}

interface ServeHarness {
  adapter: WindowsSpoolerAdapter;
  spawns: Array<{ helperPath: string; args: string[] }>;
  servedDir: string;
}

function makeServeHarness(opts: {
  htmlSubmissionError?: string;
  htmlSubmission?: ReturnType<typeof exactHtmlSubmission>;
  confirmIpp?: boolean;
} = {}): ServeHarness {
  const spawns: ServeHarness['spawns'] = [];
  let pageBase = 100;
  let jobPageReads = 0;
  let wrapperCall = 0;
  let ippQueriesThisJob = 0;
  // The jobId currently being executed, derived from the wrapper command so
  // every mock response (Windows job name, IPP job name, page counter) moves
  // forward exactly once per submitted job.
  let currentJobId = 'job-1';

  const deps: WindowsSpoolerDeps = {
    isWindows: true,
    async runPowerShell(command) {
      // The serve wrapper is the only command carrying expectedDocumentName=.
      if (command.includes('expectedDocumentName=')) {
        wrapperCall += 1;
        const nameMatch = command.match(/expectedDocumentName='PrintOps:([^']+)'/);
        if (nameMatch?.[1] !== undefined) {
          currentJobId = nameMatch[1];
          // A new job is being submitted: the device counter baseline for the
          // NEXT job is one page further on, and its reads restart.
          pageBase += 1;
          jobPageReads = 0;
          // The next IPP query is that job's BASELINE (empty), and the
          // queries after it are the post-submit observations (our job).
          ippQueriesThisJob = 0;
        }
        if (opts.htmlSubmissionError && wrapperCall === 1) {
          throw new Error(opts.htmlSubmissionError);
        }
        return JSON.stringify(opts.htmlSubmission ?? exactHtmlSubmission(currentJobId));
      }
      return '';
    },
    async pipeToPowerShell() {},
    async readDeviceState() {
      return deviceState({ pageCount: pageBase });
    },
    async readPageCount() {
      jobPageReads += 1;
      return jobPageReads === 1 ? pageBase : pageBase + 1;
    },
    async resolveSnmpHost() {
      return SNMP_HOST;
    },
    async queryIppJobs(endpoint) {
      if (!opts.confirmIpp) {
        return { ok: false, endpoint, jobs: [], error: 'simulated IPP unavailable' };
      }
      // First query of each job = its baseline, which must be EMPTY so the
      // post-submit queries observe OUR job as a NEW key.
      ippQueriesThisJob += 1;
      if (ippQueriesThisJob === 1) {
        return { ok: true, endpoint, jobs: [], statusCode: 0 };
      }
      const jobNumber = Number(currentJobId.split('-')[1] ?? 0);
      const jobIdNum = 900 + jobNumber;
      const jobs: IppRemoteJob[] = [{
        key: `ipp-job:${jobIdNum}`,
        id: jobIdNum,
        uri: `ipp://printer/ipp/print/job-${jobIdNum}`,
        name: `PrintOps_${currentJobId}`,
        state: 9,
        stateReasons: ['completed-successfully'],
        impressionsCompleted: 1,
      }];
      return { ok: true, endpoint, jobs, statusCode: 0 };
    },
    async sleep() {},
    now: (() => {
      let clock = 0;
      return () => (clock += 10_000);
    })(),
    // An existing file — the fake spawnHelper never actually launches it, and
    // resolveHtmlPrintHelperPath must not depend on the workspace CWD.
    htmlPrintHelperPath: process.execPath,
    spawnHelper(helperPath, args) {
      spawns.push({ helperPath, args });
      return fakeChild() as unknown as ReturnType<NonNullable<WindowsSpoolerDeps['spawnHelper']>>;
    },
  };

  return {
    adapter: new WindowsSpoolerAdapter(deps),
    spawns,
    servedDir: '',
  };
}

describe('buildHtmlPrintServeScript', () => {
  const script = buildHtmlPrintServeScript(
    'C:\\PrintOps\\serve',
    'C:\\PrintOps\\serve\\result-job-1.json',
    'EPSON4F6A3C (L15160 Series)',
    'PrintOps:job-1',
  );

  it('does not start the helper process (the persistent session already runs)', () => {
    expect(script).not.toContain('Start-Process');
    expect(script).not.toContain('printops-html-print.exe');
  });

  it('waits for the serve result file and throws WEBVIEW2_PRINT_TIMEOUT when it never appears', () => {
    expect(script).toContain('result-job-1.json');
    expect(script).toContain('WEBVIEW2_PRINT_TIMEOUT');
    expect(script).toContain('AddSeconds(45)');
  });

  it('observes the Windows queue for job correlation and rejects a failed helper result', () => {
    expect(script).toContain('Get-PrintJob');
    expect(script).toContain('jobObserved=($seen.Count -gt 0)');
    expect(script).toContain('WEBVIEW2_PRINT_FAILED');
    expect(script).toContain('PRINTER_NOT_FOUND');
  });

  it('escapes PowerShell single quotes in the printer name and result path', () => {
    const quoted = buildHtmlPrintServeScript(
      'C:\\PrintOps\\serve',
      "C:\\PrintOps\\serve\\result-doctor's-job.json",
      "Doctor's printer",
      "PrintOps:doctor's-job",
    );
    expect(quoted).toContain("result-doctor''s-job.json");
    expect(quoted).toContain("Doctor''s printer");
  });
});

describe('persistent serve-mode helper sessions', () => {
  it('reuses ONE helper process for consecutive jobs on the same printer', async () => {
    const h = makeServeHarness({ confirmIpp: true });
    const first = await h.adapter.executeCommand(htmlPrintCommand({ jobId: 'job-1' }));
    const second = await h.adapter.executeCommand(htmlPrintCommand({ jobId: 'job-2' }));

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    // Both jobs must ride the SAME serve process (one WebView2 init), not
    // cold-start per job.
    expect(h.spawns).toHaveLength(1);
    expect(h.spawns[0]?.args[0]).toBe('--serve');
  });

  it('spawns one helper per printer, keeping different printers independent', async () => {
    const h = makeServeHarness({ confirmIpp: true });
    await h.adapter.executeCommand(htmlPrintCommand({ jobId: 'job-1' }));
    await h.adapter.executeCommand(htmlPrintCommand({
      jobId: 'job-2',
      connectionUri: 'spooler://runner-1/OTHER%20Printer',
    }));

    expect(h.spawns).toHaveLength(2);
  });

  it('recycles a wedged helper after WEBVIEW2_PRINT_TIMEOUT and spawns fresh', async () => {
    const h = makeServeHarness({
      confirmIpp: true,
      htmlSubmissionError: 'WEBVIEW2_PRINT_TIMEOUT: helper did not produce a result within 45 seconds',
    });

    const failed = await h.adapter.executeCommand(htmlPrintCommand({ jobId: 'job-1' }));
    expect(failed.success).toBe(false);
    expect(failed.errorCode).toBe('PRINT_NOT_VERIFIABLE');

    // The next job gets a brand-new serve process instead of a corpse.
    const retried = await h.adapter.executeCommand(htmlPrintCommand({ jobId: 'job-2' }));
    expect(retried.success).toBe(true);
    expect(h.spawns).toHaveLength(2);
  });

  it('writes serve-mode request files with exact page geometry and no resultPath', async () => {
    let servedDir = '';
    const spawns: Array<{ args: string[] }> = [];
    let pageCountRead = 0;
    let ippQueryAttempt = 0;

    const deps: WindowsSpoolerDeps = {
      isWindows: true,
      async runPowerShell(command) {
        if (command.includes('expectedDocumentName=')) {
          // Inspect the request the adapter wrote for the helper.
          const files = await readdir(servedDir);
          const requestFile = files.find((f) => f.startsWith('request-')) as string;
          const request = JSON.parse(readFileSync(join(servedDir, requestFile), 'utf-8'));
          expect(request.printerName).toBe(PRINTER_NAME);
          expect(request.paperWidthMm).toBe(70);
          expect(request.paperHeightMm).toBe(30);
          expect(request.resultPath).toBeUndefined();
          expect(request.userDataFolder).toBeUndefined();
          expect(request.filePath).toContain('.html');
          return JSON.stringify(exactHtmlSubmission('job-1'));
        }
        return '';
      },
      async pipeToPowerShell() {},
      async readDeviceState() {
        return deviceState({ pageCount: 100 });
      },
      async readPageCount() {
        if (pageCountRead++ === 0) return 100;
        return 101;
      },
      async resolveSnmpHost() {
        return SNMP_HOST;
      },
      async queryIppJobs(endpoint) {
        ippQueryAttempt += 1;
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
      now: (() => {
        let clock = 0;
        return () => (clock += 10_000);
      })(),
      // An existing file — the fake spawnHelper never actually launches it,
      // and resolveHtmlPrintHelperPath must not depend on the workspace CWD.
      htmlPrintHelperPath: process.execPath,
      spawnHelper(_helperPath, args) {
        spawns.push({ args });
        servedDir = args[1] as string;
        return fakeChild() as unknown as ReturnType<NonNullable<WindowsSpoolerDeps['spawnHelper']>>;
      },
    };

    const adapter = new WindowsSpoolerAdapter(deps);
    const result = await adapter.executeCommand(htmlPrintCommand());
    expect(result.success).toBe(true);
    expect(spawns).toHaveLength(1);
    // The serve dir is a fresh temp dir under the standard prefix.
    expect(servedDir.startsWith(join(tmpdir(), 'printops-html-serve-'))).toBe(true);
  });
});
