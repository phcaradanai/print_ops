import { describe, expect, it } from 'vitest';
import { buildHtmlPrintScript, resolveHtmlPageSettings } from './windows-spooler.adapter.js';

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
});
