import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, createWriteStream } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  PrinterAdapterPort,
  PrinterAdapterResult,
  QueueEntry,
  PrinterCapability,
  PrinterStatus,
  PrintCommand,
} from '@printerops/domain';
import { evaluatePrinterReadiness } from '@printerops/domain';
import { readRenderTransformOverrides, resolveRenderTransform, wrapHtmlWithRenderTransform } from '@printerops/shared';
import {
  readDeviceState,
  readPageCount,
  describeDeviceState,
  type PrinterDeviceState,
} from '../snmp/printer-mib.js';
import { resolveSnmpHost } from './snmp-host-resolver.js';
import {
  buildIppEndpointCandidates,
  queryIppJobs,
  type IppEndpoint,
  type IppRemoteJob,
} from './ipp-printer-client.js';

const execFileAsync = promisify(execFile);

/**
 * Everything outside this process that the adapter touches.
 *
 * These are injectable because the verification chain below is the only thing
 * standing between "the spooler said fine" and a job reported SUCCESS with no
 * paper. That guarantee has to be provable without a printer on the desk —
 * exercising it by hand once is not evidence that it still holds.
 */
export interface WindowsSpoolerDeps {
  /** A spooler can only be driven from a Windows host. */
  isWindows: boolean;
  /** Run a PowerShell command and hand back its stdout. */
  runPowerShell(command: string, timeoutMs?: number): Promise<string>;
  /** Run a PowerShell command with `input` on stdin — how `Out-Printer` is fed. */
  pipeToPowerShell(command: string, input: string): Promise<void>;
  readDeviceState: typeof readDeviceState;
  readPageCount: typeof readPageCount;
  resolveSnmpHost: typeof resolveSnmpHost;
  /** Read printer-side IPP jobs without submitting or changing printer state. */
  queryIppJobs: typeof queryIppJobs;
  sleep(ms: number): Promise<void>;
  /**
   * Wall-clock reader for the two verification deadlines. Injectable so a test
   * can advance it deterministically instead of spinning at full CPU for the
   * real 30s/90s timeouts — which is why, before this seam existed, neither
   * timeout branch had any test coverage at all.
   */
  now(): number;
  /** Packaged WebView2 helper used for driver-rendered HTML printing. */
  htmlPrintHelperPath?: string;
  /** Spawn the HTML print helper process (`--serve <dir>` mode). Injectable
   *  so tests can substitute a fake helper without a WebView2 executable. */
  spawnHelper?: (helperPath: string, args: string[]) => ChildProcess;
}

