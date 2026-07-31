import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type FormEvent,
} from 'react';
import { bootstrapOwner, getBootstrapState, getCurrentUser, login, logout, healthUrl, onUnauthorized, type BootstrapInfo, type SessionUser } from './api/client.js';
import { SessionProvider } from './api/session.js';
import { LocaleProvider, useLocale } from './i18n/index.js';
import { RouteErrorBoundary } from './components/RouteErrorBoundary.js';
import { errorMessage } from './api/errors.js';

const Dashboard = lazy(() => import('./pages/Dashboard.js'));
const Printers = lazy(() => import('./pages/Printers.js'));
const PrinterDetail = lazy(() => import('./pages/PrinterDetail.js'));
const JobQueue = lazy(() => import('./pages/JobQueue.js'));
const JobDetail = lazy(() => import('./pages/JobDetail.js'));
const Runners = lazy(() => import('./pages/Runners.js'));
const AuditLogs = lazy(() => import('./pages/AuditLogs.js'));
const UsersRoles = lazy(() => import('./pages/UsersRoles.js'));
const ExportCenter = lazy(() => import('./pages/ExportCenter.js'));
const Settings = lazy(() => import('./pages/Settings.js'));
const DiscoveredPrinters = lazy(() => import('./pages/DiscoveredPrinters.js'));
const LocalDiagnostics = lazy(() => import('./pages/LocalDiagnostics.js'));
const Templates = lazy(() => import('./pages/Templates.js'));
const PaperProfiles = lazy(() => import('./pages/PaperProfiles.js'));
const TemplateSandbox = lazy(() => import('./pages/TemplateSandbox.js'));
const Webhooks = lazy(() => import('./pages/Webhooks.js'));
const RoutePolicies = lazy(() => import('./pages/RoutePolicies.js'));
const PrinterBindings = lazy(() => import('./pages/PrinterBindings.js'));
const PrintFlowBindings = lazy(() => import('./pages/PrintFlowBindings.js'));

// ----- navigation definition -----

type NavGroup = 'operations' | 'admin';

interface NavItem {
  to: string;
  key: string;
  roles: SessionUser['role'][];
  group: NavGroup;
  icon: string;
}

/** Per-item icon for visual scanning. Single Unicode char designed for system fonts. */
const NAV_ITEM_ICONS: Record<string, string> = {
  '/': '\u{1F3E0}',                   // 🏠 Dashboard
  '/printers': '\u{1F5A8}',            // 🖨️ Printers
  '/jobs': '\u{1F4CB}',                // 📋 Job Queue
  '/runners': '\u{26A1}',              // ⚡ Runners
  '/templates': '\u{1F4C4}',           // 📄 Templates
  '/paper-profiles': '\u{1F4D0}',      // 📐 Paper Profiles
  '/discovered-printers': '\u{1F50D}', // 🔍 Printer Discovery
  '/diagnostics': '\u{1F527}',          // 🔧 Runner Diagnostics
  '/template-sandbox': '\u{1F9EA}',    // 🧪 Template Sandbox
  '/webhooks': '\u{1F517}',            // 🔗 Webhooks
  '/route-policies': '\u{1F5FA}',      // 🗺️ Route Policies
  '/printer-bindings': '\u{1F4CE}',    // 📎 Printer Bindings
  '/print-flow': '\u{1F500}',          // 🔀 Print Flow (dynamic bindings)
  '/audit-logs': '\u{1F4DD}',          // 📝 Audit Logs
  '/users': '\u{1F465}',               // 👥 Users & Roles
  '/export': '\u{1F4E4}',              // 📤 Export Center
  '/settings': '\u{2699}',             // ⚙️ Settings
};

