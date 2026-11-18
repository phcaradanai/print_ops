import { describe, expect, it } from 'vitest';
import type { ControlSyncedJob } from '@printerops/domain';
import {
  InMemoryDeviceRegistryRepository,
  InMemoryEnrollmentTokenRepository,
} from '../infra/repos/in-memory-control.repo.js';
import { WebControlRegistryService } from '../services/web-control-registry.service.js';

function job(overrides: Partial<ControlSyncedJob> & { id: string }): ControlSyncedJob {
  return {
    deviceId: 'dev-1',
    printerId: 'printer-1',
    status: 'UNVERIFIED',
    copies: 1,
    payload: {},
    createdAt: '2026-11-18T09:00:00.000Z',
    ...overrides,
  };
}

function registry(): WebControlRegistryService {
  return new WebControlRegistryService({
    deviceRegistry: new InMemoryDeviceRegistryRepository(),
    enrollmentTokens: new InMemoryEnrollmentTokenRepository(),
    useSqlite: false,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
}

describe('control job review acknowledgement', () => {
  it('acknowledges a mirrored job without touching its status or payload', async () => {
    const service = registry();
    await service.upsertDeviceJobs('dev-1', [
      job({ id: 'job-1', payload: { hn: '123456' }, errorCode: 'NO_RESPONSE' }),
    ]);

    const before = await service.getDeviceJobs('dev-1');
    expect(before).toHaveLength(1);
    expect(before[0]!.status).toBe('UNVERIFIED');
    expect(before[0]!.reviewedAt).toBeUndefined();

    expect(await service.setJobReviewed('dev-1', 'job-1', true, 'operator@example.invalid')).toBe(true);

    const after = await service.getDeviceJobs('dev-1');
    expect(after[0]).toMatchObject({
      status: 'UNVERIFIED',
      payload: { hn: '123456' },
      errorCode: 'NO_RESPONSE',
      reviewedBy: 'operator@example.invalid',
    });
    expect(after[0]!.reviewedAt).toEqual(expect.any(String));

    // Un-acknowledging puts it back in front of the operator.
    expect(await service.setJobReviewed('dev-1', 'job-1', false, 'operator@example.invalid')).toBe(true);
    expect((await service.getDeviceJobs('dev-1'))[0]!.reviewedAt).toBeUndefined();
  });

  it('keeps the acknowledgement when the station re-syncs the same job', async () => {
    const service = registry();
    await service.upsertDeviceJobs('dev-1', [job({ id: 'job-1', status: 'UNVERIFIED' })]);
    await service.setJobReviewed('dev-1', 'job-1', true, 'operator');

    // A later heartbeat refreshes the job body (new status/timestamp).
    await service.upsertDeviceJobs('dev-1', [
      job({ id: 'job-1', status: 'UNVERIFIED', updatedAt: '2026-11-18T09:05:00.000Z' }),
    ]);

    const [synced] = await service.getDeviceJobs('dev-1');
    expect(synced!.reviewedAt).toEqual(expect.any(String));
    expect(synced!.updatedAt).toBe('2026-11-18T09:05:00.000Z');
  });

  it('refuses to acknowledge a job it has never seen', async () => {
    const service = registry();
    expect(await service.setJobReviewed('dev-1', 'missing-job', true, 'operator')).toBe(false);
  });
});
