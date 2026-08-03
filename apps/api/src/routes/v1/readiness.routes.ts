import type { FastifyInstance } from 'fastify';
import type {
  AuditRepositoryPort,
  CallbackDeliveryRepositoryPort,
  DiscoveredPrinterRepositoryPort,
  IntakeAttemptRepositoryPort,
  PrinterRepositoryPort,
  RunnerRepositoryPort,
  WebhookCallbackAttemptRepositoryPort,
  WebhookEndpointRepositoryPort,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../../infra/db/sqlite.js';
import { schemaVersion } from '../../infra/db/sqlite.schema.js';
import type { NatsRuntimeStatus } from '../../infra/nats/nats-connection-manager.js';
import type { RuntimeArchitecture } from '../../infra/runtime-architecture.js';
import { requirePermission } from './permission-guard.js';

export type ReadinessState = 'READY' | 'DEGRADED' | 'NOT_CONFIGURED' | 'UNAVAILABLE';

export interface ReadinessComponent {
  state: ReadinessState;
  message: string;
  action?: string;
  details?: Record<string, unknown>;
}

export interface ReadinessSnapshot {
  status: 'READY' | 'DEGRADED';
  checkedAt: string;
  components: {
    desktopShell: ReadinessComponent;
    localApi: ReadinessComponent;
    database: ReadinessComponent;
    localPrintWorker: ReadinessComponent;
    discoveryRunner: ReadinessComponent;
    selectedPrinter: ReadinessComponent;
    natsCore: ReadinessComponent;
    jetStream: ReadinessComponent;
    stream: ReadinessComponent;
    durableConsumer: ReadinessComponent;
    httpCallback: ReadinessComponent;
    natsCallback: ReadinessComponent;
    callbackRetryQueue: ReadinessComponent;
  };
}

interface ReadinessDependencies {
  runtimeArchitecture: RuntimeArchitecture;
  natsStatus: () => NatsRuntimeStatus;
  sqliteEnabled: boolean;
  printers: PrinterRepositoryPort;
  runners: RunnerRepositoryPort;
  discoveredPrinters: DiscoveredPrinterRepositoryPort;
  webhookEndpoints: WebhookEndpointRepositoryPort;
  intakeAttempts: IntakeAttemptRepositoryPort;
  callbackAttempts: WebhookCallbackAttemptRepositoryPort;
  callbackDeliveries: CallbackDeliveryRepositoryPort;
  audit: AuditRepositoryPort;
}

function component(
  state: ReadinessState,
  message: string,
  action?: string,
  details?: Record<string, unknown>,
): ReadinessComponent {
  return { state, message, ...(action ? { action } : {}), ...(details ? { details } : {}) };
}

function latestIso(values: Array<Date | undefined>): string | undefined {
  const timestamps = values.flatMap((value) => value ? [value.getTime()] : []);
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : undefined;
}

function natsAction(status: NatsRuntimeStatus): string | undefined {
  if (!status.enabled) return 'Enable NATS in Settings only when remote intake or NATS callbacks are required.';
  if (!status.connected) return 'Verify the sanitized broker address, credentials, firewall, and broker availability.';
  if (!status.streamReady) return `Create or grant access to stream ${status.stream ?? '(not configured)'}.`;
  if (!status.consumerReady) return `Resolve durable consumer ${status.durable ?? '(not configured)'} configuration.`;
  return undefined;
}

function natsDetails(status: NatsRuntimeStatus): Record<string, unknown> {
  return {
    server: status.server,
    subject: status.subject,
    stream: status.stream,
    durable: status.durable,
    lastConnectedAt: status.lastConnectedAt,
    lastDisconnectedAt: status.lastDisconnectedAt,
    lastAttemptAt: status.lastAttemptAt,
    nextRetryAt: status.nextRetryAt,
    lastErrorCode: status.lastErrorCode,
    lastErrorStage: status.lastErrorStage,
    lastErrorMessage: sanitizeText(status.lastErrorMessage),
  };
}

export async function createReadinessSnapshot(deps: ReadinessDependencies): Promise<ReadinessSnapshot> {
  const [printers, runners, discovered, endpoints, pending, retrying, callbackAttempts] = await Promise.all([
    deps.printers.findAll({ limit: 500 }),
    deps.runners.findAll({ limit: 100 }),
    deps.discoveredPrinters.findAll({ limit: 500 }),
    deps.webhookEndpoints.findAll({ limit: 500 }),
    deps.callbackDeliveries.findAll({ limit: 500, deliveryStatus: 'PENDING' }),
    deps.callbackDeliveries.findAll({ limit: 500, deliveryStatus: 'RETRY_SCHEDULED' }),
    deps.callbackAttempts.findAll({ limit: 100 }),
  ]);
  const now = Date.now();
  const recentRunners = runners.filter((runner) =>
    runner.lastHeartbeatAt && now - runner.lastHeartbeatAt.getTime() <= 90_000);
  const activePrinters = printers.filter((printer) => printer.isActive);
  const windowsPrinters = activePrinters.filter((printer) => printer.protocol === 'windows_spooler');
  const registeredDiscovery = discovered.filter((printer) => printer.registeredPrinterId);
  const enabledEndpoints = endpoints.filter((endpoint) => endpoint.enabled);
  const httpEndpoints = enabledEndpoints.filter((endpoint) =>
    endpoint.callbackTransport === 'HTTP' || endpoint.callbackTransport === 'BOTH');
  const natsEndpoints = enabledEndpoints.filter((endpoint) =>
    endpoint.callbackTransport === 'NATS' || endpoint.callbackTransport === 'BOTH');
  const latestHttpAttempt = callbackAttempts
    .filter((attempt) => attempt.transport === 'HTTP')
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())[0];
  const nats = deps.natsStatus();
  const natsDiagnostic = natsDetails(nats);
  const pendingCount = pending.length + retrying.length;

  const components: ReadinessSnapshot['components'] = {
    desktopShell: deps.runtimeArchitecture.runtimeMode === 'packaged-windows-desktop'
      ? component('READY', 'Packaged desktop runtime is active.')
      : component('NOT_CONFIGURED', 'The API is running outside the packaged desktop shell.', 'Use the Windows installer for pilot acceptance.'),
    localApi: component('READY', 'The local API is responding.', undefined, { uptimeSeconds: Math.floor(process.uptime()) }),
    database: deps.sqliteEnabled
      ? component('READY', 'SQLite opened and passed its startup integrity check.', undefined, { schemaVersion: schemaVersion(getDb()) })
      : component('NOT_CONFIGURED', 'In-memory persistence is active.', 'Use DB_MODE=sqlite for production.'),
    localPrintWorker: deps.runtimeArchitecture.executor.enabled
      ? component('READY', 'The single configured print executor is active.', undefined, {
          owner: deps.runtimeArchitecture.executor.owner,
          mode: deps.runtimeArchitecture.executor.mode,
        })
      : component('UNAVAILABLE', 'No print executor is active.', 'Enable the API local worker before accepting work.'),
    discoveryRunner: recentRunners.length > 0
      ? component('READY', `${recentRunners.length} discovery runner(s) reported recently.`, undefined, {
          lastHeartbeatAt: latestIso(recentRunners.map((runner) => runner.lastHeartbeatAt)),
          registeredPrinters: registeredDiscovery.length,
        })
      : component('UNAVAILABLE', 'No discovery runner heartbeat was received in the last 90 seconds.', 'Check desktop-runner.log and restart the desktop app.'),
    selectedPrinter: windowsPrinters.length > 0
      ? component('READY', `${windowsPrinters.length} active Windows installed printer(s) are registered.`, undefined, {
          activePrinterCount: activePrinters.length,
          supportedPrinterCount: windowsPrinters.length,
        })
      : component('UNAVAILABLE', 'No active Windows installed printer is registered.', 'Run discovery, then register and select a Windows printer.'),
    natsCore: !nats.enabled
      ? component('NOT_CONFIGURED', 'NATS is disabled.', natsAction(nats), natsDiagnostic)
      : nats.connected
        ? component('READY', 'NATS core connection is ready.', undefined, natsDiagnostic)
        : component('UNAVAILABLE', 'NATS core is not connected.', natsAction(nats), natsDiagnostic),
    jetStream: !nats.enabled
      ? component('NOT_CONFIGURED', 'JetStream intake is disabled with NATS.', natsAction(nats), natsDiagnostic)
      : nats.connected && nats.streamReady
        ? component('READY', 'JetStream is reachable.', undefined, natsDiagnostic)
        : component('UNAVAILABLE', 'JetStream intake is not ready.', natsAction(nats), natsDiagnostic),
    stream: !nats.enabled
      ? component('NOT_CONFIGURED', 'No intake stream is configured.', natsAction(nats), natsDiagnostic)
      : nats.streamReady
        ? component('READY', `Stream ${nats.stream ?? ''} is ready.`, undefined, natsDiagnostic)
        : component('UNAVAILABLE', `Stream ${nats.stream ?? '(unknown)'} is not ready.`, natsAction(nats), natsDiagnostic),
    durableConsumer: !nats.enabled
      ? component('NOT_CONFIGURED', 'No durable intake consumer is configured.', natsAction(nats), natsDiagnostic)
      : nats.consumerReady && nats.intakeReady
        ? component('READY', `Durable consumer ${nats.durable ?? ''} is consuming.`, undefined, natsDiagnostic)
        : component('UNAVAILABLE', `Durable consumer ${nats.durable ?? '(unknown)'} is not consuming.`, natsAction(nats), natsDiagnostic),
    httpCallback: httpEndpoints.length === 0
      ? component('NOT_CONFIGURED', 'No enabled HTTP callback endpoint is configured.', 'Configure an endpoint only when the caller requires HTTP results.')
      : latestHttpAttempt?.outcome === 'success'
        ? component('READY', `${httpEndpoints.length} enabled endpoint(s); the most recent HTTP callback succeeded.`, undefined, {
            configuredEndpointCount: httpEndpoints.length,
            lastAttemptAt: latestHttpAttempt.occurredAt.toISOString(),
            lastDurationMs: latestHttpAttempt.durationMs,
            lastHttpStatus: latestHttpAttempt.httpStatus,
          })
        : component('DEGRADED', latestHttpAttempt
          ? `${httpEndpoints.length} endpoint(s) configured; the most recent HTTP callback did not succeed.`
          : `${httpEndpoints.length} endpoint(s) configured, but no successful HTTP callback is recorded in this process.`,
        'Run a callback test and verify the receiver, DNS, firewall, and signing-secret environment reference.', {
          configuredEndpointCount: httpEndpoints.length,
          lastAttemptAt: latestHttpAttempt?.occurredAt.toISOString(),
          lastOutcome: latestHttpAttempt?.outcome,
          lastHttpStatus: latestHttpAttempt?.httpStatus,
          lastError: sanitizeText(latestHttpAttempt?.errorMessage),
        }),
    natsCallback: natsEndpoints.length === 0
      ? component('NOT_CONFIGURED', 'No enabled NATS callback endpoint is configured.', 'Configure an endpoint only when the caller requires NATS results.')
      : nats.callbackPublishReady
        ? component('READY', `${natsEndpoints.length} NATS callback endpoint(s) can publish.`, undefined, natsDiagnostic)
        : component('UNAVAILABLE', 'NATS callbacks are configured but publishing is unavailable.', natsAction(nats), natsDiagnostic),
    callbackRetryQueue: pendingCount === 0
      ? component('READY', 'No callback deliveries are waiting for retry.', undefined, { pendingCount: 0 })
      : component('DEGRADED', `${pendingCount} callback delivery record(s) are pending or scheduled for retry.`, 'Review callback attempts and receiver availability.', {
          pendingCount: pending.length,
          retryScheduledCount: retrying.length,
          nextRetryAt: latestIso(retrying.map((delivery) => delivery.nextAttemptAt)),
        }),
  };
  const required = [
    components.localApi,
    components.database,
    components.localPrintWorker,
    components.discoveryRunner,
    components.selectedPrinter,
    components.callbackRetryQueue,
    ...(nats.enabled ? [components.natsCore, components.jetStream, components.stream, components.durableConsumer] : []),
  ];
  return {
    status: required.every((item) => item.state === 'READY') ? 'READY' : 'DEGRADED',
    checkedAt: new Date().toISOString(),
    components,
  };
}

