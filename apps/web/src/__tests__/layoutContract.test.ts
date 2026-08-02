/**
 * Guard for the page-level region contract described in
 * docs/frontend/LAYOUT_COMPONENT_STANDARD.md.
 *
 * Intent: `PageScaffold` (via the `PageLayout` facade) owns the canonical
 * header / body / detail / footer anatomy for every route. Adoption at the
 * import level was already complete when this guard was written, so the risk
 * this catches is *drift*: a new route that composes its own layout, or an
 * existing route that grows a second landmark structure inside `children` and
 * silently bypasses the scaffold's document order, spacing, and landmarks.
 *
 * Scope is deliberately narrow — route modules reachable from App.tsx, plus
 * one level of `export { default } from` re-export (that is how
 * pages/PaperProfiles.tsx points at features/paper-profiles/). It must not
 * fire on molecules/organisms that legitimately own a landmark of their own
 * (PageHeader, PageFooter, PageScaffold, ui/surfaces.tsx, ui/Drawer.tsx), nor
 * on dialogs, which are not page regions.
 *
 * A nested component can still smuggle a landmark past this check. That is an
 * accepted limit: the guard makes the common, reviewable case impossible to
 * land by accident, and the standard covers the rest in review.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));

/** Landmarks a page must delegate to PageLayout's header/detail/footer slots. */
const RAW_LANDMARK = /<(header|footer|aside)[\s/>]/g;

/** Block and line comments, so prose about `<aside>` never trips the scan. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Route modules as App.tsx itself declares them: `lazy(() => import('./pages/X.js'))`. */
export function findRouteModuleSpecifiers(appSource: string): string[] {
  const matches = stripComments(appSource).matchAll(/import\(\s*'(\.\/pages\/[^']+)'\s*\)/g);
  return [...new Set([...matches].map((match) => match[1]!))];
}

/** `export { default } from '…'` — the one re-export hop the guard follows. */
export function findDefaultReExport(source: string): string | null {
  const match = /export\s*\{[^}]*\bdefault\b[^}]*\}\s*from\s*'([^']+)'/.exec(stripComments(source));
  return match ? match[1]! : null;
}

function specifierToPath(fromFile: string, specifier: string): string {
  return resolve(dirname(fromFile), specifier.replace(/\.js$/, '.tsx'));
}

export interface PageSource {
  path: string;
  source: string;
}

/**
 * Violations for one page-level module. Returns human-readable reasons so a
 * failure names the rule that was broken, not just the file.
 */
export function checkPageSource({ path, source }: PageSource): string[] {
  const code = stripComments(source);
  const violations: string[] = [];

  const importsScaffold = /import\s*\{[^}]*\b(PageLayout|PageScaffold)\b[^}]*\}\s*from\s*'[^']+'/.test(code);
  const rendersScaffold = /<(PageLayout|PageScaffold)[\s/>]/.test(code);
  if (!importsScaffold || !rendersScaffold) {
    violations.push(
      `${path}: must compose through PageLayout/PageScaffold (imported: ${importsScaffold}, rendered: ${rendersScaffold})`,
    );
  }

  for (const match of code.matchAll(RAW_LANDMARK)) {
    violations.push(
      `${path}: renders a raw <${match[1]}> — pass it through PageLayout's header/detail/footer slot instead`,
    );
  }

  return violations;
}

/** Every route module plus the workspace it re-exports, read from disk. */
export function collectPageSources(srcDir = SRC_DIR): PageSource[] {
  const appPath = join(srcDir, 'App.tsx');
  const pages: PageSource[] = [];

  for (const specifier of findRouteModuleSpecifiers(readFileSync(appPath, 'utf8'))) {
    const routePath = specifierToPath(appPath, specifier);
    const routeSource = readFileSync(routePath, 'utf8');
    const reExport = findDefaultReExport(routeSource);

    // A pure re-export barrel owns no layout; the workspace behind it does.
    if (reExport) {
      const targetPath = specifierToPath(routePath, reExport);
      pages.push({ path: relative(srcDir, targetPath), source: readFileSync(targetPath, 'utf8') });
    } else {
      pages.push({ path: relative(srcDir, routePath), source: routeSource });
    }
  }

  return pages;
}

describe('page layout contract', () => {
  const pages = collectPageSources();

  it('finds every route module declared in App.tsx', () => {
    expect(pages.length).toBe(19);
  });

  it('composes every route through PageLayout/PageScaffold with no raw landmarks', () => {
    const violations = pages.flatMap((page) => checkPageSource(page));
    expect(violations).toEqual([]);
  });

  it('resolves a re-export barrel to the workspace that owns the layout', () => {
    expect(pages.map((page) => page.path)).toContain(
      join('features', 'paper-profiles', 'PaperProfileWorkspace.tsx'),
    );
    expect(pages.map((page) => page.path)).not.toContain(join('pages', 'PaperProfiles.tsx'));
  });
});

describe('page layout contract guard', () => {
  const compliant = `
    import { PageLayout } from '../components/PageLayout.js';
    export default function Ok() {
      return <PageLayout title="Ok" detail={<Evidence />}>Body</PageLayout>;
    }
  `;

  it('passes a page that composes through PageLayout', () => {
    expect(checkPageSource({ path: 'pages/Ok.tsx', source: compliant })).toEqual([]);
  });

  it('fails a page that builds its own layout', () => {
    const source = `
      export default function Drifted() {
        return <article><h1>Drifted</h1>Body</article>;
      }
    `;
    expect(checkPageSource({ path: 'pages/Drifted.tsx', source }).join('\n')).toContain(
      'must compose through PageLayout/PageScaffold',
    );
  });

  it('fails a page that imports PageLayout but never renders it', () => {
    const source = `
      import { PageLayout } from '../components/PageLayout.js';
      export default function Unused() { return <div>Body</div>; }
    `;
    expect(checkPageSource({ path: 'pages/Unused.tsx', source }).join('\n')).toContain('rendered: false');
  });

  it.each(['header', 'footer', 'aside'])('fails a page that renders a raw <%s>', (tag) => {
    const source = `
      import { PageLayout } from '../components/PageLayout.js';
      export default function Raw() {
        return <PageLayout title="Raw"><${tag} className="x">side</${tag}></PageLayout>;
      }
    `;
    expect(checkPageSource({ path: 'pages/Raw.tsx', source }).join('\n')).toContain(`renders a raw <${tag}>`);
  });

  it('does not fire on prose about landmarks in comments', () => {
    const source = `
      import { PageLayout } from '../components/PageLayout.js';
      export default function Documented() {
        // Not a <aside> region: this is part of the primary task.
        /* Nor a <header> or <footer>. */
        return <PageLayout title="Documented">Body</PageLayout>;
      }
    `;
    expect(checkPageSource({ path: 'pages/Documented.tsx', source })).toEqual([]);
  });

  it('reads route modules from App.tsx rather than globbing pages/', () => {
    const appSource = `
      const Dashboard = lazy(() => import('./pages/Dashboard.js'));
      const Templates = lazy(() => import('./pages/Templates.js'));
    `;
    // pages/TemplateRowMenu.tsx is a helper, not a route: a glob would flag it.
    expect(findRouteModuleSpecifiers(appSource)).toEqual(['./pages/Dashboard.js', './pages/Templates.js']);
  });

  it('follows a default re-export barrel one level', () => {
    const barrel = `export {\n  default,\n} from '../features/paper-profiles/PaperProfileWorkspace.js';`;
    expect(findDefaultReExport(barrel)).toBe('../features/paper-profiles/PaperProfileWorkspace.js');
    expect(findDefaultReExport(compliant)).toBeNull();
  });
});
