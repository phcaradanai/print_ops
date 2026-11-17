import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app.js';
import type { JobRepositoryPort, PrinterRepositoryPort } from '@printerops/domain';

describe('Web Control Incoming Jobs & Display Name API', () => {
  let app: FastifyInstance;
  let jobRepo: JobRepositoryPort;
  let printerRepo: PrinterRepositoryPort;
  let ownerToken: string;
  let viewerToken: string;
  let releasesDirectory: string;

  beforeEach(async () => {
    releasesDirectory = mkdtempSync(join(tmpdir(), 'printops-control-jobs-'));
    process.env['PRINTOPS_RELEASES_DIR'] = releasesDirectory;
    process.env['DB_MODE'] = 'memory';
    process.env['PRINTOPS_DEV_SEED'] = 'true';

    const built = await buildApp();
    app = built.app;
    jobRepo = built.jobRepo;
    printerRepo = built.printerRepo;

    const ownerRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'sysadmin@printerops.local',
        password: 'Dev-password1!',
      },
    });
    ownerToken = (ownerRes.json() as { token: string }).token;

    const viewerRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'viewer@printerops.local',
        password: 'Dev-password1!',
      },
    });
    viewerToken = (viewerRes.json() as { token: string }).token;
  });

  afterEach(async () => {
    await app.close();
    delete process.env['PRINTOPS_RELEASES_DIR'];
    rmSync(releasesDirectory, { recursive: true, force: true });
  });

  it('updates displayName via PATCH and preserves custom displayName on re-announce', async () => {
    const announced = await app.inject({
      method: 'POST',
      url: '/api/v1/control/announce',
      payload: {
        installationId: 'inst_opd_01',
        hostname: 'opd-pc-01',
        platform: 'windows-x64',
        appVersion: '1.2.0',
        schemaVersion: 11,
      },
    });
    expect(announced.statusCode).toBe(200);
    const { deviceId } = announced.json() as { deviceId: string };

    // VIEWER cannot rename
    const forbiddenRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/control/devices/${deviceId}`,
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { displayName: 'Should Fail' },
    });
    expect(forbiddenRes.statusCode).toBe(403);

    // OWNER updates displayName & siteId
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/control/devices/${deviceId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        displayName: 'OPD Counter #1',
        siteId: 'clinic-fl2',
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json() as { displayName: string; siteId: string };
    expect(patched.displayName).toBe('OPD Counter #1');
    expect(patched.siteId).toBe('clinic-fl2');

    // Oversized displayName fails validation
    const badPatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/control/devices/${deviceId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { displayName: 'x'.repeat(129) },
    });
    expect(badPatch.statusCode).toBe(400);

    // Re-announce with different default hostname must NOT overwrite custom displayName
    const reAnnounce = await app.inject({
      method: 'POST',
      url: '/api/v1/control/announce',
      payload: {
        installationId: 'inst_opd_01',
        hostname: 'opd-pc-01-renamed',
        platform: 'windows-x64',
        appVersion: '1.2.0',
        schemaVersion: 11,
      },
    });
    expect(reAnnounce.statusCode).toBe(200);

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/control/devices/${deviceId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json() as { displayName: string; siteId: string };
    expect(detail.displayName).toBe('OPD Counter #1');
  });

  it('aggregates incoming payload key-values and error breakdowns in GET /api/v1/control/jobs and supports remote reprint', async () => {
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/control/enrollment-tokens',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { siteId: 'pharmacy-bkk', expiresInSeconds: 3600 },
    });
    const { token: enrollToken } = tokenRes.json() as { token: string };

    const enrollRes = await app.inject({
      method: 'POST',
      url: '/api/v1/control/enroll',
      payload: {
        enrollmentToken: enrollToken,
        installationId: 'inst_pharm_01',
        hostname: 'pharm-station-01',
        platform: 'windows-x64',
        architecture: 'x64',
        appVersion: '1.2.0',
        schemaVersion: 11,
        runnerVersion: '1.2.0',
        displayName: 'Pharmacy Sticker Line',
      },
    });
    expect(enrollRes.statusCode).toBe(201);
    const { deviceId, deviceToken } = enrollRes.json() as {
      deviceId: string;
      deviceToken: string;
    };

    // Push incoming synced jobs using deviceToken (simulating satellite PrintOps station)
    const pushRes = await app.inject({
      method: 'POST',
      url: `/api/v1/control/devices/${deviceId}/jobs`,
      headers: { 'x-device-token': deviceToken },
      payload: {
        jobs: [
          {
            id: 'job_remote_ok_1',
            deviceId,
            requestId: 'REQ-RX-1001',
            printerId: 'prn_zpl_01',
            printerCode: 'PHARM-ZPL-01',
            templateCode: 'RX_STICKER',
            sourceSystem: 'HIS',
            status: 'SUCCESS',
            copies: 1,
            payload: {
              hn: 'HN-68001',
              patient_name: 'Somchai Jaidee',
              drug_name: 'Paracetamol 500mg',
              apiKey: 'should-be-stripped-by-redaction',
            },
            createdAt: '2026-11-17T08:00:00.000Z',
          },
          {
            id: 'job_remote_err_2',
            deviceId,
            requestId: 'REQ-RX-1002',
            printerId: 'prn_zpl_01',
            printerCode: 'PHARM-ZPL-01',
            templateCode: 'RX_STICKER',
            sourceSystem: 'HIS',
            status: 'FAILED',
            copies: 2,
            errorCode: 'PAPER_OUT',
            errorMessage: 'Media sensor out of labels',
            payload: {
              hn: 'HN-68002',
              patient_name: 'Suda Dee',
              ward: 'OPD-2',
            },
            createdAt: '2026-11-17T08:05:00.000Z',
          },
        ],
      },
    });
    expect(pushRes.statusCode).toBe(200);
    expect((pushRes.json() as { syncedCount: number }).syncedCount).toBe(2);

    const fleetRes = await app.inject({
      method: 'GET',
      url: '/api/v1/control/jobs',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(fleetRes.statusCode).toBe(200);

    const fleet = fleetRes.json() as {
      summary: {
        totalDevices: number;
        totalJobs: number;
        successJobs: number;
        failedJobs: number;
        errorBreakdown: Array<{ deviceId: string; errorCode: string; count: number }>;
      };
      devices: Array<{
        deviceId: string;
        displayName?: string;
        payloadKeys: string[];
        stats: {
          totalJobs: number;
          successJobs: number;
          failedJobs: number;
          latestError: { jobId: string; errorCode?: string } | null;
        };
        jobs: Array<{ id: string; payload: Record<string, unknown> }>;
      }>;
    };

    expect(fleet.summary.totalJobs).toBeGreaterThanOrEqual(2);
    expect(fleet.summary.failedJobs).toBeGreaterThanOrEqual(1);
    expect(
      fleet.summary.errorBreakdown.some(
        (item) => item.deviceId === deviceId && item.errorCode === 'PAPER_OUT' && item.count === 1,
      ),
    ).toBe(true);

    const station = fleet.devices.find((d) => d.deviceId === deviceId);
    expect(station).toBeDefined();
    expect(station?.displayName).toBe('Pharmacy Sticker Line');
    expect(station?.payloadKeys).toEqual(
      expect.arrayContaining(['hn', 'patient_name', 'drug_name', 'ward']),
    );
    expect(station?.payloadKeys).not.toContain('apiKey');
    expect(station?.stats.latestError?.jobId).toBe('job_remote_err_2');

    // Remote re-print rejects missing confirmedDuplicateRisk
    const rejectReprint = await app.inject({
      method: 'POST',
      url: `/api/v1/control/devices/${deviceId}/jobs/job_remote_ok_1/reprint`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { copies: 1, reason: 'Forgot duplicate check', confirmedDuplicateRisk: false },
    });
    expect(rejectReprint.statusCode).toBe(400);

    // Remote re-print succeeds with confirmation and preserves incoming payload
    const okReprint = await app.inject({
      method: 'POST',
      url: `/api/v1/control/devices/${deviceId}/jobs/job_remote_ok_1/reprint`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        copies: 2,
        reason: 'Label damaged on first print',
        confirmedDuplicateRisk: true,
      },
    });
    expect(okReprint.statusCode).toBe(201);
    const reprinted = okReprint.json() as {
      status: string;
      copies: number;
      reprintOfJobId: string;
      payload: Record<string, unknown>;
    };
    expect(reprinted.status).toBe('QUEUED');
    expect(reprinted.copies).toBe(2);
    expect(reprinted.reprintOfJobId).toBe('job_remote_ok_1');
    expect(reprinted.payload['hn']).toBe('HN-68001');
    expect(reprinted.payload['patient_name']).toBe('Somchai Jaidee');
  });

  it('preserves incoming payload metadata when creating local reprints and exposes safe payload in GET /api/jobs', async () => {
    const printers = await printerRepo.findAll();
    const printerId = printers[0]?.id;
    expect(printerId).toBeTruthy();

    // Seed an external job directly with incoming metadata.payload
    const accepted = await jobRepo.create({
      id: 'job_ext_payload_1',
      traceId: 'trace_ext_1',
      correlationId: 'corr_ext_1',
      printerId: printerId!,
      createdBy: 'usr_his',
      mimeType: 'application/zpl',
      copies: 1,
      duplex: false,
      colorMode: 'monochrome',
      priority: 1,
      requestId: 'REQ-EXT-001',
      sourceSystem: 'HIS',
      sourceReference: 'VISIT-99',
      renderedPrintPayload: '^XA^FO50,50^ADN,36,20^FDHN-99100^FS^XZ',
      payloadSnapshot: 'keys=[hn,patient_name,apiToken] len=42',
      metadata: {
        payload: {
          hn: 'HN-99100',
          patient_name: 'Niran Suk',
          apiToken: 'must-not-leak',
        },
      },
    });
    await jobRepo.update(accepted.id, {
      status: 'FAILED',
      errorCode: 'SPOOLER_ERR',
      errorMessage: 'Printer cover open',
    });

    // Public list includes persisted incoming metadata.payload
    const jobsRes = await app.inject({
      method: 'GET',
      url: '/api/jobs',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(jobsRes.statusCode).toBe(200);
    const jobList = jobsRes.json() as Array<{
      id: string;
      metadata: { payload?: Record<string, unknown> };
    }>;
    const found = jobList.find((j) => j.id === accepted.id);
    expect(found?.metadata.payload).toEqual({
      hn: 'HN-99100',
      patient_name: 'Niran Suk',
      apiToken: 'must-not-leak',
    });

    // Local reprint preserves metadata payload
    const reprintRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${accepted.id}/reprint`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        printerId,
        copies: 2,
        reason: 'Reprint after closing cover',
        confirmedDuplicateRisk: true,
      },
    });
    expect(reprintRes.statusCode).toBe(201);
    const reprintedJob = reprintRes.json() as {
      id: string;
      metadata: { payload?: Record<string, unknown> };
    };
    expect(reprintedJob.metadata.payload).toEqual({
      hn: 'HN-99100',
      patient_name: 'Niran Suk',
      apiToken: 'must-not-leak',
    });

    // Control jobs sync exposes safe redacted payload without apiToken
    const controlJobsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/control/jobs',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(controlJobsRes.statusCode).toBe(200);
    const fleet = controlJobsRes.json() as {
      devices: Array<{
        jobs: Array<{ id: string; payload: Record<string, unknown> }>;
      }>;
    };
    const syncedOriginal = fleet.devices
      .flatMap((d) => d.jobs)
      .find((j) => j.id === accepted.id);
    expect(syncedOriginal?.payload).toEqual({
      hn: 'HN-99100',
      patient_name: 'Niran Suk',
    });

    const syncedReprint = fleet.devices
      .flatMap((d) => d.jobs)
      .find((j) => j.id === reprintedJob.id);
    expect(syncedReprint?.payload).toEqual({
      hn: 'HN-99100',
      patient_name: 'Niran Suk',
    });
  });
});
