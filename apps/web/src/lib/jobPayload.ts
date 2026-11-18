import type { JobStatus } from '@printerops/domain';
import { jobNeedsAttention } from './jobQueueView.js';

export type JobDatePreset = 'all' | 'today' | '7d' | '30d';

export type JobGroupBy =
  | 'none'
  | 'date'
  | 'status'
  | 'template'
  | 'printer'
  | 'source'
  | `key:${string}`;

export interface JobKeyFilter {
  key: string;
  value: string;
  /** True (default) matches exact value (case-insensitive); false matches substring for live typing/search. */
  exact?: boolean;
}

export interface PayloadValueCount {
  value: string;
  count: number;
}

export interface JobPayloadCarrier {
  payload?: Record<string, unknown>;
  payloadSnapshot?: string;
  metadata?: Record<string, unknown>;
}

export interface FilterableJob extends JobPayloadCarrier {
  id: string;
  status: string;
  printerId: string;
  printerCode?: string;
  templateCode?: string;
  resolvedTemplateCode?: string;
  sourceSystem?: string;
  sourceReference?: string;
  requestId?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface JobExplorerFilterOptions {
  status: 'ALL' | 'NEEDS_ATTENTION' | JobStatus;
  search: string;
  datePreset?: JobDatePreset;
  dateFrom?: string;
  dateTo?: string;
  keyFilters?: JobKeyFilter[];
  groupBy?: JobGroupBy;
  now?: Date;
}

export interface JobGroup<T extends FilterableJob> {
  groupKey: string;
  groupLabel: string;
  totalCount: number;
  queuedCount: number;
  successCount: number;
  attentionCount: number;
  failedCount: number;
  jobs: T[];
}

const SENSITIVE_KEY_PATTERN = /secret|token|password|api_?key/i;
const INTERNAL_KEYS = new Set([
  '_renderedPayload',
  'callbackIntent',
  'paperProfile',
  'printerCalibration',
  'templateSnapshot',
  'sandboxInput',
  'recovery',
  'printEvidence',
  'nats',
]);

const ACTIVE_QUEUE_STATUSES = new Set([
  'ACCEPTED',
  'VALIDATED',
  'QUEUED',
  'DISPATCHED',
  'PRINTING',
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function formatPayloadValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function extractJobPayload(job: JobPayloadCarrier): Record<string, string> {
  const meta = asRecord(job.metadata);
  const directJobPayload = asRecord(job.payload);
  const metaPayload = asRecord(meta?.['payload']);
  const mappedPayload = asRecord(meta?.['mappedPayload']);
  const intakePayload = asRecord(meta?.['intakePayload']);
  const sandboxInput = asRecord(meta?.['sandboxInput']);
  const sandboxSample = asRecord(sandboxInput?.['samplePayload']);
  const sandboxScenarios = Array.isArray(sandboxInput?.['scenarios'])
    ? (sandboxInput['scenarios'] as Array<Record<string, unknown>>)
    : undefined;
  const firstScenarioSample = sandboxScenarios
    ? asRecord(sandboxScenarios.find((item) => asRecord(item?.['samplePayload']))?.['samplePayload'])
    : undefined;

  let merged: Record<string, unknown> = {
    ...(intakePayload ?? {}),
    ...(mappedPayload ?? {}),
    ...(metaPayload ?? {}),
    ...(sandboxSample ?? firstScenarioSample ?? {}),
    ...(directJobPayload ?? {}),
  };

  if (Object.keys(merged).length === 0 && typeof job.payloadSnapshot === 'string') {
    const trimmed = job.payloadSnapshot.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = asRecord(JSON.parse(trimmed));
        if (parsed) {
          const sample = asRecord(parsed['samplePayload']);
          if (sample) {
            merged = sample;
          } else if (Array.isArray(parsed['scenarios'])) {
            const firstScenario = (parsed['scenarios'] as Array<Record<string, unknown>>)
              .find((item) => asRecord(item?.['samplePayload']));
            merged = asRecord(firstScenario?.['samplePayload']) ?? parsed;
          } else {
            merged = parsed;
          }
        }
      } catch {
        // Ignore non-JSON snapshot string like "keys=[a,b] len=12"
      }
    }
  }

  const out: Record<string, string> = {};
  const visit = (record: Record<string, unknown>, prefix: string, depth: number) => {
    for (const [key, raw] of Object.entries(record)) {
      if (INTERNAL_KEYS.has(key)) continue;
      if (SENSITIVE_KEY_PATTERN.test(key)) continue;
      const fullKey = prefix ? `${prefix}.${key}` : key;
      const nested = asRecord(raw);
      if (nested && depth < 6 && Object.keys(nested).length > 0) {
        visit(nested, fullKey, depth + 1);
        continue;
      }
      const formatted = formatPayloadValue(raw);
      if (formatted === undefined) continue;
      out[fullKey] = formatted;
    }
  };
  visit(merged, '', 0);
  return out;
}

export function payloadEntries(job: JobPayloadCarrier): Array<{ key: string; value: string }> {
  return Object.entries(extractJobPayload(job)).map(([key, value]) => ({ key, value }));
}

export function collectPayloadKeys(jobs: JobPayloadCarrier[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const job of jobs) {
    for (const key of Object.keys(extractJobPayload(job))) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}

export function collectPayloadValues(jobs: JobPayloadCarrier[], key: string): string[] {
  if (!key) return [];
  const values: string[] = [];
  const seen = new Set<string>();
  for (const job of jobs) {
    const val = extractJobPayload(job)[key];
    if (val !== undefined && val.length > 0 && !seen.has(val)) {
      seen.add(val);
      values.push(val);
    }
  }
  return values;
}

export function collectPayloadValueCounts(jobs: JobPayloadCarrier[], key: string): PayloadValueCount[] {
  if (!key) return [];
  const counts = new Map<string, number>();
  const targetLower = key.toLocaleLowerCase();
  for (const job of jobs) {
    const payload = extractJobPayload(job);
    const val = payload[key]
      ?? Object.entries(payload).find(([k]) => k.toLocaleLowerCase() === targetLower)?.[1];
    if (val !== undefined && val.length > 0) {
      counts.set(val, (counts.get(val) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Parse free-text search queries that may include `key = value` or `key:value`
 * segments separated by commas, semicolons, or whitespace (e.g.
 * `hn = 123456 , prescription = 213456`).
 */
export function parseJobSearchQuery(raw: string): {
  keyQueries: JobKeyFilter[];
  textTerms: string[];
} {
  const trimmed = raw.trim();
  if (!trimmed) return { keyQueries: [], textTerms: [] };

  const keyQueries: JobKeyFilter[] = [];
  const textTerms: string[] = [];
  const segments = trimmed.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);

  for (const segment of segments) {
    const pairPattern = /([A-Za-z0-9_.-]+)\s*[:=]\s*(?!\/\/)(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
    const singlePair = /^([A-Za-z0-9_.-]+)\s*[:=]\s*(?!\/\/)(.+)$/.exec(segment);

    // When a comma-separated segment is a single `key = value` expression (even
    // if the value contains spaces, e.g. `patient_name = Somchai Dee`), keep
    // the full value intact unless another `key=` expression follows inside it.
    if (singlePair) {
      const candidateRhs = singlePair[2] ?? '';
      const hasSecondKey = /\s+[A-Za-z0-9_.-]+\s*[:=]\s*(?!\/\/)/.test(candidateRhs);
      if (!hasSecondKey) {
        const key = singlePair[1]!.trim();
        const value = stripWrappingQuotes(candidateRhs);
        if (key && value) {
          keyQueries.push({ key, value, exact: false });
        }
        continue;
      }
    }

    let remainder = segment;
    let match: RegExpExecArray | null;
    while ((match = pairPattern.exec(segment)) !== null) {
      const key = match[1]!.trim();
      const rawValue = match[2] ?? match[3] ?? match[4] ?? '';
      const value = stripWrappingQuotes(rawValue);
      if (key && value) {
        keyQueries.push({ key, value, exact: false });
      }
      remainder = remainder.replace(match[0], ' ');
    }

    for (const token of remainder.trim().split(/\s+/).filter(Boolean)) {
      textTerms.push(token.toLocaleLowerCase());
    }
  }

  return { keyQueries, textTerms };
}

/**
 * Where a free-text search can hit. The value matters to the operator: a term
 * that only matches `templateCode` is invisible on a row whose Template column is
 * hidden, and a row that appears for no visible reason reads as a broken filter.
 * `columnId` names the list column that shows the value, so a caller can tell
 * "already on screen" from "hidden, explain it".
 */
export type JobSearchField =
  | 'reference'
  | 'status'
  | 'destination'
  | 'station'
  | 'template'
  | 'source'
  | 'runner'
  | 'error'
  | 'incoming-key'
  | 'incoming-value'
  | 'technical';

export interface JobSearchCandidate {
  field: JobSearchField;
  /** List column id that already shows this value, when one does. */
  columnId?: string;
  /** Incoming payload key, for the `incoming-*` fields. */
  key?: string;
  value: string;
  /**
   * Keys must equal the whole term; values may appear anywhere inside it.
   * `dob` therefore finds the jobs that carry a `dob` key, while `do` does not
   * silently drag them in - which is the phantom-row case that made typing a
   * short word look broken.
   */
  match: 'substring' | 'exact';
}

/**
 * Every string a search term may hit, with the column that shows it. One list,
 * used by both the filter and the "why did this row match" explanation, so the
 * two can never disagree about what matched.
 */
export function collectJobSearchCandidates(job: FilterableJob): JobSearchCandidate[] {
  const candidates: JobSearchCandidate[] = [];
  const push = (
    field: JobSearchField,
    value: string | undefined,
    match: 'substring' | 'exact' = 'substring',
    columnId?: string,
    key?: string,
  ) => {
    if (value === undefined || value === '') return;
    candidates.push({
      field,
      value,
      match,
      ...(columnId ? { columnId } : {}),
      ...(key ? { key } : {}),
    });
  };

  push('reference', job.requestId, 'substring', 'job');
  push('reference', job.id, 'substring', 'job');
  push('status', job.status, 'substring', 'status');
  push('destination', job.printerCode, 'substring', 'destination');
  push('destination', job.printerId, 'substring', 'destination');
  push('template', job.resolvedTemplateCode, 'substring', 'template');
  push('template', job.templateCode, 'substring', 'template');
  push('source', job.sourceSystem, 'substring', 'source');
  push('source', job.sourceReference, 'substring', 'source');
  push('error', job.errorCode, 'substring', 'error');
  push('error', job.errorMessage, 'substring', 'error');
  // Nothing on this page renders the raw snapshot; a hit there is always hidden.
  push('technical', job.payloadSnapshot, 'substring');

  for (const [key, value] of Object.entries(extractJobPayload(job))) {
    const columnId = `payload:${key}`;
    push('incoming-key', key, 'exact', columnId, key);
    push('incoming-value', value, 'substring', columnId, key);
  }

  return candidates;
}

/** True when one search term hits one candidate. */
export function candidateMatchesTerm(candidate: JobSearchCandidate, term: string): boolean {
  const value = candidate.value.toLocaleLowerCase();
  return candidate.match === 'exact' ? value === term : value.includes(term);
}

export interface JobSearchMatch {
  field: JobSearchField;
  columnId?: string;
  key?: string;
  /** The value that matched, already trimmed to something a row can show. */
  value: string;
}

/**
 * Which fields of this job the search actually hit, one entry per field and key.
 *
 * Returns nothing when the query has no free-text terms (a `key = value` search
 * is already spelled out in the filter chips, so repeating it per row would add
 * noise without adding information).
 */
export function describeJobSearchMatches(job: FilterableJob, search: string): JobSearchMatch[] {
  const { textTerms } = parseJobSearchQuery(search);
  if (textTerms.length === 0) return [];

  const seen = new Set<string>();
  const matches: JobSearchMatch[] = [];
  for (const candidate of collectJobSearchCandidates(job)) {
    if (!textTerms.some((term) => candidateMatchesTerm(candidate, term))) continue;
    const id = `${candidate.field}:${candidate.key ?? candidate.value}`;
    if (seen.has(id)) continue;
    seen.add(id);
    matches.push({
      field: candidate.field,
      value: candidate.value,
      ...(candidate.columnId ? { columnId: candidate.columnId } : {}),
      ...(candidate.key ? { key: candidate.key } : {}),
    });
  }
  return matches;
}

/**
 * The matches a row cannot show as it is currently laid out: no column displays
 * them. These are the rows that look like a broken filter.
 */
export function hiddenSearchMatches(
  matches: readonly JobSearchMatch[],
  visibleColumnIds: ReadonlySet<string>,
): JobSearchMatch[] {
  return matches.filter(
    (match) => match.columnId === undefined || !visibleColumnIds.has(match.columnId),
  );
}

export function matchesKeyFilter(
  payload: Record<string, string>,
  kf: JobKeyFilter,
): boolean {  const filterKeyLower = kf.key.trim().toLocaleLowerCase();
  const targetValue = kf.value.trim().toLocaleLowerCase();
  if (!filterKeyLower || !targetValue) return true;

  const exactMatches: string[] = [];
  const leafMatches: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    const kLower = k.toLocaleLowerCase();
    if (kLower === filterKeyLower) {
      exactMatches.push(v);
    } else if (kLower.endsWith(`.${filterKeyLower}`)) {
      leafMatches.push(v);
    }
  }

  const matchedValues = exactMatches.length > 0 ? exactMatches : leafMatches;
  if (matchedValues.length === 0) return false;

  const isExact = kf.exact !== false;
  return matchedValues.some((actual) => {
    const actualLower = actual.toLocaleLowerCase();
    return isExact ? actualLower === targetValue : actualLower.includes(targetValue);
  });
}

function parseLocalDateStart(ymd: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  return new Date(year, month, day, 0, 0, 0, 0).getTime();
}

function parseLocalDateEnd(ymd: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  return new Date(year, month, day, 23, 59, 59, 999).getTime();
}

function formatLocalYmd(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function filterAndGroupJobs<T extends FilterableJob>(
  jobs: T[],
  options: JobExplorerFilterOptions,
): { filteredJobs: T[]; groups: JobGroup<T>[] } {
  const now = options.now ?? new Date();
  const parsedSearch = parseJobSearchQuery(options.search);
  const datePreset = options.datePreset ?? 'all';
  const activeKeyFilters = [
    ...(options.keyFilters ?? []).filter((f) => f.key.trim().length > 0 && f.value.trim().length > 0),
    ...parsedSearch.keyQueries,
  ];

  let presetMinMs: number | null = null;
  if (datePreset === 'today') {
    presetMinMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  } else if (datePreset === '7d') {
    presetMinMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  } else if (datePreset === '30d') {
    presetMinMs = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  }

  const fromMs = options.dateFrom ? parseLocalDateStart(options.dateFrom) : null;
  const toMs = options.dateTo ? parseLocalDateEnd(options.dateTo) : null;

  const filteredJobs = jobs.filter((job) => {
    if (options.status === 'NEEDS_ATTENTION') {
      if (!jobNeedsAttention(job.status)) return false;
    } else if (options.status !== 'ALL' && job.status !== options.status) {
      return false;
    }

    const createdMs = Date.parse(job.createdAt);
    if (presetMinMs !== null && (!Number.isFinite(createdMs) || createdMs < presetMinMs)) {
      return false;
    }
    if (fromMs !== null && (!Number.isFinite(createdMs) || createdMs < fromMs)) {
      return false;
    }
    if (toMs !== null && (!Number.isFinite(createdMs) || createdMs > toMs)) {
      return false;
    }

    const payload = extractJobPayload(job);
    for (const kf of activeKeyFilters) {
      if (!matchesKeyFilter(payload, kf)) {
        return false;
      }
    }

    if (parsedSearch.textTerms.length > 0) {
      const candidates = collectJobSearchCandidates(job);
      const allTermsMatch = parsedSearch.textTerms.every((term) =>
        candidates.some((candidate) => candidateMatchesTerm(candidate, term)),
      );
      if (!allTermsMatch) {
        return false;
      }
    }

    return true;
  });

  const groupBy = options.groupBy ?? 'none';
  if (groupBy === 'none') {
    const counts = summarizeGroupCounts(filteredJobs);
    return {
      filteredJobs,
      groups: [
        {
          groupKey: 'all',
          groupLabel: 'all',
          ...counts,
          jobs: filteredJobs,
        },
      ],
    };
  }

  const buckets = new Map<string, T[]>();
  for (const job of filteredJobs) {
    const label = resolveGroupLabel(job, groupBy);
    const list = buckets.get(label);
    if (list) list.push(job);
    else buckets.set(label, [job]);
  }

  const groups: JobGroup<T>[] = Array.from(buckets.entries()).map(([label, bucketJobs]) => ({
    groupKey: `${groupBy}:${label}`,
    groupLabel: label,
    ...summarizeGroupCounts(bucketJobs),
    jobs: bucketJobs,
  }));

  return { filteredJobs, groups };
}

function resolveGroupLabel(job: FilterableJob, groupBy: JobGroupBy): string {
  if (groupBy === 'date') return formatLocalYmd(job.createdAt);
  if (groupBy === 'status') return job.status;
  if (groupBy === 'template') return job.resolvedTemplateCode ?? job.templateCode ?? '—';
  if (groupBy === 'printer') return job.printerCode ?? job.printerId ?? '—';
  if (groupBy === 'source') return job.sourceSystem ?? '—';
  if (groupBy.startsWith('key:')) {
    const fieldName = groupBy.slice(4);
    const payload = extractJobPayload(job);
    return payload[fieldName] ?? '—';
  }
  return 'all';
}

function summarizeGroupCounts<T extends FilterableJob>(jobs: T[]) {
  let queuedCount = 0;
  let successCount = 0;
  let attentionCount = 0;
  let failedCount = 0;
  for (const job of jobs) {
    if (ACTIVE_QUEUE_STATUSES.has(job.status)) queuedCount += 1;
    else if (job.status === 'SUCCESS') successCount += 1;
    else if (job.status === 'FAILED') failedCount += 1;
    else if (jobNeedsAttention(job.status)) attentionCount += 1;
  }
  return {
    totalCount: jobs.length,
    queuedCount,
    successCount,
    attentionCount,
    failedCount,
  };
}
