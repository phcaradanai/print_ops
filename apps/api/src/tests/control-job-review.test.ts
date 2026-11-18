import { describe, expect, it } from 'vitest';
import type { ControlSyncedJob } from '@printerops/domain';
import {
  InMemoryControlAuditRepository,
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

function registry(audit?: InMemoryControlAuditRepository): WebControlRegistryService {
  return new WebControlRegistryService({
    deviceRegistry: new InMemoryDeviceRegistryRepository(),
    enrollmentTokens: new InMemoryEnrollmentTokenRepository(),
    useSqlite: false,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    ...(audit ? { audit } : {}),
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

  it('audits who acknowledged the outcome, and who reopened it', async () => {
    const audit = new InMemoryControlAuditRepository();
    const service = registry(audit);
    await service.upsertDeviceJobs('dev-1', [job({ id: 'job-1', status: 'UNVERIFIED' })]);

    await service.setJobReviewed('dev-1', 'job-1', true, 'operator@example.invalid');
    await service.setJobReviewed('dev-1', 'job-1', false, 'supervisor@example.invalid');

    const records = await audit.findByDeviceId('dev-1');
    expect(records).toHaveLength(2);
    const acknowledged = records.find((record) => record.action === 'job.reviewed');
    const reopened = records.find((record) => record.action === 'job.unreviewed');
    expect(acknowledged).toMatchObject({
      actor: 'operator@example.invalid',
      deviceId: 'dev-1',
      metadata: { jobId: 'job-1', status: 'UNVERIFIED' },
    });
    expect(reopened!.actor).toBe('supervisor@example.invalid');
  });

  it('does not audit an acknowledgement it refused', async () => {
    const audit = new InMemoryControlAuditRepository();
    const service = registry(audit);
    await service.setJobReviewed('dev-1', 'missing-job', true, 'operator');
    expect(await audit.findByDeviceId('dev-1')).toHaveLength(0);
  });

  it('records what the operator confirmed without rewriting the station status', async () => {
    const service = registry();
    await service.upsertDeviceJobs('dev-1', [job({ id: 'job-1', status: 'UNVERIFIED' })]);

    await service.setJobReviewed('dev-1', 'job-1', true, 'operator', 'PRINTED');
    let [synced] = await service.getDeviceJobs('dev-1');
    expect(synced).toMatchObject({ status: 'UNVERIFIED', reviewedOutcome: 'PRINTED' });

    // Confirming the opposite answer replaces it rather than stacking.
    await service.setJobReviewed('dev-1', 'job-1', true, 'operator', 'NOT_PRINTED');
    [synced] = await service.getDeviceJobs('dev-1');
    expect(synced).toMatchObject({ status: 'UNVERIFIED', reviewedOutcome: 'NOT_PRINTED' });

    // A plain acknowledgement carries no answer, and undo clears everything.
    await service.setJobReviewed('dev-1', 'job-1', true, 'operator');
    [synced] = await service.getDeviceJobs('dev-1');
    expect(synced!.reviewedAt).toEqual(expect.any(String));
    expect(synced!.reviewedOutcome).toBeUndefined();

    await service.setJobReviewed('dev-1', 'job-1', true, 'operator', 'PRINTED');
    await service.setJobReviewed('dev-1', 'job-1', false, 'operator');
    [synced] = await service.getDeviceJobs('dev-1');
    expect(synced!.reviewedAt).toBeUndefined();
    expect(synced!.reviewedOutcome).toBeUndefined();
  });

  it('audits the confirmed outcome with the review record', async () => {
    const audit = new InMemoryControlAuditRepository();
    const service = registry(audit);
    await service.upsertDeviceJobs('dev-1', [job({ id: 'job-1', status: 'UNVERIFIED' })]);
    await service.setJobReviewed('dev-1', 'job-1', true, 'operator', 'NOT_PRINTED');

    const [record] = await audit.findByDeviceId('dev-1');
    expect(record).toMatchObject({
      action: 'job.reviewed',
      metadata: { jobId: 'job-1', status: 'UNVERIFIED', outcome: 'NOT_PRINTED' },
    });
  });
});
