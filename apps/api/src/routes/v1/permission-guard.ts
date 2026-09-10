import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Permission, Role } from '@printerops/domain';
import { ROLE_PERMISSIONS } from '@printerops/domain';

type AuthenticatedUser = {
  sub?: string;
  role?: Role;
  email?: string;
  kind?: string;
};

export function requirePermission(permission: Permission) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch (err) {
      return reply.send(err);
    }

    const user = req.user as AuthenticatedUser;
    if (user.kind === 'runner' && permission !== 'runner:read' && permission !== 'runner:manage') {
      return reply.status(403).send({ error: 'Runner credentials cannot access operator APIs' });
    }
    const role = user.role;
    if (!role || !ROLE_PERMISSIONS[role]?.includes(permission)) {
      return reply.status(403).send({ error: `Missing permission: ${permission}` });
    }
  };
}

/**
 * Allows the bundled updater to probe/reconcile the local API without carrying
 * a human JWT. The token is per installation, and the bypass is accepted only
 * from the loopback interface; all normal callers still use the permission
 * guard above.
 */
export function requirePermissionOrInternal(permission: Permission, internalToken?: string) {
  const permissionGuard = requirePermission(permission);
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (isInternalRequest(req, internalToken)) return;
    return permissionGuard(req, reply);
  };
}

export function requireInternalToken(internalToken?: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (isInternalRequest(req, internalToken)) return;
    return reply.status(401).send({ error: 'Invalid local updater credential' });
  };
}

function isInternalRequest(req: FastifyRequest, internalToken?: string): boolean {
  const supplied = req.headers['x-printops-ota-token'];
  const remote = req.ip.replace(/^::ffff:/, '');
  return Boolean(
    internalToken
    && typeof supplied === 'string'
    && supplied === internalToken
    && (remote === '127.0.0.1' || remote === '::1'),
  );
}

export function actor(req: FastifyRequest): string {
  return ((req.user as AuthenticatedUser)?.sub) ?? 'unknown';
}
