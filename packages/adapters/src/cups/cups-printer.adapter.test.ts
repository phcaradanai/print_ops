import { describe, it, expect } from 'vitest';
import { readFile, writeFile, access } from 'node:fs/promises';
import type { PrintCommand } from '@printerops/domain';
import { CupsPrinterAdapter } from './cups-printer.adapter.js';

const command = (overrides: Partial<PrintCommand> = {}): PrintCommand => ({
  jobId: 'job-1', printerId: 'printer-1', traceId: 'trace-1',
  connectionUri: 'cups://POSTEK_G2000', mimeType: 'text/html',
  renderedPrintPayload: '<html><body><div>ภาษาไทย Barcode</div></body></html>',
  copies: 2, duplex: false, colorMode: 'monochrome',
  metadata: { paperProfile: { widthMm: 60, heightMm: 30, gapMm: 2 } },
  ...overrides,
});

function harness(options: { submitError?: boolean; renderError?: boolean; response?: string } = {}) {
  const calls: { file: string; args: string[] }[] = [];
  let renderedHTML = '';
  let submittedFile = '';
  let submittedBytes = Buffer.alloc(0);
  const adapter = new CupsPrinterAdapter({ run: async (file: string, args: string[]) => {
    calls.push({ file, args });
    if (file === 'lpstat') return 'printer POSTEK_G2000 is idle. enabled';
    if (file === 'chromium') {
      if (options.renderError) throw new Error('renderer failed');
      renderedHTML = await readFile(new URL(args[args.length - 1]!), 'utf8');
      const pdf = args.find(arg => arg.startsWith('--print-to-pdf='))!.slice('--print-to-pdf='.length);
      await writeFile(pdf, '%PDF-1.4\nrendered label');
      return '';
    }
    if (file === 'lp') {
      submittedFile = args[args.length - 1]!;
      submittedBytes = await readFile(submittedFile);
      if (options.submitError) throw new Error('connection lost after submission');
      return options.response ?? 'request id is POSTEK_G2000-42 (1 file(s))';
    }
    return '';
  } });
  return { adapter, calls, html: () => renderedHTML, file: () => submittedFile, bytes: () => submittedBytes };
}

describe('CUPS Linux printing', () => {
  it('renders the existing profile to PDF and submits exactly once with copies and no rescaling', async () => {
    const h = harness();
    const result = await h.adapter.executeCommand(command());
    expect(result).toMatchObject({ success: false, errorCode: 'PRINT_NOT_VERIFIABLE', jobId: 'POSTEK_G2000-42' });
    expect(h.html()).toContain('size:60mm 30mm');
    expect(h.html()).toContain('ภาษาไทย');
    expect(h.html()).not.toContain('size:60mm 32mm');
    const submits = h.calls.filter(c => c.file === 'lp');
    expect(submits).toHaveLength(1);
    expect(submits[0]!.args).toEqual(expect.arrayContaining(['-d', 'POSTEK_G2000', '-n', '2', 'media=Custom.60x30mm', 'print-scaling=none']));
    expect(h.bytes().subarray(0, 4).toString()).toBe('%PDF');
    await expect(access(h.file())).rejects.toThrow();
  });

  it('uses profile rotation for both PDF geometry and the CUPS media', async () => {
    const h = harness();
    await h.adapter.executeCommand(command({ rotate: 90 }));
    expect(h.html()).toContain('size:30mm 60mm');
    expect(h.calls.find(c => c.file === 'lp')?.args).toContain('media=Custom.30x60mm');
  });

  it('never submits HTML when PDF rendering fails', async () => {
    const h = harness({ renderError: true });
    expect(await h.adapter.executeCommand(command())).toMatchObject({ success: false, errorCode: 'CUPS_PREPARATION_FAILED' });
    expect(h.calls.filter(c => c.file === 'lp')).toHaveLength(0);
  });

  it('does not retry or invite replay when submission outcome is ambiguous', async () => {
    const h = harness({ submitError: true });
    expect(await h.adapter.executeCommand(command())).toMatchObject({ success: false, errorCode: 'PRINT_NOT_VERIFIABLE' });
    expect(h.calls.filter(c => c.file === 'lp')).toHaveLength(1);
  });

  it('keeps an unparseable spooler response unverified', async () => {
    const h = harness({ response: 'unexpected response' });
    expect(await h.adapter.executeCommand(command())).toMatchObject({ errorCode: 'PRINT_NOT_VERIFIABLE' });
  });

  it.each(['tcp://192.168.1.50:9100', 'cups://-bad', 'cups://queue/extra'])('rejects invalid CUPS destination %s before touching a printer', async connectionUri => {
    const h = harness();
    expect(await h.adapter.executeCommand(command({ connectionUri }))).toMatchObject({ success: false, errorCode: 'CUPS_PREPARATION_FAILED' });
    expect(h.calls).toHaveLength(0);
  });

  it('requires paper geometry for rendered HTML', async () => {
    const h = harness();
    expect(await h.adapter.executeCommand(command({ metadata: {} }))).toMatchObject({ errorCode: 'CUPS_PREPARATION_FAILED' });
    expect(h.calls.filter(c => c.file === 'lp')).toHaveLength(0);
  });

  it('passes native commands as raw bytes only for explicit printer language MIME types', async () => {
    const h = harness();
    await h.adapter.executeCommand(command({ mimeType: 'application/zpl', renderedPrintPayload: '^XA^XZ' }));
    expect(h.bytes().toString()).toBe('^XA^XZ');
    expect(h.calls.find(c => c.file === 'lp')?.args).toContain('raw');
    expect(h.calls.filter(c => c.file === 'chromium')).toHaveLength(0);
  });

  it('rejects unknown data instead of silently sending it as raw printer commands', async () => {
    const h = harness();
    expect(await h.adapter.executeCommand(command({ mimeType: 'application/json' }))).toMatchObject({ errorCode: 'CUPS_PREPARATION_FAILED' });
    expect(h.calls.filter(c => c.file === 'lp')).toHaveLength(0);
  });

  it('rejects nonpositive copy counts without submitting', async () => {
    const h = harness();
    expect(await h.adapter.executeCommand(command({ copies: 0 }))).toMatchObject({ errorCode: 'CUPS_PREPARATION_FAILED' });
    expect(h.calls.filter(c => c.file === 'lp')).toHaveLength(0);
  });
});
