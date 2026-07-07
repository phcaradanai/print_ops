import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';

import { InMemoryPrinterRepository } from './infra/repos/in-memory-printer.repo.js';
import { InMemoryJobRepository } from './infra/repos/in-memory-job.repo.js';
import { InMemoryTraceRepository } from './infra/repos/in-memory-trace.repo.js';
import { InMemoryRunnerRepository } from './infra/repos/in-memory-runner.repo.js';
import { InMemoryAuditRepository } from './infra/repos/in-memory-audit.repo.js';
import { InMemoryUserRepository } from './infra/repos/in-memory-user.repo.js';
import { InMemoryServiceAccountRepository } from './infra/repos/in-memory-service-account.repo.js';
import { InMemoryDiscoveredPrinterRepository } from './infra/repos/in-memory-discovered-printer.repo.js';
import { InMemoryEventBus } from './infra/eventbus/in-memory-eventbus.js';
import { InMemoryJobQueue } from './infra/queue/in-memory-queue.js';
import { InMemoryExportAdapter } from './infra/export/in-memory-export.adapter.js';
import { RbacPermissionPolicy } from './infra/permission/rbac-permission.policy.js';
import { buildApiKeyAuth, hashApiKey, apiKeyPrefix } from './infra/middleware/api-key.js';

import { AdapterRegistry, FakePrinterAdapter } from '@printerops/adapters';
import { generateId } from '@printerops/shared';

import { CreatePrinterService } from './services/create-printer.service.js';
import { GetPrinterStatusService } from './services/get-printer-status.service.js';
import { CreatePrintJobService } from './services/create-print-job.service.js';
import { AcceptExternalJobService } from './services/accept-external-job.service.js';
import { CancelJobService } from './services/cancel-job.service.js';
import { ExecuteJobService } from './services/execute-job.service.js';
import { RegisterRunnerService } from './services/register-runner.service.js';
import { RunnerHeartbeatService } from './services/runner-heartbeat.service.js';
import { ExportJobsService } from './services/export-jobs.service.js';
import { CheckPermissionService } from './services/check-permission.service.js';
import { SyncPrinterDiscoveryService } from './services/sync-printer-discovery.service.js';
import { RegisterDiscoveredPrinterService } from './services/register-discovered-printer.service.js';

import { authRoutes } from './routes/auth.routes.js';
import { printerRoutes } from './routes/printer.routes.js';
import { jobRoutes } from './routes/job.routes.js';
import { runnerRoutes } from './routes/runner.routes.js';
import { auditRoutes } from './routes/audit.routes.js';
import { exportRoutes } from './routes/export.routes.js';
import { v1PrintJobRoutes } from './routes/v1/print-jobs.routes.js';
import { v1PrinterRoutes } from './routes/v1/printers.routes.js';
import { v1ExportRoutes } from './routes/v1/exports.routes.js';
import { v1RunnerPrinterRoutes } from './routes/v1/runner-printers.routes.js';

/** Dev-only API key — override via PRINTOPS_DEV_API_KEY env var */
export const DEV_API_KEY =
  process.env['PRINTOPS_DEV_API_KEY'] ?? 'printops-dev-apikey-2026';

