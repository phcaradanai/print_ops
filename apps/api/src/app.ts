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
import { InMemoryIntakeAttemptRepository } from './infra/repos/in-memory-intake-attempt.repo.js';
import { InMemoryWebhookCallbackAttemptRepository } from './infra/repos/in-memory-webhook-callback-attempt.repo.js';

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
import { ResolvePrinterBindingService } from './services/resolve-printer-binding.service.js';
import { DynamicPrintService } from './services/dynamic-print.service.js';
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
import { v1PrinterPrintRoutes } from './routes/v1/printer-print.routes.js';
import { v1PrinterRoutes } from './routes/v1/printers.routes.js';
import { v1ExportRoutes } from './routes/v1/exports.routes.js';
import { v1RunnerPrinterRoutes } from './routes/v1/runner-printers.routes.js';
import { v1RunnerJobRoutes } from './routes/v1/runner-jobs.routes.js';
import { templateRoutes } from './routes/v1/template.routes.js';
import { webhookRoutes } from './routes/v1/webhook.routes.js';
import { v1UserRoutes } from './routes/v1/users.routes.js';
import { WebhookCallbackService, type NatsPublisher } from './services/webhook-callback.service.js';
import { InMemoryCallbackDeliveryRepository } from './infra/repos/in-memory-callback-delivery.repo.js';
import { SqliteCallbackDeliveryRepository } from './infra/repos/sqlite/sqlite-callback-delivery.repo.js';
import {
  ResultCallbackDispatcher,
  type CallbackHttpSender,
  type CallbackNatsSender,
} from './services/result-callback-dispatcher.js';
import { retryPolicyFromEnv } from './services/callback-retry-policy.js';
import { paperProfileImportRoutes } from './routes/v1/paper-profile-imports.routes.js';
import { sandboxRoutes } from './routes/v1/sandbox.routes.js';
import { printIntakeConfigFromEnv, type PrintIntakeConfig } from './infra/nats/print-intake.js';
import { NatsConnectionManager } from './infra/nats/nats-connection-manager.js';
import { v1PrintFlowRoutes } from './routes/v1/print-flow.routes.js';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { initDatabase, getDb } from './infra/db/sqlite.js';
import { pruneOldRecords, retentionDaysFromEnv, retentionMaxRowsFromEnv } from './infra/db/retention.js';
import { ReprintJobService } from './services/reprint-job.service.js';
import { IntakeOutcomeCallbackService } from './services/intake-outcome-callback.service.js';
import { runtimeArchitectureFromEnv } from './infra/runtime-architecture.js';

/** Dev-only API key — override via PRINTOPS_DEV_API_KEY env var */
export const DEV_API_KEY =
  process.env['PRINTOPS_DEV_API_KEY'] ?? 'printops-dev-apikey-2026';

// Webhook HTTP callback sender (best-effort). Used by WebhookCallbackService
// to POST a JSON payload to a caller-supplied URL after a job is accepted.
async function httpCallbackSender(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`webhook callback HTTP ${res.status} to ${url}`);
  }
}

/**
 * HTTP sender for TERMINAL result callbacks.
 *
 * Deliberately different from `httpCallbackSender` above: it resolves for any
 * response, including 5xx, and hands back the status code. The retry policy has
 * to distinguish "receiver is down, try again" (5xx/408/429) from "receiver
 * rejected this request, stop" (most 4xx), and a sender that throws a string on
 * every non-2xx cannot carry that distinction. It also enforces a request
 * timeout, so one hung receiver cannot pin a delivery slot forever.
 */
const resultCallbackHttpSender: CallbackHttpSender = async (url, body, opts) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: opts.headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let bodyExcerpt: string | undefined;
    try {
      // Bounded: a receiver returning a megabyte of HTML must not end up in the
      // delivery record an operator reads.
      bodyExcerpt = (await res.text()).slice(0, 500) || undefined;
    } catch {
      bodyExcerpt = undefined;
    }
    return { status: res.status, bodyExcerpt };
  } finally {
    clearTimeout(timer);
  }
};

