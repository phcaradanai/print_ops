import { describe, it, expect } from 'vitest';
import { JOB_STATUSES } from '@printerops/domain';
import {
  getJobVerdict,
  offersReprint,
  reprintButtonVariant,
  verdictDetailKey,
  verdictHeadlineKey,
} from '../lib/jobVerdict.js';
import { translations } from '../i18n/translations.js';

describe('job verdict', () => {
  it('maps every status the domain defines', () => {
    for (const status of JOB_STATUSES) {
      const verdict = getJobVerdict(status);
      expect(verdict.copyKey, `no verdict for ${status}`).toBeTruthy();
      expect(verdict.copyKey).not.toBe('unknown');
    }
  });

  /**
   * The safety-critical assertion of this module.
   *
   * UNVERIFIED and TIMEOUT mean a page may already exist. Treating either as a
   * failure produces a duplicate clinical label; treating either as a success
   * produces a missing one. Both must stay `outcomeUnknown` with a cautioned
   * reprint, and neither may ever share a verdict with FAILED.
   */
  it.each(['UNVERIFIED', 'TIMEOUT'])('treats %s as an unknown outcome', (status) => {
    const verdict = getJobVerdict(status);
    expect(verdict.outcomeUnknown).toBe(true);
    expect(verdict.reprint).toBe('caution');
    expect(verdict.tone).toBe('caution');
    expect(verdict.copyKey).not.toBe(getJobVerdict('FAILED').copyKey);
  });

  it('gives UNVERIFIED and TIMEOUT different wording', () => {
    // Same stance, different reason: "nothing came back at all" and "something
    // came back but confirmed nothing" send an operator to check different
    // things at the device.
    expect(getJobVerdict('UNVERIFIED').copyKey).not.toBe(getJobVerdict('TIMEOUT').copyKey);
  });

  it.each(['FAILED', 'CANCELLED'])('treats %s as safe to reprint', (status) => {
    const verdict = getJobVerdict(status);
    expect(verdict.outcomeUnknown).toBe(false);
    expect(verdict.reprint).toBe('routine');
  });

  it('offers a quiet reprint on a confirmed print', () => {
    const verdict = getJobVerdict('SUCCESS');
    expect(verdict.reprint).toBe('redundant');
    expect(offersReprint(verdict)).toBe(true);
    expect(reprintButtonVariant(verdict)).toBe('secondary');
  });

  it('offers no reprint while the job can still change', () => {
    for (const status of ['ACCEPTED', 'VALIDATED', 'QUEUED', 'DISPATCHED', 'PRINTING']) {
      expect(offersReprint(getJobVerdict(status)), status).toBe(false);
    }
  });

  it('never offers a reprint of a duplicate-returned job', () => {
    // It never printed because an identical request already had. Reprinting
    // THIS job is the wrong move; the operator wants the original.
    expect(offersReprint(getJobVerdict('DUPLICATE_RETURNED'))).toBe(false);
  });

  it('weights the caution reprint as destructive', () => {
    expect(reprintButtonVariant(getJobVerdict('UNVERIFIED'))).toBe('danger');
    expect(reprintButtonVariant(getJobVerdict('TIMEOUT'))).toBe('danger');
    expect(reprintButtonVariant(getJobVerdict('FAILED'))).toBe('primary');
  });

  /**
   * A status this build has not heard of is exactly the case where assuming a
   * page came out — or did not — is unsafe.
   */
  it('treats an unrecognised status as an unknown outcome, never a success', () => {
    const verdict = getJobVerdict('SOME_FUTURE_STATUS');
    expect(verdict.copyKey).toBe('unknown');
    expect(verdict.outcomeUnknown).toBe(true);
    expect(verdict.tone).toBe('caution');
    expect(verdict.reprint).toBe('caution');
  });

  it('has a headline and detail in both languages for every verdict', () => {
    const statuses = [...JOB_STATUSES, 'SOME_FUTURE_STATUS'];
    for (const status of statuses) {
      const verdict = getJobVerdict(status);
      for (const key of [verdictHeadlineKey(verdict), verdictDetailKey(verdict)]) {
        expect(translations.en[key], `missing en: ${key}`).toBeTruthy();
        expect(translations.th[key], `missing th: ${key}`).toBeTruthy();
        // A key echoed back is what `t()` returns when a string is absent.
        expect(translations.en[key]).not.toBe(key);
        expect(translations.th[key]).not.toBe(key);
      }
    }
  });

  it('does not leave the Thai verdict identical to the English', () => {
    // Guards against a copy deck that was added in one language and stubbed in
    // the other — the failure mode that ships an English-only safety warning
    // to a Thai-default hospital.
    for (const status of JOB_STATUSES) {
      const key = verdictDetailKey(getJobVerdict(status));
      expect(translations.th[key], key).not.toBe(translations.en[key]);
    }
  });
});
