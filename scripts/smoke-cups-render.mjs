// Run inside the built Linux image, passed to node via stdin by the publish job.
// The real Chromium renderer runs; only the physical spooler boundary is replaced.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { CupsPrinterAdapter } from '@printerops/adapters';
const exec = promisify(execFile);
let submitted = 0;
let expectedLeftMm = 0;
let expectedPages = 1;
const adapter = new CupsPrinterAdapter({ run: async (file, args) => {
  if (file === 'lpstat') return 'printer virtual is idle. enabled';
  if (file === 'lp') {
    submitted++;
    const pdf = args.at(-1);
    assert.equal((await readFile(pdf)).subarray(0, 5).toString(), '%PDF-');
    const { stdout } = await exec('pdfinfo', [pdf]);
    assert.equal(Number(stdout.match(/Pages:\s+(\d+)/)?.[1]), expectedPages, stdout);
    const size = stdout.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/);
    assert.ok(size, stdout);
    assert.ok(Math.abs(Number(size[1]) - 60 * 72 / 25.4) < 0.1, stdout);
    assert.ok(Math.abs(Number(size[2]) - 30 * 72 / 25.4) < 0.1, stdout);
    const { stdout: text } = await exec('pdftotext', [pdf, '-']);
    assert.match(text, /PrintOps/);
    assert.match(text, /ภาษาไทย/);
    const { stdout: bbox } = await exec('pdftotext', ['-bbox', pdf, '-']);
    const left = bbox.match(/<word xMin="([\d.]+)"[^>]*>PrintOps<\/word>/);
    assert.ok(left, bbox);
    assert.ok(Math.abs(Number(left[1]) - expectedLeftMm * 72 / 25.4) < 1, bbox);
    return 'request id is virtual-42 (1 file(s))';
  }
  return (await exec(file, args, { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 })).stdout;
} });
const command = {
  jobId: 'linux-render-smoke', printerId: 'virtual', traceId: 'smoke',
  connectionUri: 'cups://virtual', mimeType: 'text/html', copies: 1,
  colorMode: 'monochrome', duplex: false,
  renderedPrintPayload: '<html><body><div style="font:12px sans-serif">PrintOps ภาษาไทย</div></body></html>',
  metadata: { paperProfile: { widthMm: 60, heightMm: 30, gapMm: 2 } },
};
const result = await adapter.executeCommand(command);
assert.equal(result.errorCode, 'PRINT_NOT_VERIFIABLE', JSON.stringify(result));
assert.equal(result.jobId, 'virtual-42', JSON.stringify(result));
const withMargins = { ...command, metadata: { paperProfile: {
  widthMm: 60, heightMm: 30, gapMm: 2,
  marginLeftMm: 4, marginTopMm: 3, marginRightMm: 2, marginBottomMm: 1,
} } };
expectedLeftMm = 4;
assert.equal((await adapter.executeCommand(withMargins)).errorCode, 'PRINT_NOT_VERIFIABLE');
// Companion-generated templates already carry field coordinates. Preserve them
// and the driver origin together, matching the existing Windows print path.
expectedLeftMm = 8;
assert.equal((await adapter.executeCommand({ ...withMargins,
  renderedPrintPayload: '<div style="position:relative;width:60mm;height:30mm"><span style="position:absolute;left:4mm;top:3mm;font:12px sans-serif">PrintOps ภาษาไทย</span></div>',
})).errorCode, 'PRINT_NOT_VERIFIABLE');
expectedPages = 2;
assert.equal((await adapter.executeCommand({ ...withMargins,
  renderedPrintPayload: Array(2).fill('<div style="position:relative;width:60mm;height:30mm;break-after:page"><span style="position:absolute;left:4mm;top:3mm;font:12px sans-serif">PrintOps ภาษาไทย</span></div>').join(''),
})).errorCode, 'PRINT_NOT_VERIFIABLE');
assert.equal(submitted, 4);
console.log('PASS actual Linux Chromium: Thai text, 60×30 mm pages, manual/generated profile margins, no extra pages for one/two labels, one submission per job, UNVERIFIED');