export async function buildApp(opts: { jwtSecret?: string } = {}) {
  const app = Fastify({
    logger: {
      redact: ['req.headers.authorization', 'req.headers["x-api-key"]', 'body.payload'],
    },
  });

  await app.register(cors, { origin: true });
  await app.register(jwt, {
    secret: opts.jwtSecret ?? process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production',
  });

  app.decorate('authenticate', async function (req: FastifyRequest, reply: FastifyReply) {
    try {
      await req.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });

  // Infra
  const printerRepo = new InMemoryPrinterRepository();
  const jobRepo = new InMemoryJobRepository();
  const traceRepo = new InMemoryTraceRepository();
  const runnerRepo = new InMemoryRunnerRepository();
  const auditRepo = new InMemoryAuditRepository();
  const userRepo = new InMemoryUserRepository();
  const serviceAccountRepo = new InMemoryServiceAccountRepository();
  const discoveredPrinterRepo = new InMemoryDiscoveredPrinterRepository();
  const eventBus = new InMemoryEventBus();
  const queue = new InMemoryJobQueue();
  const exporter = new InMemoryExportAdapter();
  const permissionPolicy = new RbacPermissionPolicy();

  // Adapter registry
  const registry = new AdapterRegistry();
  registry.registerAdapter(new FakePrinterAdapter());

  // Services
  const createPrinter = new CreatePrinterService(printerRepo, eventBus, auditRepo);
  const getPrinterStatus = new GetPrinterStatusService(printerRepo, registry);
  const createJob = new CreatePrintJobService(jobRepo, printerRepo, queue, traceRepo, auditRepo, eventBus);
  const acceptExternalJob = new AcceptExternalJobService(jobRepo, printerRepo, queue, traceRepo, auditRepo, eventBus);
  const cancelJob = new CancelJobService(jobRepo, traceRepo, auditRepo, eventBus);
  const executeJob = new ExecuteJobService(jobRepo, printerRepo, traceRepo, auditRepo, queue, eventBus, registry);
  const registerRunner = new RegisterRunnerService(runnerRepo, auditRepo, eventBus);
  const runnerHeartbeat = new RunnerHeartbeatService(runnerRepo, eventBus);
  const exportJobs = new ExportJobsService(jobRepo, exporter);
  const checkPermission = new CheckPermissionService(permissionPolicy, eventBus);
  const syncDiscovery = new SyncPrinterDiscoveryService(discoveredPrinterRepo, runnerRepo);
  const registerDiscovered = new RegisterDiscoveredPrinterService(discoveredPrinterRepo, printerRepo, auditRepo, checkPermission);

  // API key middleware
  const apiKeyHook = buildApiKeyAuth(serviceAccountRepo);

  // Seed default local users. MVP auth accepts any password for these accounts.
  for (const user of [
    { email: 'sysadmin@printerops.local', name: 'Sysadmin', role: 'OWNER' as const },
    { email: 'admin@printerops.local', name: 'Admin', role: 'ADMIN' as const },
    { email: 'user@printerops.local', name: 'User', role: 'OPERATOR' as const },
    { email: 'viewer@printerops.local', name: 'Viewer', role: 'VIEWER' as const },
  ]) {
    userRepo.seed({
      id: generateId(),
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Seed dev service account
  const devKey = DEV_API_KEY;
  serviceAccountRepo.seed({
    id: generateId(),
    name: 'Dev Integration Service',
    sourceSystem: 'integration-service',
    apiKeyHash: hashApiKey(devKey),
    apiKeyPrefix: apiKeyPrefix(devKey),
    isActive: true,
    allowedPrinterCodes: [],
    allowedTemplateCodes: [],
    maxCopiesPerJob: 100,
    maxPayloadBytes: 65536,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Seed sample printers for dev
  await printerRepo.create({
    code: 'LAB_LABEL_01',
    name: 'Lab Label Printer (Fake)',
    location: 'Lab Room A',
    protocol: 'fake',
    connectionUri: 'fake://lab-label-01',
    isActive: true,
    allowedTemplates: ['default-label', 'barcode-label', 'patient-label'],
    maxCopiesPerJob: 10,
    metadata: { model: 'FakeZebra', dpi: 203 },
  });

  await printerRepo.create({
    code: 'OFFICE_LASER_01',
    name: 'Office Laser Printer (Fake)',
    location: 'Admin Office',
    protocol: 'fake',
    connectionUri: 'fake://office-laser-01',
    isActive: true,
    maxCopiesPerJob: 50,
    metadata: { model: 'FakeLaser' },
  });

  // Routes — legacy internal API
  await app.register(async (api) => {
    await authRoutes(api, { users: userRepo });
    await printerRoutes(api, { printers: printerRepo, createPrinter, getPrinterStatus, registry });
    await jobRoutes(api, { jobs: jobRepo, traces: traceRepo, createJob, executeJob });
    await runnerRoutes(api, { runners: runnerRepo, jobs: jobRepo, registerRunner, runnerHeartbeat });
    await auditRoutes(api, { audit: auditRepo });
    await exportRoutes(api, { exportJobs, audit: auditRepo, printers: printerRepo, exporter });
  });

  // Routes — external API v1
  await app.register(async (v1) => {
    await v1PrintJobRoutes(v1, { jobs: jobRepo, traces: traceRepo, acceptExternalJob, cancelJob, executeJob, apiKeyHook });
    await v1PrinterRoutes(v1, { printers: printerRepo, getPrinterStatus, apiKeyHook });
    await v1ExportRoutes(v1, { exportJobs, audit: auditRepo, exporter, apiKeyHook });
    await v1RunnerPrinterRoutes(v1, { discoveredPrinters: discoveredPrinterRepo, syncDiscovery, registerDiscovered });
  }, { prefix: '/api/v1' });

  return { app, executeJob, queue, jobRepo, printerRepo, serviceAccountRepo, DEV_API_KEY: devKey };
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
}
