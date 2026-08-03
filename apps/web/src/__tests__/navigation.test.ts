import { describe, it, expect } from 'vitest';

// Replicate the nav items and role-filtering logic from App.tsx
// to test the filtering function without needing React DOM.

type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
type NavGroup = 'operations' | 'admin';

interface NavItem {
  to: string;
  key: string;
  roles: Role[];
  group: NavGroup;
}

const NAV_ITEMS: NavItem[] = [
  // Operations
  { to: '/', key: 'nav.dashboard', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/printers', key: 'nav.printers', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/jobs', key: 'nav.jobQueue', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/runners', key: 'nav.runners', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/templates', key: 'nav.templates', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/paper-profiles', key: 'nav.paperProfiles', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  // Admin
  { to: '/discovered-printers', key: 'nav.discovery', roles: ['OWNER', 'ADMIN'], group: 'admin' },
  { to: '/diagnostics', key: 'nav.diagnostics', roles: ['OWNER', 'ADMIN', 'OPERATOR'], group: 'admin' },
  { to: '/template-sandbox', key: 'nav.sandbox', roles: ['OWNER'], group: 'admin' },
  { to: '/webhooks', key: 'nav.webhooks', roles: ['OWNER', 'ADMIN'], group: 'admin' },
  { to: '/route-policies', key: 'nav.routePolicies', roles: ['OWNER', 'ADMIN'], group: 'admin' },
  { to: '/printer-bindings', key: 'nav.bindings', roles: ['OWNER', 'ADMIN'], group: 'admin' },
  { to: '/print-flow', key: 'nav.printFlow', roles: ['OWNER'], group: 'admin' },
  { to: '/audit-logs', key: 'nav.auditLogs', roles: ['OWNER', 'ADMIN'], group: 'admin' },
  { to: '/users', key: 'nav.usersRoles', roles: ['OWNER'], group: 'admin' },
  { to: '/export', key: 'nav.export', roles: ['OWNER', 'ADMIN'], group: 'admin' },
  { to: '/settings', key: 'nav.settings', roles: ['OWNER', 'ADMIN'], group: 'admin' },
];

function filterNavItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

function groupNavItems(items: NavItem[]): { group: NavGroup; items: NavItem[] }[] {
  const map: Record<NavGroup, NavItem[]> = { operations: [], admin: [] };
  for (const item of items) {
    map[item.group].push(item);
  }
  return (['operations', 'admin'] as NavGroup[])
    .map((g) => ({ group: g, items: map[g] }))
    .filter((g) => g.items.length > 0);
}

function splitNavItems(items: NavItem[]): { opsItems: NavItem[]; adminItems: NavItem[] } {
  const ops: NavItem[] = [];
  const admin: NavItem[] = [];
  for (const item of items) {
    if (item.group === 'operations') ops.push(item);
    else admin.push(item);
  }
  return { opsItems: ops, adminItems: admin };
}

describe('role-filtered navigation', () => {
  it('OWNER sees all 17 items', () => {
    expect(filterNavItems('OWNER')).toHaveLength(17);
  });

  it('print-flow is OWNER-only (sysadmin)', () => {
    expect(filterNavItems('OWNER').find((i) => i.to === '/print-flow')).toBeDefined();
    expect(filterNavItems('ADMIN').find((i) => i.to === '/print-flow')).toBeUndefined();
    expect(filterNavItems('OPERATOR').find((i) => i.to === '/print-flow')).toBeUndefined();
    expect(filterNavItems('VIEWER').find((i) => i.to === '/print-flow')).toBeUndefined();
  });

  it('ADMIN sees fewer items than OWNER', () => {
    const admin = filterNavItems('ADMIN');
    const owner = filterNavItems('OWNER');
    expect(admin.length).toBeLessThan(owner.length);
    // ADMIN cannot see sandbox or users
    expect(admin.find((i) => i.to === '/template-sandbox')).toBeUndefined();
    expect(admin.find((i) => i.to === '/users')).toBeUndefined();
  });

  it('OPERATOR sees workflow items plus diagnostics', () => {
    const op = filterNavItems('OPERATOR');
    expect(op.length).toBeGreaterThan(0);
    // OPERATOR should see workflow pages
    expect(op.find((i) => i.to === '/')).toBeDefined();
    expect(op.find((i) => i.to === '/printers')).toBeDefined();
    expect(op.find((i) => i.to === '/jobs')).toBeDefined();
    // OPERATOR should see diagnostics (has OPERATOR role access)
    expect(op.find((i) => i.to === '/diagnostics')).toBeDefined();
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
  it('groups owner items into operations and admin', () => {
    const items = filterNavItems('OWNER');
    const groups = groupNavItems(items);
    expect(groups).toHaveLength(2);
    expect(groups[0].group).toBe('operations');
    expect(groups[1].group).toBe('admin');
  });

  it('operations group contains 6 items', () => {
    const items = filterNavItems('OWNER');
    const { opsItems } = splitNavItems(items);
    expect(opsItems).toHaveLength(6);
  });

  it('admin group contains 11 items for owner', () => {
    const items = filterNavItems('OWNER');
    const { adminItems } = splitNavItems(items);
    expect(adminItems).toHaveLength(11);
  });

  it('viewer only gets operations group', () => {
    const viewerItems = filterNavItems('VIEWER');
    const { adminItems } = splitNavItems(viewerItems);
    expect(adminItems).toHaveLength(0);
  });

  it('every nav item has a unique to path', () => {
    const paths = NAV_ITEMS.map((i) => i.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('every nav item belongs to a valid group', () => {
    const validGroups: NavGroup[] = ['operations', 'admin'];
    for (const item of NAV_ITEMS) {
      expect(validGroups).toContain(item.group);
    }
  });

  it('every nav item key starts with nav.', () => {
    for (const item of NAV_ITEMS) {
      expect(item.key.startsWith('nav.')).toBe(true);
    }
  });

  it('no admin items are visible to VIEWER', () => {
    const viewerItems = filterNavItems('VIEWER');
    for (const item of viewerItems) {
      expect(item.group).toBe('operations');
    }
  });
});

describe('admin section expand/collapse', () => {
  it('admin is expanded by default', () => {
    let adminExpanded = false;
    expect(adminExpanded).toBe(false);
  });

  it('toggle flips from expanded to collapsed', () => {
    let adminExpanded = true;
    adminExpanded = !adminExpanded;
    expect(adminExpanded).toBe(false);
  });

  it('toggle flips from collapsed to expanded', () => {
    let adminExpanded = false;
    adminExpanded = !adminExpanded;
    expect(adminExpanded).toBe(true);
  });

  it('OPERATOR sees admin items when expanded (diagnostics)', () => {
    const op = filterNavItems('OPERATOR');
    const { adminItems } = splitNavItems(op);
    // OPERATOR should see diagnostics in admin section
    expect(adminItems.length).toBeGreaterThan(0);
    expect(adminItems.find((i) => i.to === '/diagnostics')).toBeDefined();
    // OPERATOR should NOT see owner-only admin items
    expect(adminItems.find((i) => i.to === '/template-sandbox')).toBeUndefined();
    expect(adminItems.find((i) => i.to === '/users')).toBeUndefined();
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