// __dirname is available in the CJS bundle produced by esbuild/pkg
declare var __dirname: string;

export async function buildApp(opts: { jwtSecret?: string } = {}) {
  const runtimeArchitecture = runtimeArchitectureFromEnv();
  const app = Fastify({
    logger: {
      redact: ['req.headers.authorization', 'req.headers["x-api-key"]', 'body.payload'],
    },
  });

  // CORS origin is reflect-any by default (`origin: true`) because this is a
  // LAN-only print gateway authenticated by bearer JWT / X-Api-Key header,
  // not cookies, so reflecting the origin does not by itself grant a
  // cross-site attacker anything a same-site request couldn't already do.
  // Set CORS_ALLOWED_ORIGINS (comma-separated) to lock it down once the
  // gateway is reachable from anywhere less trusted than a local network.
  const corsAllowedOriginsEnv = process.env['CORS_ALLOWED_ORIGINS'];
  const corsOrigin = corsAllowedOriginsEnv
    ? corsAllowedOriginsEnv.split(',').map((origin) => origin.trim()).filter(Boolean)
    : true;
  await app.register(cors, { origin: corsOrigin });

  const jwtSecret = opts.jwtSecret ?? process.env['JWT_SECRET'];
  if (!jwtSecret) {
    // The desktop shell (apps/desktop/src-tauri) generates and injects a real
    // per-installation JWT_SECRET for server.exe, so a properly packaged
    // desktop build never hits this branch. Any other deployment path
    // (Docker, bare `node`, CI) that reaches production without setting
    // JWT_SECRET would otherwise sign every login with a secret that is
    // public in source control — refuse to start rather than do that quietly.
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        'JWT_SECRET must be set when NODE_ENV=production. Refusing to start with the public dev-only fallback secret.',
      );
    }
    app.log.warn(
      'JWT_SECRET is not set; using an insecure development-only fallback. ' +
        'Set JWT_SECRET (or NODE_ENV=production, which will refuse to start without it) before deploying.',
    );
  }
  await app.register(jwt, {
    secret: jwtSecret ?? 'dev-secret-change-in-production',
  });

  app.decorate('authenticate', async function (req: FastifyRequest, reply: FastifyReply) {
    try {
      await req.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });

  // Infra — use SQLite when DB_MODE=sqlite, otherwise in-memory.
  // Repositories rely on the sql.js singleton, so initialise it before any
  // repository is constructed or seeded.
  const dbMode = process.env['DB_MODE'] ?? 'memory';
  const useSqlite = dbMode === 'sqlite';
  if (useSqlite) await initDatabase();

  // Bound the growth of jobs/traces/audit_logs on long-running installs (see
  // infra/db/retention.ts) — this gateway is not the system of record for
  // print/job history, so a short window (default 7 days / 1000 rows,
  // whichever is smaller) is enough. Runs once at boot and then daily;
  // disable with PRINTOPS_RETENTION_DAYS=0 and PRINTOPS_RETENTION_MAX_ROWS=0.
  let retentionTimer: ReturnType<typeof setInterval> | undefined;
  if (useSqlite) {
    const retentionDays = retentionDaysFromEnv();
    const retentionMaxRows = retentionMaxRowsFromEnv();
    const runRetentionSweep = () => {
      try {
        const result = pruneOldRecords(getDb(), { retentionDays, maxRows: retentionMaxRows });
        if (result.jobsDeleted > 0 || result.auditLogsDeleted > 0) {
          app.log.info(
            { retentionDays, retentionMaxRows, ...result },
            'retention sweep: pruned rows past the retention window/row cap',
          );
        }
      } catch (err) {
        app.log.error({ err }, 'retention sweep failed');
      }
    };
    runRetentionSweep();
    if (retentionDays > 0 || retentionMaxRows > 0) {
      retentionTimer = setInterval(runRetentionSweep, 24 * 60 * 60 * 1000);
      retentionTimer.unref?.();
      app.addHook('onClose', async () => {
        if (retentionTimer) clearInterval(retentionTimer);
      });
    }
  }

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
  // Diagnostic ring buffer of print-flow intake attempts (NATS + HTTP), capped
  // at 500 entries — deliberately in-memory only in both DB modes, since this
  // is an operational log for "what just happened", not durable business data.
  const intakeAttemptRepo = new InMemoryIntakeAttemptRepository();
  // Diagnostic ring buffer of webhook callback delivery attempts (HTTP/NATS,
  // live + sandbox test fires), capped at 500 entries — same "in-memory only,
  // both DB modes" rule as intakeAttemptRepo, since this is an operational
  // log of "did it actually deliver?", not durable business data.
  const webhookCallbackAttemptRepo = new InMemoryWebhookCallbackAttemptRepository();
  // Terminal result-callback deliveries. Durable in SQLite mode — unlike the
  // attempt ring buffer above, a pending delivery is work still owed to a
  // caller, and the retry worker has to find it again after a restart.
  const callbackDeliveryRepo = useSqlite
    ? new SqliteCallbackDeliveryRepository()
    : new InMemoryCallbackDeliveryRepository();
  const eventBus = new InMemoryEventBus({
    onHandlerError: (event, err) => app.log.error({ err, eventType: event.eventType }, 'event subscriber failed'),
  });
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
  const reprintJob = new ReprintJobService(
    jobRepo,
    createJob,
    auditRepo,
    templateRepo,
    paperRepo,
    templateRenderer,
  );
  const acceptExternalJob = new AcceptExternalJobService(
    jobRepo, printerRepo, queue, traceRepo, auditRepo, eventBus,
    // Template repo only — NOT the paper repo or the renderer. That combination
    // turns on template VALIDATION (an explicitly named template that does not
    // exist is now a 422 instead of a silently unrendered print) without
    // switching on server-side rendering for this route, which has never done
    // it and whose callers do not expect it.
    templateRepo, undefined, undefined, intakeAttemptRepo,
    // Lets POST /api/v1/print-jobs accept an optional `endpoint_code` and
    // snapshot that endpoint's callback configuration onto the job.
    webhookEndpointRepo,
  );
  // Dynamic printing (the template/profile HTTP route and NATS intake) is a
  // rendered-document flow. Keep its service separate from the legacy
  // /print-jobs intake above: that route may submit an already-rendered/raw
  // document, while dynamic intake must turn template + payload into printable
  // content before the adapter sees the job.
  const acceptDynamicPrintJob = new AcceptExternalJobService(
    jobRepo, printerRepo, queue, traceRepo, auditRepo, eventBus,
    templateRepo, paperRepo, templateRenderer, intakeAttemptRepo,
    webhookEndpointRepo,
  );
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
    templateRenderer,
    // Wire an HTTP-capable callback service eagerly: pure-HTTP webhook
    // endpoints (callbackTransport 'HTTP') must fire regardless of whether
    // the optional NATS print-intake consumer ever connects. Previously this
    // was left `undefined` until NATS connected below, which meant HTTP-only
    // callbacks silently never fired at all when NATS wasn't configured. If
    // NATS does connect, this is replaced with a NATS-capable instance below.
    new WebhookCallbackService(app.log, httpCallbackSender, undefined, webhookCallbackAttemptRepo),
    app.log,
  );

  const resolvePrinterBinding = new ResolvePrinterBindingService(paperRepo, bindingRepo, templateRepo);
  const dynamicPrint = new DynamicPrintService(
    resolvePrinterBinding,
    acceptDynamicPrintJob,
    intakeAttemptRepo,
    // `endpoint_code` on the dynamic HTTP body and the NATS envelope resolves
    // through here; the template repo closes the hole where an explicit
    // printer_code skipped binding resolution and left code_template unchecked.
    webhookEndpointRepo,
    templateRepo,
  );

  // --- Terminal result callbacks -----------------------------------------
  // The production subscriber. Before this, InMemoryEventBus.subscribe() had no
  // non-test caller: every domain event went nowhere, and the only callback
  // that ever fired did so at acceptance time carrying status "QUEUED".
  //
  // The NATS publisher is resolved lazily through a closure because the
  // connection is owned by the optional print-intake consumer, which starts
  // AFTER the routes are registered.
  let resultCallbackNats: CallbackNatsSender | undefined;
  const resultCallbackDispatcher = new ResultCallbackDispatcher({
    jobs: jobRepo,
    deliveries: callbackDeliveryRepo,
    http: resultCallbackHttpSender,
    nats: (subject, body) => {
      if (!resultCallbackNats) throw new Error('NATS transport is not connected');
      return resultCallbackNats(subject, body);
    },
    attemptLog: webhookCallbackAttemptRepo,
    logger: app.log,
    policy: retryPolicyFromEnv(),
  });
  resultCallbackDispatcher.register(eventBus);
  // Re-arm anything a previous process left mid-flight before the sweep starts,
  // otherwise a DELIVERING row is invisible to both the subscriber and the
  // retry query and would never be delivered at all.
  await resultCallbackDispatcher.recoverInFlight();
  resultCallbackDispatcher.startRetryWorker();
  app.addHook('onClose', async () => {
    resultCallbackDispatcher.stopRetryWorker();
  });

  const importPaperProfile = new ImportPaperProfileService(
    paperRepo,
    importedDesignRepo,
    auditRepo,
  );

  const sandboxSvc = new SandboxService(templateRepo, paperRepo, templateRenderer, createJob, executeJob);
  const connectivitySvc = new PrinterConnectivityService(printerRepo, registry);

  // Desktop mode owns a local, in-process worker so every queued job uses the
  // same driver-rendered Windows adapter as Sandbox. The Go runner remains the
  // discovery agent; it must not RAW-send HTML/JSON to an IPP office printer.
  let localWorkerTimer: ReturnType<typeof setInterval> | undefined;
  if (process.env['PRINTOPS_LOCAL_WORKER'] === 'true') {
    // ACCEPTED/VALIDATED are pre-dispatch states. A crash in job creation can
    // leave them behind before the durable QUEUED transition; no page can have
    // been submitted yet, so completing that transition is safe.
    for (const safeRecoveryStatus of ['ACCEPTED', 'VALIDATED'] as const) {
      const recoverableJobs = await jobRepo.findAll({ status: safeRecoveryStatus });
      for (const recoverableJob of recoverableJobs) {
        const currentJob = await jobRepo.findById(recoverableJob.id);
        if (!currentJob || currentJob.status !== safeRecoveryStatus) continue;
        await jobRepo.update(currentJob.id, {
          status: 'QUEUED',
          queuedAt: currentJob.queuedAt ?? new Date(),
          metadata: {
            ...currentJob.metadata,
            recovery: {
              previousStatus: safeRecoveryStatus,
              recoveredAt: new Date().toISOString(),
              safePreDispatchRecovery: true,
            },
          },
        });
      }
    }

    // A previous desktop process may have stopped after dispatching a document
    // but before recording the device verdict. Replaying such a job can print a
    // duplicate; leaving it eternally DISPATCHED/PRINTING is also misleading.
    // Close the ambiguity honestly and require an intentional operator action.
    for (const staleStatus of ['DISPATCHED', 'PRINTING'] as const) {
      const staleJobs = await jobRepo.findAll({ status: staleStatus });
      for (const staleJob of staleJobs) {
        const currentJob = await jobRepo.findById(staleJob.id);
        if (!currentJob || currentJob.status !== staleStatus) continue;
        const recoveredAt = new Date();
        await jobRepo.update(currentJob.id, {
          status: 'UNVERIFIED',
          finishedAt: recoveredAt,
          completedAt: recoveredAt,
          errorCode: 'RECOVERY_PRINT_STATUS_UNKNOWN',
          errorMessage:
            `Desktop restarted while the job was ${staleStatus}; a page may have printed. ` +
            'The job was not replayed to prevent a duplicate.',
          metadata: {
            ...currentJob.metadata,
            recovery: {
              previousStatus: staleStatus,
              recoveredAt: recoveredAt.toISOString(),
              autoReplaySuppressed: true,
            },
          },
        });
      }
    }

    // The queue itself is intentionally in-memory, while jobs are persisted in
    // desktop mode. Rebuild only the safe-to-dispatch portion after a restart.
    // Jobs that reached DISPATCHED/PRINTING/UNVERIFIED may already have put a
    // physical page on the wire, so automatically replaying those is unsafe.
    const persistedQueuedJobs = await jobRepo.findAll({ status: 'QUEUED' });
    persistedQueuedJobs.sort((left, right) => {
      const leftQueuedAt = left.queuedAt ?? left.createdAt;
      const rightQueuedAt = right.queuedAt ?? right.createdAt;
      return leftQueuedAt.getTime() - rightQueuedAt.getTime();
    });

    let rehydratedJobCount = 0;
    for (const persistedJob of persistedQueuedJobs) {
      // Re-read immediately before enqueueing. This keeps a job that was
      // claimed between the list query and this loop out of the rebuilt queue.
      const currentJob = await jobRepo.findById(persistedJob.id);
      if (!currentJob || currentJob.status !== 'QUEUED') continue;

      await queue.enqueue({
        jobId: currentJob.id,
        printerId: currentJob.printerId,
        traceId: currentJob.traceId,
        correlationId: currentJob.correlationId,
        priority: currentJob.priority,
        enqueuedAt: currentJob.queuedAt ?? currentJob.createdAt,
      });
      rehydratedJobCount += 1;
    }
    if (rehydratedJobCount > 0) {
      app.log.info({ rehydratedJobCount }, 'rehydrated persisted queued print jobs');
    }

    let workerBusy = false;
    const drainOne = async () => {
      if (workerBusy) return;
      workerBusy = true;
      try {
        const queuedMessage = await queue.dequeue();
        if (!queuedMessage) return;
        const jobId = queuedMessage.jobId;
        const queuedJob = await jobRepo.findById(jobId);
        if (!queuedJob || queuedJob.status !== 'QUEUED') {
          await queue.ack(jobId);
          return;
        }
        await executeJob.execute(jobId, 'desktop-local-worker');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A direct Sandbox execution may win the conditional claim. That is a
        // normal race and cannot double-print; other failures remain visible.
        if (!message.includes('already claimed') && !message.includes('cannot be executed again')) {
          app.log.error({ err }, 'local print worker failed');
        }
      } finally {
        workerBusy = false;
      }
    };
    localWorkerTimer = setInterval(() => { void drainOne(); }, 500);
    localWorkerTimer.unref?.();
    app.addHook('onClose', async () => {
      if (localWorkerTimer) clearInterval(localWorkerTimer);
    });
  }

  // API key middleware
  const apiKeyHook = buildApiKeyAuth(serviceAccountRepo);

  // A persistent store must never be re-seeded as a new instance on every
  // desktop start; doing so duplicates sample data and can overwrite records.
  const shouldSeedDemoData = !useSqlite || (await userRepo.findAll({ limit: 1 })).length === 0;

  // Seed default local users. MVP auth accepts any password for these accounts.
  for (const user of [
    { email: 'sysadmin@printerops.local', name: 'Sysadmin', role: 'OWNER' as const },
    { email: 'admin@printerops.local', name: 'Admin', role: 'ADMIN' as const },
    { email: 'user@printerops.local', name: 'User', role: 'OPERATOR' as const },
    { email: 'viewer@printerops.local', name: 'Viewer', role: 'VIEWER' as const },
  ]) {
    if (!(await userRepo.findByEmail(user.email))) {
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
  }

  // Seed dev service account
  const devKey = DEV_API_KEY;
  if (!(await serviceAccountRepo.findBySourceSystem('integration-service'))) {
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
  }

  // Seed sample printers for dev
  if (shouldSeedDemoData) {
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

  // Dynamic print-invocation flow (medisync sticker path). The medisync printing
  // consumer submits code_template=prescription-sticker + code_profile=sticker-profile;
  // this printer/profile/template/binding make that pair resolve to a real printer.
  await printerRepo.create({
    code: 'sticker-printer',
    name: 'Prescription Sticker Printer (Fake)',
    location: 'Pharmacy',
    protocol: 'fake',
    connectionUri: 'fake://sticker-printer',
    isActive: true,
    allowedTemplates: ['prescription-sticker'],
    maxCopiesPerJob: 10,
    metadata: { model: 'FakeSticker' },
  });

  const stickerProfile = await paperRepo.create({
    code: 'sticker-profile',
    name: 'Prescription Sticker 100 x 50 mm',
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

  await templateRepo.create({
    templateCode: 'prescription-sticker',
    name: 'Prescription Sticker',
    description: 'Prescription sticker template for medisync',
    engine: 'RAW_TEXT',
    content: 'RX {{prescription_id}}\n{{patient_name}}\nHN {{hn}}',
    paperProfileId: stickerProfile.id,
    status: 'PUBLISHED',
    createdBy: 'seed',
  });

  await bindingRepo.create({
    printerCode: 'sticker-printer',
    templateCode: 'prescription-sticker',
    paperProfileId: stickerProfile.id,
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
    callbackTransport: 'NONE',
    callbackOnPrintResult: false,
  });
  }

  // Optional NATS JetStream print-intake transport. Enabled only when NATS_URL
  // (or PRINTOPS_NATS_URL) is set; the HTTP API works identically without it.
  // Read here (before routes) so the print-flow config endpoint can report it.
  let printIntakeCfg: PrintIntakeConfig | undefined;
  // NATS publisher for webhook callbacks; assigned if the print-intake
  // consumer (which owns the connection) successfully starts.

  // True once startPrintIntakeConsumer actually succeeds — printIntakeCfg
  // alone only means the env config was valid, not that the consumer is live.

  try {
    printIntakeCfg = printIntakeConfigFromEnv();
  } catch (err) {
    // A shared/unscoped NATS consumer can send a patient's label to a different
    // workstation. Disable only that optional transport on bad configuration;
    // the authenticated HTTP API must remain available for recovery.
    app.log.error({ err }, 'print-intake disabled: invalid client-scoped NATS configuration');
  }
  const natsManager = new NatsConnectionManager(printIntakeCfg, { dynamicPrint, logger: app.log, intakeLog: intakeAttemptRepo });
  const routeNatsPublisher: NatsPublisher | undefined = printIntakeCfg
    ? (subject, payload) => natsManager.publish(subject, payload)
    : undefined;
  const intakeOutcomeCallbacks = new IntakeOutcomeCallbackService(
    webhookEndpointRepo,
    new WebhookCallbackService(
      app.log,
      httpCallbackSender,
      routeNatsPublisher,
      webhookCallbackAttemptRepo,
    ),
  );
  natsManager.setIntakeCallbacks(intakeOutcomeCallbacks);

  // Health check (no auth)
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // Routes — legacy internal API
  await app.register(async (api) => {
    await authRoutes(api, { users: userRepo });
    await printerRoutes(api, { printers: printerRepo, createPrinter, getPrinterStatus, registry });
    await jobRoutes(api, { jobs: jobRepo, traces: traceRepo, createJob, executeJob, reprintJob });
    await runnerRoutes(api, { runners: runnerRepo, jobs: jobRepo, registerRunner, runnerHeartbeat });
    await auditRoutes(api, { audit: auditRepo });
    await exportRoutes(api, { exportJobs, audit: auditRepo, printers: printerRepo, exporter });
  });

  // Routes — external API v1
  await app.register(async (v1) => {
    await v1PrintJobRoutes(v1, { jobs: jobRepo, traces: traceRepo, acceptExternalJob, cancelJob, executeJob, apiKeyHook, intakeLog: intakeAttemptRepo, intakeCallbacks: intakeOutcomeCallbacks });
    await v1PrinterPrintRoutes(v1, { dynamicPrint, apiKeyHook, intakeLog: intakeAttemptRepo, intakeCallbacks: intakeOutcomeCallbacks });
    await v1PrintFlowRoutes(v1, { printIntake: printIntakeCfg, natsStatus: () => natsManager.getStatus(), natsTest: () => natsManager.testConnection(), intakeLog: intakeAttemptRepo, runtimeArchitecture });
    await v1PrinterRoutes(v1, { printers: printerRepo, getPrinterStatus, apiKeyHook });
    await v1ExportRoutes(v1, { exportJobs, audit: auditRepo, exporter, apiKeyHook });
    await v1RunnerPrinterRoutes(v1, { discoveredPrinters: discoveredPrinterRepo, syncDiscovery, registerDiscovered });
    await v1RunnerJobRoutes(v1, { jobs: jobRepo, printers: printerRepo, traces: traceRepo, audit: auditRepo, events: eventBus });
    await templateRoutes(v1, { templates: templateRepo, papers: paperRepo, bindings: bindingRepo, printers: printerRepo, renderer: templateRenderer, audit: auditRepo });
    await sandboxRoutes(v1, { sandbox: sandboxSvc, connectivity: connectivitySvc, audit: auditRepo });
    await webhookRoutes(v1, { endpoints: webhookEndpointRepo, policies: webhookPolicyRepo, templates: templateRepo, papers: paperRepo, renderer: templateRenderer, intake: dynamicIntake, audit: auditRepo, createJob, executeJob, getPrinterStatus, logger: app.log, callbackSender: httpCallbackSender, callbackNats: routeNatsPublisher, callbackAttemptLog: webhookCallbackAttemptRepo, callbackDeliveries: callbackDeliveryRepo });
    await paperProfileImportRoutes(v1, { importService: importPaperProfile });
    await v1UserRoutes(v1, { users: userRepo });
  }, { prefix: '/api/v1', bodyLimit: 12 * 1024 * 1024 });

  if (printIntakeCfg) {
    const natsPublisherLocal: NatsPublisher = (subject, payload) => natsManager.publish(subject, payload);
    dynamicIntake.setCallbackService(new WebhookCallbackService(app.log, httpCallbackSender, natsPublisherLocal, webhookCallbackAttemptRepo));
    resultCallbackNats = natsPublisherLocal;
  }
  natsManager.start();
  app.addHook('onClose', async () => { await natsManager.stop(); });

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
  const mimeTypes: Record<string, string> = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  app.setNotFoundHandler(async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return reply.status(404).send({ error: 'Not found' });
    }
    const urlPath = new URL(req.url, 'http://x').pathname;
    const tryPath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
    const ext = tryPath.includes('.') ? '.' + tryPath.split('.').pop()!.toLowerCase() : '';

    for (const root of staticRoots) {
      try {
        const buf = readFileSync(join(root, tryPath));
        if (mimeTypes[ext]) reply.type(mimeTypes[ext]);
        return reply.send(buf);
      } catch {}
    }
    // SPA fallback
    for (const root of staticRoots) {
      try { return reply.type('text/html').send(readFileSync(join(root, 'index.html'))); } catch {}
    }
    return reply.status(404).send({ error: 'Not found' });
  });

  return {
    app,
    executeJob,
    queue,
    jobRepo,
    printerRepo,
    serviceAccountRepo,
    eventBus,
    callbackDeliveryRepo,
    resultCallbackDispatcher,
    DEV_API_KEY: devKey,
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
}
