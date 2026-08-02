/**
 * The verdict band — the first thing on a job's page.
 *
 * It answers, in one sentence, the only question an operator opens this page
 * with: did my label come out, and do I reprint it? Everything else on the page
 * is evidence for this sentence.
 *
 * The mark is authored SVG rather than a glyph, and it is deliberately a
 * three-way distinction rather than a two-way one:
 *
 *   check     a page came out
 *   question  nobody can say        ← not a warning triangle: this is genuinely
 *   cross     no page came out         unknown, not an error
 *
 * Marks are decorative (`aria-hidden`); the headline carries the meaning. The
 * tint behind a mark is the same semantic colour the status badge uses, so the
 * band and the badge beside it can never disagree about a job.
 */

import type { ReactNode } from 'react';
import type { JobVerdict as Verdict, VerdictTone } from '../lib/jobVerdict.js';

const MARK_STROKE = 1.75;

function CheckMark() {
  return (
    <path d="M5 10.5l3.5 3.5L15 7" fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="round" strokeLinejoin="round" />
  );
}

function QuestionMark() {
  return (
    <>
      <path d="M7.5 7.5a2.5 2.5 0 1 1 3.4 2.33c-.55.22-.9.76-.9 1.35v.57" fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="14.4" r="0.95" fill="currentColor" />
    </>
  );
}

function CrossMark() {
  return (
    <path d="M6.5 6.5l7 7M13.5 6.5l-7 7" fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="round" />
  );
}

function ClockMark() {
  return (
    <>
      <circle cx="10" cy="10" r="5.75" fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} />
      <path d="M10 6.75V10l2.4 1.6" fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function ArrowMark() {
  return (
    <>
      <path d="M10 4.75v7.5" fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="round" />
      <path d="M6.75 9l3.25 3.25L13.25 9" fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.25 15.25h9.5" fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="round" />
    </>
  );
}

function DashMark() {
  return (
    <path d="M6.25 10h7.5" fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="round" />
  );
}

const MARKS: Record<VerdictTone, () => ReactNode> = {
  confirmed: CheckMark,
  caution: QuestionMark,
  negative: CrossMark,
  pending: ClockMark,
  progress: ArrowMark,
  neutral: DashMark,
};

export function JobVerdictBand({
  verdict,
  headline,
  detail,
  badge,
  actions,
  note,
}: {
  verdict: Verdict;
  headline: string;
  detail: string;
  /** The raw status badge, for readers who know the vocabulary. */
  badge: ReactNode;
  /** Reprint control, or the stated reason there isn't one. */
  actions?: ReactNode;
  /** Provenance and other short qualifiers shown under the detail sentence. */
  note?: ReactNode;
}) {
  const Mark = MARKS[verdict.tone];

  return (
    <section
      className={`job-verdict job-verdict--${verdict.tone}`}
      aria-labelledby="job-verdict-headline"
    >
      <span className="job-verdict__mark" aria-hidden="true">
        <svg viewBox="0 0 20 20" width="20" height="20" focusable="false">
          <Mark />
        </svg>
      </span>

      <div className="job-verdict__body">
        <div className="job-verdict__headline-row">
          <h2 className="job-verdict__headline" id="job-verdict-headline">
            {headline}
          </h2>
          {badge}
        </div>
        <p className="job-verdict__detail">{detail}</p>
        {note && <div className="job-verdict__note">{note}</div>}
      </div>

      {actions && <div className="job-verdict__actions">{actions}</div>}
    </section>
  );
}
