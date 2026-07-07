import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Permission, Role } from '@printerops/domain';
import { ROLE_PERMISSIONS } from '@printerops/domain';

type AuthenticatedUser = {
  sub?: string;
  role?: Role;
  email?: string;
};

export function requirePermission(permission: Permission) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch (err) {
      return reply.send(err);
    }

    const user = req.user as AuthenticatedUser;
    const role = user.role;
    if (!role || !ROLE_PERMISSIONS[role]?.includes(permission)) {
      return reply.status(403).send({ error: `Missing permission: ${permission}` });
    }
  };
}

export function actor(req: FastifyRequest): string {
  return ((req.user as AuthenticatedUser)?.sub) ?? 'unknown';
}
