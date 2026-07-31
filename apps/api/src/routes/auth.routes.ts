import type { FastifyInstance } from 'fastify';
import type { UserRepositoryPort } from '@printerops/domain';
import { createHash, timingSafeEqual } from 'node:crypto';
import { hashPassword, validatePassword, verifyPassword } from '../infra/auth/password.js';

export async function authRoutes(
  app: FastifyInstance,
  deps: { users: UserRepositoryPort; runnerBootstrapSecret?: string }
): Promise<void> {
  let bootstrapInFlight: Promise<unknown> | undefined;

  const bootstrapState = async () => {
    const users = await deps.users.findAll();
    const owner = users.find((user) => user.role === 'OWNER' && user.isActive && user.passwordHash?.startsWith('scrypt$'));
    return owner ? 'READY' as const : users.length > 0 ? 'MIGRATION_REQUIRED' as const : 'REQUIRED_NEW' as const;
  };

  app.get('/auth/bootstrap', async () => ({ state: await bootstrapState() }));

  app.post('/auth/bootstrap', async (req, reply) => {
    if (bootstrapInFlight) {
      await bootstrapInFlight;
      return reply.status(409).send({ error: 'Owner setup has already completed' });
    }
    const body = (req.body ?? {}) as { name?: string; email?: string; password?: string; passwordConfirmation?: string };
    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? '';
    if (!name || !email || !email.includes('@')) return reply.status(400).send({ error: 'A valid name and email are required' });
    if (password !== body.passwordConfirmation) return reply.status(400).send({ error: 'Passwords do not match' });
    const validation = validatePassword(password);
    if (!validation.valid) return reply.status(400).send({ error: validation.error });

    const operation = (async () => {
      if (await bootstrapState() === 'READY') throw Object.assign(new Error('Owner setup has already completed'), { statusCode: 409 });
      const users = await deps.users.findAll();
      const existingLegacyOwners = users.filter((user) => user.role === 'OWNER' && !user.passwordHash);
      if (existingLegacyOwners.length > 0 && !existingLegacyOwners.some((owner) => owner.email.toLowerCase() === email)) {
        throw Object.assign(new Error('Use the email address of an existing owner to migrate this installation'), { statusCode: 409 });
      }
      const legacyOwner = users.find((user) => user.role === 'OWNER' && user.email.toLowerCase() === email);
      const passwordHash = await hashPassword(password);
      const owner = legacyOwner
        ? await deps.users.update(legacyOwner.id, { name, passwordHash, isActive: true })
        : await deps.users.create({ name, email, passwordHash, role: 'OWNER', isActive: true });
      for (const user of users) {
        if (user.id !== owner.id && !user.passwordHash) await deps.users.update(user.id, { isActive: false });
      }
      return owner;
    })();
    bootstrapInFlight = operation;
    try {
      const owner = await operation;
      const token = await reply.jwtSign({ sub: owner.id, role: owner.role, email: owner.email });
      return { token, user: { id: owner.id, email: owner.email, name: owner.name, role: owner.role } };
    } finally {
      bootstrapInFlight = undefined;
    }
  });

  app.post('/auth/login', async (req, reply) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (!email || !password) return reply.status(400).send({ error: 'Email and password are required' });

    const user = await deps.users.findByEmail(email);
    if (!user || !user.isActive) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = await reply.jwtSign({ sub: user.id, role: user.role, email: user.email });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  app.post('/auth/runner', async (req, reply) => {
    const supplied = ((req.body ?? {}) as { secret?: string }).secret ?? '';
    const expected = deps.runnerBootstrapSecret ?? '';
    const suppliedHash = createHash('sha256').update(supplied).digest();
    const expectedHash = createHash('sha256').update(expected).digest();
    if (!expected || !supplied || !timingSafeEqual(suppliedHash, expectedHash)) {
      return reply.status(401).send({ error: 'Invalid runner bootstrap credential' });
    }
    const token = await reply.jwtSign({
      sub: 'desktop-discovery-runner',
      role: 'ADMIN',
      email: 'desktop-runner@localhost',
      kind: 'runner',
    }, { expiresIn: '24h' });
    return { token };
  });

  app.get('/me', { onRequest: [app.authenticate] }, async (req) => {
    const payload = req.user as { sub: string; role: string; email: string };
    const user = await deps.users.findById(payload.sub);
    if (!user) throw new Error('User not found');
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  });
}
