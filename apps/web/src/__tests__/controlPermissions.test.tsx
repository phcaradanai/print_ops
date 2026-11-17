import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { APP_PAGES, ROLE_PERMISSIONS, type Permission, type Role } from '@printerops/domain';
import { SessionProvider, useHasPermission } from '../api/session.js';
import type { SessionUser } from '../api/client.js';

function PermissionProbe({ permission }: { permission: Permission }) {
  const allowed = useHasPermission(permission);
  return <span>{allowed ? 'ALLOWED' : 'DENIED'}</span>;
}

function checkUiPermission(role: Role, permission: Permission): boolean {
  const user: SessionUser = {
    id: `u-${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@printerops.local`,
    name: role,
    role,
  };
  const html = renderToStaticMarkup(
    <SessionProvider user={user}>
      <PermissionProbe permission={permission} />
    </SessionProvider>,
  );
  return html.includes('ALLOWED');
}

describe('Web Control RBAC and page access contract', () => {
  it('registers all Web Control pages in APP_PAGES for per-user allowedPages assignment', () => {
    for (const page of [
      '/control/devices',
      '/control/jobs',
      '/control/content',
      '/control/paper-profiles',
      '/control/templates',
      '/control/releases',
      '/control/users',
    ] as const) {
      expect(APP_PAGES).toContain(page);
    }
  });

  it('enforces control:manage only for OWNER and ADMIN', () => {
    expect(checkUiPermission('OWNER', 'control:manage')).toBe(true);
    expect(checkUiPermission('ADMIN', 'control:manage')).toBe(true);
    expect(checkUiPermission('OPERATOR', 'control:manage')).toBe(false);
    expect(checkUiPermission('VIEWER', 'control:manage')).toBe(false);
  });

  it('enforces control:read for every human role and job:retry for OPERATOR+', () => {
    for (const role of ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] as const) {
      expect(checkUiPermission(role, 'control:read')).toBe(true);
    }
    expect(checkUiPermission('OWNER', 'job:retry')).toBe(true);
    expect(checkUiPermission('ADMIN', 'job:retry')).toBe(true);
    expect(checkUiPermission('OPERATOR', 'job:retry')).toBe(true);
    expect(checkUiPermission('VIEWER', 'job:retry')).toBe(false);
    expect(ROLE_PERMISSIONS.VIEWER).not.toContain('control:manage');
  });
});
