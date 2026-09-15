import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildSandboxRecipe,
  JobConfigurationPanel,
  PrinterEvidence,
  type PrintEvidence,
  verdictCopyKeys,
} from '../pages/JobDetail.js';
import { t } from '../i18n/translations.js';
import { getJobVerdict } from '../lib/jobVerdict.js';

const translate = (key: string) => t('en', key);

describe('JobDetail printer-side evidence', () => {
  it('only calls SUCCESS printer-confirmed when persisted device evidence supports it', () => {
    const success = getJobVerdict('SUCCESS');

    expect(verdictCopyKeys(success, { deviceConfirmed: true }).detail)
      .toBe('page.jobDetail.verdict.printed.detail');
    expect(verdictCopyKeys(success, { ippJobConfirmed: true }).detail)
      .toBe('page.jobDetail.verdict.printed.detail');
    expect(verdictCopyKeys(success).detail)
      .toBe('page.jobDetail.verdict.reportedComplete.detail');
  });

  it('renders persisted IPP attribution and completion evidence', () => {
    const evidence: PrintEvidence = {
      spoolerJobIds: ['7'],
      spoolerStatus: 'Complete, Retained',
      pagesBefore: 110306,
      pagesAfter: 110307,
      deviceConfirmed: true,
      deviceConfirmation: 'ipp-job',
      ippEndpoint: 'ipp://printer.local:631/ipp/print',
      ippExpectedJobName: 'PrintOps_live-verified-123',
      ippJobOutcome: 'confirmed',
      ippJobStatus: 'printer confirmed 1 exact IPP job impression completed successfully',
      ippJobConfirmed: true,
      ippObservedJobs: [
        {
          key: 'job-731',
          id: 731,
          uri: 'ipp://printer.local:631/ipp/print/jobs/731',
          state: 9,
          stateName: 'completed',
          stateReasons: ['job-completed-successfully', 'none'],
          impressionsCompleted: 1,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <PrinterEvidence evidence={evidence} t={translate} />,
    );

    expect(html).toContain('Printer-side Evidence');
    expect(html).toContain('ipp://printer.local:631/ipp/print');
    expect(html).toContain('PrintOps_live-verified-123');
    expect(html).toContain('confirmed');
    expect(html).toContain('printer confirmed 1 exact IPP job impression completed successfully');
    expect(html).toContain('IPP job (ipp-job)');
    expect(html).toContain('#731');
    expect(html).toContain('ipp://printer.local:631/ipp/print/jobs/731');
    expect(html).toContain('completed');
    expect(html).toContain('job-completed-successfully, none');
    // The impression count is the evidence that a page actually came out, so
    // assert it against its own column rather than against the markup that
    // happens to wrap it — the shared table cell carries the column name.
    const impressionsCell = html.match(
      /<td[^>]*data-label="Impressions Completed"[^>]*>(.*?)<\/td>/,
    )?.[1];
    expect(impressionsCell).toBeDefined();
    expect(impressionsCell).toContain('1');
  });

  it('shows a clear empty state when no exact IPP job was observed', () => {
    const html = renderToStaticMarkup(
      <PrinterEvidence
        evidence={{
          ippJobOutcome: 'unverifiable',
          ippJobStatus: 'no new exact-name job was observed',
          ippObservedJobs: [],
        }}
        t={translate}
      />,
    );

    expect(html).toContain('unverifiable');
    expect(html).toContain('no new exact-name job was observed');
    expect(html).toContain('No matching printer-side IPP job was observed.');
  });

  it('builds a reproducible Sandbox recipe from persisted job snapshots', () => {
    const recipe = buildSandboxRecipe({
      id: 'job-1',
      status: 'SUCCESS',
      printerId: 'printer-1',
      printerCode: 'DATAMAX_I4208',
      templateCode: 'LABEL_BARCODE',
      paperProfileId: 'paper-1',
      copies: 1,
      metadata: {
        sandbox: true,
        templateSnapshot: {
          templateId: 'template-1',
          templateCode: 'LABEL_BARCODE',
        },
        paperProfile: {
          paperProfileId: 'paper-1',
          code: 'LABEL_98X11_3UP',
        },
        sandboxInput: {
          schemaVersion: 1,
          mode: 'single',
          templateId: 'template-1',
          templateCode: 'LABEL_BARCODE',
          paperProfileId: 'paper-1',
          printerCode: 'DATAMAX_I4208',
          samplePayload: { barcode: '12345678' },
        },
      },
    } as Parameters<typeof buildSandboxRecipe>[0]);

    expect(recipe).toMatchObject({
      schemaVersion: 1,
      sourceJobId: 'job-1',
      mode: 'single',
      templateId: 'template-1',
      templateCode: 'LABEL_BARCODE',
      paperProfileId: 'paper-1',
      printerCode: 'DATAMAX_I4208',
      samplePayload: { barcode: '12345678' },
    });
  });
  it('renders the persisted template, profile, geometry, and sandbox input', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <JobConfigurationPanel
        job={{
          id: 'job-1',
          status: 'SUCCESS',
          printerId: 'printer-1',
          printerCode: 'DATAMAX_I4208',
          templateCode: 'LABEL_BARCODE',
          paperProfileId: 'paper-1',
          copies: 1,
          metadata: {
            sandbox: true,
            templateSnapshot: {
              templateId: 'template-1',
              templateCode: 'LABEL_BARCODE',
              name: 'Datamax label',
              engine: 'HTML',
              status: 'PUBLISHED',
            },
            paperProfile: {
              paperProfileId: 'paper-1',
              code: 'LABEL_98X11_3UP',
              name: '98x11 3-up',
              widthMm: 98,
              heightMm: 11,
              orientation: 'landscape',
              dpi: 203,
              geometry: {
                widthMm: 98,
                heightMm: 11,
                dpi: 203,
                widthDots: 783,
                heightDots: 88,
                printableWidthMm: 94,
                printableHeightMm: 11,
                layout: { columns: 3, cellWidthMm: 30, cellHeightMm: 11, columnGapMm: 2, rowPitchMm: 13 },
                cells: [{ column: 0, row: 0, xDots: 0, yDots: 0 }],
              },
            },
            sandboxInput: {
              mode: 'single',
              templateCode: 'LABEL_BARCODE',
              paperProfileId: 'paper-1',
              printerCode: 'DATAMAX_I4208',
              samplePayload: { barcode: '12345678' },
            },
          },
        }}
        t={translate}
        copied={false}
        onCopy={() => {}}
        />
      </MemoryRouter>,
    );

    expect(html).toContain('Print configuration');
    expect(html).toContain('LABEL_BARCODE');
    expect(html).toContain('LABEL_98X11_3UP');
    expect(html).toContain('98 × 11 mm');
    expect(html).toContain('783 × 88 dots');
    expect(html).toContain('12345678');
    expect(html).toContain('Open in Sandbox');
  });
});
