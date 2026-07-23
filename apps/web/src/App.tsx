import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  Component,
  type ReactNode,
  type FormEvent,
} from 'react';
import Dashboard from './pages/Dashboard.js';
import Printers from './pages/Printers.js';
import PrinterDetail from './pages/PrinterDetail.js';
import JobQueue from './pages/JobQueue.js';
import JobDetail from './pages/JobDetail.js';
import Runners from './pages/Runners.js';
import AuditLogs from './pages/AuditLogs.js';
import UsersRoles from './pages/UsersRoles.js';
import ExportCenter from './pages/ExportCenter.js';
import Settings from './pages/Settings.js';
import DiscoveredPrinters from './pages/DiscoveredPrinters.js';
import LocalDiagnostics from './pages/LocalDiagnostics.js';
import Templates from './pages/Templates.js';
import PaperProfiles from './pages/PaperProfiles.js';
import TemplateSandbox from './pages/TemplateSandbox.js';
import Webhooks from './pages/Webhooks.js';
import RoutePolicies from './pages/RoutePolicies.js';
import PrinterBindings from './pages/PrinterBindings.js';
import PrintFlowBindings from './pages/PrintFlowBindings.js';
import { getCurrentUser, login, logout, healthUrl, type SessionUser } from './api/client.js';
import { LocaleProvider, useLocale } from './i18n/index.js';

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
    roles: ['OWNER'],
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

function LoginView({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const { t } = useLocale();
  const [email, setEmail] = useState(import.meta.env.DEV ? 'sysadmin@printerops.local' : '');
  const [password, setPassword] = useState(import.meta.env.DEV ? 'dev-password' : '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onLogin(await login(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.error'));
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

        {error && <div className="login-error">{error}</div>}

        <button type="submit" disabled={submitting}>
          {submitting ? t('common.signingIn') : t('common.signIn')}
        </button>

        <div className="login-hint">{t('login.hint')}</div>
      </form>
    </div>
  );
}

// ----- error boundary -----

function ErrorFallback({ error }: { error: Error }) {
  const { t } = useLocale();
  return (
    <div className="error-fallback">
      <h2>{t('error.title')}</h2>
      <p>{error.message}</p>
      <button
        onClick={() => window.location.reload()}
        className="error-reload-btn"
      >
        {t('error.reload')}
      </button>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) return <ErrorFallback error={this.state.error} />;
    return this.props.children;
  }
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
    () => NAV_ITEMS.filter((item) => item.roles.includes(user.role)),
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
  return (
    <div className="app-shell">
      <AppNav user={user} onLogout={onLogout} />
      <main className="app-main">
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
      </main>
    </div>
  );
}

// ----- entry point -----

export default function App() {
  const [apiReady, setApiReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

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
    getCurrentUser()
      .then(setUser)
      .catch(() => logout())
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
        <ErrorBoundary>
          <LoginView onLogin={setUser} />
        </ErrorBoundary>
      </LocaleProvider>
    );
  }

  return (
    <LocaleProvider>
      <ErrorBoundary>
        <AppShell user={user} onLogout={handleLogout} />
      </ErrorBoundary>
    </LocaleProvider>
  );
}
