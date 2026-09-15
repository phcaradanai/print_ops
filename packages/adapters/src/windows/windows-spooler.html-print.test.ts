import { describe, expect, it } from 'vitest';
import type { PrintCommand } from '@printerops/domain';
import { applyHtmlRenderTransform, buildHtmlPrintScript, resolveHtmlPageSettings } from './windows-spooler.adapter.js';

describe('buildHtmlPrintScript', () => {
  it('uses WebView2 PrintAsync helper and observes a correlated Windows job when available', () => {
    const script = buildHtmlPrintScript(
      'C:\\PrintOps\\printops-html-print.exe',
      'C:\\Temp\\request.json',
      'C:\\Temp\\result.json',
      'EPSON49F1BC (L6580 Series)',
      'PrintOps:job-123',
    );

    expect(script).toContain('printops-html-print.exe');
    expect(script).toContain("'--request'");
    expect(script).toContain('Get-PrintJob');
    expect(script).toContain('jobObserved=($seen.Count -gt 0)');
    expect(script).not.toContain('throw "PRINT_JOB_NOT_OBSERVED');
    expect(script).toContain('WEBVIEW2_PRINT_FAILED');
    expect(script).toContain("'EPSON49F1BC (L6580 Series)'");
    expect(script).toContain("$documentName -eq 'PrintOps:job-123'");
    expect(script).toContain("expectedDocumentName='PrintOps:job-123'");
    expect(script).toContain('Start-Process');
    expect(script).not.toContain('SetDefaultPrinter');
    expect(script).not.toContain('printto');
    expect(script).not.toContain('PrintHTML');
    expect(script).not.toContain('ShowPrintDialog');
  });

  it('escapes PowerShell single quotes in a printer name', () => {
    expect(buildHtmlPrintScript(
      'C:\\PrintOps\\printops-html-print.exe',
      'C:\\Temp\\request.json',
      'C:\\Temp\\result.json',
      "Doctor's printer",
      "PrintOps:doctor's-job",
    ))
      .toContain("$documentName -eq 'PrintOps:doctor''s-job'");
  });
});

describe('resolveHtmlPageSettings', () => {
  it('rotates dimensions and directional margins exactly like the profile editor', () => {
    expect(resolveHtmlPageSettings('<main />', {
      paperProfile: {
        widthMm: 100,
        heightMm: 50,
        marginTopMm: 1,
        marginRightMm: 2,
        marginBottomMm: 3,
        marginLeftMm: 4,
        orientation: 'portrait',
      },
    })).toEqual({
      widthMm: 50,
      heightMm: 100,
      marginTopMm: 4,
      marginRightMm: 1,
      marginBottomMm: 2,
      marginLeftMm: 3,
      orientation: 'portrait',
    });
  });

  it('keeps naturally oriented profile geometry unchanged', () => {
    expect(resolveHtmlPageSettings('<main />', {
      paperProfile: {
        widthMm: 91.95,
        heightMm: 122.6,
        marginTopMm: 2,
        marginRightMm: 3,
        marginBottomMm: 4,
        marginLeftMm: 5,
        orientation: 'portrait',
      },
    })).toMatchObject({
      widthMm: 91.95,
      heightMm: 122.6,
      marginTopMm: 2,
      marginRightMm: 3,
      marginBottomMm: 4,
      marginLeftMm: 5,
      orientation: 'portrait',
    });
  });

  it('keeps the driver page at the label face height so a gap sensor is not counted twice', () => {
    expect(resolveHtmlPageSettings('<main />', {
      paperProfile: {
        widthMm: 98,
        heightMm: 11,
        gapMm: 2,
        marginTopMm: 0.05,
        marginRightMm: 2,
        marginBottomMm: 0.05,
        marginLeftMm: 2,
        orientation: 'landscape',
      },
    })).toMatchObject({
      widthMm: 98,
      heightMm: 11,
      orientation: 'landscape',
    });
  });

  it('uses the effective per-job transform when resolving the driver frame', () => {
    expect(resolveHtmlPageSettings('<main />', {
      paperProfile: {
        widthMm: 100,
        heightMm: 50,
        orientation: 'landscape',
        rotation: 15,
      },
    }, { rotate: 270 })).toMatchObject({
      widthMm: 50,
      heightMm: 100,
      orientation: 'portrait',
    });
  });

  it('reads the transformed frame size when the renderer already wrapped HTML', () => {
    const html = '<div data-printops-transform-frame="true" style="position:relative;width:50mm;height:100mm;overflow:hidden"><div /></div>';
    expect(resolveHtmlPageSettings(html, {
      paperProfile: {
        widthMm: 100,
        heightMm: 50,
        orientation: 'landscape',
      },
    })).toMatchObject({
      widthMm: 50,
      heightMm: 100,
      orientation: 'portrait',
    });
  });
});

describe('applyHtmlRenderTransform', () => {
  const page = {
    widthMm: 100,
    heightMm: 50,
    marginTopMm: 2,
    marginRightMm: 3,
    marginBottomMm: 4,
    marginLeftMm: 5,
    orientation: 'landscape' as const,
  };
  const command = (overrides: Partial<PrintCommand> = {}): PrintCommand => ({
    jobId: 'job-transform',
    printerId: 'printer-transform',
    traceId: 'trace-transform',
    mimeType: 'text/html',
    copies: 1,
    duplex: false,
    colorMode: 'auto',
    metadata: {},
    ...overrides,
  });

  it('applies profile transforms while preserving the physical page frame', () => {
    const output = applyHtmlRenderTransform(
      '<span>complete output</span>',
      page,
      command({
        metadata: {
          paperProfile: { rotation: 90, flipHorizontal: true, flipVertical: false },
        },
      }),
    );

    expect(output).toContain('transform:rotate(90deg) scaleX(-1) scaleY(1)');
    expect(output).toContain('width:50mm;height:100mm;overflow:hidden');
  });

  it('lets per-job values override profile values without changing the page frame', () => {
    const output = applyHtmlRenderTransform(
      '<span>complete output</span>',
      page,
      command({
        rotate: 270,
        flipHorizontal: false,
        flipVertical: true,
        metadata: {
          paperProfile: { rotation: 15, flipHorizontal: true, flipVertical: true },
        },
      }),
    );

    expect(output).toContain('transform:rotate(270deg) scaleX(1) scaleY(-1)');
    expect(output).not.toContain('rotate(15deg)');
    expect(output).toContain('width:50mm;height:100mm;overflow:hidden');
  });

  it('does not wrap output that the shared renderer already transformed', () => {
    const output = applyHtmlRenderTransform(
      '<div data-printops-transform-frame="true">already transformed</div>',
      page,
      command({ rotate: 90 }),
    );

    expect(output).toBe('<div data-printops-transform-frame="true">already transformed</div>');
  });

  it('uses direct HTML metadata dimensions as the source before a job rotation', () => {
    const output = applyHtmlRenderTransform(
      '<span>direct html</span>',
      { widthMm: 100, heightMm: 50, marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0, orientation: 'landscape' },
      command({ rotate: 90, metadata: { widthMm: 100, heightMm: 50 } }),
    );

    expect(output).toContain('width:50mm;height:100mm;overflow:hidden');
    expect(output).toContain('left:-25mm;top:25mm;width:100mm;height:50mm');
  });
});
