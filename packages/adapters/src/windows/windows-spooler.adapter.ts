import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
import {
  readDeviceState,
  readPageCount,
  describeDeviceState,
  type PrinterDeviceState,
} from '../snmp/printer-mib.js';
import { resolveSnmpHost } from './snmp-host-resolver.js';

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
  sleep(ms: number): Promise<void>;
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
  sleep,
};

/**
 * WindowsSpoolerAdapter — prints via the Windows print spooler.
 *
 * On Windows, uses PowerShell to send documents:
 *  - text/plain: piped through `Out-Printer` (handles text formatting)
 *  - text/html: temp file + shell `printto` verb (Edge/browser renders)
 *  - raw (ZPL/TSPL/etc.): temp file + .NET RawPrinterHelper (sends exact bytes)
 *
 * After sending to the spooler, polls `Get-PrintJob` to verify the physical
 * printer actually completed the job before returning success.
 *
 * On non-Windows, all operations return a descriptive error.
 */
export class WindowsSpoolerAdapter implements PrinterAdapterPort {
  readonly protocol = 'windows_spooler';
  readonly adapterName = 'WindowsSpoolerAdapter';

  private readonly deps: WindowsSpoolerDeps;

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

    // Device truth first: the spooler reports "Normal" for a printer that is
    // out of paper, so SNMP wins whenever the printer answers it.
    const deviceStatus = await this.getDeviceStatus(name);
    if (deviceStatus) return deviceStatus;

    try {
      const stdout = await this.deps.runPowerShell(
        `(Get-Printer -Name '${name.replace(/'/g, "''")}' -ErrorAction Stop).PrinterStatus`,
      );
      const raw = stdout.trim();
      const code: PrinterStatus['code'] =
        raw === 'Normal' ? 'idle' :
        raw === 'Idle' ? 'idle' :
        raw === 'Printing' || raw === 'Processing' ? 'busy' :
        raw === 'Error' ? 'error' :
        raw === 'Offline' || raw === 'NotAvailable' ? 'offline' :
        'unknown';
      return { printerId: name, code, message: raw || undefined, checkedAt: new Date() };
    } catch {
      return { printerId: name, code: 'unknown', message: 'Failed to query printer status', checkedAt: new Date() };
    }
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

