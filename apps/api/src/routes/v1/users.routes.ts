import type { FastifyInstance } from 'fastify';
import { APP_PAGES, type AppPage, type UserRepositoryPort, type Role } from '@printerops/domain';
import { hashPassword, validatePassword } from '../../infra/auth/password.js';

const ROLE_LEVELS: Record<Role, number> = {
  VIEWER: 1,
  OPERATOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

export async function v1UserRoutes(
  app: FastifyInstance,
  deps: { users: UserRepositoryPort }
): Promise<void> {
  app.get('/users', { onRequest: [app.authenticate] }, async (req) => {
    const payload = req.user as { sub: string; role: Role; email: string };
    const viewerLevel = ROLE_LEVELS[payload.role] ?? 0;

    // Password hashes are never returned. A caller may only enumerate accounts
    // at their own role level or below, so lower roles cannot discover OWNER or
    // other privileged identities through the API even if the UI route is
    // hidden from them.
    const users = await deps.users.findAll();
    return users.filter(u => (ROLE_LEVELS[u.role] ?? 0) <= viewerLevel).map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      allowedPages: u.role === 'OWNER' ? [...APP_PAGES] : u.allowedPages,
      isActive: u.isActive,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
  }));
  });

  app.put('/users/:id/access', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { allowedPages } = (req.body ?? {}) as { allowedPages?: string[] };
    const payload = req.user as { sub: string; role: Role };
    if (!Array.isArray(allowedPages) || allowedPages.some(page => !APP_PAGES.includes(page as AppPage))) {
      return reply.status(400).send({ error: 'allowedPages must contain only known application pages' });
    }
    const currentUser = await deps.users.findById(payload.sub);
    const targetUser = await deps.users.findById(id);
    if (!currentUser) return reply.status(401).send({ error: 'Unauthorized' });
    if (!targetUser) return reply.status(404).send({ error: 'User not found' });
    if (targetUser.role === 'OWNER') return reply.status(403).send({ error: 'OWNER always has access to every page' });
    if (currentUser.id === targetUser.id || ROLE_LEVELS[currentUser.role] <= ROLE_LEVELS[targetUser.role]) {
      return reply.status(403).send({ error: 'Only a higher role may change this user access' });
    }
    const updated = await deps.users.update(id, { allowedPages: [...new Set(allowedPages)] as AppPage[] });
    return { id: updated.id, allowedPages: updated.allowedPages ?? [] };
  });

  app.put('/users/:id/status', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { isActive } = (req.body ?? {}) as { isActive?: unknown };
    const payload = req.user as { sub: string; role: Role };
    if (typeof isActive !== 'boolean') {
      return reply.status(400).send({ error: 'isActive must be a boolean' });
    }
    const currentUser = await deps.users.findById(payload.sub);
    const targetUser = await deps.users.findById(id);
    if (!currentUser) return reply.status(401).send({ error: 'Unauthorized' });
    if (!targetUser) return reply.status(404).send({ error: 'User not found' });
    if (targetUser.role === 'OWNER') {
      return reply.status(403).send({ error: 'OWNER account status cannot be changed' });
    }
    if (currentUser.id === targetUser.id || ROLE_LEVELS[currentUser.role] <= ROLE_LEVELS[targetUser.role]) {
      return reply.status(403).send({ error: 'Only a higher role may change this user status' });
    }
    const updated = await deps.users.update(id, { isActive });
    return { id: updated.id, isActive: updated.isActive };
  });

  app.put('/users/:id/password', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { password } = req.body as { password?: string };
    const payload = req.user as { sub: string; role: Role; email: string };

    if (!password) {
      return reply.status(400).send({ error: 'Password is required' });
    }
    const validation = validatePassword(password);
    if (!validation.valid) return reply.status(400).send({ error: validation.error });

    const currentUser = await deps.users.findById(payload.sub);
    const targetUser = await deps.users.findById(id);

    if (!currentUser) return reply.status(401).send({ error: 'Unauthorized' });
    if (!targetUser) return reply.status(404).send({ error: 'User not found' });

    if (currentUser.id !== targetUser.id) {
      const currentLevel = ROLE_LEVELS[currentUser.role] ?? 0;
      const targetLevel = ROLE_LEVELS[targetUser.role] ?? 0;
      if (currentLevel <= targetLevel) {
        return reply.status(403).send({ error: 'Not authorized to change password for this role' });
      }
    }

    await deps.users.update(id, { passwordHash: await hashPassword(password) });

    return { success: true };
  });
}
