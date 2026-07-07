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
  | 'role:manage'
  | 'template:read'
  | 'template:create'
  | 'template:update'
  | 'template:preview'
  | 'template:publish'
  | 'template:delete'
  | 'paper-profile:read'
  | 'paper-profile:create'
  | 'paper-profile:update'
  | 'paper-profile:delete'
  | 'webhook:read'
  | 'webhook:create'
  | 'webhook:update'
  | 'webhook:test'
  | 'webhook:disable'
  | 'sandbox:access'
  | 'sandbox:render-preview'
  | 'sandbox:send-test-print';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: [
    'printer:read', 'printer:create', 'printer:update', 'printer:control',
    'job:create', 'job:read', 'job:cancel', 'job:retry',
    'runner:read', 'runner:manage',
    'audit:read', 'trace:read', 'export:read',
    'user:manage', 'role:manage',
    'template:read', 'template:create', 'template:update', 'template:preview', 'template:publish', 'template:delete',
    'paper-profile:read', 'paper-profile:create', 'paper-profile:update', 'paper-profile:delete',
    'webhook:read', 'webhook:create', 'webhook:update', 'webhook:test', 'webhook:disable',
    'sandbox:access', 'sandbox:render-preview', 'sandbox:send-test-print',
  ],
  ADMIN: [
    'printer:read', 'printer:create', 'printer:update', 'printer:control',
    'job:create', 'job:read', 'job:cancel', 'job:retry',
    'runner:read', 'runner:manage',
    'audit:read', 'trace:read', 'export:read',
    'template:read', 'template:create', 'template:update', 'template:preview', 'template:publish',
    'paper-profile:read', 'paper-profile:create', 'paper-profile:update',
    'webhook:read', 'webhook:create', 'webhook:update', 'webhook:test', 'webhook:disable',
  ],
  OPERATOR: [
    'printer:read', 'printer:control',
    'job:create', 'job:read', 'job:cancel', 'job:retry',
    'runner:read',
    'trace:read',
    'template:read',
    'paper-profile:read',
  ],
  VIEWER: [
    'printer:read',
    'job:read',
    'runner:read',
    'trace:read',
    'template:read',
    'paper-profile:read',
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
