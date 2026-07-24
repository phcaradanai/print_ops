import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { IntakeAttemptRepositoryPort } from '@printerops/domain';
import { requirePermission } from './permission-guard.js';
import { redactNatsUrl, type PrintIntakeConfig } from '../../infra/nats/print-intake.js';

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
    printIntake?: PrintIntakeConfig | undefined;
    printIntakeConnected: () => boolean;
    intakeLog?: IntakeAttemptRepositoryPort;
  },
): Promise<void> {
  app.get(
    '/print-flow/config',
    { onRequest: [requirePermission('template:read')] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const nats = deps.printIntake;
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
              connected: deps.printIntakeConnected(),
              url: redactNatsUrl(nats.url),
              stream: nats.stream,
              clientId: nats.clientId,
              subject: nats.subject,
              durable: nats.durable,
              dlqPrefix: nats.dlqPrefix,
              maxDeliver: nats.maxDeliver,
              authRequired: false,
            }
          : { enabled: false, connected: false, authRequired: false },
      });
    },
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
