import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
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
    expect(html).toContain('>1</td>');
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
});
