import type { PrinterAdapterPort, PrinterAdapterResult, QueueEntry, PrinterCapability, PrinterStatus, PrintCommand } from '@printerops/domain';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRenderTransformOverrides } from '@printerops/shared';
import { applyHtmlRenderTransform, applyHtmlCalibration, resolveHtmlPageSettings } from '../windows/windows-spooler.adapter.js';

const exec = promisify(execFile);
export interface CupsPrinterDeps {
  run: (file: string, args: string[]) => Promise<string>;
}
const nativeFormats = new Set([
  'application/zpl', 'application/vnd.zebra-zpl', 'application/tspl',
  'application/epl', 'application/pcl', 'application/dpl', 'application/vnd.datamax-dpl',
]);

/** CUPS is the driver boundary: a queue must have a compatible Linux driver.
 * A spooler receipt alone never confirms a physical page. Do not auto-retry lp.
 */
export class CupsPrinterAdapter implements PrinterAdapterPort {
  readonly protocol = 'cups';
  readonly adapterName = 'CupsPrinterAdapter';
  private readonly run: CupsPrinterDeps['run'];

  constructor(deps: Partial<CupsPrinterDeps> = {}) {
    this.run = deps.run ?? (async (file, args) => {
      const { stdout } = await exec(file, args, {
        timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, LC_ALL: 'C.UTF-8' },
      });
      return stdout;
    });
  }

  private queue(uri: string | undefined): string {
    // Parse directly: URL.hostname would lowercase case-sensitive queue names.
    const match = /^cups:\/\/([A-Za-z0-9][A-Za-z0-9_.-]{0,126})$/.exec(uri ?? '');
    if (!match) throw new Error('Use cups://QUEUE_NAME for a configured Linux CUPS queue');
    return match[1]!;
  }

  async detect(uri: string): Promise<boolean> {
    try { await this.run('lpstat', ['-p', this.queue(uri)]); return true; }
    catch { return false; }
  }

  async getStatus(uri: string): Promise<PrinterStatus> {
    const queue = this.queue(uri);
    try {
      const status = await this.run('lpstat', ['-p', queue, '-l']);
      return { printerId: queue, code: /disabled|paused|error/i.test(status) ? 'error' : /printing/i.test(status) ? 'busy' : 'idle',
        detected: true, message: status.trim(), rawStatus: status, checkedAt: new Date() };
    } catch (error) {
      return { printerId: queue, code: 'unknown', detected: false, message: String(error), checkedAt: new Date() };
    }
  }

  async getCapabilities(uri: string): Promise<PrinterCapability> {
    // Do not fabricate a universal printer's physical limits or driver options.
    const options = await this.run('lpoptions', ['-p', this.queue(uri), '-l']);
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
      const status = await this.run('lpstat', ['-p', queue]);
      if (/disabled|paused/i.test(status)) throw new Error(`CUPS queue ${queue} is disabled`);
      dir = await mkdtemp(join(tmpdir(), 'printops-cups-'));
      const file = join(dir, mime === 'text/html' ? 'label.pdf' : 'document');
      const args = ['-d', queue, '-n', String(command.copies), '-t', `PrintOps:${command.jobId}`,
        '-o', 'job-sheets=none', '-o', 'print-scaling=none',
        '-o', command.duplex ? 'sides=two-sided-long-edge' : 'sides=one-sided'];
      if (mime === 'text/html') {
        const overrides = { ...readRenderTransformOverrides(command.metadata),
          ...(command.rotate !== undefined ? { rotate: command.rotate } : {}),
          ...(command.flipHorizontal !== undefined ? { flipHorizontal: command.flipHorizontal } : {}),
          ...(command.flipVertical !== undefined ? { flipVertical: command.flipVertical } : {}) };
        const source = bytes.toString('utf8');
        const page = resolveHtmlPageSettings(source, command.metadata, overrides);
        const html = applyHtmlCalibration(applyHtmlRenderTransform(source, page, command, overrides), page, command);
        // PDF and driver share the exact label face size; the feed gap is not a page.
        const css = `<style>@page{size:${page.widthMm}mm ${page.heightMm}mm;margin:0}html,body{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>`;
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
      submitting = true;
      receipt = await this.run('lp', args);
      const id = receipt.match(/request id is (\S+-\d+)/)?.[1];
      const evidence = { cupsJobId: id, cupsQueue: queue, spoolerAccepted: !!id,
        physicalDeliveryConfirmed: false, retried: false };
      await command.onProgress?.({ stage: 'SPOOLER_ACCEPTED', occurredAt: new Date(), evidence });
      return { success: false, jobId: id, errorCode: 'PRINT_NOT_VERIFIABLE',
        message: `CUPS submission ${id ?? 'receipt unknown'}: physical delivery is unverified; do not auto-reprint`, raw: evidence };
    } catch (error) {
      return { success: false, errorCode: submitting ? 'PRINT_NOT_VERIFIABLE' : 'CUPS_PREPARATION_FAILED',
        message: String(error), raw: { submissionAttempted: submitting, receipt, physicalDeliveryConfirmed: false, retried: false } };
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async printTestPage(_uri: string, _id: string): Promise<PrinterAdapterResult> {
    return { success: false, errorCode: 'PAPER_PROFILE_REQUIRED', message: 'Use Template Sandbox with the selected template and paper profile for a CUPS test label' };
  }

  async listQueue(uri: string): Promise<QueueEntry[]> {
    const rows = await this.run('lpstat', ['-o', this.queue(uri)]);
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
      await this.run('cancel', [jobId]);
      return { success: true, jobId, message: 'CUPS cancellation requested; an already printed page cannot be recalled' };
    } catch (error) { return { success: false, errorCode: 'CUPS_CANCEL_FAILED', message: String(error) }; }
  }
}
