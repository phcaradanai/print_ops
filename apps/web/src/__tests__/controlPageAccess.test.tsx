/**
 * Page-access contract for the Web Control shell.
 *
 * Regression guard for two ways the shell used to render an empty screen:
 *  - an empty (or other-build) `allowedPages` list was treated as a whitelist
 *    matching nothing, so a non-OWNER lost every page and the sidebar;
 *  - an address that no `<Route>` claimed produced an empty `<main>` — no
 *    "not found", no way back.
 *
 * The shell reads `VITE_CONTROL_APP` once when `App.tsx` is evaluated, so the
 * env var is stubbed before the module is imported dynamically. Rendering uses
 * `renderToStaticMarkup` (SSR), matching `controlPermissions.test.tsx` and the
 * other component tests: no DOM, no network, lazy pages stay in Suspense.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '../api/client.js';
import { LocaleProvider } from '../i18n/index.js';
import { t } from '../i18n/translations.js';

type AppModule = typeof import('../App.js');

let app: AppModule;

beforeAll(async () => {
  vi.stubEnv('VITE_CONTROL_APP', 'true');
  app = await import('../App.js');
});

/** Default runtime locale is Thai (no localStorage in the test runtime). */
const th = (key: string) => t('th', key);

const VIEWER: SessionUser = {
  id: 'viewer-1',
  email: 'viewer@printerops.local',
  name: 'Viewer',
  role: 'VIEWER',
};

function renderShell(user: SessionUser, path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <LocaleProvider>
        <app.AppShell user={user} onLogout={() => {}} />
      </LocaleProvider>
    </MemoryRouter>,
  );
}

/** A routed page renders as the Suspense fallback in SSR; the gate refusing it
 *  renders the not-authorized notice instead. */
function shellShowsRoutedPage(html: string): boolean {
  return html.includes(th('common.loading'));
}

function showsNotAuthorized(html: string): boolean {
  return html.includes(th('auth.notAuthorized.title'));
}

describe('Web Control shell page access', () => {
  it('does not blank the shell for a VIEWER whose allowedPages list is empty', () => {
    const html = renderShell({ ...VIEWER, allowedPages: [] }, '/control/devices');

    // Sidebar survives: the control pages are listed again.
    expect(html).toContain('href="/control/devices"');
    expect(html).toContain('href="/control/jobs"');
    // The gate let the routed page through instead of the not-authorized panel.
    expect(showsNotAuthorized(html)).toBe(false);
    expect(shellShowsRoutedPage(html)).toBe(true);
  });

  it('does not blank the shell when the stored list belongs to the dashboard build', () => {
    // Saved by the PrintOps dashboard build: legacy paths only, none of which
    // can ever match a `/control/*` page.
    const html = renderShell(
      { ...VIEWER, allowedPages: ['/', '/jobs', '/printers'] },
      '/control/devices',
    );

    expect(html).toContain('href="/control/devices"');
    expect(html).toContain('href="/control/jobs"');
    expect(showsNotAuthorized(html)).toBe(false);
    expect(shellShowsRoutedPage(html)).toBe(true);
  });

  it('still enforces a control-build list that names specific pages', () => {
    const restricted: SessionUser = { ...VIEWER, allowedPages: ['/control/devices'] };

    const blocked = renderShell(restricted, '/control/jobs');
    expect(showsNotAuthorized(blocked)).toBe(true);
    expect(shellShowsRoutedPage(blocked)).toBe(false);
    // The sidebar is restricted to the one assigned page, not emptied.
    expect(blocked).toContain('href="/control/devices"');
    expect(blocked).not.toContain('href="/control/jobs"');

    const allowed = renderShell(restricted, '/control/devices');
    expect(showsNotAuthorized(allowed)).toBe(false);
    expect(shellShowsRoutedPage(allowed)).toBe(true);
  });

  it('renders a not-found surface for a /control/* address no route claims', () => {
    const html = renderShell({ ...VIEWER, allowedPages: [] }, '/control/not-a-real-page');

    expect(html).toContain(th('notFound.title'));
    expect(html).toContain(th('notFound.hint'));
    expect(html).toContain(th('notFound.home'));
  });
});

describe('page access helpers', () => {
  it('treats a missing or empty list as unrestricted', () => {
    expect(app.allowedPageSet(VIEWER)).toBeUndefined();
    expect(app.allowedPageSet({ ...VIEWER, allowedPages: [] })).toBeUndefined();
  });

  it('ignores a page list saved by the other build, in both directions', () => {
    const dashboardList = ['/', '/jobs'];
    const controlList = ['/control/devices', '/control/jobs'];

    expect(app.allowedPageSet({ ...VIEWER, allowedPages: dashboardList }, true)).toBeUndefined();
    expect(app.allowedPageSet({ ...VIEWER, allowedPages: controlList }, false)).toBeUndefined();

    // The same lists still restrict inside their own build.
    expect(app.allowedPageSet({ ...VIEWER, allowedPages: controlList }, true)).toEqual(controlList);
    expect(app.allowedPageSet({ ...VIEWER, allowedPages: dashboardList }, false)).toEqual(dashboardList);
  });

  it('never restricts OWNER and leaves non-nav addresses alone', () => {
    const owner: SessionUser = { ...VIEWER, role: 'OWNER', allowedPages: [] };
    expect(app.isPagePathAllowed(owner, '/control/jobs', true)).toBe(true);
    // Detail routes and /account/security have no nav item of their own.
    expect(app.isPagePathAllowed(VIEWER, undefined, true)).toBe(true);
  });

  it('picks the first page this session may open as the home target', () => {
    expect(app.firstAllowedNavPath(VIEWER, true)).toBe('/control/devices');
    expect(
      app.firstAllowedNavPath({ ...VIEWER, allowedPages: ['/control/jobs'] }, true),
    ).toBe('/control/jobs');
    expect(app.firstAllowedNavPath(VIEWER, false)).toBe('/');
  });
});
