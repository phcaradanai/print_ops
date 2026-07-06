import type { Permission, Role } from '../models/user.js';

export interface PermissionContext {
  userId: string;
  role: Role;
}

export interface PermissionPolicyPort {
  can(ctx: PermissionContext, permission: Permission): boolean;
  assertCan(ctx: PermissionContext, permission: Permission): void;
}