    // --- Check printer is actually online before sending ---
    const status = await this.getPrinterStatus(printerName);
    if (status.code === 'offline') {
      return {
        success: false,
        errorCode: 'PRINTER_OFFLINE',
        message: `Printer "${printerName}" is offline`,
      };
    }
    if (status.code === 'error') {
      return {
        success: false,
        errorCode: 'PRINTER_ERROR',
        message: `Printer "${printerName}" is in error state${status.message ? ': ' + status.message : ''}`,
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
      jobId: command.jobId,
      subject: `job ${command.jobId}`,
      emit: async () => {
        if (command.mimeType === 'text/html') {
          await this.printHtml(printerName, content.toString('utf-8'));
        } else if (command.mimeType === 'text/plain' || command.mimeType === 'RAW_TEXT') {
          await this.printText(printerName, content.toString('utf-8'));
        } else {
          await this.printRaw(printerName, content);
        }
      },
    });
  }

  /**
   * Send a document and decide whether it printed.
   *
   * SUCCESS is reported only when a device-level channel proved a page came
   * out. The spooler may DISPROVE a print but may never PROVE one, and a
   * device-channel failure must never demote a print a device reading already
   * confirmed. Every caller goes through here: an invariant enforced in two
   * places is an invariant that only holds until the two drift apart, which is
   * how the test-page route came to report success on the spooler's word alone.
   */
  private async sendAndVerify(params: {
    printerName: string;
    copies: number;
    /** Printer metadata carrying the SNMP overrides, when the caller has any. */
    metadata: Record<string, unknown> | undefined;
    jobId?: string;
    /** How to name this print in operator-facing messages. */
    subject: string;
    /** Hand one copy to the spooler. */
    emit: () => Promise<void>;
  }): Promise<PrinterAdapterResult> {
    const { printerName, copies, jobId, subject } = params;

    // --- Windows-level pre-flight: never feed a printer already in fault ---
    const preflightFault = await this.readPrinterFault(printerName);
    if (preflightFault) {
      return {
        success: false,
        jobId,
        errorCode: 'PRINTER_NOT_READY',
        message: `Printer "${printerName}" is ${preflightFault} — not sending job`,
      };
    }

    // --- Device-level pre-flight (SNMP, when the printer answers) ---
    const snmp = await this.resolveSnmpTarget(params.metadata, printerName);
    let deviceBefore: PrinterDeviceState | undefined;
    if (snmp) {
      deviceBefore = await this.deps.readDeviceState(snmp.host, { community: snmp.community });
      if (deviceBefore?.blocked) {
        return {
          success: false,
          jobId,
          errorCode: 'PRINTER_DEVICE_ERROR',
          message: `Printer "${printerName}" reports ${deviceBefore.errors.join(', ')} — not sending job`,
        };
      }
    }

    // --- Note what was already queued, so our own job can be told apart ---
    const beforeIds = await this.getJobIds(printerName);

    // --- Print copies ---
    for (let i = 0; i < copies; i++) {
      await params.emit();
    }

    // --- Wait for the spooler, which can disprove a print but never prove one ---
    const spooler = await this.waitForSpooler(printerName, beforeIds);
    if (spooler.outcome === 'blocked') {
      return {
        success: false,
        jobId,
        errorCode: 'PRINT_JOB_ERROR',
        message: `WindowsSpoolerAdapter: ${subject} failed on "${printerName}": ${spooler.detail}`,
      };
    }

    // --- Device-level confirmation: did paper actually come out? ---
    if (snmp && deviceBefore?.pageCount !== undefined) {
      const confirmation = await this.waitForDeviceConfirmation(
        snmp,
        deviceBefore.pageCount,
        copies,
      );
      if (confirmation.outcome === 'confirmed') {
        return {
          success: true,
          jobId,
          message: `WindowsSpoolerAdapter: ${subject} on "${printerName}" — ${confirmation.detail}`,
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
        };
      }
      // not-confirmed: the counter WAS read and did not advance — a real
      // negative. A retry is safe, so FAILED (not UNVERIFIED) is correct here.
      return {
        success: false,
        jobId,
        errorCode: 'PRINT_NOT_CONFIRMED_BY_DEVICE',
        message: `WindowsSpoolerAdapter: ${subject} on "${printerName}" — ${confirmation.detail}`,
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
   * Poll the device page counter until it advances by the number of copies.
   *
   * A raised blocking error (out of paper, jam, cover open) fails immediately
   * with the device's own reason — that is the whole point of reading SNMP
   * rather than trusting the spooler.
   */
  private async waitForDeviceConfirmation(
    snmp: { host: string; community: string },
    pagesBefore: number,
    copies: number,
  ): Promise<{ outcome: 'confirmed' | 'not-confirmed' | 'unverifiable'; detail: string }> {
    const deadline = Date.now() + this.DEVICE_VERIFY_TIMEOUT_MS;
    let lastCount = pagesBefore;
    // The wait must distinguish two timeouts that look identical without this
    // flag: a counter that was read and stayed put (a real negative — the page
    // did not come out, a retry is safe) vs. a device that stopped answering
    // mid-verify so no read ever succeeded (unknown — paper may well have come
    // out, a retry risks a duplicate). The two must not share an outcome, or a
    // network blip during verification files a printed page as retryable-FAILED.
    let anyReadSucceeded = false;

    while (Date.now() < deadline) {
      const pages = await this.deps.readPageCount(snmp.host, { community: snmp.community });
      if (pages !== undefined) {
        anyReadSucceeded = true;
        lastCount = pages;
        if (pages - pagesBefore >= copies) {
          return {
            outcome: 'confirmed',
            detail: `device confirmed ${pages - pagesBefore} page(s) printed (counter ${pagesBefore} → ${pages})`,
          };
        }
      }

      const state = await this.deps.readDeviceState(snmp.host, { community: snmp.community });
      if (state?.blocked) {
        return {
          outcome: 'not-confirmed',
          detail: `printer reports ${state.errors.join(', ')} — ${describeDeviceState(state)}`,
        };
      }

      await this.deps.sleep(this.DEVICE_POLL_INTERVAL_MS);
    }

    if (!anyReadSucceeded) {
      // Never read the counter at all during the whole window — the device
      // went quiet after the baseline, so the only honest verdict is "we don't
      // know". Map to UNVERIFIABLE so the job lands in UNVERIFIED, not FAILED.
      return {
        outcome: 'unverifiable',
        detail:
          `device stopped answering SNMP during verification (no counter read in ${this.DEVICE_VERIFY_TIMEOUT_MS}ms). ` +
          `Paper may have come out — do not auto-retry.`,
      };
    }
    return {
      outcome: 'not-confirmed',
      detail: `page counter did not advance within ${this.DEVICE_VERIFY_TIMEOUT_MS}ms (counter ${pagesBefore} → ${lastCount}, expected +${copies})`,
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
   * `blocked` is the only outcome that proves failure. `finished` and
   * `left-queue` mean Windows is happy, which is not the same as paper existing
   * — the caller still has to confirm at the device.
   */
  private async waitForSpooler(
    printerName: string,
    beforeIds: Set<string>,
  ): Promise<SpoolerVerdict> {
    const deadline = Date.now() + this.PRINT_TIMEOUT_MS;
    let lastStatus = 'unknown';
    let seenOurJob = false;

    // Give the spooler a moment to register the job.
    await this.deps.sleep(1000);

    while (Date.now() < deadline) {
      // The device fault the spooler surfaces on the printer itself — this is
      // what "PrinterStatus: Error" looks like when a WSD printer goes away.
      const printerFault = await this.readPrinterFault(printerName);
      if (printerFault) {
        return { outcome: 'blocked', detail: `printer reports ${printerFault}` };
      }

      const ourJobs = (await this.getPrintJobs(printerName)).filter((job) => !beforeIds.has(job.id));

      const blocked = ourJobs.find((job) => isBlockedStatus(job.status));
      if (blocked) {
        return { outcome: 'blocked', detail: `job status: ${blocked.status}` };
      }

      if (ourJobs.length === 0) {
        return seenOurJob
          ? { outcome: 'left-queue', detail: 'job left the spooler queue' }
          : { outcome: 'left-queue', detail: 'job was accepted and is no longer queued' };
      }

      seenOurJob = true;

      if (ourJobs.every((job) => isFinishedStatus(job.status))) {
        return { outcome: 'finished', detail: `spooler reports ${ourJobs[0]?.status}` };
      }

      lastStatus = ourJobs[0]?.status ?? 'printing';
      await this.deps.sleep(this.POLL_INTERVAL_MS);
    }

    return {
      outcome: 'timeout',
      detail: `still queued after ${this.PRINT_TIMEOUT_MS}ms (last status: ${lastStatus})`,
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
      return PRINTER_FAULT_STATUSES.has(raw) ? raw : undefined;
    } catch {
      // Cannot read it — say nothing rather than invent a fault.
      return undefined;
    }
  }

  /** Ids currently in the spooler queue, used to tell our job from the rest. */
  private async getJobIds(printerName: string): Promise<Set<string>> {
    const jobs = await this.getPrintJobs(printerName);
    return new Set(jobs.map((job) => job.id));
  }

  /** Get current print jobs for a printer. */
  private async getPrintJobs(printerName: string): Promise<Array<{ id: string; status: string }>> {
    if (!this.deps.isWindows) return [];
    try {
      const safeName = printerName.replace(/'/g, "''");
      // JobStatus is a flags enum — ConvertTo-Json would emit it as a number
      // (e.g. 4224), so cast it to its text form ("Printing, Retained") here.
      const stdout = await this.deps.runPowerShell(
        `Get-PrintJob -PrinterName '${safeName}' -ErrorAction SilentlyContinue | Select-Object Id,@{Name='JobStatus';Expression={[string]$_.JobStatus}} | ConvertTo-Json -Compress`,
        5000,
      );
      const raw = stdout.trim();
      if (!raw) return [];
      const arr = JSON.parse(raw);
      const items = Array.isArray(arr) ? arr : [arr];
      return items.map((j: { Id?: number; JobStatus?: unknown }) => ({
        id: String(j.Id ?? ''),
        status: statusText(j.JobStatus),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Device-level status over SNMP, or undefined when the printer does not
   * answer. Reports what the hardware says — paper out, jam, cover open —
   * which the spooler does not surface.
   */
  private async getDeviceStatus(printerName: string): Promise<PrinterStatus | undefined> {
    let host: string | undefined;
    try {
      host = await this.deps.resolveSnmpHost(printerName);
    } catch {
      return undefined;
    }
    if (!host) return undefined;

    const state = await this.deps.readDeviceState(host);
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
  private async getPrinterStatus(printerName: string): Promise<PrinterStatus> {
    const deviceStatus = await this.getDeviceStatus(printerName);
    if (deviceStatus) return deviceStatus;

    try {
      const safeName = printerName.replace(/'/g, "''");
      const stdout = await this.deps.runPowerShell(
        `(Get-Printer -Name '${safeName}' -ErrorAction Stop).PrinterStatus`,
        5000,
      );
      const raw = stdout.trim();
      const code: PrinterStatus['code'] =
        raw === 'Normal' ? 'idle' :
        raw === 'Idle' ? 'idle' :
        raw === 'Printing' || raw === 'Processing' ? 'busy' :
        raw === 'Error' ? 'error' :
        raw === 'Offline' || raw === 'NotAvailable' ? 'offline' :
        'unknown';
      return { printerId: printerName, code, message: raw || undefined, checkedAt: new Date() };
    } catch {
      return { printerId: printerName, code: 'unknown', message: 'Failed to query printer status', checkedAt: new Date() };
    }
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
      jobId: j.id,
      status: j.status,
      position: idx,
      submittedAt: new Date(),
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

  private async printHtml(printerName: string, html: string): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'printops-html-'));
    const file = join(dir, 'document.html');
    try {
      await writeFile(file, html, 'utf-8');
      const script =
        `$ErrorActionPreference='Stop';
         $p = Start-Process -FilePath '${file.replace(/'/g, "''")}' -Verb printto -ArgumentList '"${printerName.replace(/'/g, "''")}"' -PassThru -Wait;
         if ($p.ExitCode -ne 0) { exit 1 }`;
      await this.deps.runPowerShell(script, 30_000);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
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

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** What the spooler had to say about our job once it stopped moving. */
type SpoolerVerdict = {
  /** `blocked` is a proven failure; the rest only mean Windows raised nothing. */
  outcome: 'left-queue' | 'finished' | 'blocked' | 'timeout';
  detail: string;
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
