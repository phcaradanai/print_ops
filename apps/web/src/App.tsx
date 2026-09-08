import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from 'react';
import { bootstrapOwner, getBootstrapState, getCurrentUser, hasSessionToken, login, logout, healthUrl, onUnauthorized, type BootstrapInfo, type SessionUser } from './api/client.js';
import { SessionProvider } from './api/session.js';
import { LocaleProvider, useLocale } from './i18n/index.js';
import { RouteErrorBoundary } from './components/RouteErrorBoundary.js';
import { NavIcon } from './components/NavIcon.js';
import { ActionIcon } from './components/ActionIcon.js';
import { errorMessage } from './api/errors.js';
import { Input, Button, FormField } from './components/ui/index.js';
import webPackage from '../package.json';

export const APP_VERSION = webPackage.version;

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

const MOBILE_NAV_QUERY = '(max-width: 1024px)';
const DEFAULT_LOGIN_EMAIL = 'sysadmin@printerops.local';
const DEFAULT_LOGIN_PASSWORD = 'Dev-password1!';
interface OwnerSetupAuthorization {
  email: string;
  password: string;
}

function isMobileNavViewport() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(MOBILE_NAV_QUERY).matches;
}
export function AppVersionBadge({ label }: { label: string }) {
  return (
    <span
      className="app-version"
      aria-label={label + ': ' + APP_VERSION}
      title={label + ': ' + APP_VERSION}
    >
      v{APP_VERSION}
    </span>
  );
}

// ----- navigation definition -----

type NavGroup = 'operations' | 'admin';

interface NavItem {
  to: string;
  key: string;
  roles: SessionUser['role'][];
  group: NavGroup;
}

const NAV_ITEMS: NavItem[] = [
  // ----- Operations (always visible, all roles) -----
  {
    to: '/',
    key: 'nav.dashboard',
    roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'],
    group: 'operations',
  },
  {
    to: '/printers',
    key: 'nav.printers',
    roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'],
    group: 'operations',
  },
  {
    to: '/jobs',
    key: 'nav.jobQueue',
    roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'],
    group: 'operations',
  },
  {
    to: '/runners',
    key: 'nav.runners',
    roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'],
    group: 'operations',
  },
  {
    to: '/templates',
    key: 'nav.templates',
    roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'],
    group: 'operations',
  },
  {
    to: '/paper-profiles',
    key: 'nav.paperProfiles',
    roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'],
    group: 'operations',
  },

  // ----- Settings & Admin (collapsible, role-gated) -----
  {
    to: '/discovered-printers',
    key: 'nav.discovery',
    roles: ['OWNER', 'ADMIN'],
    group: 'admin',
  },
  {
    to: '/diagnostics',
    key: 'nav.diagnostics',
    roles: ['OWNER', 'ADMIN', 'OPERATOR'],
    group: 'admin',
  },
  {
    to: '/template-sandbox',
    key: 'nav.sandbox',
    roles: ['OWNER'],
    group: 'admin',
  },
  {
    to: '/webhooks',
    key: 'nav.webhooks',
    roles: ['OWNER', 'ADMIN'],
    group: 'admin',
  },
  {
    to: '/route-policies',
    key: 'nav.routePolicies',
    roles: ['OWNER', 'ADMIN'],
    group: 'admin',
  },
  {
    to: '/printer-bindings',
    key: 'nav.bindings',
    roles: ['OWNER', 'ADMIN'],
    group: 'admin',
  },
  {
    to: '/print-flow',
    key: 'nav.printFlow',
    roles: ['OWNER'],
    group: 'admin',
  },
  {
    to: '/audit-logs',
    key: 'nav.auditLogs',
    roles: ['OWNER', 'ADMIN'],
    group: 'admin',
  },
  {
    to: '/users',
    key: 'nav.usersRoles',
    roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'],
    group: 'admin',
  },
  {
    to: '/export',
    key: 'nav.export',
    roles: ['OWNER', 'ADMIN'],
    group: 'admin',
  },
  {
    to: '/settings',
    key: 'nav.settings',
    roles: ['OWNER', 'ADMIN'],
    group: 'admin',
  },
];

// ----- splash -----

