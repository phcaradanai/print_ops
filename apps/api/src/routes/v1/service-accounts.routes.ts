import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  AuditRepositoryPort,
  ServiceAccount,
  ServiceAccountRepositoryPort,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { apiKeyPrefix, hashApiKey } from '../../infra/middleware/api-key.js';
import { requirePermission } from './permission-guard.js';

type AuthenticatedUser = { sub: string; email: string };

function issueApiKey(): string {
  return `po_live_${randomBytes(32).toString('base64url')}`;
}

function safeAccount(account: ServiceAccount) {
  return {
    id: account.id,
    name: account.name,
    sourceSystem: account.sourceSystem,
    apiKeyPrefix: account.apiKeyPrefix,
    isActive: account.isActive,
    allowedPrinterCodes: account.allowedPrinterCodes,
    allowedTemplateCodes: account.allowedTemplateCodes,
    maxCopiesPerJob: account.maxCopiesPerJob,
    maxPayloadBytes: account.maxPayloadBytes,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

async function audit(
  repo: AuditRepositoryPort,
  req: FastifyRequest,
  action: 'service_account.created' | 'service_account.key_rotated' | 'service_account.revoked',
  account: ServiceAccount,
  before?: Record<string, unknown>,
) {
  const user = req.user as AuthenticatedUser;
  await repo.create({
    traceId: generateId(),
    action,
    actorId: user.sub,
    actorEmail: user.email,
    resourceType: 'service_account',
    resourceId: account.id,
    before,
    after: safeAccount(account),
    metadata: {},
  });
}

export async function serviceAccountRoutes(
  app: FastifyInstance,
  deps: { serviceAccounts: ServiceAccountRepositoryPort; audit: AuditRepositoryPort },
): Promise<void> {
  const ownerOnly = requirePermission('user:manage');

  app.get('/service-accounts', { onRequest: [ownerOnly] }, async () => {
    return (await deps.serviceAccounts.findAll()).map(safeAccount);
  });

  app.post('/service-accounts', { onRequest: [ownerOnly] }, async (req, reply) => {
    const body = req.body as {
      name?: string;
      sourceSystem?: string;
      allowedPrinterCodes?: string[];
      allowedTemplateCodes?: string[];
      maxCopiesPerJob?: number;
      maxPayloadBytes?: number;
    };
    const name = body.name?.trim();
    const sourceSystem = body.sourceSystem?.trim();
    if (!name || !sourceSystem || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(sourceSystem)) {
      return reply.status(400).send({ error: 'Name and a valid source system are required' });
    }
    if ((await deps.serviceAccounts.findAll()).some((account) => account.sourceSystem === sourceSystem)) {
      return reply.status(409).send({ error: 'Source system already exists' });
    }
    const maxCopiesPerJob = body.maxCopiesPerJob ?? 100;
    const maxPayloadBytes = body.maxPayloadBytes ?? 65_536;
    if (!Number.isInteger(maxCopiesPerJob) || maxCopiesPerJob < 1 || maxCopiesPerJob > 1_000) {
      return reply.status(400).send({ error: 'Maximum copies must be a whole number between 1 and 1000' });
    }
    if (!Number.isInteger(maxPayloadBytes) || maxPayloadBytes < 1_024 || maxPayloadBytes > 12 * 1024 * 1024) {
      return reply.status(400).send({ error: 'Maximum payload bytes must be between 1024 and 12582912' });
    }
    const apiKey = issueApiKey();
    const account = await deps.serviceAccounts.create({
      name,
      sourceSystem,
      apiKeyHash: hashApiKey(apiKey),
      apiKeyPrefix: apiKeyPrefix(apiKey),
      isActive: true,
      allowedPrinterCodes: body.allowedPrinterCodes ?? [],
      allowedTemplateCodes: body.allowedTemplateCodes ?? [],
      maxCopiesPerJob,
      maxPayloadBytes,
    });
    await audit(deps.audit, req, 'service_account.created', account);
    return reply.status(201).send({ account: safeAccount(account), apiKey });
  });

  app.post('/service-accounts/:id/rotate', { onRequest: [ownerOnly] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await deps.serviceAccounts.findById(id);
    if (!existing) return reply.status(404).send({ error: 'Service account not found' });
    if (!existing.isActive) return reply.status(409).send({ error: 'Revoked service accounts cannot be rotated' });
    const apiKey = issueApiKey();
    const account = await deps.serviceAccounts.update(id, {
      apiKeyHash: hashApiKey(apiKey),
      apiKeyPrefix: apiKeyPrefix(apiKey),
    });
    await audit(deps.audit, req, 'service_account.key_rotated', account, safeAccount(existing));
    return { account: safeAccount(account), apiKey };
  });

  app.post('/service-accounts/:id/revoke', { onRequest: [ownerOnly] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await deps.serviceAccounts.findById(id);
    if (!existing) return reply.status(404).send({ error: 'Service account not found' });
    const account = existing.isActive
      ? await deps.serviceAccounts.update(id, { isActive: false })
      : existing;
    if (existing.isActive) await audit(deps.audit, req, 'service_account.revoked', account, safeAccount(existing));
    return { account: safeAccount(account) };
  });
}
