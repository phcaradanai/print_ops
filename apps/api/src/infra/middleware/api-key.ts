import { createHash, timingSafeEqual } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ServiceAccountRepositoryPort } from '@printerops/domain';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function apiKeyPrefix(key: string): string {
  return key.substring(0, 8);
}

/**
 * Authenticate an external system with its service-account key.
 *
 * Operator/OWNER bootstrap is deliberately not part of this trust boundary:
 * a retained or deployment-provisioned service account must keep accepting
 * work while the dashboard still needs first-owner setup. The key itself is
 * still mandatory and must belong to an active service account.
 */
export function buildApiKeyAuth(serviceAccounts: ServiceAccountRepositoryPort) {
  return async function apiKeyAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = req.headers['x-api-key'] as string | undefined;
    if (!header) {
      return reply.status(401).send({ error: 'Missing X-Api-Key header' });
    }

    const prefix = apiKeyPrefix(header);
    const hash = hashApiKey(header);

    const all = await serviceAccounts.findAll();
    const candidate = Buffer.from(hash, 'hex');
    const account = all.find((a) => {
      const expected = Buffer.from(a.apiKeyHash, 'hex');
      return a.isActive && a.apiKeyPrefix === prefix && expected.length === candidate.length && timingSafeEqual(expected, candidate);
    });

    if (!account) {
      return reply.status(401).send({ error: 'Invalid or inactive API key' });
    }

    (req as FastifyRequest & { serviceAccount: typeof account }).serviceAccount = account;
  };
}
