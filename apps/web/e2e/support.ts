/**
 * Shared browser-harness plumbing for the `apps/web` Playwright suites.
 *
 * The suites run against the *production* bundle in `apps/web/dist`, served as
 * plain static files (see `playwright.config.ts`). Two things have to be handled
 * for that to work, and getting either wrong produces a silently blank page
 * rather than a failed assertion:
 *
 *  1. **Document requests.** The static server knows nothing about client-side
 *     routes, so `GET /paper-profiles` is a 404. Worse, a catch-all
 *     `page.route('**\/*')` that answers by pathname will happily answer the
 *     *navigation* request with API JSON — the browser then renders the JSON as
 *     text. That is exactly why `reprint-safety.spec.ts` timed out looking for a
 *     button: the page body was the `/jobs` array. Navigations are therefore
 *     always served the built `index.html`, before any API matching runs.
 *
 *  2. **Locale.** The app defaults to Thai (`i18n/locale.tsx`), so a spec that
 *     asserts English strings must say so. `locale` is explicit here for the
 *     same reason the Thai-overflow cases need it pinned the other way.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';

const DIST = join(process.cwd(), 'apps', 'web', 'dist');
const INDEX_HTML = readFileSync(join(DIST, 'index.html'), 'utf8');

export type ApiHandler = (
  url: URL,
  route: Route,
  method: string,
) => Promise<boolean> | boolean;

export interface HarnessOptions {
  /** Dashboard language. The app itself defaults to `th`. */
  locale?: 'en' | 'th';
  /** Answers API calls. Return true when the route was handled. */
  api?: ApiHandler;
  /** Role for the mocked session. */
  role?: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
}

/** Requests that must reach the static server rather than a mock. */
function isStaticAsset(url: URL): boolean {
  return url.pathname.startsWith('/assets/') || url.pathname === '/favicon.ico';
}

/**
 * Installs auth, locale, document serving and API mocking on a page.
 *
 * Unmatched API calls are answered with a 501 instead of being passed through to
 * the static server: a 404 HTML body parsed as JSON produces a confusing error
 * far from its cause, and a test should fail on the call it forgot to mock.
 */
export async function installHarness(page: Page, options: HarnessOptions = {}): Promise<void> {
  const { locale = 'en', api, role = 'ADMIN' } = options;

  await page.addInitScript(
    ([token, chosenLocale]) => {
      localStorage.setItem('token', token);
      localStorage.setItem('printops-locale', chosenLocale);
    },
    ['synthetic-browser-token', locale] as const,
  );

  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.resourceType() === 'document') {
      return route.fulfill({ contentType: 'text/html', body: INDEX_HTML });
    }

    const url = new URL(request.url());
    if (isStaticAsset(url)) return route.continue();

    const method = request.method();
    // The whole shell sits behind a splash screen that polls this until it
    // answers, so every suite needs it before anything else can be asserted.
    if (url.pathname === '/health') {
      return route.fulfill({ json: { status: 'ok' } });
    }
    if (url.pathname === '/auth/bootstrap') {
      return route.fulfill({ json: { state: 'READY' } });
    }
    if (url.pathname === '/me') {
      return route.fulfill({
        json: {
          id: 'synthetic-admin',
          email: 'test@example.invalid',
          name: 'Synthetic Admin',
          role,
        },
      });
    }

    if (api && (await api(url, route, method))) return;
    return route.fulfill({ status: 501, json: { error: `unmocked ${method} ${url.pathname}` } });
  });
}

/** Widths the Desktop shell has to stay usable at (FE-02A viewport matrix). */
export const DESKTOP_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1100, height: 720 },
  { width: 1024, height: 768 },
] as const;

/**
 * True when the document scrolls sideways. An unintended horizontal scrollbar on
 * the application shell is the single most common symptom of a fixed-width
 * control inside a flex row, so it gets its own measurement rather than an
 * eyeballed screenshot.
 */
export async function hasHorizontalPageScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    // 1px of tolerance: sub-pixel layout rounding is not a defect.
    return doc.scrollWidth - doc.clientWidth > 1;
  });
}

/** Overflow report for the element at `selector`, for scroll-ownership checks. */
export async function overflowReport(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollsHorizontally: el.scrollWidth - el.clientWidth > 1,
      scrollsVertically: el.scrollHeight - el.clientHeight > 1,
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
    };
  }, selector);
}