function SplashScreen({ error, onRetry }: { error?: boolean; onRetry?: () => void }) {
  const { t } = useLocale();
  const [status, setStatus] = useState(t('splash.starting'));

  useEffect(() => {
    if (error) {
      setStatus(t('splash.unable'));
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const interval = setInterval(() => {
      if (cancelled) return;
      attempts++;
      setStatus(t('splash.progress').replace('{n}', String(attempts)));
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [t, error]);

  return (
    <div className="splash-screen">
      <div className="splash-content">
        <div className="splash-logo">{t('login.title')}</div>
        <p className="splash-tagline">{t('splash.tagline')}</p>
        <div className="splash-status">{status}</div>
        {error ? (
          <Button onClick={onRetry} variant="secondary" style={{ marginTop: '1rem' }}>
            {t('error.retry')}
          </Button>
        ) : (
          <div className="splash-spinner" />
        )}
      </div>
    </div>
  );
}

// ----- login -----

function LoginView({
  onLogin,
  bootstrap,
  onOwnerSetup,
  sessionExpired = false,
}: {
  onLogin: (user: SessionUser) => void;
  bootstrap: BootstrapInfo;
  onOwnerSetup: (authorization: OwnerSetupAuthorization) => void;
  /** True when the app returned here because a 401 ended the session. */
  sessionExpired?: boolean;
}) {
  const { t } = useLocale();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [email, setEmail] = useState(DEFAULT_LOGIN_EMAIL);
  const [password, setPassword] = useState(DEFAULT_LOGIN_PASSWORD);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

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
          <h1 ref={headingRef} tabIndex={-1}>{t('login.title')}</h1>
          <p>{t('login.subtitle')}</p>
        </div>

        <FormField label={t('login.email')} required>
          {(control) => (
            <Input
              {...control}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="username"
              required
            />
          )}
        </FormField>

        <FormField label={t('login.password')} required>
          {(control) => (
            <Input
              {...control}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              trailing={
                <button
                  type="button"
                  className="login-password-toggle"
                  aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                  aria-pressed={showPassword}
                  title={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  <ActionIcon name={showPassword ? 'eyeOff' : 'eye'} />
                </button>
              }
            />
          )}
        </FormField>

        {sessionExpired && !error && (
          <div className="login-notice" role="status">{t('auth.sessionExpired')}</div>
        )}

        {error && <div className="login-error" role="alert">{error}</div>}

        <Button type="submit" disabled={submitting} busy={submitting} style={{ marginTop: '0.5rem' }}>
          {submitting ? t('common.signingIn') : t('common.signIn')}
        </Button>

        <div className="login-optional-setup">
          <p>{bootstrap.state === 'READY' ? t('setup.readyNotice') : t('setup.optionalNotice')}</p>
          <button type="button" className="login-secondary-action" onClick={() => onOwnerSetup({ email, password })}>
            {t('setup.openOptional')}
          </button>
        </div>

        {import.meta.env.DEV && <div className="login-hint">{t('login.hint')}</div>}
      </form>
    </div>
  );
}

function OwnerSetupView({
  bootstrap,
  authorization,
  onComplete,
  onBack,
}: {
  bootstrap: BootstrapInfo;
  authorization: OwnerSetupAuthorization;
  onComplete: (user: SessionUser) => void;
  onBack: () => void;
}) {
  const { t } = useLocale();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [name, setName] = useState('');
  const [authorizationEmail, setAuthorizationEmail] = useState(authorization.email);
  const [authorizationPassword, setAuthorizationPassword] = useState(authorization.password);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const ownerAuthorization = bootstrap.state === 'READY'
        ? { authorizationEmail: authorizationEmail.trim(), authorizationPassword }
        : {};
      onComplete(await bootstrapOwner({ name, email, password, passwordConfirmation, ...ownerAuthorization }));
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
          <h1 ref={headingRef} tabIndex={-1}>{t('setup.title')}</h1>
          <p>{bootstrap.state === 'MIGRATION_REQUIRED' ? t('setup.migrationSubtitle') : bootstrap.state === 'READY' ? t('setup.readySubtitle') : t('setup.subtitle')}</p>
          {bootstrap.state === 'MIGRATION_REQUIRED' && bootstrap.ownerEmailHints.length > 0 && (
            <p className="login-hint">{t('setup.migrationOwnerHint').replace('{emails}', bootstrap.ownerEmailHints.join(', '))}</p>
          )}
        </div>
        <div style={{ display: 'grid', gap: '1rem' }}>
          {bootstrap.state === 'READY' && (
            <>
              <div className="login-hint">{t('setup.authorizationNotice')}</div>
              <FormField label={t('setup.authorizationEmail')} required>
                {(control) => <Input {...control} value={authorizationEmail} onChange={(event) => setAuthorizationEmail(event.target.value)} type="email" autoComplete="username" required />}
              </FormField>
              <FormField label={t('setup.authorizationPassword')} required>
                {(control) => <Input {...control} value={authorizationPassword} onChange={(event) => setAuthorizationPassword(event.target.value)} type="password" autoComplete="current-password" required />}
              </FormField>
            </>
          )}
          <FormField label={t('setup.name')} required>
            {(control) => <Input {...control} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />}
          </FormField>
          <FormField label={t('login.email')} required>
            {(control) => <Input {...control} value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required />}
          </FormField>
          <FormField label={t('login.password')} required>
            {(control) => <Input {...control} value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" required />}
          </FormField>
          <FormField label={t('setup.confirmPassword')} required>
            {(control) => <Input {...control} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} type="password" autoComplete="new-password" required />}
          </FormField>
        </div>
        <div className="login-hint" style={{ marginTop: '0.5rem' }}>{t('setup.passwordHint')}</div>
        {error && <div className="login-error" role="alert">{error}</div>}
        <Button type="submit" disabled={submitting} busy={submitting} style={{ marginTop: '0.5rem' }}>
          {submitting ? t('setup.creating') : bootstrap.state === 'READY' ? t('setup.createAdditional') : t('setup.create')}
        </Button>
        <Button variant="ghost" type="button" className="login-secondary-action" onClick={onBack}>
          {t('setup.backToLogin')}
        </Button>
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
  const [isMobileViewport, setIsMobileViewport] = useState(isMobileNavViewport);
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

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(MOBILE_NAV_QUERY);
    const updateViewport = ({ matches }: { matches: boolean }) => {
      setIsMobileViewport(matches);
      if (!matches) setMobileOpen(false);
    };
    updateViewport(mediaQuery);
    mediaQuery.addEventListener('change', updateViewport);
    return () => mediaQuery.removeEventListener('change', updateViewport);
  }, []);

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
        <NavIcon route={item.to} />
        <span className="nav-link-label">{t(item.key)}</span>
      </NavLink>
    </li>
  );

  const navContent = (
    <>
      <h2 className="app-nav-brand">
        <span className="app-brand-name">PrintOps</span>
        <AppVersionBadge label={t('app.version')} />
      </h2>

      {/* Operations group — always visible */}
      {opsItems.length > 0 && (
        <div className="nav-group">
          <div className="nav-group-label">{t('nav.group.operations')}</div>
          <ul className="nav-group-list d1-list">
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
            <svg
              className={'nav-admin-chevron' + (adminExpanded ? ' nav-admin-chevron--open' : '')}
              viewBox="0 0 12 12"
              width="9"
              height="9"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4.5 2.5 L8.5 6 L4.5 9.5" />
            </svg>
            <span className="nav-group-label nav-group-label--toggle">
              {t('nav.group.admin')}
            </span>
          </button>
          {adminExpanded && (
            <ul id="nav-admin-list" className="nav-group-list d1-list">
              {adminItems.map(renderNavLink)}
            </ul>
          )}
        </div>
      )}

      <article className="session-card">
        <div className="session-card__identity">
          <span className="session-avatar" aria-hidden="true">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <div className="session-card__info">
            <div className="session-name">{user.name}</div>
            <span className="session-role">
              {t('session.role')}: {t('session.role.' + user.role)}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="session-signout-btn"
          onClick={onLogout}
        >
          <ActionIcon name="logout" />
          {t('common.signOut')}
        </button>
      </article>
    </>
  );

  const navId = 'app-nav';

  return (
    <>
      <header className="app-header">
        {/* Mobile hamburger */}
        <button
          type="button"
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
        <span className="app-header-brand">
          <span className="app-brand-name">PrintOps</span>
          <AppVersionBadge label={t('app.version')} />
        </span>
      </header>

      {/* Overlay for mobile */}
      {mobileOpen && (
        <div
          className="nav-overlay"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      <nav id={navId} className={'app-nav d1-nav' + (mobileOpen ? ' app-nav--open' : '')} aria-label={t('nav.ariaLabel')} inert={isMobileViewport && !mobileOpen ? true : undefined}>
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
      <a className="skip-link" href="#main-content">{t('nav.skipToContent')}</a>
      <AppNav user={user} onLogout={onLogout} />



      <main id="main-content" className="app-main" tabIndex={-1}>
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
  const [apiError, setApiError] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [bootstrap, setBootstrap] = useState<BootstrapInfo>({ state: 'READY', ownerEmailHints: [] });
  const [authMode, setAuthMode] = useState<'login' | 'owner-setup'>('login');
  const [setupAuthorization, setSetupAuthorization] = useState<OwnerSetupAuthorization>({
    email: DEFAULT_LOGIN_EMAIL,
    password: DEFAULT_LOGIN_PASSWORD,
  });

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

  const checkApi = useCallback(async () => {
    setApiError(false);
    let cancelled = false;
    for (let i = 0; i < 5; i++) {
      if (cancelled) return;
      try {
        const res = await fetch(healthUrl());
        if (res.ok) {
          setApiReady(true);
          return;
        }
      } catch {
        // API not ready yet
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!cancelled) setApiError(true);
  }, []);

  useEffect(() => {
    void checkApi();
  }, [checkApi]);

  useEffect(() => {
    if (!apiReady) return;
    getBootstrapState()
      .then(async (info) => {
        setBootstrap(info);
        // Restore every valid human role session. OWNER bootstrap state is an
        // optional administration concern and must not block an existing
        // ADMIN/OPERATOR/VIEWER account from using its configured permissions.
        if (hasSessionToken()) {
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
        <SplashScreen error={apiError} onRetry={checkApi} />
      </LocaleProvider>
    );
  }

  if (!user) {
    return (
      <LocaleProvider>
        <RouteErrorBoundary>
          {authMode === 'login' ? <LoginView
            onLogin={(next) => {
              setSessionExpired(false);
              setUser(next);
            }}
            bootstrap={bootstrap}
            onOwnerSetup={(authorization) => {
              setSetupAuthorization(authorization);
              setAuthMode('owner-setup');
            }}
            sessionExpired={sessionExpired}
          /> : <OwnerSetupView bootstrap={bootstrap} authorization={setupAuthorization} onComplete={(next) => {
            setBootstrap({ state: 'READY', ownerEmailHints: [] });
            setAuthMode('login');
            setUser(next);
          }} onBack={() => setAuthMode('login')} />}
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
