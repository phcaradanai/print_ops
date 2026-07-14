import { Routes, Route, NavLink } from 'react-router-dom';
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
import { getCurrentUser, login, logout, healthUrl, type SessionUser } from './api/client.js';
import { LocaleProvider, useLocale } from './i18n/index.js';

// ----- navigation definition -----

type NavGroup = 'operations' | 'administration';

interface NavItem {
  to: string;
  key: string;
  roles: SessionUser['role'][];
  group: NavGroup;
}

const NAV_ITEMS: NavItem[] = [
  // Operator Workflow
  { to: '/', key: 'nav.dashboard', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/printers', key: 'nav.printers', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/jobs', key: 'nav.jobQueue', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/runners', key: 'nav.runners', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/templates', key: 'nav.templates', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },
  { to: '/paper-profiles', key: 'nav.paperProfiles', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'], group: 'operations' },

  // Administration
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

const GROUP_ORDER: NavGroup[] = ['operations', 'administration'];
const GROUP_LABEL_KEYS: Record<NavGroup, string> = {
  operations: 'nav.group.operations',
  administration: 'nav.group.administration',
};

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
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleNav = useMemo(
    () => NAV_ITEMS.filter((item) => item.roles.includes(user.role)),
    [user],
  );

  // Group visible items
  const grouped = useMemo(() => {
    const map: Record<NavGroup, NavItem[]> = { operations: [], administration: [] };
    for (const item of visibleNav) {
      map[item.group].push(item);
    }
    return GROUP_ORDER.map((g) => ({ group: g, items: map[g] })).filter(
      (g) => g.items.length > 0,
    );
  }, [visibleNav]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // Close mobile menu on Escape key
  useEffect(() => {
    if (!mobileOpen) return;
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        setMobileOpen(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  const navContent = (
    <>
      <h2 className="app-nav-brand">PrinterOps</h2>

      {grouped.map(({ group, items }) => (
        <div key={group} className="nav-group">
          <div className="nav-group-label">{t(GROUP_LABEL_KEYS[group])}</div>
          <ul className="nav-group-list">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    'nav-link' + (isActive ? ' nav-link--active' : '')
                  }
                  onClick={closeMobile}
                >
                  {t(item.key)}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}

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
