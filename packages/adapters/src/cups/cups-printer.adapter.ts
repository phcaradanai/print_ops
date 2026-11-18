import type { PrinterAdapterPort, PrinterAdapterResult, QueueEntry, PrinterCapability, PrinterStatus, PrintCommand } from '@printerops/domain';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readRenderTransformOverrides } from '@printerops/shared';
import { applyHtmlRenderTransform, applyHtmlMarginCompensation, applyHtmlCalibration, resolveHtmlPageSettings } from '../windows/windows-spooler.adapter.js';
import { parseIppEndpoint, queryIppJobs } from '../windows/ipp-printer-client.js';

const exec = promisify(execFile);
export interface CupsPrinterDeps {
  run: (file: string, args: string[], server?: string, timeoutMs?: number) => Promise<string>;
  server?: string;
  queryPrinterJobs: typeof queryIppJobs;
  deviceVerifyTimeoutMs: number;
}
const queueName = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,126}$/;
const nativeFormats = new Set([
  'application/zpl', 'application/vnd.zebra-zpl', 'application/tspl',
  'application/epl', 'application/pcl', 'application/dpl', 'application/vnd.datamax-dpl',
]);
type DeviceDelivery =
  | { confirmed: true; id?: number; impressionsCompleted: number }
  | { confirmed: false; detail: string };

/** CUPS is the driver boundary: a queue must have a compatible Linux driver.
 * Only a correlated job completed at the device confirms delivery.
 */
export class CupsPrinterAdapter implements PrinterAdapterPort {
  readonly protocol = 'cups';
  readonly adapterName = 'CupsPrinterAdapter';
  private readonly run: CupsPrinterDeps['run'];
  private server: string | undefined;
  private readonly queryPrinterJobs: typeof queryIppJobs;
  private readonly deviceVerifyTimeoutMs: number;

