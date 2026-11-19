import { describe, expect, it } from 'vitest';
import {
  collectPayloadKeys,
  collectPayloadValueCounts,
  collectPayloadValues,
  extractJobPayload,
  filterAndGroupJobs,
  parseJobSearchQuery,
  payloadEntries,
  type FilterableJob,
} from '../lib/jobPayload.js';

const NOW = new Date('2026-11-17T10:00:00.000Z');

const SAMPLE_JOBS: FilterableJob[] = [
  {
    id: 'job_1',
    status: 'SUCCESS',
    printerId: 'prn-1',
    printerCode: 'OPD-ZPL-01',
    templateCode: 'PATIENT_WRISTBAND',
    sourceSystem: 'HIS',
    requestId: 'REQ-1001',
    payload: {
      hn: 'HN-001',
      patient_name: 'Somchai',
      ward: 'OPD-1',
      secretToken: 'should-redact',
    },
    createdAt: '2026-11-17T08:15:00.000Z',
  },
  {
    id: 'job_2',
    status: 'FAILED',
    printerId: 'prn-2',
    printerCode: 'PHARM-01',
    templateCode: 'RX_LABEL',
    sourceSystem: 'ERP',
    requestId: 'REQ-1002',
    errorCode: 'OFFLINE',
    errorMessage: 'Printer unreachable',
    metadata: {
      mappedPayload: {
        hn: 'HN-002',
        patient_name: 'Suda',
        ward: 'IPD-3',
      },
      intakePayload: {
        lot_no: 'LOT-99',
      },
    },
    createdAt: '2026-11-12T09:00:00.000Z',
  },
  {
    id: 'job_3',
    status: 'UNVERIFIED',
    printerId: 'prn-1',
    printerCode: 'OPD-ZPL-01',
    templateCode: 'PATIENT_WRISTBAND',
    sourceSystem: 'HIS',
    requestId: 'REQ-1003',
    payloadSnapshot: JSON.stringify({
      hn: 'HN-001',
      ward: 'ER',
      password: 'hidden',
    }),
    createdAt: '2026-10-01T12:00:00.000Z',
  },
];

