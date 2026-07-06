export type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';

export type Permission =
  | 'printer:read'
  | 'printer:create'
  | 'printer:update'
  | 'printer:control'
  | 'job:create'
  | 'job:read'
  | 'job:cancel'
  | 'job:retry'
  | 'runner:read'
  | 'runner:manage'
  | 'audit:read'
  | 'trace:read'
  | 'export:read'
  | 'user:manage'
  | 'role:manage';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: [
    'printer:read', 'printer:create', 'printer:update', 'printer:control',
    'job:create', 'job:read', 'job:cancel', 'job:retry',
    'runner:read', 'runner:manage',
    'audit:read', 'trace:read', 'export:read',
    'user:manage', 'role:manage',
  ],
  ADMIN: [
    'printer:read', 'printer:create', 'printer:update', 'printer:control',
    'job:create', 'job:read', 'job:cancel', 'job:retry',
    'runner:read', 'runner:manage',
    'audit:read', 'trace:read', 'export:read',
  ],
  OPERATOR: [
    'printer:read', 'printer:control',
    'job:create', 'job:read', 'job:cancel', 'job:retry',
    'runner:read',
    'trace:read',
  ],
  VIEWER: [
    'printer:read',
    'job:read',
    'runner:read',
    'trace:read',
  ],
};

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