  constructor(deps: Partial<CupsPrinterDeps> = {}) {
    this.server = deps.server ?? process.env['CUPS_SERVER'];
    this.queryPrinterJobs = deps.queryPrinterJobs ?? queryIppJobs;
    this.deviceVerifyTimeoutMs = deps.deviceVerifyTimeoutMs ?? 40_000;
    this.run = deps.run ?? (async (file, args, server, timeoutMs = 60_000) => {
      const { stdout } = await exec(file, args, {
        timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, ...(server ? { CUPS_SERVER: server } : {}), LC_ALL: 'C.UTF-8' },
      });
      return stdout;
    });
  }

  getServer(): string {
    return this.server ?? '';
  }

  setServer(server: string): void {
    this.server = server;
  }

  async assertServerReachable(server: string): Promise<void> {
    const status = await this.run('lpstat', ['-r', '-p'], server, 8_000);
    if (!/^scheduler is running\s*$/m.test(status)) throw new Error('CUPS scheduler did not respond');
  }

  private queue(uri: string | undefined): string {
    // Parse directly: URL.hostname would lowercase case-sensitive queue names.
    const match = /^cups:\/\/([A-Za-z0-9][A-Za-z0-9_.-]{0,126})$/.exec(uri ?? '');
    if (!match) throw new Error('Use cups://QUEUE_NAME for a configured Linux CUPS queue');
    return match[1]!;
  }

  async listPrinters(): Promise<string[]> {
    const output = await this.run('lpstat', ['-p'], this.server, 8_000);
    return output.split('\n').flatMap((line) => {
      const name = /^printer (\S+) /.exec(line)?.[1];
      return name && queueName.test(name) ? [name] : [];
    });
  }

  async detect(uri: string): Promise<boolean> {
    try { await this.run('lpstat', ['-p', this.queue(uri)], this.server); return true; }
    catch { return false; }
  }

  async getStatus(uri: string): Promise<PrinterStatus> {
    const queue = this.queue(uri);
    try {
      const status = await this.run('lpstat', ['-p', queue, '-l'], this.server);
      return { printerId: queue, code: /disabled|paused|error/i.test(status) ? 'error' : /printing/i.test(status) ? 'busy' : 'idle',
        detected: true, message: status.trim(), rawStatus: status, checkedAt: new Date() };
    } catch (error) {
      return { printerId: queue, code: 'unknown', detected: false, message: String(error), checkedAt: new Date() };
    }
  }

  async getCapabilities(uri: string): Promise<PrinterCapability> {
    // Do not fabricate a universal printer's physical limits or driver options.
    const options = await this.run('lpoptions', ['-p', this.queue(uri), '-l'], this.server);
    const resolutions = options.match(/\b\d+(?:x\d+)?dpi\b/g) ?? [];
    return { colorSupported: /ColorModel[^\n]*(?:RGB|CMYK|Color)/i.test(options),
      duplexSupported: /Duplex[^\n]*(?:DuplexNoTumble|DuplexTumble)/i.test(options),
      maxPageWidth: 0, maxPageHeight: 0, supportedMediaTypes: [],
      supportedResolutions: [...new Set(resolutions)], maxCopies: 999 };
  }

  async executeCommand(command: PrintCommand): Promise<PrinterAdapterResult> {
    let dir: string | undefined;
    let submitting = false;
    let receipt: string | undefined;
    try {
      const queue = this.queue(command.connectionUri);
      const server = this.server;
      if (!Number.isInteger(command.copies) || command.copies < 1 || command.copies > 999) {
        throw new Error('CUPS copies must be an integer between 1 and 999');
      }
      const mime = command.mimeType.toLowerCase().split(';')[0]!.trim();
      if (!['text/html', 'application/pdf', 'image/png', 'image/jpeg', 'text/plain'].includes(mime) && !nativeFormats.has(mime)) {
        throw new Error(`Unsupported CUPS document format: ${mime}`);
      }
      const bytes = command.documentBase64
        ? Buffer.from(command.documentBase64, 'base64')
        : Buffer.from(command.renderedPrintPayload ?? '', 'utf8');
      if (bytes.length === 0) throw new Error('A rendered payload or documentBase64 is required');
      // Read-only preflight, before any print submission.
      const status = await this.run('lpstat', ['-p', queue], server);
      if (/disabled|paused/i.test(status)) throw new Error(`CUPS queue ${queue} is disabled`);
      dir = await mkdtemp(join(tmpdir(), 'printops-cups-'));
      const file = join(dir, mime === 'text/html' ? 'label.pdf' : 'document');
      const jobTitle = `PrintOps:${command.jobId}:${randomUUID()}`;
      const args = ['-d', queue, '-n', String(command.copies), '-t', jobTitle,
        '-o', 'job-sheets=none', '-o', 'print-scaling=none',
        '-o', command.duplex ? 'sides=two-sided-long-edge' : 'sides=one-sided'];
      if (mime === 'text/html') {
        const overrides = { ...readRenderTransformOverrides(command.metadata),
          ...(command.rotate !== undefined ? { rotate: command.rotate } : {}),
          ...(command.flipHorizontal !== undefined ? { flipHorizontal: command.flipHorizontal } : {}),
          ...(command.flipVertical !== undefined ? { flipVertical: command.flipVertical } : {}) };
        const source = bytes.toString('utf8');
        const page = resolveHtmlPageSettings(source, command.metadata, overrides);
        const html = applyHtmlCalibration(applyHtmlMarginCompensation(applyHtmlRenderTransform(source, page, command, overrides), page, command, overrides), page, command);
        // Preserve the Windows driver margin origin without shrinking the page flow area.
        // CSS page margins split full-height label boxes into extra blank pages.
        // Paint containment clips the shifted overflow while preserving existing
        // one-label and multi-label page breaks, without shrinking barcode geometry.
        // PDF and driver share the label face size; the feed gap is not a page.
        const css = `<style>@page{size:${page.widthMm}mm ${page.heightMm}mm;margin:0}html,body{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}html{contain:paint}body{position:relative;left:${page.marginLeftMm}mm;top:${page.marginTopMm}mm}</style>`;
        const input = join(dir, 'label.html');
        await writeFile(input, html + css);
        await this.run('chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
          '--no-pdf-header-footer', `--user-data-dir=${join(dir, 'chromium')}`,
          `--print-to-pdf=${file}`, pathToFileURL(input).href]);
        const pdf = await readFile(file);
        if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Chromium did not produce a PDF');
        args.push('-o', `media=Custom.${page.widthMm}x${page.heightMm}mm`);
      } else {
        if (mime === 'application/pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF document');
        await writeFile(file, bytes);
        if (nativeFormats.has(mime)) args.push('-o', 'raw');
      }
      if (command.colorMode !== 'auto') args.push('-o', `print-color-mode=${command.colorMode}`);
      if (command.resolution && /^\d+(?:x\d+)?dpi$/.test(command.resolution)) args.push('-o', `printer-resolution=${command.resolution}`);
      args.push('--', file);
      const remoteServer = server?.startsWith('/') ? undefined : server;
      const submission = remoteServer
        ? await this.prepareRemoteSubmission(remoteServer, queue, file, mime, command, args, jobTitle)
        : { file: 'lp', args };
      submitting = true;
      receipt = await this.run(submission.file, submission.args, server);
      const ippId = remoteServer ? /^\s*job-id \(integer\) = (\d+)\s*$/m.exec(receipt)?.[1] : undefined;
      const id = ippId ? `${queue}-${ippId}` : receipt.match(/request id is (\S+-\d+)/)?.[1];
      const evidence = { cupsJobId: id, cupsQueue: queue, spoolerAccepted: !!id,
        physicalDeliveryConfirmed: false, retried: false };
      let verificationDetail = 'CUPS did not return a job ID';
      if (id) {
        await command.onProgress?.({ stage: 'SPOOLER_ACCEPTED', occurredAt: new Date(), evidence });
        const delivery = await this.confirmDeviceDelivery(queue, jobTitle, command.copies, server);
        if (delivery.confirmed) {
          return {
            success: true,
            jobId: id,
            message: `Printer confirmed CUPS job ${id} with ${delivery.impressionsCompleted} completed impression(s)`,
            raw: {
              ...evidence,
              physicalDeliveryConfirmed: true,
              deviceConfirmed: true,
              ippJobConfirmed: true,
              ippJobId: delivery.id,
              impressionsCompleted: delivery.impressionsCompleted,
            },
          };
        }
        verificationDetail = delivery.detail;
      }
      return { success: false, jobId: id, errorCode: 'PRINT_NOT_VERIFIABLE',
        message: `CUPS submission ${id ?? 'receipt unknown'}: physical delivery is unverified; do not auto-reprint`,
        raw: { ...evidence, verificationDetail } };
    } catch (error) {
      return { success: false, errorCode: submitting ? 'PRINT_NOT_VERIFIABLE' : 'CUPS_PREPARATION_FAILED',
        message: String(error), raw: { submissionAttempted: submitting, receipt, physicalDeliveryConfirmed: false, retried: false } };
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async confirmDeviceDelivery(queue: string, jobTitle: string, copies: number, server?: string): Promise<DeviceDelivery> {
    try {
      const devices = await this.run('lpstat', ['-v', queue], server, 8_000);
      const prefix = `device for ${queue}: `;
      const uri = devices.split('\n').find((line) => line.startsWith(prefix))?.slice(prefix.length).trim();
      let endpoint = uri && /^ipps?:\/\//i.test(uri) ? parseIppEndpoint(uri) : undefined;
      if (!endpoint) return { confirmed: false, detail: 'The CUPS queue has no direct IPP device URI' };

      const deadline = performance.now() + this.deviceVerifyTimeoutMs;
      let detail = 'No matching completed IPP job';
      do {
        let response = await this.queryPrinterJobs(endpoint);
        if (!response.ok && endpoint.transport === 'http:' && response.error === 'IPP endpoint returned HTTP 426') {
          const secured = parseIppEndpoint(endpoint.uri.replace(/^ipp:/, 'ipps:'));
          if (!secured) return { confirmed: false, detail: 'Unable to use IPPS for the CUPS device URI' };
          endpoint = secured;
          response = await this.queryPrinterJobs(endpoint);
        }
        if (!response.ok) {
          detail = response.error;
        } else {
          const jobs = response.jobs.filter((job) => job.name === jobTitle);
          if (jobs.length > 1) return { confirmed: false, detail: 'Multiple IPP jobs matched the print attempt' };
          const job = jobs[0];
          if (job?.state === 7 || job?.state === 8) {
            return { confirmed: false, detail: `Device job ended in IPP state ${job.state}` };
          }
          detail = 'No matching completed IPP job';
          if (job?.state === 9) {
            const count = job.impressionsCompleted;
            const succeeded = job.stateReasons.some(
              (reason) => reason === 'completed-successfully' || reason === 'job-completed-successfully',
            );
            if (succeeded && count !== undefined && count >= Math.max(copies, job.impressions ?? 0)) {
              return { confirmed: true, id: job.id, impressionsCompleted: count };
            }
            detail = 'The completed IPP job has not reported successful output for all requested copies';
          }
        }
        const remaining = deadline - performance.now();
        if (remaining > 0) await delay(Math.min(1_500, remaining));
      } while (performance.now() < deadline);
      return { confirmed: false, detail };
    } catch (error) {
      return { confirmed: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  private async prepareRemoteSubmission(
    server: string, queue: string, file: string, mime: string, command: PrintCommand, lpArgs: string[], jobTitle: string,
  ): Promise<{ file: string; args: string[] }> {
    const uri = new URL(`ipp://${server}/printers/${queue}`);
    const media = lpArgs.find((arg) => /^media=Custom\.[\d.]+x[\d.]+mm$/.test(arg))?.slice('media='.length);
    const resolution = lpArgs.find((arg) => arg.startsWith('printer-resolution='))?.slice('printer-resolution='.length);
    const testFile = `${file}.ipp`;
    const printRequest = [
      '{',
      'OPERATION Print-Job',
      'GROUP operation-attributes-tag',
      'ATTR charset attributes-charset utf-8',
      'ATTR language attributes-natural-language en',
      'ATTR uri printer-uri $uri',
      'ATTR name requesting-user-name $user',
      'ATTR name job-name $title',
      'ATTR mimeMediaType document-format $format',
      'GROUP job-attributes-tag',
      `ATTR integer copies ${command.copies}`,
      'ATTR keyword job-sheets none,none',
      'ATTR keyword print-scaling none',
      `ATTR keyword sides ${command.duplex ? 'two-sided-long-edge' : 'one-sided'}`,
      ...(command.colorMode === 'color' || command.colorMode === 'monochrome'
        ? [`ATTR keyword print-color-mode ${command.colorMode}`] : []),
      ...(media ? [`ATTR name media ${media}`] : []),
      ...(resolution ? [`ATTR resolution printer-resolution ${resolution}`] : []),
      'FILE $filename',
      'STATUS successful-ok',
      'STATUS successful-ok-ignored-or-substituted-attributes',
      'EXPECT job-id',
      '}',
    ].join('\n');
    await writeFile(testFile, printRequest);
    const format = nativeFormats.has(mime) ? 'application/vnd.cups-raw' : mime === 'text/html' ? 'application/pdf' : mime;
    return { file: 'ipptool', args: ['-tv', '-f', file, '-d', `title=${jobTitle}`, '-d', `format=${format}`, uri.href, testFile] };
  }

  async printTestPage(_uri: string, _id: string): Promise<PrinterAdapterResult> {
    return { success: false, errorCode: 'PAPER_PROFILE_REQUIRED', message: 'Use Template Sandbox with the selected template and paper profile for a CUPS test label' };
  }

  async listQueue(uri: string): Promise<QueueEntry[]> {
    const rows = await this.run('lpstat', ['-o', this.queue(uri)], this.server);
    return rows.trim().split('\n').filter(Boolean).map((line, position) => ({
      jobId: line.trim().split(/\s+/)[0]!, status: 'queued', position,
      // lpstat formats dates per server; do not invent a parseable submission time.
      submittedAt: new Date(0),
    }));
  }

  async cancelJob(uri: string, jobId: string): Promise<PrinterAdapterResult> {
    const queue = this.queue(uri);
    if (!jobId.startsWith(`${queue}-`) || !/^\d+$/.test(jobId.slice(queue.length + 1))) {
      return { success: false, errorCode: 'INVALID_CUPS_JOB', message: 'Job id must belong to this CUPS queue' };
    }
    try {
      await this.run('cancel', [jobId], this.server);
      return { success: true, jobId, message: 'CUPS cancellation requested; an already printed page cannot be recalled' };
    } catch (error) { return { success: false, errorCode: 'CUPS_CANCEL_FAILED', message: String(error) }; }
  }
}
