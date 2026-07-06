import type { FastifyInstance } from 'fastify';
import type { UserRepositoryPort } from '@printerops/domain';

export async function authRoutes(
  app: FastifyInstance,
  deps: { users: UserRepositoryPort }
): Promise<void> {
  app.post('/auth/login', async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };

    const user = await deps.users.findByEmail(email);
    if (!user || !user.isActive) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // MVP: no real password check; production must hash/compare
    const token = await reply.jwtSign({ sub: user.id, role: user.role, email: user.email });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  app.get('/me', { onRequest: [app.authenticate] }, async (req) => {
    const payload = req.user as { sub: string; role: string; email: string };
    const user = await deps.users.findById(payload.sub);
    if (!user) throw new Error('User not found');
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  });
}
