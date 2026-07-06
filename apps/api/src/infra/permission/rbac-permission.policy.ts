import type { PermissionPolicyPort, PermissionContext, Permission } from '@printerops/domain';
import { ROLE_PERMISSIONS } from '@printerops/domain';
import { PermissionError } from '@printerops/shared';

export class RbacPermissionPolicy implements PermissionPolicyPort {
  can(ctx: PermissionContext, permission: Permission): boolean {
    const allowed = ROLE_PERMISSIONS[ctx.role] ?? [];
    return allowed.includes(permission);
  }

  assertCan(ctx: PermissionContext, permission: Permission): void {
    if (!this.can(ctx, permission)) {
      throw new PermissionError(permission);
    }
  }
}
