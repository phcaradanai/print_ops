import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuditRepositoryPort, IntakeAttemptRepositoryPort } from '@printerops/domain';
import { AppError } from '@printerops/shared';
import { actor, requirePermission } from './permission-guard.js';
import { redactNatsUrl, type PrintIntakeConfig } from '../../infra/nats/print-intake.js';
import type { NatsRuntimeStatus } from '../../infra/nats/nats-connection-manager.js';
import type { NatsSettings, NatsSettingsSource } from '../../infra/nats/nats-settings.js';
import type { RuntimeArchitecture } from '../../infra/runtime-architecture.js';

/** Read view of the operator-editable NATS settings. */
export interface NatsSettingsView {
  settings: NatsSettings;
  source: NatsSettingsSource;
}

/** Result of applying (and persisting) a settings change. */
export interface NatsSettingsApplied extends NatsSettingsView {
  status: NatsRuntimeStatus;
}

/**
 * Read-only view of the dynamic print-flow transports, for the sysadmin
 * dashboard: which subject to publish to and which HTTP path to POST to.
 *
 * JWT + permission guarded: the NATS intake itself is unauthenticated on the
 * internal network, but that is no reason to hand its topology to any caller.
 * The NATS URL is credential-redacted before it leaves the process.
 */
export async function v1PrintFlowRoutes(
  app: FastifyInstance,
  deps: {
    printIntake?: () => PrintIntakeConfig | undefined;
    natsStatus: () => NatsRuntimeStatus;
    natsTest: () => Promise<{ ok: boolean; stage: string; code?: string; message: string; durationMs: number }>;
    /** Current operator-editable settings, from file or environment. */
    natsSettingsRead: () => Promise<NatsSettingsView>;
    /**
     * Validates, persists and applies settings in place. Throws ValidationError
     * for bad input; the route turns that into the 400 the dashboard shows.
     */
    natsSettingsSave: (input: unknown) => Promise<NatsSettingsApplied>;
    intakeLog?: IntakeAttemptRepositoryPort;
    audit?: AuditRepositoryPort;
    runtimeArchitecture: RuntimeArchitecture;
  },
): Promise<void> {
  app.get(
    '/print-flow/config',
    { onRequest: [requirePermission('template:read')] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      // Read through the manager, not a boot-time snapshot: settings saved from
      // the dashboard apply at runtime, and this page must show the live topology.
      const nats = deps.printIntake?.();
      return reply.send({
        http: {
          // The HTTP transport stays authenticated; only NATS is open internally.
          path: '/api/v1/printer/{code_template}/{code_profile}',
          method: 'POST',
          authHeader: 'X-Api-Key',
        },
        nats: nats
          ? {
              enabled: true,
              connected: deps.natsStatus().connected,
              url: redactNatsUrl(nats.url),
              stream: nats.stream,
              clientId: nats.clientId,
              subject: nats.subject,
              durable: nats.durable,
              dlqPrefix: nats.dlqPrefix,
              maxDeliver: nats.maxDeliver,
              authRequired: false,
            }
          : { ...deps.natsStatus(), enabled: false, connected: false, authRequired: false },
      });
    },
  );

  app.get('/print-flow/nats-status', { onRequest: [requirePermission('template:read')] }, async (_req, reply) => reply.send(deps.natsStatus()));

  app.post('/print-flow/nats-test', { onRequest: [requirePermission('template:read')] }, async (_req, reply) => reply.send(await deps.natsTest()));

  // Read view of the settings that drive intake. Unlike nats-status/config (which
  // redact the URL) this is the EDIT form, so it returns the URL exactly as
  // stored — which can carry broker credentials. It is therefore guarded with
  // printer:control, the same permission that may change intake, rather than the
  // read-only template:read used by the redacted endpoints.
  app.get(
    '/print-flow/nats-settings',
    { onRequest: [requirePermission('printer:control')] },
    async (_req: FastifyRequest, reply: FastifyReply) => reply.send(await deps.natsSettingsRead()),
  );

  // Persist and apply NATS intake settings without restarting the API process.
  // Guarded with printer:control — the same class of mutating action as
  // nats-test, but this one decides which broker may deliver print jobs, so a
  // read-only VIEWER must not reach it.
  app.put(
    '/print-flow/nats-settings',
    { onRequest: [requirePermission('printer:control')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      let before: NatsSettingsView | undefined;
      try {
        before = await deps.natsSettingsRead();
        const applied = await deps.natsSettingsSave(req.body);
        await deps.audit?.create({
          traceId: 'nats-settings',
          action: 'nats_settings.updated',
          actorId: actor(req),
          resourceType: 'nats_settings',
          resourceId: 'print-intake',
          // Credentials in the URL never reach the audit log, which is readable
          // by every ADMIN and OWNER.
          before: { ...before.settings, url: redactNatsUrl(before.settings.url) } as unknown as Record<string, unknown>,
          after: { ...applied.settings, url: redactNatsUrl(applied.settings.url) } as unknown as Record<string, unknown>,
          metadata: {
            previousSource: before.source,
            enabled: applied.settings.enabled,
            connected: applied.status.connected,
            state: applied.status.state,
          },
        });
        return reply.send(applied);
      } catch (error) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        throw error;
      }
    },
  );

  app.get(
    '/print-flow/runtime-architecture',
    { onRequest: [requirePermission('template:read')] },
    async (_req, reply) => reply.send(deps.runtimeArchitecture),
  );

  // Read-only log of every dynamic-print-flow intake attempt (NATS or HTTP),
  // including rejected/dead-lettered ones — so a sysadmin can see that a job
  // DID arrive and WHY it never became a print job, instead of it silently
  // vanishing with nothing but a line in the API process log.
  app.get(
    '/print-flow/intake-log',
    { onRequest: [requirePermission('audit:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { limit, offset, outcome, source } = req.query as {
        limit?: string;
        offset?: string;
        outcome?: 'accepted' | 'duplicate' | 'rejected';
        source?: 'nats' | 'api';
      };
      const attempts = await deps.intakeLog?.findAll({
        limit: limit ? Number(limit) : 100,
        offset: offset ? Number(offset) : undefined,
        outcome,
        source,
      });
      return reply.send(attempts ?? []);
    },
  );
}
