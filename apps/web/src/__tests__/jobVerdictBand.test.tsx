import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '@printerops/domain';
import { JobVerdictBand } from '../components/JobVerdict.js';
import { getJobVerdict, offersReprint } from '../lib/jobVerdict.js';
import { translations } from '../i18n/translations.js';

const en = (key: string) => translations.en[key] ?? key;
const th = (key: string) => translations.th[key] ?? key;

function renderBand(status: string, locale: (key: string) => string = en) {
  const verdict = getJobVerdict(status);
  return renderToStaticMarkup(
    <JobVerdictBand
      verdict={verdict}
      headline={locale(`page.jobDetail.verdict.${verdict.copyKey}.headline`)}
      detail={locale(`page.jobDetail.verdict.${verdict.copyKey}.detail`)}
      badge={<span className="status-badge">{status}</span>}
    />,
  );
}

describe('JobVerdictBand', () => {
  it('leads with the plain-language verdict, not the enum name', () => {
    const html = renderBand('UNVERIFIED');
    expect(html).toContain('May have printed\u00A0— not verified');
    // The raw status is still present for readers who know the vocabulary.
    expect(html).toContain('UNVERIFIED');
  });

  it('tells an operator to check the printer before reprinting', () => {
    // The instruction has to survive; it is the entire point of the status.
    expect(renderBand('UNVERIFIED')).toContain('Check the printer before reprinting');
    expect(renderBand('TIMEOUT')).toContain('Check the printer before reprinting');
  });

  it('puts the instruction before the explanation in Thai', () => {
    const html = renderBand('UNVERIFIED', th);
    const instruction = html.indexOf('ตรวจสอบที่เครื่องพิมพ์ก่อนสั่งพิมพ์ซ้ำ');
    const explanation = html.indexOf('ไม่มีการยืนยันจากเครื่องพิมพ์');
    expect(instruction).toBeGreaterThan(-1);
    expect(explanation).toBeGreaterThan(-1);
    // Under time pressure the operator must reach the action first.
    expect(instruction).toBeLessThan(explanation);
  });

  it('says reprinting is safe only where nothing printed', () => {
    expect(renderBand('FAILED')).toContain('Reprinting is safe');
    expect(renderBand('CANCELLED')).toContain('Reprinting is safe');
    expect(renderBand('UNVERIFIED')).not.toContain('Reprinting is safe');
    expect(renderBand('TIMEOUT')).not.toContain('Reprinting is safe');
    expect(renderBand('SUCCESS')).not.toContain('Reprinting is safe');
  });

  it('carries a tone class so the mark and the badge cannot disagree', () => {
    expect(renderBand('SUCCESS')).toContain('job-verdict--confirmed');
    expect(renderBand('UNVERIFIED')).toContain('job-verdict--caution');
    expect(renderBand('FAILED')).toContain('job-verdict--negative');
  });

  it('marks the icon decorative so the headline carries the meaning', () => {
    expect(renderBand('FAILED')).toContain('aria-hidden="true"');
  });

  it('renders the reprint action slot only when one is passed', () => {
    expect(renderBand('SUCCESS')).not.toContain('job-verdict__actions');
  });
});

describe('reprint permission gating', () => {
  /**
   * VIEWER holds job:read but not job:retry. `JobQueue` renders Reprint for
   * everyone and lets the API reject it; Job Detail must not repeat that.
   */
  it('agrees with the server-side permission table', () => {
    expect(ROLE_PERMISSIONS.VIEWER).not.toContain('job:retry');
    expect(ROLE_PERMISSIONS.OPERATOR).toContain('job:retry');
    expect(ROLE_PERMISSIONS.ADMIN).toContain('job:retry');
    expect(ROLE_PERMISSIONS.OWNER).toContain('job:retry');
  });

  it('explains a withheld reprint rather than hiding it silently', () => {
    expect(en('page.jobDetail.reprintNotPermitted')).toBeTruthy();
    expect(th('page.jobDetail.reprintNotPermitted')).not.toBe(
      en('page.jobDetail.reprintNotPermitted'),
    );
  });

  it('states why a job with incomplete identity cannot be reprinted', () => {
    // The server refuses without requestId + runnerId. The operator should
    // learn that before writing a reason, not after submitting.
    expect(en('page.jobDetail.reprintBlockedIdentity')).toContain('cannot be reprinted');
    expect(th('page.jobDetail.reprintBlockedIdentity')).toBeTruthy();
  });

  it('offers a reprint on exactly the terminal statuses where one makes sense', () => {
    const offered = ['SUCCESS', 'UNVERIFIED', 'TIMEOUT', 'FAILED', 'CANCELLED'];
    const withheld = ['ACCEPTED', 'VALIDATED', 'QUEUED', 'DISPATCHED', 'PRINTING', 'DUPLICATE_RETURNED'];
    for (const status of offered) expect(offersReprint(getJobVerdict(status)), status).toBe(true);
    for (const status of withheld) expect(offersReprint(getJobVerdict(status)), status).toBe(false);
  });
});