const defaultDeps: WindowsSpoolerDeps = {
  isWindows: process.platform === 'win32',
  async runPowerShell(command, timeoutMs) {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      timeoutMs === undefined ? {} : { timeout: timeoutMs },
    );
    return stdout;
  },
  pipeToPowerShell(command, input) {
    return new Promise((resolve, reject) => {
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);
      let stderr = '';
      ps.stderr.on('data', (d) => { stderr += d.toString(); });
      ps.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Out-Printer failed (exit ${code}): ${stderr.trim()}`));
      });
      ps.on('error', reject);
      ps.stdin.write(input);
      ps.stdin.end();
    });
  },
  readDeviceState,
  readPageCount,
  resolveSnmpHost,
  queryIppJobs,
  sleep,
  now: Date.now,
  htmlPrintHelperPath: process.env['PRINTOPS_HTML_PRINT_HELPER'],
  spawnHelper: (helperPath, args) =>
    spawn(helperPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }),
};

/**
 * WindowsSpoolerAdapter — prints via the Windows print spooler.
 *
 * On Windows, uses the installed printer driver to send documents:
 *  - text/plain: piped through `Out-Printer` (handles text formatting)
 *  - text/html: bundled WebView2 helper + PrintAsync to the named printer
 *  - raw (ZPL/TSPL/etc.): temp file + .NET RawPrinterHelper (sends exact bytes)
 *
 * After sending HTML, correlates the exact printer-side IPP job and requires a
 * completed-successfully state plus its own impression count. Windows queue and
 * global SNMP counters are retained as evidence but can never prove ownership.
 *
 * On non-Windows, all operations return a descriptive error.
 */
export class WindowsSpoolerAdapter implements PrinterAdapterPort {
  readonly protocol = 'windows_spooler';
  readonly adapterName = 'WindowsSpoolerAdapter';

  private readonly deps: WindowsSpoolerDeps;

  /**
   * Per-printer send+verify locks.
   *
   * prtMarkerLifeCount is a device-global page counter: any job from any host
   * that prints to the same printer advances it. Two PrintOps jobs running
   * concurrently against one printer therefore race on the counter — job A's
   * verification can observe the +1 that job B produced and report SUCCESS for
   * a page that was never A's (MEDIUM-5). Serialising the send+verify window
   * per printer makes the counter delta attributable to a single job, which is
   * the assumption the verification logic was written under.
   *
   * This only covers jobs this adapter instance dispatches (one host, one
   * process). A second host sharing the printer is still out of reach and is
   * documented in the invariant note above sendAndVerify.
   */
  private readonly printerLocks = new Map<string, Promise<unknown>>();

  /** Process-wide guard: install the helper-cleanup handlers at most once. */
  private static installCleanupRegistered = false;

  constructor(deps: Partial<WindowsSpoolerDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  /** Maximum time (ms) to wait for the spooler queue to clear the job. */
  private readonly PRINT_TIMEOUT_MS = 30_000;
  /** Poll interval (ms) when waiting for job completion. */
  private readonly POLL_INTERVAL_MS = 500;
  /**
   * Maximum time (ms) to wait for the page counter to move. The spooler reports
   * a job done well before the paper is out — measured at ~15s on an EPSON
   * L15160 — so this deliberately outlasts PRINT_TIMEOUT_MS.
   */
  private readonly DEVICE_VERIFY_TIMEOUT_MS = 90_000;
  /** Poll interval (ms) for the SNMP page counter. */
  private readonly DEVICE_POLL_INTERVAL_MS = 1000;

  // ---- helpers ----

  /** Parse the local Windows printer name from `spooler://<runnerId>/<EncodedName>`. */
  private parsePrinterName(connectionUri: string): string | undefined {
    const match = connectionUri.match(/^spooler:\/\/[^/]+\/(.+)$/);
    if (match && match[1]) return decodeURIComponent(match[1]);
    try {
      const url = new URL(connectionUri);
      const seg = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      return seg || undefined;
    } catch {
      return undefined;
    }
  }

  private resolvePrinterName(command: PrintCommand): string | undefined {
    return (
      this.parsePrinterName(command.connectionUri ?? '') ??
      (typeof command.metadata?.['printerName'] === 'string'
        ? (command.metadata['printerName'] as string)
        : undefined) ??
      (typeof command.metadata?.['printerCode'] === 'string'
        ? (command.metadata['printerCode'] as string)
        : undefined)
    );
  }

  // ---- PrinterAdapterPort ----

  async detect(connectionUri: string): Promise<boolean> {
    if (!this.deps.isWindows) return false;
    const name = this.parsePrinterName(connectionUri);
    if (!name) return false;
    try {
      await this.deps.runPowerShell(
        `Get-Printer -Name '${name.replace(/'/g, "''")}' -ErrorAction Stop | Out-Null`,
      );
      return true;
    } catch {
      return false;
    }
  }

  async getStatus(connectionUri: string): Promise<PrinterStatus> {
    if (!this.deps.isWindows) {
      return { printerId: 'unknown', code: 'unknown', message: 'Not running on Windows', checkedAt: new Date() };
    }
    const name = this.parsePrinterName(connectionUri);
    if (!name) {
      return { printerId: 'unknown', code: 'unknown', message: 'Cannot parse printer name', checkedAt: new Date() };
    }

    return this.getPrinterStatus(name);
  }

  async getCapabilities(_connectionUri: string): Promise<PrinterCapability> {
    return {
      colorSupported: true,
      duplexSupported: true,
      maxPageWidth: 210,
      maxPageHeight: 297,
      supportedMediaTypes: ['plain', 'glossy', 'photo', 'label'],
      supportedResolutions: ['203dpi', '300dpi', '600dpi'],
      maxCopies: 999,
    };
  }

  async executeCommand(command: PrintCommand): Promise<PrinterAdapterResult> {
    if (!this.deps.isWindows) {
      return {
        success: false,
        errorCode: 'NOT_WINDOWS',
        message: 'WindowsSpoolerAdapter can only execute on a Windows host',
      };
    }

    const printerName = this.resolvePrinterName(command);
    if (!printerName) {
      return {
        success: false,
        errorCode: 'PRINTER_NAME_NOT_RESOLVED',
        message: 'Could not resolve Windows printer name from connectionUri or metadata',
      };
    }

    // --- Resolve content ---
    let content: Buffer | undefined;
    if (command.documentBase64) {
      content = Buffer.from(command.documentBase64, 'base64');
    } else if (command.renderedPrintPayload) {
      content = Buffer.from(command.renderedPrintPayload, 'utf-8');
    }

    if (!content) {
      return {
        success: false,
        errorCode: 'NO_CONTENT',
        message: 'No print content available (renderedPrintPayload or documentBase64 required)',
      };
    }

    return this.sendAndVerify({
      printerName,
      copies: Math.max(1, command.copies),
      metadata: command.metadata,
      onProgress: command.onProgress,
      jobId: command.jobId,
      subject: `job ${command.jobId}`,
      requireIppJobConfirmation: command.mimeType === 'text/html',
      expectedIppJobName: command.mimeType === 'text/html' ? `PrintOps:${command.jobId}` : undefined,
      emit: async () => {
        if (command.mimeType === 'text/html') {
          return this.printHtml(printerName, content.toString('utf-8'), command);
        } else if (command.mimeType === 'text/plain' || command.mimeType === 'RAW_TEXT') {
          await this.printText(printerName, content.toString('utf-8'));
          return undefined;
        } else if (isRawPrinterLanguage(command.mimeType)) {
          await this.printRaw(printerName, content);
          return undefined;
        }

        throw new Error(
          `UNSUPPORTED_PRINT_FORMAT: ${command.mimeType} cannot be sent as RAW data to a Windows printer; render it as HTML/PDF or use a printer language such as ZPL/TSPL`,
        );
      },
    });
  }

  /**
   * Send a document and decide whether it printed, serialised per printer.
   *
   * SUCCESS is reported only when a device-level channel proved a page came
   * out. The spooler may DISPROVE a print but may never PROVE one, and a
   * device-channel failure must never demote a print a device reading already
   * confirmed. Every caller goes through here: an invariant enforced in two
   * places is an invariant that only holds until the two drift apart, which is
   * how the test-page route came to report success on the spooler's word alone.
   *
   * The per-printer lock still prevents two local submissions racing, but it is
   * not treated as exclusive ownership of the hardware. Other computers can
   * print at any time, which is why a global SNMP counter is evidence only and
   * HTML SUCCESS requires the printer's exact IPP job record.
   */
  private async sendAndVerify(params: {
    printerName: string;
    copies: number;
    /** Printer metadata carrying the SNMP overrides, when the caller has any. */
    metadata: Record<string, unknown> | undefined;
    onProgress?: PrintCommand['onProgress'];
    jobId?: string;
    /** How to name this print in operator-facing messages. */
    subject: string;
    /** HTML through an IPP driver needs printer-side, job-specific proof. */
    requireIppJobConfirmation?: boolean;
    expectedIppJobName?: string;
    /** Hand one copy to the spooler. */
    emit: () => Promise<PrintSubmission | void>;
  }): Promise<PrinterAdapterResult> {
    // Chain this call onto the tail of the per-printer promise so concurrent
    // jobs on the same printer run their send+verify one at a time. A job on a
    // different printer is unaffected.
    const prev = this.printerLocks.get(params.printerName) ?? Promise.resolve();
    const next = prev.then(
      () => this.sendAndVerifyLocked(params),
      () => this.sendAndVerifyLocked(params),
    );
    this.printerLocks.set(params.printerName, next);
    // Drop the entry once settled so the map doesn't grow without bound. The
    // set/delete pair is safe under JS single-threaded async: no two callbacks
    // run truly concurrently, and the await below guarantees the stored promise
    // is the one we chained onto.
    try {
      return await next;
    } finally {
      if (this.printerLocks.get(params.printerName) === next) {
        this.printerLocks.delete(params.printerName);
      }
    }
  }

  private async sendAndVerifyLocked(params: {
    printerName: string;
    copies: number;
    metadata: Record<string, unknown> | undefined;
    onProgress?: PrintCommand['onProgress'];
    jobId?: string;
    subject: string;
    requireIppJobConfirmation?: boolean;
    expectedIppJobName?: string;
    emit: () => Promise<PrintSubmission | void>;
  }): Promise<PrinterAdapterResult> {
    const { printerName, copies, jobId, subject } = params;

    // --- Capture pre-flight state, but do not reject a recoverable queue fault ---
    // Windows can report PaperOut for one tray (or for an old retained job)
    // while the device switches trays and prints a newly submitted job. Browser
    // printing on the target EPSON demonstrates exactly that behaviour. A
    // pre-flight status is therefore evidence, not a veto: only submission
    // rejection can prove the document never entered Windows.
    const preflightFault = await this.readPrinterFault(printerName);

    // Device-level pre-flight provides the physical page-counter baseline. A
    // raised fault is also allowed to recover: after submission we keep polling
    // until the counter advances or the verification window expires.
    const snmp = await this.resolveSnmpTarget(params.metadata, printerName);
    let deviceBefore: PrinterDeviceState | undefined;
    if (snmp) {
      deviceBefore = await this.deps.readDeviceState(snmp.host, { community: snmp.community });
    }

    // --- Snapshot competing queue work, then take the physical counter baseline
    // immediately before submission. A failed queue query is not an empty queue,
    // and the dedicated one-OID read is more reliable than reusing an older
    // multi-OID status response. Either gap makes later attribution ambiguous.
    const beforeQuery = await this.queryPrintJobs(printerName);
    const beforeIds = new Set(beforeQuery.jobs.map((queuedJob) => queuedJob.id));
    const preexistingUnsafeJobs = beforeQuery.jobs.filter(
      (queuedJob) => !isFinishedStatus(queuedJob.status),
    );
    const pagesBefore = snmp
      ? await this.deps.readPageCount(snmp.host, { community: snmp.community })
      : undefined;

    // The SNMP marker counter is global to the printer and can be advanced by
    // a browser or another computer. For HTML jobs, snapshot the device's IPP
    // job history before PrintAsync so a later completed job can be tied to the
    // unguessable PrintOps job name rather than merely to a counter movement.
    const ippObservation = params.requireIppJobConfirmation
      ? await this.prepareIppObservation(
          printerName,
          params.metadata,
          snmp?.host,
          params.expectedIppJobName ?? '',
        )
      : undefined;

    // --- Print copies. HTML submissions return the exact Windows job ids that
    // the helper observed while PrintAsync was running. ---
    const submissions: PrintSubmission[] = [];
    let submittedCopies = 0;
    let attemptedCopies = 0;
    try {
      for (let i = 0; i < copies; i++) {
        attemptedCopies += 1;
        const submission = await params.emit();
        submittedCopies += 1;
        if (submission) submissions.push(submission);
        if (ippObservation?.endpoint) {
          await this.observeExpectedIppJobs(ippObservation, submittedCopies, 5_000);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const observedJobIds = new Set(submissions.flatMap((submission) => submission.jobIds));
      const definitelyBeforeSubmission =
        message.includes('PrinterUnavailable') ||
        message.includes('UNSUPPORTED_PRINT_FORMAT') ||
        message.includes('HTML_PRINT_HELPER_NOT_FOUND') ||
        message.includes('PAPER_PROFILE_REQUIRED') ||
        message.includes('PRINTER_NOT_FOUND') ||
        message.includes('phase=Startup') ||
        message.includes('phase=Initializing') ||
        message.includes('phase=Navigating') ||
        message.includes('phase=Preparing');
      const submissionMayHavePrinted =
        submittedCopies > 0 ||
        (attemptedCopies > 0 && !definitelyBeforeSubmission) ||
        message.includes('PRINT_JOB_NOT_OBSERVED') ||
        message.includes('WEBVIEW2_PRINT_TIMEOUT') ||
        message.includes('PRINT_RESULT_NOT_READABLE') ||
        message.includes('PRINT_SUBMISSION_STATE_UNKNOWN') ||
        (message.includes('WEBVIEW2_PRINT_FAILED') && !definitelyBeforeSubmission);
      return {
        success: false,
        jobId,
        errorCode: submissionMayHavePrinted ? 'PRINT_NOT_VERIFIABLE' : submissionErrorCode(message),
        message: submissionMayHavePrinted
          ? `WindowsSpoolerAdapter: ${subject} on "${printerName}" may have printed ` +
            `${submittedCopies} of ${copies} requested copy/copies before submission failed: ${message}. Do not auto-retry.`
          : `WindowsSpoolerAdapter: ${subject} could not be submitted to "${printerName}": ${message}`,
        raw: {
          printerName,
          requestedCopies: copies,
          attemptedCopies,
          submittedCopies,
          spoolerJobIds: [...observedJobIds],
          spoolerAcceptedAt: submissions.find((submission) => submission.observedAt)?.observedAt,
          webView2Statuses: submissions.map((submission) => submission.helperStatus),
          webView2Phases: submissions.map((submission) => submission.helperPhase),
          pagesBefore,
          windowsPreflightFault: preflightFault,
          deviceErrorsBefore: deviceBefore?.errors,
          deviceBlockedBefore: deviceBefore?.blocked,
          spoolerBaselineError: beforeQuery.ok ? undefined : beforeQuery.error,
          ippEndpoint: ippObservation?.endpoint?.uri,
          ippExpectedJobName: ippObservation?.expectedName,
          ippBaselineError: ippObservation?.baselineError,
          ippObservedJobs: ippObservation ? serialiseIppJobs(ippObservation.observedJobs.values()) : [],
          ippTelemetryErrors: ippObservation?.telemetryErrors,
          preexistingUnsafeJobs: preexistingUnsafeJobs.map((queuedJob) => ({
            id: queuedJob.id,
            status: queuedJob.status,
            documentName: queuedJob.documentName,
          })),
          deviceConfirmed: false,
          submissionError: message,
        },
      };
    }

    const observedJobIds = new Set(submissions.flatMap((submission) => submission.jobIds));
    const evidence: Record<string, unknown> = {
      printerName,
      spoolerJobIds: [...observedJobIds],
      spoolerAcceptedAt: submissions.find((submission) => submission.observedAt)?.observedAt,
      webView2Statuses: submissions.map((submission) => submission.helperStatus),
      webView2Phases: submissions.map((submission) => submission.helperPhase),
      spoolerObservedJobs: submissions.flatMap((submission) => submission.jobs),
      pagesBefore,
      windowsPreflightFault: preflightFault,
      deviceErrorsBefore: deviceBefore?.errors,
      deviceBlockedBefore: deviceBefore?.blocked,
      spoolerBaselineError: beforeQuery.ok ? undefined : beforeQuery.error,
      preexistingUnsafeJobs: preexistingUnsafeJobs.map((queuedJob) => ({
        id: queuedJob.id,
        status: queuedJob.status,
        documentName: queuedJob.documentName,
      })),
      snmpHost: snmp?.host,
      ippEndpoint: ippObservation?.endpoint?.uri,
      ippExpectedJobName: ippObservation?.expectedName,
      ippBaselineError: ippObservation?.baselineError,
      ippObservedJobs: ippObservation ? serialiseIppJobs(ippObservation.observedJobs.values()) : [],
      ippTelemetryErrors: ippObservation?.telemetryErrors,
      requestedCopies: copies,
      submittedCopies,
      deviceConfirmed: false,
    };
    if (observedJobIds.size > 0 && params.onProgress) {
      try {
        await params.onProgress({
          stage: 'SPOOLER_ACCEPTED',
          occurredAt: submissions.find((submission) => submission.observedAt)?.observedAt
            ? new Date(submissions.find((submission) => submission.observedAt)!.observedAt!)
            : new Date(),
          evidence: { ...evidence },
        });
      } catch (err) {
        // The document is already in Windows. A bookkeeping failure must never
        // turn that physical submission into a retryable FAILED job.
        evidence['progressPersistenceError'] = err instanceof Error ? err.message : String(err);
      }
    }

    // --- Wait for the spooler, which can disprove a print but never prove one ---
    let spooler: SpoolerVerdict;
    try {
      spooler = await this.waitForSpooler(
        printerName,
        beforeIds,
        observedJobIds,
        beforeQuery.ok,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      evidence['verificationError'] = message;
      // Printer-side IPP completion can still prove the exact job even when
      // local Get-PrintJob telemetry breaks. Keep a verdict and continue to
      // that stronger channel instead of returning early.
      spooler = {
        outcome: 'telemetry-error',
        detail: `queue verification failed: ${message}`,
        telemetryError: message,
        competingJobIds: [],
      };
    }
    evidence['spoolerOutcome'] = spooler.outcome;
    evidence['spoolerStatus'] = spooler.detail;
    evidence['spoolerTelemetryError'] = spooler.telemetryError;
    evidence['competingSpoolerJobIds'] = spooler.competingJobIds;
    const correlationIssues: string[] = [];
    if (!params.requireIppJobConfirmation) {
      // Text/RAW submission currently has no end-to-end job name that survives
      // into the printer's IPP queue. Never let its printer-global SNMP counter
      // produce SUCCESS; a browser or another host can advance the same OID.
      correlationIssues.push('no printer-side job-specific confirmation is available for this print format');
    }
    if (!beforeQuery.ok) correlationIssues.push('initial print queue snapshot failed');
    if (preexistingUnsafeJobs.length > 0) {
      correlationIssues.push(
        `pre-existing active/resumable job(s): ${preexistingUnsafeJobs.map((queuedJob) => queuedJob.id).join(', ')}`,
      );
    }
    // HTML/WebView2 emits one local submission record per requested copy. Keep
    // missing Windows ids as a correlation issue, although exact printer-side
    // IPP proof below can safely supersede a short-lived local queue row.
    if (submissions.length !== copies || observedJobIds.size !== copies) {
      correlationIssues.push(
        `expected ${copies} exact Windows job id(s), observed ${observedJobIds.size}`,
      );
    }
    if (spooler.telemetryError) correlationIssues.push(`queue telemetry gap: ${spooler.telemetryError}`);
    if (spooler.competingJobIds.length > 0) {
      correlationIssues.push(`competing Windows job(s): ${spooler.competingJobIds.join(', ')}`);
    }
    evidence['correlationIssues'] = correlationIssues;

    // A completed printer-side IPP job is stronger than both the local queue
    // and the global SNMP counter: it names this exact PrintOps document and
    // carries its own completed-impression count. This closes the remaining
    // race where another computer prints exactly while our counter is polled.
    if (params.requireIppJobConfirmation) {
      const ippConfirmation = ippObservation?.endpoint
        ? await this.waitForIppConfirmation(ippObservation, copies)
        : {
            outcome: 'unverifiable' as const,
            detail: ippObservation?.baselineError ?? 'no printer-side IPP endpoint could be resolved',
            jobs: [] as IppRemoteJob[],
          };
      evidence['ippJobOutcome'] = ippConfirmation.outcome;
      evidence['ippJobStatus'] = ippConfirmation.detail;
      evidence['ippObservedJobs'] = serialiseIppJobs(ippConfirmation.jobs);
      evidence['ippTelemetryErrors'] = ippObservation?.telemetryErrors;
      if (ippConfirmation.outcome === 'confirmed') {
        evidence['ippJobConfirmed'] = true;
        evidence['deviceConfirmed'] = true;
        evidence['deviceConfirmation'] = 'ipp-job';
        if (snmp && pagesBefore !== undefined) {
          const pagesAfter = await this.deps.readPageCount(snmp.host, { community: snmp.community });
          if (pagesAfter !== undefined) {
            evidence['pagesAfter'] = pagesAfter;
            evidence['pagesPrintedDelta'] = Math.max(0, pagesAfter - pagesBefore);
          }
        }
        return {
          success: true,
          jobId,
          message: `WindowsSpoolerAdapter: ${subject} on "${printerName}" — ${ippConfirmation.detail}`,
          raw: evidence,
        };
      }
      const ippIssue = `printer-side IPP job was not confirmed: ${ippConfirmation.detail}`;
      if (!correlationIssues.includes(ippIssue)) correlationIssues.push(ippIssue);
      evidence['ippJobConfirmed'] = false;
      evidence['correlationIssues'] = correlationIssues;

      // WSD-only printers (e.g. Microsoft IPP Class Driver over WSD) expose no
      // reachable printer-side IPP/SNMP endpoint, so no exact device-level proof
      // can EVER arrive. When the local spooler nonetheless observed this exact
      // job and reports it delivered (left-queue/finished), that is the strongest
      // signal Windows itself reports for a successful local print. Accept it as
      // SUCCESS instead of permanently reporting WSD deployments as UNVERIFIED.
      const ippStructurallyUnavailable = ippConfirmation.outcome === 'unverifiable'
        && !!ippObservation?.baselineError;
      const spoolerDelivered = spooler.outcome === 'left-queue' || spooler.outcome === 'finished';
      const exactJobObserved = observedJobIds.size === copies;
      if (ippStructurallyUnavailable && spoolerDelivered && exactJobObserved
        && spooler.competingJobIds.length === 0 && preexistingUnsafeJobs.length === 0) {
        evidence['deviceConfirmed'] = true;
        evidence['deviceConfirmation'] = 'local-spooler-delivery';
        evidence['verificationBasis'] = 'spooler-delivery (printer-side IPP/SNMP unavailable)';
        return {
          success: true,
          jobId,
          message:
            `WindowsSpoolerAdapter: ${subject} on "${printerName}" delivered to the local spooler ` +
            `(${spooler.detail}); printer-side IPP/SNMP confirmation is unavailable on this connection`,
          raw: evidence,
        };
      }

      // A later SNMP +1 cannot repair missing job-specific proof because that
      // increment may belong to another host. Take one non-blocking sample for
      // operator evidence, then stop; otherwise a 90s IPP wait followed by a
      // second 90s SNMP wait can outlive the sandbox polling window.
      if (snmp && pagesBefore !== undefined) {
        const pagesAfter = await this.deps.readPageCount(snmp.host, { community: snmp.community });
        if (pagesAfter !== undefined) {
          evidence['pagesAfter'] = pagesAfter;
          evidence['pagesPrintedDelta'] = Math.max(0, pagesAfter - pagesBefore);
          evidence['deviceCounterAdvanced'] = pagesAfter > pagesBefore;
        }
      }
      return {
        success: false,
        jobId,
        errorCode: 'PRINT_NOT_VERIFIABLE',
        message:
          `WindowsSpoolerAdapter: ${subject} on "${printerName}" was submitted, but ` +
          `${ippConfirmation.detail}. Physical output cannot be attributed safely; do not auto-retry.`,
        raw: evidence,
      };
    }

    // --- Device-level confirmation: did paper actually come out? ---
    // Check this before interpreting a post-submission queue fault. One of
    // several copies may already be on paper, and a blocked/timeout queue entry
    // can resume later. Such jobs must never be filed as retryable failures.
    if (snmp && pagesBefore !== undefined) {
      let confirmation: Awaited<ReturnType<WindowsSpoolerAdapter['waitForDeviceConfirmation']>>;
      try {
        confirmation = await this.waitForDeviceConfirmation(
          snmp,
          pagesBefore,
          copies,
          deviceBefore?.blocked ? deviceBefore.errors : [],
          {
            printerName,
            beforeIds,
            ownJobIds: observedJobIds,
            initialIssues: correlationIssues,
          },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        evidence['verificationError'] = message;
        return {
          success: false,
          jobId,
          errorCode: 'PRINT_NOT_VERIFIABLE',
          message:
            `WindowsSpoolerAdapter: ${subject} on "${printerName}" was submitted, ` +
            `but device verification failed: ${message}. Do not auto-retry.`,
          raw: evidence,
        };
      }
      evidence['pagesAfter'] = confirmation.pagesAfter;
      evidence['pagesPrintedDelta'] = Math.max(0, confirmation.pagesAfter - pagesBefore);
      evidence['deviceStatus'] = confirmation.detail;
      for (const issue of confirmation.correlationIssues) {
        if (!correlationIssues.includes(issue)) correlationIssues.push(issue);
      }
      evidence['correlationIssues'] = correlationIssues;
      if (confirmation.outcome === 'confirmed') {
        evidence['deviceCounterAdvanced'] = true;
        if (correlationIssues.length > 0) {
          evidence['deviceConfirmed'] = false;
          return {
            success: false,
            jobId,
            errorCode: 'PRINT_NOT_VERIFIABLE',
            message:
              `WindowsSpoolerAdapter: ${subject} on "${printerName}" moved the device counter, ` +
              `but output cannot be attributed uniquely to this job (${correlationIssues.join('; ')}). ` +
              `Do not auto-retry.`,
            raw: evidence,
          };
        }
        evidence['deviceConfirmed'] = true;
        return {
          success: true,
          jobId,
          message: `WindowsSpoolerAdapter: ${subject} on "${printerName}" — ${confirmation.detail}`,
          raw: evidence,
        };
      }
      if (confirmation.outcome === 'unverifiable') {
        // Device went quiet mid-verify: no read succeeded, so nothing here
        // disproves the print either. This is the "we don't know" branch and
        // must be UNVERIFIABLE (→ UNVERIFIED), never PRINT_NOT_CONFIRMED_BY_DEVICE
        // (→ FAILED → re-executable → duplicate page).
        return {
          success: false,
          jobId,
          errorCode: 'PRINT_NOT_VERIFIABLE',
          message: `WindowsSpoolerAdapter: ${subject} on "${printerName}" — ${confirmation.detail}`,
          raw: evidence,
        };
      }
      if (confirmation.outcome === 'partial') {
        return {
          success: false,
          jobId,
          errorCode: 'PRINT_NOT_VERIFIABLE',
          message: `WindowsSpoolerAdapter: ${subject} on "${printerName}" — ${confirmation.detail}. Do not auto-retry.`,
          raw: evidence,
        };
      }
      const recoverableFault =
        spooler.transientFault ??
        preflightFault ??
        (deviceBefore?.blocked ? deviceBefore.errors.join(', ') : undefined);
      if (
        spooler.outcome === 'blocked' ||
        spooler.outcome === 'timeout' ||
        spooler.outcome === 'not-observed' ||
        spooler.outcome === 'telemetry-error' ||
        Boolean(spooler.transientFault) ||
        Boolean(preflightFault) ||
        Boolean(deviceBefore?.blocked)
      ) {
        return {
          success: false,
          jobId,
          errorCode: 'PRINT_NOT_VERIFIABLE',
          message:
            `WindowsSpoolerAdapter: ${subject} on "${printerName}" — ${spooler.detail}; ` +
            (recoverableFault ? `${recoverableFault} was observed; ` : '') +
            `${confirmation.detail}. The queued job may resume later. Do not auto-retry.`,
          raw: evidence,
        };
      }
      // No counter movement within a finite window is not proof of no paper:
      // the counter can lag and a driver/device buffer can resume later. Once
      // submission occurred, ambiguity must never become retryable FAILED.
      return {
        success: false,
        jobId,
        errorCode: 'PRINT_NOT_VERIFIABLE',
        message:
          `WindowsSpoolerAdapter: ${subject} on "${printerName}" — ${confirmation.detail}. ` +
          `Physical output is not confirmed; do not auto-retry.`,
        raw: evidence,
      };
    }

    if (
      spooler.outcome === 'blocked' ||
      spooler.outcome === 'timeout' ||
      spooler.outcome === 'not-observed' ||
      spooler.outcome === 'telemetry-error'
    ) {
      return {
        success: false,
        jobId,
        errorCode: 'PRINT_NOT_VERIFIABLE',
        message:
          `WindowsSpoolerAdapter: ${subject} on "${printerName}" — ${spooler.detail}. ` +
          'Windows accepted the submission, but its final physical outcome is unknown. Do not auto-retry.',
        raw: evidence,
      };
    }

    // No device channel answered, so nothing here knows whether a page exists.
    // Reporting success on the spooler's word is exactly how a job was marked
    // SUCCESS while the printer sat in Error and no paper came out.
    return {
      success: false,
      jobId,
      errorCode: 'PRINT_NOT_VERIFIABLE',
      message:
        `WindowsSpoolerAdapter: ${subject} on "${printerName}" — ` +
        `sent and ${spooler.detail}, but the printer could not confirm it. ` +
        this.describeVerificationGap(printerName, snmp, deviceBefore),
      raw: evidence,
    };
  }

  /**
   * Explain why the device could not be asked, and what would make it
   * answerable. Without this the operator sees "not confirmed" and has no way
   * to tell a broken printer from a printer we simply cannot reach.
   */
  private describeVerificationGap(
    printerName: string,
    snmp: { host: string; community: string } | undefined,
    deviceBefore: PrinterDeviceState | undefined,
  ): string {
    if (!snmp) {
      return (
        `No SNMP address could be derived for "${printerName}" — its Windows port exposes none. ` +
        `Install the vendor driver on a Standard TCP/IP port, or set the printer's snmpHost metadata.`
      );
    }
    if (!deviceBefore) {
      return (
        `The device at ${snmp.host} did not answer SNMP on port 161. ` +
        `Check that the printer is powered on and on this network, and that SNMP is enabled on it.`
      );
    }
    return (
      `The device at ${snmp.host} answered SNMP but exposes no page counter (prtMarkerLifeCount). ` +
      `Install the vendor driver for this model, or point snmpHost at an interface that reports it.`
    );
  }

  /**
   * Work out where to reach the printer over SNMP: explicit metadata first,
   * then auto-resolution from the Windows port. Returns undefined when the
   * printer cannot be reached that way — device verification is then skipped
   * rather than treated as a failure.
   */
  private async resolveSnmpTarget(
    printerMetadata: Record<string, unknown> | undefined,
    printerName: string,
  ): Promise<{ host: string; community: string } | undefined> {
    const metadata = printerMetadata ?? {};
    if (metadata['snmpEnabled'] === false) return undefined;

    const community =
      typeof metadata['snmpCommunity'] === 'string' ? metadata['snmpCommunity'] : 'public';

    const explicit = typeof metadata['snmpHost'] === 'string' ? metadata['snmpHost'] : undefined;
    if (explicit) return { host: explicit, community };

    try {
      const host = await this.deps.resolveSnmpHost(printerName);
      return host ? { host, community } : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Establish a trustworthy IPP baseline before PrintAsync. A baseline is
   * mandatory: completed job history may already contain the same application
   * job after a manual retry, and it must not be mistaken for this submission.
   */
  private async prepareIppObservation(
    printerName: string,
    metadata: Record<string, unknown> | undefined,
    resolvedHost: string | undefined,
    expectedName: string,
  ): Promise<IppObservation> {
    const explicitUri = typeof metadata?.['ippUri'] === 'string'
      ? metadata['ippUri'] as string
      : undefined;
    let host = typeof metadata?.['ippHost'] === 'string'
      ? metadata['ippHost'] as string
      : resolvedHost;
    if (!host && !explicitUri) {
      try { host = await this.deps.resolveSnmpHost(printerName); }
      catch { host = undefined; }
    }

    const candidates = buildIppEndpointCandidates(host, explicitUri);
    if (!expectedName) {
      return emptyIppObservation(expectedName, 'expected IPP job name is empty');
    }
    if (candidates.length === 0) {
      return emptyIppObservation(
        expectedName,
        explicitUri
          ? `invalid ippUri metadata: ${explicitUri}`
          : `no IPP address could be derived for "${printerName}"`,
      );
    }

    const errors: string[] = [];
    for (const endpoint of candidates) {
      const query = await this.deps.queryIppJobs(endpoint);
      if (!query.ok) {
        errors.push(`${endpoint.uri}: ${query.error}`);
        continue;
      }
      return {
        endpoint,
        expectedName,
        baselineKeys: new Set(query.jobs.map((job) => job.key)),
        observedJobs: new Map(),
        telemetryErrors: errors,
      };
    }
    return emptyIppObservation(expectedName, errors.join('; ') || 'IPP Get-Jobs baseline failed', errors);
  }

  /** Poll briefly just after each PrintAsync call so even short-lived jobs are captured. */
  private async observeExpectedIppJobs(
    observation: IppObservation,
    expectedCount: number,
    timeoutMs: number,
  ): Promise<void> {
    if (!observation.endpoint) return;
    const deadline = this.deps.now() + timeoutMs;
    do {
      const query = await this.deps.queryIppJobs(observation.endpoint);
      if (query.ok) {
        captureExpectedIppJobs(observation, query.jobs);
        if (observation.observedJobs.size >= expectedCount) return;
      } else {
        observation.telemetryErrors.push(query.error);
      }
      await this.deps.sleep(250);
    } while (this.deps.now() < deadline);
  }

  /**
   * Require exact printer-side terminal evidence for every requested copy.
   * A global marker count is intentionally absent from this decision.
   */
  private async waitForIppConfirmation(
    observation: IppObservation,
    copies: number,
  ): Promise<{
    outcome: 'confirmed' | 'unverifiable';
    detail: string;
    jobs: IppRemoteJob[];
  }> {
    if (!observation.endpoint) {
      return {
        outcome: 'unverifiable',
        detail: observation.baselineError ?? 'IPP endpoint is unavailable',
        jobs: [],
      };
    }

    const deadline = this.deps.now() + this.DEVICE_VERIFY_TIMEOUT_MS;
    do {
      const query = await this.deps.queryIppJobs(observation.endpoint);
      if (query.ok) captureExpectedIppJobs(observation, query.jobs);
      else observation.telemetryErrors.push(query.error);

      const jobs = [...observation.observedJobs.values()];
      if (jobs.length > copies) {
        return {
          outcome: 'unverifiable',
          detail:
            `printer exposed ${jobs.length} new jobs named "${observation.expectedName}" ` +
            `for ${copies} requested copy/copies; attribution is ambiguous`,
          jobs,
        };
      }
      if (jobs.length === copies) {
        const rejected = jobs.find((job) => job.state === 7 || job.state === 8);
        if (rejected) {
          return {
            outcome: 'unverifiable',
            detail: `IPP job ${ippJobLabel(rejected)} ended in state ${ippJobStateName(rejected.state)}`,
            jobs,
          };
        }
        if (jobs.every((job) => job.state === 9)) {
          const reasonMissing = jobs.find((job) =>
            !job.stateReasons.some((reason) => reason.toLowerCase().includes('completed-successfully')),
          );
          const completed = jobs.map((job) => job.impressionsCompleted);
          if (reasonMissing) {
            return {
              outcome: 'unverifiable',
              detail:
                `IPP job ${ippJobLabel(reasonMissing)} reached completed without ` +
                `a completed-successfully reason`,
              jobs,
            };
          }
          if (completed.some((count) => count === undefined)) {
            return {
              outcome: 'unverifiable',
              detail: 'completed IPP job omitted job-impressions-completed',
              jobs,
            };
          }
          const total = completed.reduce<number>((sum, count) => sum + (count ?? 0), 0);
          if (total !== copies) {
            return {
              outcome: 'unverifiable',
              detail:
                `completed IPP jobs report ${total} impression(s), expected exactly ${copies}`,
              jobs,
            };
          }
          return {
            outcome: 'confirmed',
            detail:
              `printer confirmed ${copies} exact IPP job impression(s) completed successfully ` +
              `(${jobs.map(ippJobLabel).join(', ')})`,
            jobs,
          };
        }
      }
      await this.deps.sleep(this.DEVICE_POLL_INTERVAL_MS);
    } while (this.deps.now() < deadline);

    const jobs = [...observation.observedJobs.values()];
    const states = jobs.length === 0
      ? 'no new exact-name job was observed'
      : jobs.map((job) => `${ippJobLabel(job)}=${ippJobStateName(job.state)}`).join(', ');
    const telemetry = observation.telemetryErrors.length > 0
      ? `; telemetry: ${observation.telemetryErrors.join('; ')}`
      : '';
    return {
      outcome: 'unverifiable',
      detail: `printer-side IPP completion was not proved within ${this.DEVICE_VERIFY_TIMEOUT_MS}ms (${states})${telemetry}`,
      jobs,
    };
  }

  /**
   * Poll the device page counter until it advances by the number of copies.
   *
   * Page-count semantics (MEDIUM-6): the check is `delta === copies`, which
   * assumes one physical page per copy. That holds for the label printers
   * PrintOps targets (ZPL/TSPL — one label = one page), where `copies` is the
   * number of labels and the counter delta is exactly that. It does NOT hold
   * for a multi-page document printed with copies=1: a 10-page report that
   * jams after page 1 shows delta +1 and would be reported SUCCESS with 9
   * pages missing. PrintOps is a label gateway today; if document printing is
   * added, this must require `pagesPerDocument * copies` (derive
   * pagesPerDocument from the spooler's TotalPages job attribute) rather than
   * `copies` alone.
   *
   * A raised blocking error (out of paper, jam, cover open) is remembered while
   * polling continues: another tray or operator action may let this exact job
   * resume. A finite timeout remains UNVERIFIED, never retryable FAILED.
   */
  private async waitForDeviceConfirmation(
    snmp: { host: string; community: string },
    pagesBefore: number,
    copies: number,
    initialBlockingErrors: string[] = [],
    queueCorrelation?: {
      printerName: string;
      beforeIds: Set<string>;
      ownJobIds: Set<string>;
      initialIssues: string[];
    },
  ): Promise<{
    outcome: 'confirmed' | 'not-confirmed' | 'partial' | 'unverifiable';
    detail: string;
    pagesAfter: number;
    correlationIssues: string[];
  }> {
    const deadline = this.deps.now() + this.DEVICE_VERIFY_TIMEOUT_MS;
    let lastCount = pagesBefore;
    // Track whether the final counter sample is fresh. Silence is explicitly
    // unverifiable; even a fresh unchanged value is not retry-safe because a
    // driver/device buffer can still resume after this finite observation window.
    let anyReadSucceeded = false;
    let lastCounterReadSucceeded = false;
    const blockingErrorsSeen = new Set(initialBlockingErrors);
    const correlationIssues = new Set(queueCorrelation?.initialIssues ?? []);

    while (this.deps.now() < deadline) {
      if (queueCorrelation) {
        const queue = await this.queryPrintJobs(queueCorrelation.printerName);
        if (!queue.ok) {
          correlationIssues.add(`queue telemetry gap during device verification: ${queue.error}`);
        } else if (queueCorrelation.ownJobIds.size > 0) {
          for (const queuedJob of queue.jobs) {
            if (
              !queueCorrelation.beforeIds.has(queuedJob.id) &&
              !queueCorrelation.ownJobIds.has(queuedJob.id)
            ) {
              correlationIssues.add(`competing Windows job during device verification: ${queuedJob.id}`);
            }
          }
        }
      }
      // LOW-6 note: readDeviceState already returns pageCount, so a future
      // refactor could drop the separate readPageCount call and halve the SNMP
      // probes per poll. Not done here because the test harness keys
      // page-count progression off the readPageCount stub (deviceStates only
      // carries the blocking/fault view), and collapsing the two would force a
      // harness rewrite across every scenario for a latency-only gain.
      const pages = await this.deps.readPageCount(snmp.host, { community: snmp.community });
      lastCounterReadSucceeded = pages !== undefined;
      if (pages !== undefined) {
        anyReadSucceeded = true;
        lastCount = pages;
        const delta = pages - pagesBefore;
        if (delta === copies) {
          if (correlationIssues.size > 0) {
            return {
              outcome: 'unverifiable',
              detail:
                `device counter advanced by exactly ${delta}, but output cannot be attributed uniquely ` +
                `(${[...correlationIssues].join('; ')}). Do not auto-retry.`,
              pagesAfter: pages,
              correlationIssues: [...correlationIssues],
            };
          }
          return {
            outcome: 'confirmed',
            detail: `device confirmed ${delta} page(s) printed (counter ${pagesBefore} → ${pages})`,
            pagesAfter: pages,
            correlationIssues: [],
          };
        }
        if (delta > copies) {
          return {
            outcome: 'unverifiable',
            detail:
              `device counter advanced by ${delta}, exceeding ${copies} expected page(s) ` +
              `(counter ${pagesBefore} → ${pages}); competing output makes attribution unsafe. ` +
              `Do not auto-retry.`,
            pagesAfter: pages,
            correlationIssues: [...correlationIssues, 'device counter exceeded expected output'],
          };
        }
      }

      const state = await this.deps.readDeviceState(snmp.host, { community: snmp.community });
      if (state?.blocked) {
        // PaperOut/empty-tray is often transient: the device can switch trays
        // or resume after the operator loads paper. Remember the fault but keep
        // polling so a later counter increment can still establish SUCCESS.
        for (const error of state.errors) blockingErrorsSeen.add(error);
      }

      await this.deps.sleep(this.DEVICE_POLL_INTERVAL_MS);
    }

    if (!lastCounterReadSucceeded) {
      // A read early in the window is not a final negative. If the counter went
      // quiet before the deadline, a page could have come out after our last
      // successful sample. Only a fresh final read can safely prove no output.
      return {
        outcome: 'unverifiable',
        detail: !anyReadSucceeded
          ? `device stopped answering SNMP during verification (no counter read in ${this.DEVICE_VERIFY_TIMEOUT_MS}ms). ` +
            `Paper may have come out — do not auto-retry.`
          : `device page counter stopped answering before final verification ` +
            `(last counter ${pagesBefore} → ${lastCount}). Paper may have come out after the last reading — do not auto-retry.`,
        pagesAfter: lastCount,
        correlationIssues: [...correlationIssues],
      };
    }
    const printed = Math.max(0, lastCount - pagesBefore);
    if (printed > 0) {
      return {
        outcome: 'partial',
        detail: `device counter advanced by only ${printed} of ${copies} requested page(s) within ${this.DEVICE_VERIFY_TIMEOUT_MS}ms (counter ${pagesBefore} → ${lastCount})`,
        pagesAfter: lastCount,
        correlationIssues: [...correlationIssues],
      };
    }
    if (blockingErrorsSeen.size > 0) {
      return {
        outcome: 'unverifiable',
        detail:
          `printer reported ${[...blockingErrorsSeen].join(', ')} during submission/verification and the counter did not advance ` +
          `(counter ${pagesBefore} → ${lastCount}). The job may resume later. Do not auto-retry.`,
        pagesAfter: lastCount,
        correlationIssues: [...correlationIssues],
      };
    }
    return {
      outcome: 'not-confirmed',
      detail: `page counter did not advance within ${this.DEVICE_VERIFY_TIMEOUT_MS}ms (counter ${pagesBefore} → ${lastCount}, expected +${copies})`,
      pagesAfter: lastCount,
      correlationIssues: [...correlationIssues],
    };
  }

  /**
   * Watch the spooler until our own job leaves the queue or raises a fault.
   *
   * Only jobs absent from `beforeIds` are considered. Counting queue entries the
   * way this used to fails whenever an unrelated job is already stuck: a queue
   * that stays at one entry looks like "back to its original size", which is how
   * a print that never happened was once reported as complete.
   *
   * No queue outcome proves physical success or failure. `finished` and
   * `left-queue` only mean Windows is done, while `blocked` is recoverable and
   * may resume; the caller still needs exact device-level confirmation.
   */
  private async waitForSpooler(
    printerName: string,
    beforeIds: Set<string>,
    observedJobIds: Set<string> = new Set(),
    baselineReliable = true,
  ): Promise<SpoolerVerdict> {
    const deadline = this.deps.now() + this.PRINT_TIMEOUT_MS;
    let lastStatus = 'unknown';
    let seenOurJob = observedJobIds.size > 0;
    let transientFault: string | undefined;
    let telemetryError = baselineReliable ? undefined : 'initial print queue snapshot failed';
    const competingJobIds = new Set<string>();

    // Give the spooler a moment to register the job.
    await this.deps.sleep(1000);

    while (this.deps.now() < deadline) {
      // PrinterStatus is queue-wide and can stay PaperOut because of a different
      // retained job even while this job switches trays and prints. Preserve it
      // as evidence, but never let it end observation early.
      const printerFault = await this.readPrinterFault(printerName);
      if (printerFault) {
        transientFault = `printer reports ${printerFault}`;
      }

      const query = await this.queryPrintJobs(printerName);
      if (!query.ok) {
        telemetryError = query.error;
        await this.deps.sleep(this.POLL_INTERVAL_MS);
        continue;
      }
      const jobs = query.jobs;
      if (observedJobIds.size > 0) {
        for (const job of jobs) {
          if (!beforeIds.has(job.id) && !observedJobIds.has(job.id)) {
            competingJobIds.add(job.id);
          }
        }
      }
      if (!baselineReliable && observedJobIds.size === 0) {
        await this.deps.sleep(this.POLL_INTERVAL_MS);
        continue;
      }
      const ourJobs = observedJobIds.size > 0
        ? jobs.filter((job) => observedJobIds.has(job.id))
        : jobs.filter((job) => !beforeIds.has(job.id));

      const blocked = ourJobs.find((job) => isBlockedStatus(job.status));
      if (blocked) {
        transientFault = `job status: ${blocked.status}`;
      }

      if (ourJobs.length === 0) {
        return seenOurJob
          ? {
              outcome: 'left-queue',
              detail: 'correlated job left the spooler queue',
              transientFault,
              telemetryError,
              competingJobIds: [...competingJobIds],
            }
          : {
              outcome: 'not-observed',
              detail: 'no new Windows spooler job was observed for this submission',
              transientFault,
              telemetryError,
              competingJobIds: [...competingJobIds],
            };
      }

      seenOurJob = true;

      if (!blocked && ourJobs.every((job) => isFinishedStatus(job.status))) {
        return {
          outcome: 'finished',
          detail: `spooler reports ${ourJobs[0]?.status}`,
          transientFault,
          telemetryError,
          competingJobIds: [...competingJobIds],
        };
      }

      lastStatus = ourJobs[0]?.status ?? 'printing';
      await this.deps.sleep(this.POLL_INTERVAL_MS);
    }

    return transientFault
      ? {
          outcome: 'blocked',
          detail: `still queued after ${this.PRINT_TIMEOUT_MS}ms (${transientFault}; last status: ${lastStatus})`,
          transientFault,
          telemetryError,
          competingJobIds: [...competingJobIds],
        }
      : {
          outcome: telemetryError ? 'telemetry-error' : 'timeout',
          detail: telemetryError
            ? `print queue telemetry failed during verification: ${telemetryError}`
            : `still queued after ${this.PRINT_TIMEOUT_MS}ms (last status: ${lastStatus})`,
          telemetryError,
          competingJobIds: [...competingJobIds],
        };
  }

  /**
   * The printer's own fault text, or undefined when Windows sees nothing wrong.
   * Cheap, always available, and independent of SNMP — a WSD/IPP printer that
   * has gone offline shows up here immediately.
   */
  private async readPrinterFault(printerName: string): Promise<string | undefined> {
    if (!this.deps.isWindows) return undefined;
    try {
      const safeName = printerName.replace(/'/g, "''");
      const stdout = await this.deps.runPowerShell(
        `(Get-Printer -Name '${safeName}' -ErrorAction Stop).PrinterStatus`,
        5000,
      );
      const raw = stdout.trim();
      return printerFaultFromStatus(raw);
    } catch {
      // Cannot read it — say nothing rather than invent a fault.
      return undefined;
    }
  }

  /** Query current jobs without conflating telemetry failure with an empty queue. */
  private async queryPrintJobs(printerName: string): Promise<PrintJobQuery> {
    if (!this.deps.isWindows) {
      return { ok: false, jobs: [], error: 'Print queue telemetry is available only on Windows' };
    }
    try {
      const safeName = printerName.replace(/'/g, "''");
      // JobStatus is a flags enum — ConvertTo-Json would emit it as a number
      // (e.g. 4224), so cast it to its text form ("Printing, Retained") here.
      // SubmittedTime is carried through so listQueue can report when a job
      // actually entered the queue instead of faking "just now" (LOW-1).
      const stdout = await this.deps.runPowerShell(
        `Get-PrintJob -PrinterName '${safeName}' -ErrorAction Stop | Select-Object Id,DocumentName,@{Name='JobStatus';Expression={[string]$_.JobStatus}},SubmittedTime | ConvertTo-Json -Compress`,
        5000,
      );
      const raw = stdout.trim();
      if (!raw) return { ok: true, jobs: [] };
      const arr = JSON.parse(raw);
      const items = Array.isArray(arr) ? arr : [arr];
      return {
        ok: true,
        jobs: items.map((j: { Id?: number; DocumentName?: string; JobStatus?: unknown; SubmittedTime?: string }) => ({
          id: String(j.Id ?? ''),
          documentName: typeof j.DocumentName === 'string' ? j.DocumentName : undefined,
          status: statusText(j.JobStatus),
          submittedAt: j.SubmittedTime ? new Date(j.SubmittedTime) : undefined,
        })),
      };
    } catch (err) {
      return {
        ok: false,
        jobs: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Best-effort queue list for the public diagnostics endpoint. */
  private async getPrintJobs(printerName: string): Promise<WindowsPrintJob[]> {
    return (await this.queryPrintJobs(printerName)).jobs;
  }

  /**
   * Device-level status over SNMP, or undefined when the printer does not
   * answer. Reports what the hardware says — paper out, jam, cover open —
   * which the spooler does not surface.
   *
   * Goes through resolveSnmpTarget so it honours the same snmpHost /
   * snmpCommunity / snmpEnabled metadata the send+verify path uses (MEDIUM-7).
   * Two SNMP paths that disagree on configuration is how a printer set to
   * community "private" gets probed with "public", times out, and burns 2s on
   * every pre-flight for no reason.
   */
  private async getDeviceStatus(
    printerName: string,
    metadata?: Record<string, unknown>,
  ): Promise<PrinterStatus | undefined> {
    const snmp = await this.resolveSnmpTarget(metadata, printerName);
    if (!snmp) return undefined;

    const state = await this.deps.readDeviceState(snmp.host, { community: snmp.community });
    if (!state) return undefined;

    const code: PrinterStatus['code'] = state.blocked
      ? state.errors.includes('offline')
        ? 'offline'
        : 'error'
      : state.printerStatus === 4
        ? 'busy'
        : state.printerStatus === 3
          ? 'idle'
          : 'unknown';

    return {
      printerId: printerName,
      code,
      message:
        state.errors.length > 0
          ? `${state.errors.join(', ')} (${describeDeviceState(state)})`
          : describeDeviceState(state),
      checkedAt: new Date(),
    };
  }

  /** Get printer status (internal helper, no connectionUri parsing needed). */
  private async getPrinterStatus(
    printerName: string,
    metadata?: Record<string, unknown>,
  ): Promise<PrinterStatus> {
    let windowsStatus: PrinterStatus;
    try {
      const safeName = printerName.replace(/'/g, "''");
      const stdout = await this.deps.runPowerShell(
        `$p = Get-Printer -Name '${safeName}' -ErrorAction Stop | Select-Object -First 1
$win32 = $null
try {
  $win32 = Get-CimInstance -Class Win32_Printer -ErrorAction Stop |
    Where-Object { $_.Name -eq '${safeName}' } | Select-Object -First 1
} catch { }
$workOffline = $p.WorkOffline
if ($null -eq $workOffline -and $null -ne $win32) { $workOffline = $win32.WorkOffline }
[ordered]@{
  status = [string]$p.PrinterStatus
  state = [string]$p.PrinterState
  workOffline = $workOffline
} | ConvertTo-Json -Compress`,
        5000,
      );
      const observation = parseWindowsPrinterStatus(stdout);
      const code = windowsPrinterStatusCode(observation);
      const readiness = evaluatePrinterReadiness({
        detected: true,
        statusCode: code,
        rawStatus: observation.status,
        rawState: observation.state,
        workOffline: observation.workOffline,
      });
      windowsStatus = {
        printerId: printerName,
        code,
        message: observation.status || undefined,
        detected: true,
        workOffline: observation.workOffline,
        rawStatus: observation.status || undefined,
        rawState: observation.state || undefined,
        checkedAt: new Date(),
      };
      if (readiness.warning) {
        windowsStatus.message = [
          windowsStatus.message,
          'Windows reported UNKNOWN; readiness allowed because no explicit offline, error, or paused state was reported',
        ].filter(Boolean).join('; ');
      }
    } catch {
      windowsStatus = {
        printerId: printerName,
        code: 'unknown',
        detected: true,
        message: 'Failed to query printer status',
        checkedAt: new Date(),
      };
    }

    const deviceStatus = await this.getDeviceStatus(printerName, metadata);
    if (!deviceStatus || deviceStatus.code === 'unknown') return windowsStatus;

    // Hardware SNMP is authoritative when it answers. Windows PrinterStatus is
    // queue-wide and may remain PaperOut because an older retained job targeted
    // an empty tray, even while the physical printer is idle and can switch a
    // new job to another tray. Keep the Windows value in the message so the
    // conflict is visible without letting stale queue state mask device truth.
    const windowsContext =
      windowsStatus.code === 'offline' || windowsStatus.code === 'error' || windowsStatus.rawStatus
        ? `Windows spooler reports ${windowsStatus.rawStatus ?? windowsStatus.message ?? windowsStatus.code}`
        : undefined;
    return {
      ...deviceStatus,
      detected: windowsStatus.detected,
      workOffline: windowsStatus.workOffline,
      rawStatus: windowsStatus.rawStatus,
      rawState: windowsStatus.rawState,
      message: [deviceStatus.message, windowsContext].filter(Boolean).join('; ') || undefined,
    };
  }

  async printTestPage(connectionUri: string, printerId: string): Promise<PrinterAdapterResult> {
    const name = this.parsePrinterName(connectionUri);
    if (!name || !this.deps.isWindows) {
      return { success: false, errorCode: 'INVALID', message: 'Cannot resolve printer or not on Windows' };
    }
    // A test page exists to answer "does paper come out of this printer?", so it
    // is the last place that may take the spooler's word for it.
    const body = `--- PrintOps Test Page ---\nPrinter: ${name}\nPrinter ID: ${printerId}\nTime: ${new Date().toISOString()}\n`;
    return this.sendAndVerify({
      printerName: name,
      copies: 1,
      // Reached through connectionUri alone — no metadata to carry SNMP
      // overrides, so the target is resolved from the Windows port.
      metadata: undefined,
      subject: 'test page',
      emit: () => this.printText(name, body),
    });
  }

  async listQueue(connectionUri: string): Promise<QueueEntry[]> {
    const name = this.parsePrinterName(connectionUri);
    if (!name || !this.deps.isWindows) return [];
    const jobs = await this.getPrintJobs(name);
    return jobs.map((j, idx) => ({
      // Fall back to the queue position rather than '' so an id-less row does
      // not collide with every other id-less row on the empty string.
      jobId: j.id !== '' ? j.id : `pos-${idx}`,
      status: j.status,
      position: idx,
      // Use the real queue time when the spooler provides it, not a fabricated
      // "just now" — a job stuck since yesterday used to read as fresh (LOW-1).
      submittedAt: j.submittedAt ?? new Date(),
    }));
  }

  async cancelJob(connectionUri: string, jobId: string): Promise<PrinterAdapterResult> {
    const name = this.parsePrinterName(connectionUri);
    if (!name || !this.deps.isWindows) {
      return { success: false, errorCode: 'INVALID', message: 'Cannot resolve printer or not on Windows' };
    }
    try {
      await this.deps.runPowerShell(
        `Remove-PrintJob -PrinterName '${name.replace(/'/g, "''")}' -ID ${Number(jobId) || 0} -ErrorAction SilentlyContinue`,
      );
      return { success: true, jobId, message: `Job ${jobId} cancelled on "${name}"` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, jobId, errorCode: 'CANCEL_FAILED', message: msg };
    }
  }

  // ---- printing strategies ----

  private printText(printerName: string, text: string): Promise<void> {
    return this.deps.pipeToPowerShell(
      `$ErrorActionPreference='Stop'; $input | Out-Printer -Name '${printerName.replace(/'/g, "''")}'`,
      text,
    );
  }

  private async printHtml(
    printerName: string,
    html: string,
    command: PrintCommand,
  ): Promise<PrintSubmission> {
    // A persistent serve-mode helper keeps ONE WebView2 environment alive per
    // printer instead of cold-starting a fresh WebView2 for every job
    // (DEFECT-05: ~1-2s per job of process + runtime initialisation, which is
    // why batches of labels printed one at a time). The adapter serialises
    // submissions per printer (printerLocks) and the helper processes
    // requests strictly one at a time, so per-printer FIFO order and the
    // send+verify counter attribution are preserved exactly as before.
    const session = await this.htmlHelperSession(printerName);
    const jobId = (command.jobId ?? `job-${Date.now()}`).replace(/[^A-Za-z0-9_-]/g, '_');
    const file = join(session.dir, `doc-${jobId}.html`);
    const requestFile = join(session.dir, `request-${jobId}.json`);
    const resultFile = join(session.dir, `result-${jobId}.json`);
    try {
      const page = resolveHtmlPageSettings(html, command.metadata);
      const transformedHtml = applyHtmlRenderTransform(html, page, command);
      await writeFile(file, transformedHtml, 'utf-8');
      const jobName = `PrintOps:${command.jobId ?? jobId}`;
      // Serve-mode requests omit resultPath/userDataFolder: the result goes
      // to result-<jobId>.json and the WebView2 data folder is shared and
      // long-lived (created once by the helper at startup).
      await writeFile(requestFile, JSON.stringify({
        filePath: file,
        printerName,
        jobName,
        copies: 1,
        paperWidthMm: page.widthMm,
        paperHeightMm: page.heightMm,
        marginTopMm: page.marginTopMm,
        marginRightMm: page.marginRightMm,
        marginBottomMm: page.marginBottomMm,
        marginLeftMm: page.marginLeftMm,
        orientation: page.orientation,
        duplex: command.duplex ? 'long-edge' : 'one-sided',
        colorMode: command.colorMode,
      }), 'utf-8');

      let stdout: string;
      try {
        stdout = await this.deps.runPowerShell(
          buildHtmlPrintServeScript(session.dir, resultFile, printerName, jobName),
          60_000,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('WEBVIEW2_PRINT_TIMEOUT')) {
          // The helper produced no result — it is likely wedged or dead.
          // Recycle it so the next job spawns a fresh process instead of
          // queueing behind a corpse.
          await this.recycleHtmlHelperSession(printerName, session);
        }
        if (
          message.includes('HTML_PRINT_HELPER_NOT_FOUND') ||
          message.includes('PRINTER_NOT_FOUND') ||
          (message.includes('WEBVIEW2_PRINT_FAILED') && message.includes('PrinterUnavailable')) ||
          message.includes('phase=Startup') ||
          message.includes('phase=Initializing') ||
          message.includes('phase=Navigating') ||
          message.includes('phase=Preparing')
        ) {
          throw err;
        }
        throw new Error(`PRINT_SUBMISSION_STATE_UNKNOWN: ${message}`);
      }
      let parsed: {
        helperStatus?: string;
        helperPhase?: string;
        observedAt?: string;
        jobs?: Array<{ id?: number; status?: string; documentName?: string }>;
      };
      try {
        parsed = JSON.parse(stdout.trim()) as typeof parsed;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`PRINT_RESULT_NOT_READABLE: ${message}`);
      }
      const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
      const jobIds = jobs.map((job) => String(job.id ?? '')).filter(Boolean);
      return {
        jobIds,
        helperStatus: parsed.helperStatus ?? 'Succeeded',
        helperPhase: parsed.helperPhase,
        observedAt: parsed.observedAt,
        jobs,
      };
    } finally {
      // Clean per-request artifacts; the session dir and the WebView2 data
      // folder inside it live for the life of the helper process.
      await rm(file, { force: true }).catch(() => {});
      await rm(requestFile, { force: true }).catch(() => {});
      await rm(resultFile, { force: true }).catch(() => {});
    }
  }

  // ---- persistent HTML helper sessions (serve mode) ----

  /** How long a serve-mode helper stays alive without work before exiting. */
  private static readonly HTML_HELPER_IDLE_MS = 180_000;

  private htmlHelperSessions = new Map<string, { dir: string; child: ChildProcess }>();

  /** Get (or spawn) the persistent helper for a printer. */
  private async htmlHelperSession(printerName: string): Promise<{ dir: string; child: ChildProcess }> {
    const existing = this.htmlHelperSessions.get(printerName);
    if (existing && existing.child.exitCode === null) return existing;
    if (existing) {
      // Dead session — reclaim its directory before spawning a replacement.
      this.htmlHelperSessions.delete(printerName);
      await rm(existing.dir, { recursive: true, force: true }).catch(() => {});
    }

    const helperPath = this.resolveHtmlPrintHelperPath();
    const dir = await mkdtemp(join(tmpdir(), 'printops-html-serve-'));
    // `--serve` keeps the process alive and reuses one WebView2 environment;
    // the idle timeout bounds the orphan a crashed parent could leave behind.
    const logError = (line: string): void => {
      try {
        const log = createWriteStream(join(dir, 'helper-stderr.log'), { flags: 'a' });
        log.write(`${new Date().toISOString()} ${line}\n`);
        log.end();
      } catch {
        // diagnostic only
      }
    };
    logError(`HELPER_PATH: ${helperPath}`);
    logError(`HELPER_ARGS: --serve ${dir} --idle-ms ${WindowsSpoolerAdapter.HTML_HELPER_IDLE_MS}`);
    logError(`HELPER_CWD: ${process.cwd()}`);
    const spawnHelper = this.deps.spawnHelper ??
      ((path: string, args: string[]) => spawn(path, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }));
    const child = spawnHelper(
      helperPath,
      ['--serve', dir, '--idle-ms', String(WindowsSpoolerAdapter.HTML_HELPER_IDLE_MS)],
    );
    // DEBUG: capture helper stderr to a file next to the session dir so a
    // silent startup death can be diagnosed on the field machine.
    if (child.stderr && typeof child.stderr.pipe === 'function') {
      try {
        const log = createWriteStream(join(dir, 'helper-stderr.log'), { flags: 'a' });
        child.stderr.pipe(log);
      } catch {
        // diagnostic only
      }
    }
    child.once('error', (err) => logError(`SPAWN_ERROR: ${err.message}`));
    child.once('exit', (code, signal) => {
      logError(`HELPER_EXIT code=${code} signal=${signal ?? ''}`);
      if (this.htmlHelperSessions.get(printerName)?.child === child) {
        this.htmlHelperSessions.delete(printerName);
      }
    });
    // One process-wide cleanup for every session this adapter spawned.
    if (!WindowsSpoolerAdapter.installCleanupRegistered) {
      WindowsSpoolerAdapter.installCleanupRegistered = true;
      const killAll = (): void => {
        for (const session of this.htmlHelperSessions.values()) {
          session.child.kill();
        }
      };
      process.once('exit', killAll);
      // SIGINT/SIGTERM: pkg builds get a hard 'exit'; dev (tsx) may only get
      // the signal, so kill helpers there too.
      process.once('SIGINT', () => { killAll(); });
      process.once('SIGTERM', () => { killAll(); });
    }
    this.htmlHelperSessions.set(printerName, { dir, child });
    return { dir, child };
  }

  /** Drop a wedged/dead session so the next job starts a fresh helper. */
  private async recycleHtmlHelperSession(
    printerName: string,
    session: { dir: string; child: ChildProcess },
  ): Promise<void> {
    if (this.htmlHelperSessions.get(printerName)?.child === session.child) {
      this.htmlHelperSessions.delete(printerName);
    }
    try {
      session.child.kill();
    } catch {
      // already dead
    }
    await rm(session.dir, { recursive: true, force: true }).catch(() => {});
  }

  private resolveHtmlPrintHelperPath(): string {
    // Tauri's resource_dir() returns extended-length paths (\\?\C:\...) and the
    // desktop passes that straight into PRINTOPS_HTML_PRINT_HELPER. Node's
    // existsSync/spawn tolerate the prefix, but the .NET Framework CLR cannot
    // resolve a \\?\ app base and dies with "Could not load file or assembly
    // ... The system cannot find the file specified". Normalise to a plain
    // Win32 path before spawning.
    const normaliseWinPath = (candidate: string): string =>
      candidate.startsWith('\\\\?\\') ? candidate.slice(4) : candidate;
    const candidates = [
      this.deps.htmlPrintHelperPath,
      process.env['PRINTOPS_HTML_PRINT_HELPER'],
      join(process.cwd(), 'print-helper', 'printops-html-print.exe'),
      join(process.cwd(), 'apps', 'windows-print-helper', 'publish', 'printops-html-print.exe'),
      join(process.cwd(), '..', 'windows-print-helper', 'publish', 'printops-html-print.exe'),
    ]
      .filter((candidate): candidate is string => Boolean(candidate))
      .map(normaliseWinPath);

    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) {
      throw new Error(
        `HTML_PRINT_HELPER_NOT_FOUND: expected printops-html-print.exe at one of: ${candidates.join(', ')}`,
      );
    }
    return found;
  }

  private async printRaw(printerName: string, data: Buffer): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'printops-raw-'));
    const file = join(dir, 'document.bin');
    try {
      await writeFile(file, data);
      const safeName = printerName.replace(/'/g, "''");
      const safePath = file.replace(/'/g, "''");
      const script = RAW_PRINT_PS_PREFIX + `$name='${safeName}'; $path='${safePath}'; ` + RAW_PRINT_PS_SUFFIX;
      await this.deps.runPowerShell(script, 15_000);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Run the bundled WebView2 print helper and observe the Windows queue while it
 * calls CoreWebView2.PrintAsync. Every new job id that appears only within that
 * isolated invocation window is captured; document name is kept as evidence
 * but cannot be the key because Microsoft IPP Class Driver may replace the HTML
 * title. A very fast job may still enter and leave between 50ms samples.
 * Missing local queue evidence therefore does not abort verification: the
 * caller can still prove the exact document from the printer-side IPP job. The
 * helper sets PrinterName directly, so it never changes the user's default
 * printer and never displays the legacy print chooser.
 */
export function buildHtmlPrintScript(
  helperPath: string,
  requestFile: string,
  resultFile: string,
  printerName: string,
  expectedDocumentName: string,
): string {
  const safeHelper = helperPath.replace(/'/g, "''");
  const safeRequest = requestFile.replace(/'/g, "''");
  const safeResult = resultFile.replace(/'/g, "''");
  const safePrinterName = printerName.replace(/'/g, "''");
  const safeDocumentName = expectedDocumentName.replace(/'/g, "''");
  return `$ErrorActionPreference='Stop';
    if (-not (Test-Path -LiteralPath '${safeHelper}')) { throw 'HTML_PRINT_HELPER_NOT_FOUND: ${safeHelper}' }
    if ($null -eq (Get-Printer -Name '${safePrinterName}' -ErrorAction SilentlyContinue)) { throw 'PRINTER_NOT_FOUND: ${safePrinterName}' }
    $before = @{};
    @(Get-PrintJob -PrinterName '${safePrinterName}' -ErrorAction SilentlyContinue) | ForEach-Object { $before[[string]$_.Id] = $true };
    $seen = @{};
    $observed = @{ at = $null };
    function Capture-PrintOpsJobs {
      @(Get-PrintJob -PrinterName '${safePrinterName}' -ErrorAction SilentlyContinue) | ForEach-Object {
        $id = [string]$_.Id;
        $documentName = [string]$_.DocumentName;
        if (-not $before.ContainsKey($id)) {
          if ($null -eq $observed.at) { $observed.at = [DateTime]::UtcNow.ToString('o') }
          $seen[$id] = [ordered]@{ id=[int]$_.Id; status=[string]$_.JobStatus; documentName=$documentName; expectedDocumentName=($documentName -eq '${safeDocumentName}'); submittedTime=$_.SubmittedTime };
        }
      }
    }
    $process = Start-Process -FilePath '${safeHelper}' -ArgumentList @('--request', '"${safeRequest}"') -PassThru -WindowStyle Hidden;
    $deadline = [DateTime]::UtcNow.AddSeconds(45);
    while (-not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
      Capture-PrintOpsJobs;
      Start-Sleep -Milliseconds 50;
      $process.Refresh();
    }
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue;
      throw 'WEBVIEW2_PRINT_TIMEOUT: helper did not finish within 45 seconds';
    }
    $afterDeadline = [DateTime]::UtcNow.AddSeconds(2);
    while ([DateTime]::UtcNow -lt $afterDeadline) {
      Capture-PrintOpsJobs;
      Start-Sleep -Milliseconds 50;
    }
    $helper = if (Test-Path -LiteralPath '${safeResult}') { Get-Content -Raw -LiteralPath '${safeResult}' | ConvertFrom-Json } else { $null };
    if ($process.ExitCode -ne 0 -or $null -eq $helper -or -not $helper.success) {
      $reason = if ($null -ne $helper) { "phase=$($helper.phase); status=$($helper.status); $($helper.message)" } else { "helper exit code $($process.ExitCode) without result" };
      throw "WEBVIEW2_PRINT_FAILED: $reason";
    }
    [ordered]@{ helperStatus=[string]$helper.status; helperPhase=[string]$helper.phase; observedAt=$observed.at; expectedDocumentName='${safeDocumentName}'; jobObserved=($seen.Count -gt 0); jobs=@($seen.Values) } | ConvertTo-Json -Depth 5 -Compress;`;
}

/**
 * Serve-mode variant of buildHtmlPrintScript for the PERSISTENT helper.
 *
 * The adapter keeps one `printops-html-print.exe --serve <dir>` process alive
 * per printer, so WebView2 initialises once instead of once per job
 * (DEFECT-05). This script no longer starts the helper: the adapter writes
 * `request-<jobId>.json` into the serve dir before invoking this script, the
 * helper writes `result-<jobId>.json` when the print finishes, and this
 * script observes the Windows queue while waiting for that result file.
 */
export function buildHtmlPrintServeScript(
  serveDir: string,
  resultFile: string,
  printerName: string,
  expectedDocumentName: string,
): string {
  const safeResult = resultFile.replace(/'/g, "''");
  const safePrinterName = printerName.replace(/'/g, "''");
  const safeDocumentName = expectedDocumentName.replace(/'/g, "''");
  return `$ErrorActionPreference='Stop';
    if ($null -eq (Get-Printer -Name '${safePrinterName}' -ErrorAction SilentlyContinue)) { throw 'PRINTER_NOT_FOUND: ${safePrinterName}' }
    $before = @{};
    @(Get-PrintJob -PrinterName '${safePrinterName}' -ErrorAction SilentlyContinue) | ForEach-Object { $before[[string]$_.Id] = $true };
    $seen = @{};
    $observed = @{ at = $null };
    function Capture-PrintOpsJobs {
      @(Get-PrintJob -PrinterName '${safePrinterName}' -ErrorAction SilentlyContinue) | ForEach-Object {
        $id = [string]$_.Id;
        $documentName = [string]$_.DocumentName;
        if (-not $before.ContainsKey($id)) {
          if ($null -eq $observed.at) { $observed.at = [DateTime]::UtcNow.ToString('o') }
          $seen[$id] = [ordered]@{ id=[int]$_.Id; status=[string]$_.JobStatus; documentName=$documentName; expectedDocumentName=($documentName -eq '${safeDocumentName}'); submittedTime=$_.SubmittedTime };
        }
      }
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(45);
    while (-not (Test-Path -LiteralPath '${safeResult}') -and [DateTime]::UtcNow -lt $deadline) {
      Capture-PrintOpsJobs;
      Start-Sleep -Milliseconds 50;
    }
    if (-not (Test-Path -LiteralPath '${safeResult}')) {
      throw 'WEBVIEW2_PRINT_TIMEOUT: serve helper did not produce a result within 45 seconds';
    }
    $helper = Get-Content -Raw -LiteralPath '${safeResult}' | ConvertFrom-Json;
    if (-not $helper.success) {
      throw "WEBVIEW2_PRINT_FAILED: phase=$($helper.phase); status=$($helper.status); $($helper.message)";
    }
    [ordered]@{ helperStatus=[string]$helper.status; helperPhase=[string]$helper.phase; observedAt=$observed.at; expectedDocumentName='${safeDocumentName}'; jobObserved=($seen.Count -gt 0); jobs=@($seen.Values) } | ConvertTo-Json -Depth 5 -Compress;`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

type PrintSubmission = {
  jobIds: string[];
  helperStatus: string;
  helperPhase?: string;
  observedAt?: string;
  jobs: Array<{ id?: number; status?: string; documentName?: string }>;
};

type IppObservation = {
  endpoint?: IppEndpoint;
  expectedName: string;
  baselineKeys: Set<string>;
  observedJobs: Map<string, IppRemoteJob>;
  telemetryErrors: string[];
  baselineError?: string;
};

function emptyIppObservation(
  expectedName: string,
  baselineError: string,
  telemetryErrors: string[] = [],
): IppObservation {
  return {
    expectedName,
    baselineKeys: new Set(),
    observedJobs: new Map(),
    telemetryErrors,
    baselineError,
  };
}

/** Microsoft IPP Class Driver replaces ':' in WebView document titles with '_'. */
export function normaliseIppJobName(name: string | undefined): string {
  return (name ?? '').trim().replace(/:/g, '_');
}

function captureExpectedIppJobs(observation: IppObservation, jobs: IppRemoteJob[]): void {
  const expected = normaliseIppJobName(observation.expectedName);
  for (const job of jobs) {
    if (observation.baselineKeys.has(job.key)) continue;
    if (normaliseIppJobName(job.name) !== expected) continue;
    observation.observedJobs.set(job.key, job);
  }
}

function serialiseIppJobs(jobs: Iterable<IppRemoteJob>): Array<Record<string, unknown>> {
  return [...jobs].map((job) => ({
    key: job.key,
    id: job.id,
    uri: job.uri,
    uuid: job.uuid,
    name: job.name,
    state: job.state,
    stateName: ippJobStateName(job.state),
    stateReasons: job.stateReasons,
    impressions: job.impressions,
    impressionsCompleted: job.impressionsCompleted,
    mediaSheetsCompleted: job.mediaSheetsCompleted,
  }));
}

function ippJobLabel(job: IppRemoteJob): string {
  return job.id === undefined ? job.key : `#${job.id}`;
}

function ippJobStateName(state: number | undefined): string {
  return ({
    3: 'pending',
    4: 'pending-held',
    5: 'processing',
    6: 'processing-stopped',
    7: 'canceled',
    8: 'aborted',
    9: 'completed',
  } as Record<number, string>)[state ?? -1] ?? `unknown(${state ?? 'missing'})`;
}

type WindowsPrintJob = {
  id: string;
  documentName?: string;
  status: string;
  submittedAt?: Date;
};

type PrintJobQuery =
  | { ok: true; jobs: WindowsPrintJob[] }
  | { ok: false; jobs: WindowsPrintJob[]; error: string };

export type HtmlPageSettings = {
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  orientation: 'portrait' | 'landscape';
};

function metadataNumber(metadata: Record<string, unknown>, key: string): number | undefined {
  const direct = metadata[key];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const profile = metadata['paperProfile'];
  if (profile && typeof profile === 'object') {
    const nested = (profile as Record<string, unknown>)[key];
    if (typeof nested === 'number' && Number.isFinite(nested)) return nested;
  }
  return undefined;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const direct = metadata[key];
  if (typeof direct === 'string') return direct;
  const profile = metadata['paperProfile'];
  if (profile && typeof profile === 'object') {
    const nested = (profile as Record<string, unknown>)[key];
    if (typeof nested === 'string') return nested;
  }
  return undefined;
}

export function applyHtmlRenderTransform(
  html: string,
  page: HtmlPageSettings,
  command: PrintCommand,
): string {
  // The API renderer already wraps HTML output. This guard keeps the adapter
  // safe for direct HTML commands and prevents a queued job from being
  // transformed twice.
  if (html.includes('data-printops-transform-frame')) return html;
  const profile = command.metadata?.['paperProfile'];
  const profileValues = profile && typeof profile === 'object' && !Array.isArray(profile)
    ? profile as Record<string, unknown>
    : command.metadata ?? {};
  const metadataOverrides = readRenderTransformOverrides(command.metadata);
  const transform = resolveRenderTransform(profileValues, {
    ...metadataOverrides,
    ...(command.rotate !== undefined ? { rotate: command.rotate } : {}),
    ...(command.flipHorizontal !== undefined ? { flipHorizontal: command.flipHorizontal } : {}),
    ...(command.flipVertical !== undefined ? { flipVertical: command.flipVertical } : {}),
  });
  return wrapHtmlWithRenderTransform(html, page.widthMm, page.heightMm, transform);
}

/** Resolve actual driver page settings from the selected profile, with the
 * dimensions embedded in generated HTML as a backwards-compatible fallback. */
export function resolveHtmlPageSettings(
  html: string,
  metadata: Record<string, unknown> = {},
): HtmlPageSettings {
  const widthMatch = html.match(/(?:^|[;"'])\s*width\s*:\s*([0-9]+(?:\.[0-9]+)?)mm/i);
  const heightMatch = html.match(/(?:^|[;"'])\s*height\s*:\s*([0-9]+(?:\.[0-9]+)?)mm/i);
  const widthMm = metadataNumber(metadata, 'widthMm') ?? Number(widthMatch?.[1]);
  const heightMm = metadataNumber(metadata, 'heightMm') ?? Number(heightMatch?.[1]);

  if (!Number.isFinite(widthMm) || widthMm <= 0 || !Number.isFinite(heightMm) || heightMm <= 0) {
    throw new Error(
      'PAPER_PROFILE_REQUIRED: HTML printing requires widthMm and heightMm from the selected paper profile',
    );
  }

  const requestedOrientation = metadataString(metadata, 'orientation')?.trim().toLowerCase();
  const orientation: HtmlPageSettings['orientation'] =
    requestedOrientation === 'portrait' || requestedOrientation === 'landscape'
      ? requestedOrientation
      : widthMm > heightMm ? 'landscape' : 'portrait';
  const naturalOrientation: HtmlPageSettings['orientation'] = widthMm > heightMm ? 'landscape' : 'portrait';
  const marginTopMm = Math.max(0, metadataNumber(metadata, 'marginTopMm') ?? 0);
  const marginRightMm = Math.max(0, metadataNumber(metadata, 'marginRightMm') ?? 0);
  const marginBottomMm = Math.max(0, metadataNumber(metadata, 'marginBottomMm') ?? 0);
  const marginLeftMm = Math.max(0, metadataNumber(metadata, 'marginLeftMm') ?? 0);

  // Match the paper-profile editor: imported/legacy data can store dimensions
  // whose natural orientation disagrees with the explicit orientation. Rotate
  // both the sheet and its directional margins before handing it to the driver.
  if (naturalOrientation !== orientation) {
    return {
      widthMm: heightMm,
      heightMm: widthMm,
      marginTopMm: marginLeftMm,
      marginRightMm: marginTopMm,
      marginBottomMm: marginRightMm,
      marginLeftMm: marginBottomMm,
      orientation,
    };
  }
  return {
    widthMm,
    heightMm,
    marginTopMm,
    marginRightMm,
    marginBottomMm,
    marginLeftMm,
    orientation,
  };
}

function isRawPrinterLanguage(mimeType: string): boolean {
  return new Set([
    'application/zpl',
    'application/vnd.zebra-zpl',
    'application/tspl',
    'application/epl',
    'application/pcl',
  ]).has(mimeType.trim().toLowerCase());
}

function submissionErrorCode(message: string): string {
  const known = [
    'PRINT_JOB_NOT_OBSERVED',
    'PRINT_RESULT_NOT_READABLE',
    'PRINT_SUBMISSION_STATE_UNKNOWN',
    'WEBVIEW2_PRINT_FAILED',
    'WEBVIEW2_PRINT_TIMEOUT',
    'HTML_PRINT_HELPER_NOT_FOUND',
    'PAPER_PROFILE_REQUIRED',
    'UNSUPPORTED_PRINT_FORMAT',
    'PRINTER_NOT_FOUND',
  ];
  return known.find((code) => message.includes(code)) ?? 'PRINT_SUBMISSION_FAILED';
}

/** What the spooler had to say about our job once it stopped moving. */
type SpoolerVerdict = {
  /** Queue observation alone never proves that paper came out. */
  outcome: 'left-queue' | 'finished' | 'blocked' | 'timeout' | 'not-observed' | 'telemetry-error';
  detail: string;
  /** Recoverable Windows/job fault seen at any time during this submission. */
  transientFault?: string;
  telemetryError?: string;
  competingJobIds: string[];
};

/** `Get-Printer` states that mean the printer cannot produce a page right now. */
const PRINTER_FAULT_STATUSES = new Set([
  'Error',
  'Offline',
  'NotAvailable',
  'PaperOut',
  'PaperJam',
  'PaperProblem',
  'DoorOpen',
  'NoToner',
  'OutOfMemory',
  'UserIntervention',
]);

function printerFaultFromStatus(raw: string): string | undefined {
  const flags = raw
    .split(/[,|]/)
    .map((flag) => flag.trim())
    .filter(Boolean);
  return flags.find((flag) =>
    [...PRINTER_FAULT_STATUSES].some((fault) => fault.toLowerCase() === flag.toLowerCase()),
  );
}

export interface WindowsPrinterStatusObservation {
  status: string;
  state?: string;
  workOffline?: boolean | null;
}

/**
 * Parse the structured status emitted by the Windows query. The raw-token
 * fallback keeps older runners/test seams compatible while the structured
 * form carries WorkOffline for USB queues.
 */
export function parseWindowsPrinterStatus(stdout: string): WindowsPrinterStatusObservation {
  const raw = stdout.trim();
  if (!raw) return { status: '' };
  try {
    const parsed = JSON.parse(raw) as {
      status?: unknown;
      state?: unknown;
      workOffline?: unknown;
    };
    if (parsed && typeof parsed === 'object' && ('status' in parsed || 'state' in parsed || 'workOffline' in parsed)) {
      return {
        status: typeof parsed.status === 'string' ? parsed.status : '',
        state: typeof parsed.state === 'string' ? parsed.state : undefined,
        workOffline: typeof parsed.workOffline === 'boolean' ? parsed.workOffline : null,
      };
    }
  } catch {
    // PowerShell 5.1/status test seams may return only the raw enum name.
  }
  return { status: raw };
}

/** Normalize status for the public PrinterStatus contract. */
export function windowsPrinterStatusCode(
  observation: WindowsPrinterStatusObservation | string,
): PrinterStatus['code'] {
  const normalizedObservation = typeof observation === 'string'
    ? parseWindowsPrinterStatus(observation)
    : observation;
  const status = normalizedObservation.status.trim().toLowerCase();
  const state = (normalizedObservation.state ?? '').trim().toLowerCase();
  const tokens = `${status},${state}`
    .split(/[,|]/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (normalizedObservation.workOffline === true || tokens.includes('offline')) return 'offline';
  if (tokens.includes('error') || tokens.includes('paused')) return 'error';
  if (['normal', 'idle', 'ready', 'online'].includes(status)) return 'idle';
  if (['printing', 'processing', 'busy'].includes(status)) return 'busy';
  // Do not turn PaperOut/PaperJam/etc. into a synthetic ERROR here. Those
  // values remain visible as raw evidence and are handled by the spooler and
  // device verification safety checks at submission time.
  return 'unknown';
}

/** Windows may hand back the JobStatus enum as a number; normalise to text. */
function statusText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return 'unknown';
  return String(value);
}

/**
 * Split a Windows JobStatus into its individual flag names.
 *
 * JobStatus is a *flags* enum rendered as a comma-separated list — "Printing,
 * Retained", "Error, Printing". Substring matching over the whole string gets
 * this wrong in both directions: "Printing, Retained" contains "retained" but
 * the job is still going, and "Error, Retained" contains "retained" but nothing
 * was printed. Every flag has to be looked at separately.
 */
export function parseJobFlags(status: unknown): Set<string> {
  return new Set(
    statusText(status)
      .toLowerCase()
      .split(',')
      .map((flag) => flag.replace(/[^a-z]/g, ''))
      .filter(Boolean),
  );
}

/** Flags meaning the job will not print without someone intervening. */
const BLOCKING_JOB_FLAGS = [
  'error',
  'offline',
  'paperout',
  'blocked',
  'blockeddevq',
  'deleted',
  'deleting',
  'paused',
  'userintervention',
];

/** Flags meaning the spooler has not finished with the job yet. */
const ACTIVE_JOB_FLAGS = ['printing', 'spooling', 'restarting'];

/** Flags meaning the spooler considers the document delivered. */
const DONE_JOB_FLAGS = ['printed', 'complete', 'completed', 'retained'];

/** The job cannot proceed — an explicit device or spooler fault. */
export function isBlockedStatus(status: unknown): boolean {
  const flags = parseJobFlags(status);
  return BLOCKING_JOB_FLAGS.some((flag) => flags.has(flag));
}

/**
 * The spooler is done with this job and raised no fault.
 *
 * This is *not* proof that paper came out — only that Windows handed the
 * document off without complaint. Confirming the physical page is the device
 * tier's job.
 */
export function isFinishedStatus(status: unknown): boolean {
  const flags = parseJobFlags(status);
  if (BLOCKING_JOB_FLAGS.some((flag) => flags.has(flag))) return false;
  if (ACTIVE_JOB_FLAGS.some((flag) => flags.has(flag))) return false;
  return DONE_JOB_FLAGS.some((flag) => flags.has(flag));
}

/**
 * PowerShell prefix: defines a .NET `RawPrinter` type via P/Invoke (winspool.drv).
 * Consumed in two parts so variables can be injected between them.
 */
const RAW_PRINT_PS_PREFIX = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
}
public class RawPrinter {
  public static bool SendBytes(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    var di = new RawPrinterHelper.DOCINFOA { pDocName = "PrintOps", pDataType = "RAW" };
    if (!RawPrinterHelper.OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
    try {
      if (!RawPrinterHelper.StartDocPrinter(hPrinter, 1, di)) return false;
      try {
        if (!RawPrinterHelper.StartPagePrinter(hPrinter)) return false;
        try {
          IntPtr p = Marshal.AllocHGlobal(bytes.Length);
          try {
            Marshal.Copy(bytes, 0, p, bytes.Length);
            int written;
            if (!RawPrinterHelper.WritePrinter(hPrinter, p, bytes.Length, out written)) return false;
            return written == bytes.Length;
          } finally { Marshal.FreeHGlobal(p); }
        } finally { RawPrinterHelper.EndPagePrinter(hPrinter); }
      } finally { RawPrinterHelper.EndDocPrinter(hPrinter); }
    } finally { RawPrinterHelper.ClosePrinter(hPrinter); }
  }
}
'@
$ErrorActionPreference = 'Stop'
`;

const RAW_PRINT_PS_SUFFIX = `
$bytes = [System.IO.File]::ReadAllBytes($path)
if (-not [RawPrinter]::SendBytes($name, $bytes)) { Write-Error 'RawPrinter.SendBytes returned false' }
`;
