import type { FastifyInstance } from 'fastify';
import type { AuditRepositoryPort } from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../infra/db/sqlite.js';
import { schemaVersion } from '../../infra/db/sqlite.schema.js';
import { requirePermission } from './permission-guard.js';

export async function databaseBackupRoutes(
  app: FastifyInstance,
  deps: { audit: AuditRepositoryPort; sqliteEnabled: boolean },
): Promise<void> {
  app.get('/system/database-backup', { onRequest: [requirePermission('user:manage')] }, async (req, reply) => {
    if (!deps.sqliteEnabled) return reply.status(409).send({ error: 'Database backup is available only with SQLite persistence' });
    const db = getDb();
    const bytes = db.export();
    const version = schemaVersion(db);
    const actor = req.user as { sub: string; email: string };
    await deps.audit.create({
      traceId: generateId(),
      action: 'database.backup_exported',
      actorId: actor.sub,
      actorEmail: actor.email,
      resourceType: 'database',
      resourceId: `schema-v${version}`,
      metadata: { schemaVersion: version, byteLength: bytes.byteLength },
    });
    const date = new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Type', 'application/vnd.sqlite3')
      .header('Content-Disposition', `attachment; filename="printops-backup-v${version}-${date}.db"`)
      .header('Cache-Control', 'no-store')
      .send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  });
}
