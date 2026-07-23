import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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
  deps: { printIntake?: PrintIntakeConfig | undefined },
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
              url: redactNatsUrl(nats.url),
              stream: nats.stream,
              clientId: nats.clientId,
              subject: nats.subject,
              durable: nats.durable,
              dlqPrefix: nats.dlqPrefix,
              maxDeliver: nats.maxDeliver,
              authRequired: false,
            }
          : { enabled: false, authRequired: false },
      });
    },
  );
}
