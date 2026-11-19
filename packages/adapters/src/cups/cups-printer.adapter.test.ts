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
  it('prints one static test page using the selected queue defaults without a paper profile', async () => {
    const h = harness();
    const result = await h.adapter.printTestPage('cups://POSTEK_G2000', 'printer-1');
    const submissions = h.calls.filter((call) => call.file === 'lp');
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.args).toEqual(expect.arrayContaining(['-d', 'POSTEK_G2000', '-n', '1']));
    expect(submissions[0]!.args.some((arg) => /^(media|printer-resolution|print-color-mode)=/.test(arg))).toBe(false);
    expect(h.calls.some((call) => call.file === 'chromium')).toBe(false);
    expect(h.bytes().subarray(0, 5).toString()).toBe('%PDF-');
    expect(h.bytes().toString()).toContain('PrintOps Test');
    expect(result).toMatchObject({ jobId: 'POSTEK_G2000-42', raw: { spoolerAccepted: true } });
  });

  it('sends the static test PDF in one remote Print-Job without overriding queue media or resolution', async () => {
    let submissions = 0;
    const adapter = new CupsPrinterAdapter({ server: 'cups:631', run: async (file, args) => {
      if (file === 'lpstat') return 'printer POSTEK_G2000 is idle. enabled';
      if (file !== 'ipptool') throw new Error(`Unexpected command: ${file}`);
      submissions++;
      const pdf = await readFile(args[args.indexOf('-f') + 1]!);
      const request = await readFile(args.at(-1)!, 'utf8');
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(args).toContain('format=application/pdf');
      expect(request).toContain('OPERATION Print-Job');
      expect(request).toContain('ATTR integer copies 1');
      expect(request).not.toMatch(/ATTR (?:name media|resolution printer-resolution|keyword print-color-mode) /);
      return 'job-id (integer) = 43';
    } });
    const result = await adapter.printTestPage('cups://POSTEK_G2000', 'printer-1');
    expect(submissions).toBe(1);
    expect(result).toMatchObject({ jobId: 'POSTEK_G2000-43', raw: { spoolerAccepted: true } });
  });

  it('submits a TCP queue with one IPP Print-Job and captures the CUPS job ID', async () => {
    const calls: string[] = [];
    const adapter = new CupsPrinterAdapter({
      server: 'cups:631',
      run: async (file, args) => {
        calls.push(file);
        if (file === 'lpstat') return 'printer POSTEK_G2000 is idle. enabled';
        expect(file).toBe('ipptool');
        expect(args).toContain('ipp://cups:631/printers/POSTEK_G2000');
        expect(args).toContain('format=application/pdf');
        const request = await readFile(args.at(-1) ?? '', 'utf8');
        expect(request).toContain('OPERATION Print-Job');
        expect(request).toContain('ATTR integer copies 2');
        return '        job-id (integer) = 42\n';
      },
    });
    const result = await adapter.executeCommand(command({
      mimeType: 'application/pdf',
      documentBase64: Buffer.from('%PDF-1.4\ntest document').toString('base64'),
    }));
    expect(calls).toEqual(['lpstat', 'ipptool', 'lpstat']);
    expect(result).toMatchObject({
      jobId: 'POSTEK_G2000-42',
      errorCode: 'PRINT_NOT_VERIFIABLE',
      raw: { spoolerAccepted: true, physicalDeliveryConfirmed: false },
    });
  });

  it.each([
    { outcome: 'device reports successful completion', reasons: ['completed-successfully'], impressions: 2, confirmed: true },
    { outcome: 'device requires TLS for IPP job history', reasons: ['completed-successfully'], impressions: 2,
      confirmed: true, requiresTls: true },
    { outcome: 'device omits the impression count', reasons: ['completed-successfully'], impressions: undefined, confirmed: false },
    { outcome: 'device reports an incomplete copy count', reasons: ['completed-successfully'], impressions: 1, confirmed: false },
    { outcome: 'device reports completion with errors', reasons: ['job-completed-with-errors'], impressions: 2, confirmed: false },
  ])('uses physical evidence when $outcome', async ({ reasons, impressions, confirmed, requiresTls }) => {
    let title = '';
    let submissions = 0;
    const adapter = new CupsPrinterAdapter({
      server: 'cups:631',
      deviceVerifyTimeoutMs: 0,
      run: async (file, args) => {
        if (file === 'lpstat') {
          return args[0] === '-v'
            ? 'device for POSTEK_G2000: ipp://epson.local/ipp/print'
            : 'printer POSTEK_G2000 is idle. enabled';
        }
        submissions++;
        title = args.find((arg) => arg.startsWith('title='))?.slice('title='.length) ?? '';
        return '        job-id (integer) = 42\n';
      },
      queryPrinterJobs: async (endpoint) => {
        expect(endpoint.hostname).toBe('epson.local');
        expect(title).toMatch(/^PrintOps:job-1:[0-9a-f-]{36}$/);
        if (requiresTls && endpoint.transport === 'http:') {
          return { ok: false, endpoint, jobs: [], error: 'IPP endpoint returned HTTP 426' };
        }
        return { ok: true, endpoint, statusCode: 0, jobs: [
          { key: 'previous', id: 6, name: 'PrintOps:job-1', state: 9, stateReasons: ['completed-successfully'], impressionsCompleted: 10 },
          { key: 'current', id: 7, name: title, state: 9, stateReasons: reasons, impressionsCompleted: impressions },
        ] };
      },
    });
    const result = await adapter.executeCommand(command({ mimeType: 'text/plain', renderedPrintPayload: 'PrintOps test' }));
    expect(submissions).toBe(1);
    expect(result).toMatchObject({
      success: confirmed,
      jobId: 'POSTEK_G2000-42',
      raw: { spoolerAccepted: true, physicalDeliveryConfirmed: confirmed },
    });
    if (confirmed) expect(result.raw).toMatchObject({ ippJobId: 7, impressionsCompleted: 2 });
    else expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
  });

  it('waits through a temporary IPP error and incomplete history without resubmitting the job', async () => {
    let title = '';
    let submissions = 0;
    let checks = 0;
    const adapter = new CupsPrinterAdapter({
      server: 'cups:631',
      run: async (file, args) => {
        if (file === 'lpstat') {
          return args[0] === '-v'
            ? 'device for POSTEK_G2000: ipps://epson.local/ipp/print'
            : 'printer POSTEK_G2000 is idle. enabled';
        }
        submissions++;
        title = args.find((arg) => arg.startsWith('title='))?.slice('title='.length) ?? '';
        return '        job-id (integer) = 42\n';
      },
      queryPrinterJobs: async (endpoint) => {
        checks++;
        if (checks === 1) return { ok: false, endpoint, jobs: [], error: 'Printer temporarily unavailable' };
        return { ok: true, endpoint, statusCode: 0, jobs: [{
          key: 'current',
          id: 7,
          name: title,
          state: 9,
          stateReasons: ['completed-successfully'],
          impressionsCompleted: checks === 2 ? undefined : 2,
        }] };
      },
    });
    const result = await adapter.executeCommand(command({ mimeType: 'text/plain', renderedPrintPayload: 'PrintOps test' }));
    expect(checks).toBe(3);
    expect(submissions).toBe(1);
    expect(result).toMatchObject({
      success: true,
      jobId: 'POSTEK_G2000-42',
      raw: { physicalDeliveryConfirmed: true, ippJobId: 7, impressionsCompleted: 2 },
    });
  }, 10_000);

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

  it('preserves the Windows profile origin without reducing the PDF page area', async () => {
    const h = harness();
    await h.adapter.executeCommand(command({ metadata: { paperProfile: {
      widthMm: 60, heightMm: 30, marginLeftMm: 4, marginTopMm: 3, marginRightMm: 2, marginBottomMm: 1,
    } } }));
    expect(h.html()).toContain('left:4mm;top:3mm');
    expect(h.html()).toContain('margin:0');
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

  it('confirms a device job that appears only on a later poll and is listed twice, without job-impressions', async () => {
    let title = '';
    let submissions = 0;
    let checks = 0;
    const adapter = new CupsPrinterAdapter({
      server: 'cups:631',
      deviceVerifyTimeoutMs: 6_000,
      run: async (file, args) => {
        if (file === 'lpstat') {
          return args[0] === '-v'
            ? 'device for POSTEK_G2000: ipp://epson.local/ipp/print'
            : 'printer POSTEK_G2000 is idle. enabled';
        }
        submissions++;
        title = args.find((arg) => arg.startsWith('title='))?.slice('title='.length) ?? '';
        return '        job-id (integer) = 42\n';
      },
      queryPrinterJobs: async (endpoint) => {
        checks++;
        // The device has not recorded the attempt yet on the first read.
        if (checks === 1) return { ok: true, endpoint, statusCode: 0, jobs: [] };
        // It then reports the attempt as active and as completed: the active set
        // and the completed set are separate reads, and only the completed record
        // carries output. job-impressions is absent; job-impressions-completed is not.
        return { ok: true, endpoint, statusCode: 0, jobs: [
          { key: 'job-id:7', id: 7, name: title, state: 5, stateReasons: ['job-printing'], impressionsCompleted: 0 },
          { key: 'ipp://epson.local/jobs/7', id: 7, uri: 'ipp://epson.local/jobs/7',
            name: title, state: 9, stateReasons: ['completed-successfully'], impressionsCompleted: 2 },
        ] };
      },
    });
    const result = await adapter.executeCommand(command({ mimeType: 'text/plain', copies: 2, renderedPrintPayload: 'PrintOps test' }));
    expect(checks).toBe(2);
    expect(submissions).toBe(1);
    expect(result).toMatchObject({
      success: true,
      jobId: 'POSTEK_G2000-42',
      raw: { physicalDeliveryConfirmed: true, ippJobId: 7, impressionsCompleted: 2 },
    });
  }, 15_000);

  it('explains why a raw socket queue cannot confirm delivery without reporting print success', async () => {
    let submissions = 0;
    const adapter = new CupsPrinterAdapter({
      run: async (file, args) => {
        if (file === 'lpstat') {
          return args[0] === '-v'
            ? 'device for POSTEK_G2000: socket://192.0.2.164:9100'
            : 'printer POSTEK_G2000 is idle. enabled';
        }
        if (file !== 'lp') throw new Error(`Unexpected command: ${file}`);
        submissions++;
        return 'request id is POSTEK_G2000-42 (1 file(s))';
      },
      queryPrinterJobs: async () => { throw new Error('A socket URI is not an IPP endpoint'); },
    });
    const result = await adapter.executeCommand(command({ mimeType: 'text/plain', copies: 1 }));
    expect(submissions).toBe(1);
    expect(result).toMatchObject({
      success: false,
      jobId: 'POSTEK_G2000-42',
      errorCode: 'PRINT_NOT_VERIFIABLE',
      raw: { spoolerAccepted: true, physicalDeliveryConfirmed: false, retried: false },
    });
    // This is the result message consumed by the job UI, not just hidden raw evidence.
    expect(result.message).toContain('socket://');
    expect(result.message).toContain('per-job');
    expect(result.message).toContain('do not auto-reprint');
    expect(result.message).not.toContain('192.0.2.164');
  });

  describe('escposack:// queues (ESC/POS process-ID acknowledgement)', () => {
    function ackAdapter(jobs: (poll: number) => Array<{ id: number; state: number; stateReasons: string[] }>, server?: string) {
      let submissions = 0;
      let polls = 0;
      const endpoints: string[] = [];
      const adapter = new CupsPrinterAdapter({
        server,
        deviceVerifyTimeoutMs: 2_500,
        run: async (file, args) => {
          if (file === 'lpstat') {
            return args[0] === '-v'
              ? 'device for epsonTM-L100: escposack://192.0.2.164:9100'
              : 'printer epsonTM-L100 is idle. enabled';
          }
          submissions++;
          return file === 'ipptool' ? '        job-id (integer) = 17\n' : 'request id is epsonTM-L100-17 (1 file(s))';
        },
        queryPrinterJobs: async (endpoint) => {
          endpoints.push(endpoint.uri);
          return { ok: true, endpoint, statusCode: 0,
            jobs: jobs(polls++).map((job) => ({ key: String(job.id), ...job })) };
        },
      });
      return { adapter, submissions: () => submissions, polls: () => polls, endpoints };
    }
    const tmCommand = () => command({ connectionUri: 'cups://epsonTM-L100', mimeType: 'text/plain', copies: 1 });

    it('confirms delivery from this exact CUPS job once the printer acknowledged it', async () => {
      const h = ackAdapter((poll) => [
        { id: 16, state: 9, stateReasons: ['job-completed-successfully'] },
        { id: 17, state: poll === 0 ? 5 : 9, stateReasons: poll === 0 ? ['job-printing'] : ['job-completed-successfully'] },
      ], 'cups:631');
      const result = await h.adapter.executeCommand(tmCommand());
      expect(h.submissions()).toBe(1);
      expect(h.polls()).toBe(2);
      expect(h.endpoints[0]).toBe('ipp://cups:631/printers/epsonTM-L100');
      expect(result).toMatchObject({
        success: true,
        jobId: 'epsonTM-L100-17',
        raw: { spoolerAccepted: true, physicalDeliveryConfirmed: true, deviceConfirmed: true, deviceConfirmation: 'escpos-process-id' },
      });
      expect(result.message).toContain('acknowledged');
    }, 10_000);

    it('does not borrow another job\'s completion and stays unverified when the window expires', async () => {
      const h = ackAdapter(() => [
        { id: 16, state: 9, stateReasons: ['job-completed-successfully'] },
        { id: 17, state: 5, stateReasons: ['job-printing'] },
      ]);
      const result = await h.adapter.executeCommand(tmCommand());
      expect(h.submissions()).toBe(1);
      expect(h.endpoints[0]).toBe('ipp://localhost:631/printers/epsonTM-L100');
      expect(result).toMatchObject({ success: false, errorCode: 'PRINT_NOT_VERIFIABLE',
        raw: { physicalDeliveryConfirmed: false, retried: false } });
    }, 10_000);

    it('reports a backend cancellation (no printer acknowledgement) as unverified without retrying', async () => {
      const h = ackAdapter(() => [{ id: 17, state: 7, stateReasons: ['job-canceled-at-device'] }]);
      const result = await h.adapter.executeCommand(tmCommand());
      expect(h.submissions()).toBe(1);
      expect(h.polls()).toBe(1);
      expect(result).toMatchObject({ success: false, errorCode: 'PRINT_NOT_VERIFIABLE' });
      expect(result.message).toContain('did not acknowledge CUPS job 17');
      expect(result.message).toContain('do not auto-reprint');
    });
  });

  it('confirms a completed job that publishes media sheets but no impression counter', async () => {
    let title = '';
    const adapter = new CupsPrinterAdapter({
      server: 'cups:631',
      deviceVerifyTimeoutMs: 0,
      run: async (file, args) => {
        if (file === 'lpstat') {
          return args[0] === '-v'
            ? 'device for POSTEK_G2000: ipp://queue.local/ipp/print'
            : 'printer POSTEK_G2000 is idle. enabled';
        }
        title = args.find((arg) => arg.startsWith('title='))?.slice('title='.length) ?? '';
        return '        job-id (integer) = 42\n';
      },
      queryPrinterJobs: async (endpoint) => ({ ok: true, endpoint, statusCode: 0, jobs: [{
        key: 'current', id: 9, name: title, state: 9, stateReasons: ['completed-successfully'],
        mediaSheetsCompleted: 1,
      }] }),
    });
    const result = await adapter.executeCommand(command({ mimeType: 'text/plain', copies: 1, renderedPrintPayload: 'PrintOps test' }));
    expect(result).toMatchObject({
      success: true,
      raw: { physicalDeliveryConfirmed: true, ippJobId: 9, impressionsCompleted: 1 },
    });
  });

  it('keeps polling when a completed job reports its output counters before they settle', async () => {
    let title = '';
    let checks = 0;
    const adapter = new CupsPrinterAdapter({
      server: 'cups:631',
      deviceVerifyTimeoutMs: 6_000,
      run: async (file, args) => {
        if (file === 'lpstat') {
          return args[0] === '-v'
            ? 'device for POSTEK_G2000: ipp://epson.local/ipp/print'
            : 'printer POSTEK_G2000 is idle. enabled';
        }
        title = args.find((arg) => arg.startsWith('title='))?.slice('title='.length) ?? '';
        return '        job-id (integer) = 42\n';
      },
      queryPrinterJobs: async (endpoint) => {
        checks++;
        // The Epson publishes job-impressions-completed = 0 for a job that has
        // already ended cleanly while it is finalizing its counters.
        return { ok: true, endpoint, statusCode: 0, jobs: [{
          key: 'current', id: 7, name: title, state: 9, stateReasons: ['completed-successfully'],
          impressionsCompleted: checks < 3 ? 0 : 1,
        }] };
      },
    });
    const result = await adapter.executeCommand(command({ mimeType: 'text/plain', copies: 1, renderedPrintPayload: 'PrintOps test' }));
    expect(checks).toBe(3);
    expect(result).toMatchObject({ success: true, raw: { physicalDeliveryConfirmed: true, ippJobId: 7 } });
  }, 15_000);

  it.each([
    { outcome: 'the device reports completion without any output counter',
      jobs: [{ id: 7, state: 9, stateReasons: ['completed-successfully'] }] },
    { outcome: 'the device reports fewer sheets than requested copies',
      jobs: [{ id: 7, state: 9, stateReasons: ['completed-successfully'], mediaSheetsCompleted: 1 }] },
    { outcome: 'the device reports the job as canceled',
      jobs: [{ id: 7, state: 7, stateReasons: ['job-canceled-by-user'], impressionsCompleted: 0 }] },
    { outcome: 'the device lists two distinct jobs under the same attempt name',
      jobs: [
        { id: 7, state: 9, stateReasons: ['completed-successfully'], impressionsCompleted: 1 },
        { id: 8, state: 9, stateReasons: ['completed-successfully'], impressionsCompleted: 1 },
      ] },
  ])('keeps an ambiguous device answer unverified when $outcome', async ({ jobs }) => {
    let title = '';
    let submissions = 0;
    const adapter = new CupsPrinterAdapter({
      server: 'cups:631',
      deviceVerifyTimeoutMs: 0,
      run: async (file, args) => {
        if (file === 'lpstat') {
          return args[0] === '-v'
            ? 'device for POSTEK_G2000: ipp://epson.local/ipp/print'
            : 'printer POSTEK_G2000 is idle. enabled';
        }
        submissions++;
        title = args.find((arg) => arg.startsWith('title='))?.slice('title='.length) ?? '';
        return '        job-id (integer) = 42\n';
      },
      queryPrinterJobs: async (endpoint) => ({
        ok: true, endpoint, statusCode: 0,
        jobs: jobs.map((job) => ({ ...job, key: `id:${job.id}`, name: title })),
      }),
    });
    const result = await adapter.executeCommand(command({ mimeType: 'text/plain', copies: 2, renderedPrintPayload: 'PrintOps test' }));
    expect(submissions).toBe(1);
    expect(result).toMatchObject({
      success: false,
      jobId: 'POSTEK_G2000-42',
      errorCode: 'PRINT_NOT_VERIFIABLE',
      raw: { physicalDeliveryConfirmed: false },
    });
  });
});
