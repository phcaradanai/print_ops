export type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
export type Permission = 'printer:read' | 'printer:create' | 'printer:update' | 'printer:control' | 'job:create' | 'job:read' | 'job:cancel' | 'job:retry' | 'runner:read' | 'runner:manage' | 'audit:read' | 'trace:read' | 'export:read' | 'user:manage' | 'role:manage';
export declare const ROLE_PERMISSIONS: Record<Role, Permission[]>;
export interface User {
    id: string;
    email: string;
    name: string;
    role: Role;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}
//# sourceMappingURL=user.d.ts.map