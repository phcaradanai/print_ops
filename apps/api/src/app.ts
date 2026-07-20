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
import { InMemoryPrintTemplateRepository } from './infra/repos/in-memory-template.repo.js';
import { InMemoryPaperProfileRepository } from './infra/repos/in-memory-paper-profile.repo.js';
import { InMemoryPrinterTemplateBindingRepository } from './infra/repos/in-memory-template-binding.repo.js';
import { InMemoryWebhookEndpointRepository, InMemoryWebhookRoutePolicyRepository } from './infra/repos/in-memory-webhook.repo.js';
import { InMemoryImportedDesignRepository } from './infra/repos/in-memory-imported-design.repo.js';

import { SqlitePrinterRepository } from './infra/repos/sqlite/sqlite-printer.repo.js';
import { SqliteJobRepository } from './infra/repos/sqlite/sqlite-job.repo.js';
import { SqliteTraceRepository } from './infra/repos/sqlite/sqlite-trace.repo.js';
import { SqliteRunnerRepository } from './infra/repos/sqlite/sqlite-runner.repo.js';
import { SqliteAuditRepository } from './infra/repos/sqlite/sqlite-audit.repo.js';
import { SqliteUserRepository } from './infra/repos/sqlite/sqlite-user.repo.js';
import { SqliteServiceAccountRepository } from './infra/repos/sqlite/sqlite-service-account.repo.js';
import { SqliteDiscoveredPrinterRepository } from './infra/repos/sqlite/sqlite-discovered-printer.repo.js';
import { SqlitePrintTemplateRepository } from './infra/repos/sqlite/sqlite-template.repo.js';
import { SqlitePaperProfileRepository } from './infra/repos/sqlite/sqlite-paper-profile.repo.js';
import { SqlitePrinterTemplateBindingRepository } from './infra/repos/sqlite/sqlite-printer-template-binding.repo.js';
import { SqliteWebhookEndpointRepository } from './infra/repos/sqlite/sqlite-webhook-endpoint.repo.js';
import { SqliteWebhookRoutePolicyRepository } from './infra/repos/sqlite/sqlite-webhook-route-policy.repo.js';
import { SqliteImportedDesignRepository } from './infra/repos/sqlite/sqlite-imported-design.repo.js';

import { InMemoryEventBus } from './infra/eventbus/in-memory-eventbus.js';
import { InMemoryJobQueue } from './infra/queue/in-memory-queue.js';
import { InMemoryExportAdapter } from './infra/export/in-memory-export.adapter.js';
import { RbacPermissionPolicy } from './infra/permission/rbac-permission.policy.js';
import { buildApiKeyAuth, hashApiKey, apiKeyPrefix } from './infra/middleware/api-key.js';
import { SimpleTemplateRenderer } from './infra/template/simple-template-renderer.js';

import { AdapterRegistry, FakePrinterAdapter, WindowsSpoolerAdapter } from '@printerops/adapters';
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
import { DynamicIntakeService } from './services/dynamic-intake.service.js';
import { ImportPaperProfileService } from './services/import-paper-profile.service.js';
import { SandboxService } from './services/sandbox.service.js';
import { PrinterConnectivityService } from './services/printer-connectivity.service.js';

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
import { v1RunnerJobRoutes } from './routes/v1/runner-jobs.routes.js';
import { templateRoutes } from './routes/v1/template.routes.js';
import { webhookRoutes } from './routes/v1/webhook.routes.js';
import { paperProfileImportRoutes } from './routes/v1/paper-profile-imports.routes.js';
import { sandboxRoutes } from './routes/v1/sandbox.routes.js';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';

/** Dev-only API key — override via PRINTOPS_DEV_API_KEY env var */
export const DEV_API_KEY =
  process.env['PRINTOPS_DEV_API_KEY'] ?? 'printops-dev-apikey-2026';

