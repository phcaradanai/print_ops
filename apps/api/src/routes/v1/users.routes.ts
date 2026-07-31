import type { FastifyInstance } from 'fastify';
import type { UserRepositoryPort, Role } from '@printerops/domain';
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
      isActive: u.isActive,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));
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