const SECRET_KEY = /(password|secret|token|authorization|api[-_]?key|credential|payload|document|rendered)/i;
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const LIVE_KEY = /\bpo_live_[A-Za-z0-9_-]+\b/g;
const SECRET_ASSIGNMENT = /\b(password|passphrase|secret|token|authorization|api[-_]?key|credential|payload)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi;
const SECRET_JSON = /"(password|passphrase|secret|token|authorization|api[-_]?key|credential|payload)"\s*:\s*("(?:\\.|[^"])*"|[^,}\r\n]+)/gi;
const SENSITIVE_LOG_LINE = /\b(patient|patient_name|documentBase64|renderedPrintPayload|print payload|callback payload)\b|"(body|payload|document|content)"\s*:|\b(HN|MRN)\s*[:=]/i;

export function sanitizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value
    .replace(URL_CREDENTIALS, '$1[REDACTED]@')
    .replace(BEARER, '$1 [REDACTED]')
    .replace(LIVE_KEY, '[REDACTED_API_KEY]')
    .replace(SECRET_JSON, '"$1":"[REDACTED]"')
    .replace(SECRET_ASSIGNMENT, '$1$2[REDACTED]');
}

export function redactSupportValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return sanitizeText(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redactSupportValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        redactSupportValue(child, childKey),
      ]),
    );
  }
  return value;
}

