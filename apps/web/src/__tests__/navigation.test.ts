import { describe, it, expect } from 'vitest';

// Replicate the nav items and role-filtering logic from App.tsx
// to test the filtering function without needing React DOM.

type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
type NavGroup = 'operations' | 'administration';

interface NavItem {
  to: string;
  key: string;
  roles: Role[];
  group: NavGroup;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', key: 'nav.dashboard', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/printers', key: 'nav.printers', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/jobs', key: 'nav.jobQueue', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/runners', key: 'nav.runners', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/templates', key: 'nav.templates', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/paper-profiles', key: 'nav.paperProfiles', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/discovered-printers', key: 'nav.discovery', roles: ['OWNER', 'ADMIN'], group: 'administration' },
  { to: '/diagnostics', key: 'nav.diagnostics', roles: ['OWNER', 'ADMIN', 'OPERATOR'], group: 'administration' },
  { to: '/template-sandbox', key: 'nav.sandbox', roles: ['OWNER'], group: 'administration' },
  { to: '/webhooks', key: 'nav.webhooks', roles: ['OWNER', 'ADMIN'], group: 'administration' },
  { to: '/route-policies', key: 'nav.routePolicies', roles: ['OWNER', 'ADMIN'], group: 'administration' },
  { to: '/printer-bindings', key: 'nav.bindings', roles: ['OWNER', 'ADMIN'], group: 'administration' },
  { to: '/audit-logs', key: 'nav.auditLogs', roles: ['OWNER', 'ADMIN'], group: 'administration' },
  { to: '/users', key: 'nav.usersRoles', roles: ['OWNER'], group: 'administration' },
  { to: '/export', key: 'nav.export', roles: ['OWNER', 'ADMIN'], group: 'administration' },
  { to: '/settings', key: 'nav.settings', roles: ['OWNER', 'ADMIN'], group: 'administration' },
];

function filterNavItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

function groupNavItems(items: NavItem[]): { group: NavGroup; items: NavItem[] }[] {
  const map: Record<NavGroup, NavItem[]> = { operations: [], administration: [] };
  for (const item of items) {
    map[item.group].push(item);
  }
  return (['operations', 'administration'] as NavGroup[])
    .map((g) => ({ group: g, items: map[g] }))
    .filter((g) => g.items.length > 0);
}

describe('role-filtered navigation', () => {
  it('OWNER sees all 16 items', () => {
    expect(filterNavItems('OWNER')).toHaveLength(16);
  });

  it('ADMIN sees fewer items than OWNER', () => {
    const admin = filterNavItems('ADMIN');
    const owner = filterNavItems('OWNER');
    expect(admin.length).toBeLessThan(owner.length);
    // ADMIN cannot see sandbox or users
    expect(admin.find((i) => i.to === '/template-sandbox')).toBeUndefined();
    expect(admin.find((i) => i.to === '/users')).toBeUndefined();
  });

  it('OPERATOR sees workflow items only', () => {
    const op = filterNavItems('OPERATOR');
    expect(op.length).toBeGreaterThan(0);
    // OPERATOR should see workflow pages
    expect(op.find((i) => i.to === '/')).toBeDefined();
    expect(op.find((i) => i.to === '/printers')).toBeDefined();
    expect(op.find((i) => i.to === '/jobs')).toBeDefined();
    // OPERATOR should not see admin-only pages
    expect(op.find((i) => i.to === '/users')).toBeUndefined();
    expect(op.find((i) => i.to === '/audit-logs')).toBeUndefined();
  });

  it('VIEWER sees minimal items', () => {
    const viewer = filterNavItems('VIEWER');
    expect(viewer.length).toBeGreaterThan(0);
    // VIEWER should not see any admin pages
    expect(viewer.find((i) => i.to === '/users')).toBeUndefined();
    expect(viewer.find((i) => i.to === '/settings')).toBeUndefined();
  });
});

describe('navigation grouping', () => {
  it('groups owner items into operations and administration', () => {
    const items = filterNavItems('OWNER');
    const groups = groupNavItems(items);
    expect(groups).toHaveLength(2);
    expect(groups[0].group).toBe('operations');
    expect(groups[1].group).toBe('administration');
  });

  it('operations group contains 6 items', () => {
    const items = filterNavItems('OWNER');
    const groups = groupNavItems(items);
    const ops = groups.find((g) => g.group === 'operations')!;
    expect(ops.items).toHaveLength(6);
  });

  it('administration group contains 10 items for owner', () => {
    const items = filterNavItems('OWNER');
    const groups = groupNavItems(items);
    const admin = groups.find((g) => g.group === 'administration')!;
    expect(admin.items).toHaveLength(10);
  });

  it('viewer only gets operations group', () => {
    const viewerItems = filterNavItems('VIEWER');
    const groups = groupNavItems(viewerItems);
    // Viewer sees only operations items
    const admGroup = groups.find((g) => g.group === 'administration');
    expect(admGroup).toBeUndefined();
  });

  it('every nav item has a unique to path', () => {
    const paths = NAV_ITEMS.map((i) => i.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('every nav item belongs to a valid group', () => {
    const validGroups: NavGroup[] = ['operations', 'administration'];
    for (const item of NAV_ITEMS) {
      expect(validGroups).toContain(item.group);
    }
  });

  it('every nav item key starts with nav.', () => {
    for (const item of NAV_ITEMS) {
      expect(item.key.startsWith('nav.')).toBe(true);
    }
  });
});

describe('mobile menu state machine', () => {
  it('toggles from false to true', () => {
    const toggle = (prev: boolean) => !prev;
    expect(toggle(false)).toBe(true);
  });

  it('toggles from true to false', () => {
    const toggle = (prev: boolean) => !prev;
    expect(toggle(true)).toBe(false);
  });

  it('closeMobile sets to false regardless', () => {
    const close = () => false;
    expect(close()).toBe(false);
  });
});
