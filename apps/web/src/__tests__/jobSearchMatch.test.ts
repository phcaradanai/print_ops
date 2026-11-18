import { describe, expect, it } from 'vitest';
import {
  collectJobSearchCandidates,
  describeJobSearchMatches,
  filterAndGroupJobs,
  hiddenSearchMatches,
  type FilterableJob,
} from '../lib/jobPayload.js';

function job(overrides: Partial<FilterableJob> & { id: string }): FilterableJob {
  return {
    status: 'UNVERIFIED',
    printerId: 'printer-john-01',
    printerCode: 'ZEBRA_OPD_01',
    templateCode: 'PATIENT_LABEL',
    createdAt: '2026-11-18T09:00:00.000Z',
    payload: { hn: '123456', patient_name: 'Somchai Dee' },
    ...overrides,
  } as FilterableJob;
}

function search(jobs: FilterableJob[], term: string): FilterableJob[] {
  return filterAndGroupJobs(jobs, {
    status: 'ALL',
    search: term,
    datePreset: 'all',
    dateFrom: '',
    dateTo: '',
    keyFilters: [],
  }).filteredJobs;
}

describe('collectJobSearchCandidates', () => {
  it('names the column that already shows each value', () => {
    const candidates = collectJobSearchCandidates(job({ id: 'job-1' }));
    const firstOf = (field: string) => candidates.find((candidate) => candidate.field === field);
    expect(firstOf('reference')?.columnId).toBe('job');
    expect(firstOf('status')?.columnId).toBe('status');
    expect(firstOf('destination')?.columnId).toBe('destination');
    expect(firstOf('template')?.columnId).toBe('template');
    expect(firstOf('incoming-key')?.columnId).toBe('payload:hn');
    expect(firstOf('incoming-value')?.columnId).toBe('payload:hn');
  });

  it('matches incoming keys as whole terms and values anywhere inside', () => {
    const candidates = collectJobSearchCandidates(job({ id: 'job-1', payload: { dob: '1990-01-01' } }));
    const keyCandidate = candidates.find((candidate) => candidate.field === 'incoming-key' && candidate.key === 'dob');
    const valueCandidate = candidates.find((candidate) => candidate.field === 'incoming-value' && candidate.key === 'dob');
    expect(keyCandidate?.match).toBe('exact');
    expect(valueCandidate?.match).toBe('substring');
  });
});

describe('describeJobSearchMatches', () => {
  it('reports the field a term actually hit', () => {
    const matches = describeJobSearchMatches(job({ id: 'job-1' }), 'ab');
    // "ab" is inside "PATIENT_LABEL" - visible only when the Template column is on.
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ field: 'template', value: 'PATIENT_LABEL', columnId: 'template' });
  });

  it('says nothing when the query has no free-text term', () => {
    expect(describeJobSearchMatches(job({ id: 'job-1' }), 'hn = 123456')).toEqual([]);
    expect(describeJobSearchMatches(job({ id: 'job-1' }), '   ')).toEqual([]);
  });

  it('lists one entry per field and key, not one per term occurrence', () => {
    const matches = describeJobSearchMatches(job({ id: 'job-1', payload: { hn: 'do', dob: 'do' } }), 'do');
    const keys = matches.filter((match) => match.field === 'incoming-value').map((match) => match.key);
    expect(new Set(keys)).toEqual(new Set(['hn', 'dob']));
  });
});

describe('hiddenSearchMatches', () => {
  it('keeps only the matches the current columns do not show', () => {
    const matches = describeJobSearchMatches(job({ id: 'job-1' }), 'ab');
    expect(hiddenSearchMatches(matches, new Set(['job', 'status']))).toHaveLength(1);
    expect(hiddenSearchMatches(matches, new Set(['job', 'status', 'template']))).toHaveLength(0);
  });

  it('treats a match with no column as always hidden', () => {
    const withSnapshot = job({ id: 'job-1', payload: {}, payloadSnapshot: 'keys=[ab] len=2' });
    const matches = describeJobSearchMatches(withSnapshot, 'keys=');
    expect(matches).toEqual([{ field: 'technical', value: 'keys=[ab] len=2' }]);
    expect(hiddenSearchMatches(matches, new Set(['job', 'status', 'template']))).toHaveLength(1);
  });
});

