import { createHash } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ServiceAccountRepositoryPort } from '@printerops/domain';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function apiKeyPrefix(key: string): string {
  return key.substring(0, 8);
}

export function buildApiKeyAuth(serviceAccounts: ServiceAccountRepositoryPort) {
  return async function apiKeyAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = req.headers['x-api-key'] as string | undefined;
    if (!header) {
      return reply.status(401).send({ error: 'Missing X-Api-Key header' });
    }

    const prefix = apiKeyPrefix(header);
    const hash = hashApiKey(header);

    const all = await serviceAccounts.findAll();
    const account = all.find((a) => a.isActive && a.apiKeyPrefix === prefix && a.apiKeyHash === hash);

    if (!account) {
      return reply.status(401).send({ error: 'Invalid or inactive API key' });
    }

    (req as FastifyRequest & { serviceAccount: typeof account }).serviceAccount = account;
  };
}
