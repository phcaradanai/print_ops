import { describe, expect, it } from 'vitest';
import type { PrintCommand } from '@printerops/domain';
import { applyDplCalibration, applyHtmlCalibration, isDatamaxI4208, resolveHtmlPageSettings, textPayloadToHtml } from './windows-spooler.adapter.js';

describe('Datamax-O\'Neil I-4208 label routing', () => {
  it('recognises the hardware from model metadata and the Windows queue name', () => {
    expect(isDatamaxI4208({ model: "Datamax-O'Neil I-4208", dpi: 203 })).toBe(true);
    expect(isDatamaxI4208({}, "Datamax-O'Neil I-4208")).toBe(true);
    expect(isDatamaxI4208({ model: 'EPSON L15160' }, 'EPSON L15160')).toBe(false);
  });

  it('escapes RAW_TEXT before sending it through the profile-sized HTML path', () => {
    const html = textPayloadToHtml('HN <123>\n"AB\'');

    expect(html).toContain('HN &lt;123&gt;');
    expect(html).toContain('&quot;AB&#39;');
    expect(html).toContain('white-space:pre-wrap');
    expect(html).toContain('overflow:hidden');
  });

  it('translates signed calibration dots into a physical HTML origin shift', () => {
    const html = applyHtmlCalibration(
      '<div data-printops-label="true">label</div>',
      {
        widthMm: 98,
        heightMm: 11,
        marginTopMm: 0,
        marginRightMm: 0,
        marginBottomMm: 0,
        marginLeftMm: 0,
        orientation: 'landscape',
      },
      {
        jobId: 'job-1',
        printerId: 'printer-1',
        traceId: 'trace-1',
        mimeType: 'text/html',
        copies: 1,
        duplex: false,
        colorMode: 'monochrome',
        metadata: {
          paperProfile: { paperProfileId: 'paper-1', dpi: 203 },
          printerCalibration: {
            printerId: 'printer-1',
            paperProfileId: 'paper-1',
            dpi: 203,
            xOffsetDots: 8,
            yOffsetDots: -4,
          },
        },
      },
    );

    expect(html).toContain('data-printops-calibration-frame');
    expect(html).toContain('left:1.000985mm');
    expect(html).toContain('top:-0.500493mm');
    expect(html).toContain('label');
  });

  it('rejects calibration that does not match the command tuple', () => {
    expect(() => applyHtmlCalibration(
      '<div>label</div>',
      { widthMm: 98, heightMm: 11, marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0, orientation: 'landscape' },
      {
        jobId: 'job-1',
        printerId: 'printer-1',
        traceId: 'trace-1',
        mimeType: 'text/html',
        copies: 1,
        duplex: false,
        colorMode: 'monochrome',
        metadata: {
          paperProfile: { paperProfileId: 'paper-1', dpi: 203 },
          printerCalibration: { printerId: 'other-printer', paperProfileId: 'paper-1', dpi: 203, xOffsetDots: 1, yOffsetDots: 1 },
        },
      },
    )).toThrow(/INVALID_PRINTER_CALIBRATION/);
  });

  it('honours an explicit physical row height for a repeated-label grid', () => {
    const page = resolveHtmlPageSettings(
      '<div style="width:98mm;height:11mm"></div>',
      { widthMm: 98, pageHeightMm: 22, paperProfile: { heightMm: 11 } },
    );
    expect(page.widthMm).toBe(98);
    expect(page.heightMm).toBe(22);
  });
});

const dpl = '\x02L\rm\rD11\r1E2306006000023C000001\rQ0001\rE\r';

function command(calibration: Record<string, unknown>): PrintCommand {
  return {
    jobId: 'job-dpl',
    traceId: 'trace-dpl',
    printerId: 'printer-a',
    connectionUri: 'spooler://runner/Datamax-O%27Neil%20I-4208',
    mimeType: 'application/dpl',
    renderedPrintPayload: dpl,
    copies: 1,
    duplex: false,
    colorMode: 'auto',
    metadata: {
      dpi: 203,
      paperProfile: { paperProfileId: 'profile-a', widthMm: 30, heightMm: 11, dpi: 203 },
      printerCalibration: calibration,
    },
  };
}

describe('Datamax native DPL calibration', () => {
  it('converts stored printer dot offsets to metric DPL units without changing template geometry', () => {
    const calibrated = applyDplCalibration(Buffer.from(dpl, 'latin1'), command({
      printerId: 'printer-a',
      paperProfileId: 'profile-a',
      dpi: 203,
      xOffsetDots: 2,
      yOffsetDots: 1,
    })).toString('latin1');
    const record = calibrated.split('\r').find((line) => line.startsWith('1E'));
    expect(record).toBe('1E2306006010026C000001');
    expect(calibrated).toContain('\x02L\rm\rD11\r');
  });

  it('rejects a calibration from another printer/profile tuple', () => {
    expect(() => applyDplCalibration(Buffer.from(dpl, 'latin1'), command({
      printerId: 'printer-b',
      paperProfileId: 'profile-a',
      dpi: 203,
      xOffsetDots: 1,
      yOffsetDots: 0,
    }))).toThrow(/does not match the printer, paper profile, or DPI/);
  });
});