describe('search matching rules', () => {
  it('does not drag a job in because a short term sits inside a payload key', () => {
    const jobs = [job({ id: 'job-1', payload: { dob: '1990-01-01' } })];
    // The reported bug: "do" is inside "dob", so the row looked unrelated.
    expect(search(jobs, 'do')).toHaveLength(0);
    expect(search(jobs, 'dob')).toHaveLength(1);
  });

  it('still finds a job by a value fragment inside incoming data', () => {
    expect(search([job({ id: 'job-1', payload: { patient_name: 'Somchai Dee' } })], 'omch')).toHaveLength(1);
  });

  it('requires every term, as before', () => {
    expect(search([job({ id: 'job-1' })], 'hn 123456')).toHaveLength(1);
    expect(search([job({ id: 'job-1' })], 'hn 999999')).toHaveLength(0);
  });
});

describe('technical-details switch', () => {
  const failing = job({
    id: '3f7a1c2e-91b4-4d6f-8a01-000000000002',
    // No "ab" anywhere in the primary fields: the only "ab" lives in the two
    // technical details below ("ext-ab-77" and "cable").
    templateCode: 'XRAY_10x15',
    errorCode: 'PRINTER_OFFLINE',
    errorMessage: 'Printer not responding; check the cable.',
    sourceReference: 'ext-ab-77',
  });

  function searchWith(jobs: FilterableJob[], term: string, searchTechnical: boolean) {
    return filterAndGroupJobs(jobs, {
      status: 'ALL',
      search: term,
      datePreset: 'all',
      dateFrom: '',
      dateTo: '',
      keyFilters: [],
      searchTechnical,
    }).filteredJobs;
  }

  it("marks the drawer's technical fields as the technical tier", () => {
    const candidates = collectJobSearchCandidates(failing);
    const tiersOf = (field: string) =>
      candidates.filter((candidate) => candidate.field === field).map((candidate) => candidate.tier);
    expect(tiersOf('error')).toEqual(['technical', 'technical']);
    expect(tiersOf('source')).toEqual(['technical']);
    // The internal id is technical; the request reference the intake sent is not.
    expect(tiersOf('reference')).toEqual(['technical']);
    expect(tiersOf('status')).toEqual(['primary']);
    expect(tiersOf('template')).toEqual(['primary']);
  });

  it('leaves the technical fields out when the switch is off', () => {
    // "ab" exists only in the source reference and the error message.
    expect(searchWith([failing], 'ab', true)).toHaveLength(1);
    expect(searchWith([failing], 'ab', false)).toHaveLength(0);
    expect(searchWith([failing], 'PRINTER_OFFLINE', true)).toHaveLength(1);
    expect(searchWith([failing], 'PRINTER_OFFLINE', false)).toHaveLength(0);
    // Ordinary fields keep working either way.
    expect(searchWith([failing], 'UNVERIFIED', true)).toHaveLength(1);
    expect(searchWith([failing], 'UNVERIFIED', false)).toHaveLength(1);
    expect(searchWith([failing], '123456', false)).toHaveLength(1);
  });

  it('explains only the hits the current switch would allow', () => {
    const withTechnical = describeJobSearchMatches(failing, 'ab', { includeTechnical: true });
    expect(withTechnical.map((match) => match.field)).toEqual(
      expect.arrayContaining(['error', 'source']),
    );
    expect(describeJobSearchMatches(failing, 'ab', { includeTechnical: false })).toEqual([]);
  });

  it('drops the technical candidates themselves when the switch is off', () => {
    const fields = collectJobSearchCandidates(failing, { includeTechnical: false }).map(
      (candidate) => candidate.field,
    );
    expect(fields).not.toContain('error');
    expect(fields).not.toContain('source');
    expect(fields).toContain('status');
    expect(fields).toContain('template');
    expect(fields).toContain('incoming-value');
  });
});