function sanitizeLogContent(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => SENSITIVE_LOG_LINE.test(line) ? '[REDACTED_SENSITIVE_LOG_LINE]' : sanitizeText(line) ?? '')
    .join('\n');
}

function recentLogTail(filename: string): { filename: string; modifiedAt?: string; content?: string; unavailable?: string } {
  const directory = process.env['PRINTOPS_LOG_DIR'];
  if (!directory) return { filename, unavailable: 'Log directory is not exposed in this runtime.' };
  const path = join(directory, filename);
  if (!existsSync(path)) return { filename, unavailable: 'Log file does not exist.' };
  try {
    const bytes = readFileSync(path);
    const tail = bytes.subarray(Math.max(0, bytes.length - 128 * 1024)).toString('utf8');
    return { filename, modifiedAt: statSync(path).mtime.toISOString(), content: sanitizeLogContent(tail) };
  } catch {
    return { filename, unavailable: 'Log file could not be read.' };
  }
}

export async function readinessRoutes(app: FastifyInstance, deps: ReadinessDependencies): Promise<void> {
  app.get('/system/readiness', { onRequest: [requirePermission('template:read')] }, async (_req, reply) =>
    reply.header('Cache-Control', 'no-store').send(await createReadinessSnapshot(deps)));

  app.get('/system/support-bundle', { onRequest: [requirePermission('user:manage')] }, async (req, reply) => {
    const [readiness, intakeAttempts, callbackAttempts, deliveries, runners, printers] = await Promise.all([
      createReadinessSnapshot(deps),
      deps.intakeAttempts.findAll({ limit: 100 }),
      deps.callbackAttempts.findAll({ limit: 100 }),
      deps.callbackDeliveries.findAll({ limit: 100 }),
      deps.runners.findAll({ limit: 100 }),
      deps.discoveredPrinters.findAll({ limit: 500 }),
    ]);
    const bundle = redactSupportValue({
      generatedAt: new Date().toISOString(),
      versions: {
        application: process.env['PRINTOPS_APP_VERSION'] ?? 'development',
        commit: process.env['PRINTOPS_GIT_COMMIT'] ?? 'unknown',
        node: process.version,
      },
      runtimeArchitecture: deps.runtimeArchitecture,
      readiness,
      nats: deps.natsStatus(),
      database: { mode: deps.sqliteEnabled ? 'sqlite' : 'memory', schemaVersion: deps.sqliteEnabled ? schemaVersion(getDb()) : null },
      recentIntakeAttempts: intakeAttempts,
      recentCallbackAttempts: callbackAttempts.map(({ target: _target, ...attempt }) => attempt),
      recentCallbackDeliveries: deliveries.map(({ payload: _payload, target: _target, ...delivery }) => delivery),
      printerDiscovery: {
        runners: runners.map(({ metadata: _metadata, ipAddress: _ipAddress, ...runner }) => runner),
        printers: printers.map(({ attributes: _attributes, ...printer }) => printer),
      },
      logs: [
        recentLogTail('desktop.log'),
        recentLogTail('desktop-server.log'),
        recentLogTail('desktop-runner.log'),
      ],
    });
    const actor = req.user as { sub: string; email: string };
    await deps.audit.create({
      traceId: generateId(),
      action: 'support_bundle.exported',
      actorId: actor.sub,
      actorEmail: actor.email,
      resourceType: 'system',
      resourceId: 'support-bundle',
      metadata: { excludesPayloads: true, credentialsRedacted: true },
    });
    const date = new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="printops-support-${date}.json"`)
      .header('Cache-Control', 'no-store')
      .send(JSON.stringify(bundle, null, 2));
  });
}