describe('jobPayload utilities', () => {
  it('extracts incoming payload keys/values from payload, metadata, and JSON snapshots while stripping secrets', () => {
    expect(extractJobPayload(SAMPLE_JOBS[0])).toEqual({
      hn: 'HN-001',
      patient_name: 'Somchai',
      ward: 'OPD-1',
    });

    expect(extractJobPayload(SAMPLE_JOBS[1])).toEqual({
      lot_no: 'LOT-99',
      hn: 'HN-002',
      patient_name: 'Suda',
      ward: 'IPD-3',
    });

    expect(extractJobPayload(SAMPLE_JOBS[2])).toEqual({
      hn: 'HN-001',
      ward: 'ER',
    });

    expect(payloadEntries(SAMPLE_JOBS[2])).toEqual([
      { key: 'hn', value: 'HN-001' },
      { key: 'ward', value: 'ER' },
    ]);
  });

  it('collects distinct payload keys and values for filter builders', () => {
    expect(collectPayloadKeys(SAMPLE_JOBS)).toEqual([
      'hn',
      'patient_name',
      'ward',
      'lot_no',
    ]);
    expect(collectPayloadValues(SAMPLE_JOBS, 'hn')).toEqual(['HN-001', 'HN-002']);
    expect(collectPayloadValues(SAMPLE_JOBS, 'ward')).toEqual(['OPD-1', 'IPD-3', 'ER']);
  });

  it('filters by payload keys, date presets/range, status NEEDS_ATTENTION, and search text', () => {
    const byKey = filterAndGroupJobs(SAMPLE_JOBS, {
      status: 'ALL',
      search: '',
      keyFilters: [{ key: 'hn', value: 'hn-001' }],
      now: NOW,
    });
    expect(byKey.filteredJobs.map((j) => j.id)).toEqual(['job_1', 'job_3']);

    const byToday = filterAndGroupJobs(SAMPLE_JOBS, {
      status: 'ALL',
      search: '',
      datePreset: 'today',
      now: NOW,
    });
    expect(byToday.filteredJobs.map((j) => j.id)).toEqual(['job_1']);

    const byCustomDates = filterAndGroupJobs(SAMPLE_JOBS, {
      status: 'ALL',
      search: '',
      dateFrom: '2026-11-10',
      dateTo: '2026-11-15',
      now: NOW,
    });
    expect(byCustomDates.filteredJobs.map((j) => j.id)).toEqual(['job_2']);

    const attentionOnly = filterAndGroupJobs(SAMPLE_JOBS, {
      status: 'NEEDS_ATTENTION',
      search: '',
      now: NOW,
    });
    expect(attentionOnly.filteredJobs.map((j) => j.id)).toEqual(['job_2', 'job_3']);

    const byPayloadSearch = filterAndGroupJobs(SAMPLE_JOBS, {
      status: 'ALL',
      search: 'LOT-99',
      now: NOW,
    });
    expect(byPayloadSearch.filteredJobs.map((j) => j.id)).toEqual(['job_2']);
  });

  it('groups filtered jobs by dynamic payload key, date, status, or template', () => {
    const groupedByHn = filterAndGroupJobs(SAMPLE_JOBS, {
      status: 'ALL',
      search: '',
      groupBy: 'key:hn',
      now: NOW,
    });
    expect(groupedByHn.groups).toHaveLength(2);
    expect(groupedByHn.groups[0]?.groupLabel).toBe('HN-001');
    expect(groupedByHn.groups[0]?.totalCount).toBe(2);
    expect(groupedByHn.groups[0]?.attentionCount).toBe(1);
    expect(groupedByHn.groups[1]?.groupLabel).toBe('HN-002');
    expect(groupedByHn.groups[1]?.failedCount).toBe(1);

    const groupedByTemplate = filterAndGroupJobs(SAMPLE_JOBS, {
      status: 'ALL',
      search: '',
      groupBy: 'template',
      now: NOW,
    });
    expect(groupedByTemplate.groups.map((g) => g.groupLabel)).toEqual([
      'PATIENT_WRISTBAND',
      'RX_LABEL',
    ]);
  });

  it('finds an incoming payload value from the shared search pipeline', () => {
    const { filteredJobs } = filterAndGroupJobs(SAMPLE_JOBS, {
      status: 'ALL',
      search: 'Somchai',
      now: NOW,
    });
    expect(filteredJobs.map((job) => job.id)).toEqual(['job_1']);
  });

  it('flattens nested payloads, counts key values, and filters multiple key = value pairs', () => {
    const nestedJobs: FilterableJob[] = [
      {
        id: 'rx_1',
        status: 'SUCCESS',
        printerId: 'p1',
        payload: {
          patient: { hn: '123456', ward: 'OPD-1' },
          prescription: '213456',
        },
        createdAt: '2026-11-17T08:00:00.000Z',
      },
      {
        id: 'rx_2',
        status: 'SUCCESS',
        printerId: 'p1',
        payload: {
          patient: { hn: '123456', ward: 'IPD-2' },
          prescription: '999999',
        },
        createdAt: '2026-11-17T08:05:00.000Z',
      },
      {
        id: 'rx_3',
        status: 'FAILED',
        printerId: 'p1',
        payload: {
          hn: '654321',
          prescription: '213456',
        },
        createdAt: '2026-11-17T08:10:00.000Z',
      },
    ];

    expect(extractJobPayload(nestedJobs[0])).toEqual({
      'patient.hn': '123456',
      'patient.ward': 'OPD-1',
      prescription: '213456',
    });

    expect(collectPayloadValueCounts(nestedJobs, 'prescription')).toEqual([
      { value: '213456', count: 2 },
      { value: '999999', count: 1 },
    ]);

    expect(parseJobSearchQuery('hn = 123456 , prescription = 213456')).toEqual({
      keyQueries: [
        { key: 'hn', value: '123456', exact: false },
        { key: 'prescription', value: '213456', exact: false },
      ],
      textTerms: [],
    });

    const filteredControl = filterAndGroupJobs(nestedJobs, {
      status: 'ALL',
      search: 'hn = 123456 , prescription = 213456',
      now: NOW,
    });
    expect(filteredControl.filteredJobs.map((j) => j.id)).toEqual(['rx_1']);

    const filteredByKeyFilters = filterAndGroupJobs(nestedJobs, {
      status: 'ALL',
      search: '',
      keyFilters: [
        { key: 'hn', value: '123456', exact: true },
        { key: 'prescription', value: '213', exact: false },
      ],
      now: NOW,
    });
    expect(filteredByKeyFilters.filteredJobs.map((j) => j.id)).toEqual(['rx_1']);
  });
});