// __dirname is available in the CJS bundle produced by esbuild/pkg
declare var __dirname: string;

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

  // Infra — use SQLite when DB_MODE=sqlite, otherwise in-memory
  const dbMode = process.env['DB_MODE'] ?? 'memory';
  const useSqlite = dbMode === 'sqlite';

  const printerRepo = useSqlite ? new SqlitePrinterRepository() : new InMemoryPrinterRepository();
  const jobRepo = useSqlite ? new SqliteJobRepository() : new InMemoryJobRepository();
  const traceRepo = useSqlite ? new SqliteTraceRepository() : new InMemoryTraceRepository();
  const runnerRepo = useSqlite ? new SqliteRunnerRepository() : new InMemoryRunnerRepository();
  const auditRepo = useSqlite ? new SqliteAuditRepository() : new InMemoryAuditRepository();
  const userRepo = useSqlite ? new SqliteUserRepository() : new InMemoryUserRepository();
  const serviceAccountRepo = useSqlite ? new SqliteServiceAccountRepository() : new InMemoryServiceAccountRepository();
  const discoveredPrinterRepo = useSqlite ? new SqliteDiscoveredPrinterRepository() : new InMemoryDiscoveredPrinterRepository();
  const templateRepo = useSqlite ? new SqlitePrintTemplateRepository() : new InMemoryPrintTemplateRepository();
  const paperRepo = useSqlite ? new SqlitePaperProfileRepository() : new InMemoryPaperProfileRepository();
  const bindingRepo = useSqlite ? new SqlitePrinterTemplateBindingRepository() : new InMemoryPrinterTemplateBindingRepository();
  const webhookEndpointRepo = useSqlite ? new SqliteWebhookEndpointRepository() : new InMemoryWebhookEndpointRepository();
  const webhookPolicyRepo = useSqlite ? new SqliteWebhookRoutePolicyRepository() : new InMemoryWebhookRoutePolicyRepository();
  const importedDesignRepo = useSqlite ? new SqliteImportedDesignRepository() : new InMemoryImportedDesignRepository();
  const eventBus = new InMemoryEventBus();
  const queue = new InMemoryJobQueue();
  const exporter = new InMemoryExportAdapter();
  const permissionPolicy = new RbacPermissionPolicy();
  const templateRenderer = new SimpleTemplateRenderer();

  // Adapter registry
  const registry = new AdapterRegistry();
  registry.registerAdapter(new FakePrinterAdapter());
  registry.registerAdapter(new WindowsSpoolerAdapter());

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
  const dynamicIntake = new DynamicIntakeService(
    webhookEndpointRepo,
    webhookPolicyRepo,
    templateRepo,
    paperRepo,
    bindingRepo,
    jobRepo,
    printerRepo,
    queue,
    traceRepo,
    auditRepo,
    eventBus,
    templateRenderer
  );

  const importPaperProfile = new ImportPaperProfileService(
    paperRepo,
    importedDesignRepo,
    auditRepo,
  );

  const sandboxSvc = new SandboxService(templateRepo, paperRepo, templateRenderer, createJob);
  const connectivitySvc = new PrinterConnectivityService(printerRepo, registry);

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
    name: 'Lab Label Printer (EPSON L15160)',
    location: 'Lab Room A',
    protocol: 'windows_spooler',
    connectionUri: 'spooler://sandbox-runner/' + encodeURIComponent('EPSON4F6A3C (L15160 Series)'),
    isActive: true,
    allowedTemplates: ['default-label', 'barcode-label', 'patient-label', 'LAB_LABEL_DEFAULT', 'BARCODE_LABEL_DEFAULT', 'TEST_LABEL'],
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

  const label100x50 = await paperRepo.create({
    code: 'LABEL_100X50',
    name: 'Label 100 x 50 mm',
    widthMm: 100,
    heightMm: 50,
    marginTopMm: 2,
    marginRightMm: 2,
    marginBottomMm: 2,
    marginLeftMm: 2,
    dpi: 203,
    orientation: 'portrait',
    unit: 'mm',
  });

  await paperRepo.create({
    code: 'LABEL_80X50',
    name: 'Label 80 x 50 mm',
    widthMm: 80,
    heightMm: 50,
    marginTopMm: 2,
    marginRightMm: 2,
    marginBottomMm: 2,
    marginLeftMm: 2,
    dpi: 203,
    orientation: 'portrait',
    unit: 'mm',
  });

  await templateRepo.create({
    templateCode: 'LAB_LABEL_DEFAULT',
    name: 'Lab Label Default',
    description: 'Default lab label template',
    engine: 'RAW_TEXT',
    content: 'LAB {{label}}\nBARCODE {{barcode}}\nHN {{hn_masked}}',
    paperProfileId: label100x50.id,
    status: 'PUBLISHED',
    createdBy: 'seed',
  });

  await templateRepo.create({
    templateCode: 'BARCODE_LABEL_DEFAULT',
    name: 'Barcode Label Default',
    engine: 'ZPL',
    content: '^XA\n^FO40,40^FD{{label}}^FS\n^FO40,80^BCN,80,Y,N,N^FD{{barcode}}^FS\n^XZ',
    paperProfileId: label100x50.id,
    status: 'PUBLISHED',
    createdBy: 'seed',
  });

  await templateRepo.create({
    templateCode: 'TEST_LABEL',
    name: 'Test Label',
    engine: 'RAW_TEXT',
    content: 'TEST {{label}}\n{{barcode}}',
    paperProfileId: label100x50.id,
    status: 'PUBLISHED',
    createdBy: 'seed',
  });

  await bindingRepo.create({
    printerCode: 'LAB_LABEL_01',
    templateCode: 'LAB_LABEL_DEFAULT',
    paperProfileId: label100x50.id,
    isDefault: true,
    enabled: true,
  });

  const labPolicy = await webhookPolicyRepo.create({
    policyCode: 'lab-label-static',
    name: 'Lab Label Static',
    matchRules: { when: [{ field: 'type', op: 'eq', value: 'lab_label' }] },
    printerMapping: { strategy: 'static', printer_code: 'LAB_LABEL_01' },
    templateMapping: { strategy: 'static', template_code: 'LAB_LABEL_DEFAULT' },
    payloadMapping: { barcode: '$.barcode', label: '$.label', hn_masked: '$.hn' },
    priorityMapping: { strategy: 'static', priority: 'normal' },
    enabled: true,
  });

  await webhookEndpointRepo.create({
    endpointCode: 'dev-intake',
    name: 'Development Intake',
    sourceSystem: 'integration-service',
    authMode: 'NONE',
    enabled: true,
    routePolicyId: labPolicy.id,
  });

  // Health check (no auth)
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

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
    await v1RunnerJobRoutes(v1, { jobs: jobRepo, printers: printerRepo, traces: traceRepo, audit: auditRepo, events: eventBus });
    await templateRoutes(v1, { templates: templateRepo, papers: paperRepo, bindings: bindingRepo, printers: printerRepo, renderer: templateRenderer, audit: auditRepo });
    await sandboxRoutes(v1, { sandbox: sandboxSvc, connectivity: connectivitySvc, audit: auditRepo });
    await webhookRoutes(v1, { endpoints: webhookEndpointRepo, policies: webhookPolicyRepo, templates: templateRepo, papers: paperRepo, renderer: templateRenderer, intake: dynamicIntake, audit: auditRepo, createJob, executeJob });
    await paperProfileImportRoutes(v1, { importService: importPaperProfile });
  }, { prefix: '/api/v1', bodyLimit: 12 * 1024 * 1024 });

  // Landing page — serve Vite index.html if available, otherwise inline UI
  const staticRoots = [
    join(dirname(process.execPath), 'static'),          // next to .exe
    join(process.cwd(), '..', 'web', 'dist'),            // dev mode (tsx)
  ];
  if (typeof __dirname === 'string') {
    staticRoots.unshift(join(__dirname, 'static'));      // pkg snapshot
  }

  app.get('/', async (_req, reply) => {
    for (const root of staticRoots) {
      try { return reply.type('text/html').send(readFileSync(join(root, 'index.html'))); } catch {}
    }
    // Fallback inline UI
    return reply.type('text/html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PrinterOps</title><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1e1e2e;color:#cdd6f4}a{color:#89b4fa}</style></head><body><div style="text-align:center;max-width:400px"><h1 style="font-size:2rem;margin-bottom:.5rem">🖨️ PrinterOps</h1><p style="color:#a6adc8">Print Gateway — API + Dashboard</p><div style="margin:2rem 0"><p>✅ API running on port ${process.env['PORT'] ?? 3001}</p><p>📋 <a href="/api/v1/templates">Templates</a> · <a href="/api/v1/sandbox/run">Sandbox</a></p><p>🔌 <a href="/api/v1/connectivity/report">Connectivity Report</a></p></div></div></body></html>`);
  });

  // Serve static files (JS, CSS, assets) for unmatched GET/HEAD
  app.setNotFoundHandler(async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return reply.status(404).send({ error: 'Not found' });
    }
    const urlPath = new URL(req.url, 'http://x').pathname;
    const tryPath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;

    for (const root of staticRoots) {
      try { return reply.send(readFileSync(join(root, tryPath))); } catch {}
    }
    // SPA fallback
    for (const root of staticRoots) {
      try { return reply.send(readFileSync(join(root, 'index.html'))); } catch {}
    }
    return reply.status(404).send({ error: 'Not found' });
  });

  return { app, executeJob, queue, jobRepo, printerRepo, serviceAccountRepo, DEV_API_KEY: devKey };
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
}
