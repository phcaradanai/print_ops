import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';

import { InMemoryPrinterRepository } from './infra/repos/in-memory-printer.repo.js';
import { InMemoryJobRepository } from './infra/repos/in-memory-job.repo.js';
import { InMemoryTraceRepository } from './infra/repos/in-memory-trace.repo.js';
import { InMemoryRunnerRepository } from './infra/repos/in-memory-runner.repo.js';
import { InMemoryAuditRepository } from './infra/repos/in-memory-audit.repo.js';
import { InMemoryUserRepository } from './infra/repos/in-memory-user.repo.js';
import { InMemoryEventBus } from './infra/eventbus/in-memory-eventbus.js';
import { InMemoryJobQueue } from './infra/queue/in-memory-queue.js';
import { InMemoryExportAdapter } from './infra/export/in-memory-export.adapter.js';
import { RbacPermissionPolicy } from './infra/permission/rbac-permission.policy.js';

import { AdapterRegistry, FakePrinterAdapter } from '@printerops/adapters';
import { generateId } from '@printerops/shared';

import { CreatePrinterService } from './services/create-printer.service.js';
import { GetPrinterStatusService } from './services/get-printer-status.service.js';
import { CreatePrintJobService } from './services/create-print-job.service.js';
import { ExecuteJobService } from './services/execute-job.service.js';
import { RegisterRunnerService } from './services/register-runner.service.js';
import { RunnerHeartbeatService } from './services/runner-heartbeat.service.js';
import { ExportJobsService } from './services/export-jobs.service.js';
import { CheckPermissionService } from './services/check-permission.service.js';

import { authRoutes } from './routes/auth.routes.js';
import { printerRoutes } from './routes/printer.routes.js';
import { jobRoutes } from './routes/job.routes.js';
import { runnerRoutes } from './routes/runner.routes.js';
import { auditRoutes } from './routes/audit.routes.js';
import { exportRoutes } from './routes/export.routes.js';

export async function buildApp(opts: { jwtSecret?: string } = {}) {
  const app = Fastify({ logger: true });

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
  const executeJob = new ExecuteJobService(jobRepo, printerRepo, traceRepo, auditRepo, queue, eventBus, registry);
  const registerRunner = new RegisterRunnerService(runnerRepo, auditRepo, eventBus);
  const runnerHeartbeat = new RunnerHeartbeatService(runnerRepo, eventBus);
  const exportJobs = new ExportJobsService(jobRepo, exporter);
  const checkPermission = new CheckPermissionService(permissionPolicy, eventBus);

  // Seed default admin user (MVP only)
  userRepo.seed({
    id: generateId(),
    email: 'admin@printerops.local',
    name: 'Admin',
    role: 'ADMIN',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Routes
  await app.register(async (api) => {
    await authRoutes(api, { users: userRepo });
    await printerRoutes(api, { printers: printerRepo, createPrinter, getPrinterStatus, registry });
    await jobRoutes(api, { jobs: jobRepo, traces: traceRepo, createJob, executeJob });
    await runnerRoutes(api, { runners: runnerRepo, registerRunner, runnerHeartbeat });
    await auditRoutes(api, { audit: auditRepo });
    await exportRoutes(api, { exportJobs });
  });

  return { app, executeJob, queue, jobRepo, printerRepo };
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
}
