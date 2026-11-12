// Run inside the built Linux image, passed to node via stdin by the publish job.
// The real Chromium renderer runs; only the physical spooler boundary is replaced.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { CupsPrinterAdapter } from '@printerops/adapters';
const exec = promisify(execFile);
let submitted = 0;
const adapter = new CupsPrinterAdapter({ run: async (file, args) => {
  if (file === 'lpstat') return 'printer virtual is idle. enabled';
  if (file === 'lp') {
    submitted++;
    const pdf = args.at(-1);
    assert.equal((await readFile(pdf)).subarray(0, 5).toString(), '%PDF-');
    const { stdout } = await exec('pdfinfo', [pdf]);
    assert.match(stdout, /Pages:\s+1\b/);
    const size = stdout.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/);
    assert.ok(size, stdout);
    assert.ok(Math.abs(Number(size[1]) - 60 * 72 / 25.4) < 0.1, stdout);
    assert.ok(Math.abs(Number(size[2]) - 30 * 72 / 25.4) < 0.1, stdout);
    const { stdout: text } = await exec('pdftotext', [pdf, '-']);
    assert.match(text, /PrintOps/);
    assert.match(text, /ภาษาไทย/);
    return 'request id is virtual-42 (1 file(s))';
  }
  return (await exec(file, args, { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 })).stdout;
} });
const result = await adapter.executeCommand({
  jobId: 'linux-render-smoke', printerId: 'virtual', traceId: 'smoke',
  connectionUri: 'cups://virtual', mimeType: 'text/html', copies: 1,
  colorMode: 'monochrome', duplex: false,
  renderedPrintPayload: '<html><body><div style="font:12px sans-serif">PrintOps ภาษาไทย</div></body></html>',
  metadata: { paperProfile: { widthMm: 60, heightMm: 30, gapMm: 2 } },
});
assert.equal(result.errorCode, 'PRINT_NOT_VERIFIABLE', JSON.stringify(result));
assert.equal(result.jobId, 'virtual-42', JSON.stringify(result));
assert.equal(submitted, 1);
console.log('PASS actual Linux Chromium → one 60×30 mm PDF with Thai text → one spooler submission → UNVERIFIED');