const NAV_ITEMS: NavItem[] = [
  // ----- Operations (always visible, all roles) -----
  {
    to: '/',
    key: 'nav.dashboard',
    roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'],
    group: 'operations',
    icon: NAV_ITEM_ICONS['/'],
  },
  {
    to: '/printers',
    key: 'nav.printers',
    roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'],
    group: 'operations',
    icon: NAV_ITEM_ICONS['/printers'],
  },
  {
    to: '/jobs',
    key: 'nav.jobQueue',
    roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'],
    group: 'operations',
    icon: NAV_ITEM_ICONS['/jobs'],
  },
  {
    to: '/runners',
    key: 'nav.runners',
    roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'],
    group: 'operations',
    icon: NAV_ITEM_ICONS['/runners'],
  },
  {
    to: '/templates',
    key: 'nav.templates',
    roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'],
    group: 'operations',
    icon: NAV_ITEM_ICONS['/templates'],
  },
  {
    to: '/paper-profiles',
    key: 'nav.paperProfiles',
    roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'],
    group: 'operations',
    icon: NAV_ITEM_ICONS['/paper-profiles'],
  },

  // ----- Settings & Admin (collapsible, role-gated) -----
  {
    to: '/discovered-printers',
    key: 'nav.discovery',
    roles: ['OWNER', 'ADMIN'],
    group: 'admin',
    icon: NAV_ITEM_ICONS['/discovered-printers'],
  },
  {
    to: '/diagnostics',
    key: 'nav.diagnostics',
    roles: ['OWNER', 'ADMIN', 'OPERATOR'],
    group: 'admin',
    icon: NAV_ITEM_ICONS['/diagnostics'],
  },
  {
    to: '/template-sandbox',
    key: 'nav.sandbox',
    roles: ['OWNER'],
    group: 'admin',
    icon: NAV_ITEM_ICONS['/template-sandbox'],
  },
  {
    to: '/webhooks',
    key: 'nav.webhooks',
    roles: ['OWNER', 'ADMIN'],
    group: 'admin',
    icon: NAV_ITEM_ICONS['/webhooks'],
  },
  {
    to: '/route-policies',
    key: 'nav.routePolicies',
    roles: ['OWNER', 'ADMIN'],
    group: 'admin',
    icon: NAV_ITEM_ICONS['/route-policies'],
  },
  {
    to: '/printer-bindings',
    key: 'nav.bindings',
    roles: ['OWNER', 'ADMIN'],
    group: 'admin',
    icon: NAV_ITEM_ICONS['/printer-bindings'],
  },
  {
    to: '/print-flow',
    key: 'nav.printFlow',
    roles: ['OWNER'],
    group: 'admin',
    icon: NAV_ITEM_ICONS['/print-flow'],
  },
  {
    to: '/audit-logs',
    key: 'nav.auditLogs',
    roles: ['OWNER', 'ADMIN'],
    group: 'admin',
    icon: NAV_ITEM_ICONS['/audit-logs'],
  },
  {
    to: '/users',
    key: 'nav.usersRoles',
    roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'],
    group: 'admin',
    icon: NAV_ITEM_ICONS['/users'],
  },
  {
    to: '/export',
    key: 'nav.export',
    roles: ['OWNER', 'ADMIN'],
    group: 'admin',
    icon: NAV_ITEM_ICONS['/export'],
  },
  {
    to: '/settings',
    key: 'nav.settings',
    roles: ['OWNER', 'ADMIN'],
    group: 'admin',
    icon: NAV_ITEM_ICONS['/settings'],
  },
];

// ----- splash -----

function SplashScreen() {
  const { t } = useLocale();
  const [status, setStatus] = useState(t('splash.starting'));

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    async function waitForApi() {
      while (!cancelled && attempts < 120) {
        attempts++;
        try {
          const res = await fetch(healthUrl());
          if (res.ok) {
            if (!cancelled) setStatus(t('splash.ready'));
            return;
          }
        } catch {
          // retrying...
        }
        if (!cancelled) {
          setStatus(t('splash.progress').replace('{n}', String(attempts)));
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (!cancelled) setStatus(t('splash.unable'));
    }
    void waitForApi();
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="splash-screen">
      <div className="splash-content">
        <div className="splash-logo">{t('login.title')}</div>
        <p className="splash-tagline">{t('splash.tagline')}</p>
        <div className="splash-status">{status}</div>
        <div className="splash-spinner" />
      </div>
    </div>
  );
}

// ----- login -----

function LoginView({
  onLogin,
  sessionExpired = false,
}: {
  onLogin: (user: SessionUser) => void;
  /** True when the app returned here because a 401 ended the session. */
  sessionExpired?: boolean;
}) {
  const { t } = useLocale();
  const [email, setEmail] = useState(import.meta.env.DEV ? 'sysadmin@printerops.local' : '');
  const [password, setPassword] = useState(import.meta.env.DEV ? 'Dev-password1!' : '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onLogin(await login(email, password));
    } catch (err) {
      setError(errorMessage(err, t('login.error')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-panel" onSubmit={(event) => void submit(event)}>
        <div>
          <h1>{t('login.title')}</h1>
          <p>{t('login.subtitle')}</p>
        </div>

        <label>
          {t('login.email')}
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
          />
        </label>

        <label>
          {t('login.password')}
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </label>

        {sessionExpired && !error && (
          <div className="login-notice" role="status">{t('auth.sessionExpired')}</div>
        )}

        {error && <div className="login-error">{error}</div>}

        <button type="submit" disabled={submitting}>
          {submitting ? t('common.signingIn') : t('common.signIn')}
        </button>

        {import.meta.env.DEV && <div className="login-hint">{t('login.hint')}</div>}
      </form>
    </div>
  );
}

function OwnerSetupView({ bootstrap, onComplete }: { bootstrap: BootstrapInfo; onComplete: (user: SessionUser) => void }) {
  const { t } = useLocale();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onComplete(await bootstrapOwner({ name, email, password, passwordConfirmation }));
    } catch (err) {
      setError(errorMessage(err, t('setup.error')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-panel" onSubmit={(event) => void submit(event)}>
        <div>
          <h1>{t('setup.title')}</h1>
          <p>{bootstrap.state === 'MIGRATION_REQUIRED' ? t('setup.migrationSubtitle') : t('setup.subtitle')}</p>
          {bootstrap.state === 'MIGRATION_REQUIRED' && bootstrap.ownerEmailHints.length > 0 && (
            <p className="login-hint">{t('setup.migrationOwnerHint').replace('{emails}', bootstrap.ownerEmailHints.join(', '))}</p>
          )}
        </div>
        <label>{t('setup.name')}<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>
        <label>{t('login.email')}<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required /></label>
        <label>{t('login.password')}<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" required /></label>
        <label>{t('setup.confirmPassword')}<input value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} type="password" autoComplete="new-password" required /></label>
        <div className="login-hint">{t('setup.passwordHint')}</div>
        {error && <div className="login-error" role="alert">{error}</div>}
        <button type="submit" disabled={submitting}>{submitting ? t('setup.creating') : t('setup.create')}</button>
      </form>
    </div>
  );
}

// ----- navigation -----

function AppNav({
  user,
  onLogout,
}: {
  user: SessionUser;
  onLogout: () => void;
}) {
  const { t } = useLocale();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [adminExpanded, setAdminExpanded] = useState(false);

  const visibleNav = useMemo(
    () => NAV_ITEMS.filter((item) => item.roles.includes(user.role) && (user.role === 'OWNER' || !user.allowedPages || user.allowedPages.includes(item.to))),
    [user],
  );

  const { opsItems, adminItems } = useMemo(() => {
    const ops: NavItem[] = [];
    const admin: NavItem[] = [];
    for (const item of visibleNav) {
      if (item.group === 'operations') ops.push(item);
      else admin.push(item);
    }
    return { opsItems: ops, adminItems: admin };
  }, [visibleNav]);

  const hasAdmin = adminItems.length > 0;

  // Keep the active admin route discoverable after direct navigation or reload.
  useEffect(() => {
    if (adminItems.some((item) => location.pathname === item.to || location.pathname.startsWith(item.to + '/'))) {
      setAdminExpanded(true);
    }
  }, [adminItems, location.pathname]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  const toggleAdmin = useCallback(() => setAdminExpanded((prev) => !prev), []);

  const renderNavLink = (item: NavItem) => (
    <li key={item.to}>
      <NavLink
        to={item.to}
        end={item.to === '/'}
        className={({ isActive }) =>
          'nav-link' + (isActive ? ' nav-link--active' : '')
        }
        onClick={closeMobile}
        title={t(item.key)}
      >
        <span className="nav-link-icon" aria-hidden="true">{item.icon}</span>
        <span className="nav-link-label">{t(item.key)}</span>
      </NavLink>
    </li>
  );

  const navContent = (
    <>
      <h2 className="app-nav-brand">PrinterOps</h2>

      {/* Operations group — always visible */}
      {opsItems.length > 0 && (
        <div className="nav-group">
          <div className="nav-group-label">{t('nav.group.operations')}</div>
          <ul className="nav-group-list">
            {opsItems.map(renderNavLink)}
          </ul>
        </div>
      )}

      {/* Settings & Admin group — collapsible */}
      {hasAdmin && (
        <div className="nav-group">
          <button
            type="button"
            className="nav-admin-toggle"
            aria-expanded={adminExpanded}
            aria-controls="nav-admin-list"
            onClick={toggleAdmin}
            title={adminExpanded ? t('nav.admin.collapse') : t('nav.admin.expand')}
          >
            <span
              className={'nav-admin-chevron' + (adminExpanded ? ' nav-admin-chevron--open' : '')}
              aria-hidden="true"
            >
              {'\u25B6'}
            </span>
            <span className="nav-group-label nav-group-label--toggle">
              {t('nav.group.admin')}
            </span>
          </button>
          {adminExpanded && (
            <ul id="nav-admin-list" className="nav-group-list">
              {adminItems.map(renderNavLink)}
            </ul>
          )}
        </div>
      )}

      <div className="session-card">
        <div className="session-name">{user.name}</div>
        <span className="session-role">
          {t('session.role')}: {t('session.role.' + user.role)}
        </span>
        <button
          type="button"
          className="session-signout-btn"
          onClick={onLogout}
        >
          {t('common.signOut')}
        </button>
      </div>
    </>
  );

  const navId = 'app-nav';

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="nav-toggle"
        aria-expanded={mobileOpen}
        aria-controls={navId}
        aria-label={mobileOpen ? t('nav.menu.close') : t('nav.menu.open')}
        onClick={() => setMobileOpen((prev) => !prev)}
      >
        <span className="nav-toggle-bar" />
        <span className="nav-toggle-bar" />
        <span className="nav-toggle-bar" />
      </button>

      {/* Overlay for mobile */}
      {mobileOpen && (
        <div
          className="nav-overlay"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      <nav
        id={navId}
        className={'app-nav' + (mobileOpen ? ' app-nav--open' : '')}
        aria-label={t('nav.ariaLabel')}
      >
        {navContent}
      </nav>
    </>
  );
}

// ----- App shell -----

/** Route-level gate: renders children only for the given roles, otherwise a
 *  "not authorized" notice. Blocks direct-URL access, not just nav visibility. */
function RequireRoles({
  user,
  roles,
  children,
}: {
  user: SessionUser;
  roles: SessionUser['role'][];
  children: ReactNode;
}) {
  const { t } = useLocale();
  if (!roles.includes(user.role)) {
    return (
      <div className="not-authorized" role="alert">
        <h1>{t('auth.notAuthorized.title')}</h1>
        <p>{t('auth.notAuthorized.message')}</p>
      </div>
    );
  }
  return <>{children}</>;
}

function AppShell({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const { t } = useLocale();
  const location = useLocation();
  const pagePath = NAV_ITEMS.find((item) => item.to === '/' ? location.pathname === '/' : location.pathname === item.to || location.pathname.startsWith(item.to + '/'))?.to;
  const pageAllowed = user.role === 'OWNER' || !user.allowedPages || !pagePath || user.allowedPages.includes(pagePath);
  return (
    <SessionProvider user={user}>
    <div className="app-shell">
      <AppNav user={user} onLogout={onLogout} />
      <main className="app-main">
        {!pageAllowed ? <div className="not-authorized" role="alert"><h1>{t('auth.notAuthorized.title')}</h1><p>{t('auth.notAuthorized.message')}</p></div> : <Suspense fallback={<div className="loading-text" role="status">{t('common.loading')}</div>}>
          <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/printers" element={<Printers />} />
          <Route path="/printers/:id" element={<PrinterDetail />} />
          <Route path="/jobs" element={<JobQueue />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/runners" element={<Runners />} />
          <Route path="/discovered-printers" element={<DiscoveredPrinters />} />
          <Route path="/diagnostics" element={<LocalDiagnostics />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/paper-profiles" element={<PaperProfiles />} />
          <Route path="/template-sandbox" element={<TemplateSandbox />} />
          <Route path="/webhooks" element={<Webhooks />} />
          <Route path="/route-policies" element={<RoutePolicies />} />
          <Route path="/printer-bindings" element={<PrinterBindings />} />
          <Route
            path="/print-flow"
            element={
              <RequireRoles user={user} roles={['OWNER']}>
                <PrintFlowBindings />
              </RequireRoles>
            }
          />
          <Route path="/audit-logs" element={<AuditLogs />} />
          <Route path="/users" element={<UsersRoles />} />
          <Route path="/export" element={<ExportCenter />} />
          <Route path="/settings" element={<Settings />} />
          </Routes>
        </Suspense>}
      </main>
    </div>
    </SessionProvider>
  );
}

// ----- entry point -----

export default function App() {
  const [apiReady, setApiReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [bootstrap, setBootstrap] = useState<BootstrapInfo>({ state: 'READY', ownerEmailHints: [] });

  // Subscribed BEFORE the session check below, so a 401 from that very first
  // `getCurrentUser()` is handled by the same path as one that happens an hour
  // later. Both are idempotent: the token is already cleared by the notifier.
  useEffect(() => {
    return onUnauthorized(() => {
      setUser(null);
      setSessionExpired(true);
      setCheckingSession(false);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkApi() {
      for (let i = 0; i < 120; i++) {
        if (cancelled) return;
        try {
          const res = await fetch(healthUrl());
          if (res.ok) {
            if (!cancelled) setApiReady(true);
            return;
          }
        } catch {
          // API not ready yet
        }
        if (!cancelled) await new Promise((r) => setTimeout(r, 1000));
      }
      if (!cancelled) setApiReady(true);
    }

    void checkApi();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!apiReady) return;
    getBootstrapState()
      .then(async (info) => {
        setBootstrap(info);
        if (info.state === 'READY') {
          try { setUser(await getCurrentUser()); } catch { logout(); }
        }
      })
      .finally(() => setCheckingSession(false));
  }, [apiReady]);

  const handleLogout = useCallback(() => {
    logout();
    setUser(null);
  }, []);

  if (!apiReady || checkingSession) {
    return (
      <LocaleProvider>
        <SplashScreen />
      </LocaleProvider>
    );
  }

  if (!user) {
    return (
      <LocaleProvider>
        <RouteErrorBoundary>
          {bootstrap.state === 'READY' ? <LoginView
            onLogin={(next) => {
              setSessionExpired(false);
              setUser(next);
            }}
            sessionExpired={sessionExpired}
          /> : <OwnerSetupView bootstrap={bootstrap} onComplete={(next) => {
            setBootstrap({ state: 'READY', ownerEmailHints: [] });
            setUser(next);
          }} />}
        </RouteErrorBoundary>
      </LocaleProvider>
    );
  }

  return (
    <LocaleProvider>
      <RouteErrorBoundary>
        <AppShell user={user} onLogout={handleLogout} />
      </RouteErrorBoundary>
    </LocaleProvider>
  );
}
