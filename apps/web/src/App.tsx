import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from 'react';
import { apiFetch, bootstrapOwner, getBootstrapState, getCurrentUser, hasSessionToken, issuePasswordRecoveryCode, login, logout, recoverPassword, healthUrl, onUnauthorized, desktopBootstrapOrigin, type BootstrapInfo, type SessionUser } from './api/client.js';
import { SessionProvider } from './api/session.js';
import { LocaleProvider, useLocale } from './i18n/index.js';
import type { ControlCommandProgress } from '@printerops/domain';
import { RemoteCommandProgress } from './components/RemoteCommandProgress.js';
import { RouteErrorBoundary } from './components/RouteErrorBoundary.js';
import { ServiceConnectionScreen } from './components/ServiceConnectionScreen.js';
import { NavIcon } from './components/NavIcon.js';
import { ActionIcon } from './components/ActionIcon.js';
import { errorMessage } from './api/errors.js';
import { Input, Button, FormField } from './components/ui/index.js';
import webPackage from '../package.json';

export const APP_VERSION = webPackage.version;
export const CONTROL_PLANE_VERSION = import.meta.env.VITE_CONTROL_PLANE_VERSION || '1.0.0';
const CONTROL_APP = import.meta.env.VITE_CONTROL_APP === 'true';
if (CONTROL_APP && typeof document !== 'undefined') document.title = 'Web Control';

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
const WebControlDevices = lazy(() => import('./pages/WebControlDevices.js'));
const WebControlDeviceDetail = lazy(() => import('./pages/WebControlDeviceDetail.js'));
const WebControlReleases = lazy(() => import('./pages/WebControlReleases.js'));
const WebControlContent = lazy(() => import('./pages/WebControlContent.js'));
const AccountSecurity = lazy(() => import('./pages/AccountSecurity.js'));

const MOBILE_NAV_QUERY = '(max-width: 860px)';
const DEFAULT_LOGIN_EMAIL = CONTROL_APP ? '' : 'sysadmin@printerops.local';
const DEFAULT_LOGIN_PASSWORD = CONTROL_APP ? '' : 'Dev-password1!';
interface OwnerSetupAuthorization {
  email: string;
  password: string;
}

function isMobileNavViewport() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(MOBILE_NAV_QUERY).matches;
}
export function AppVersionBadge({ label, version }: { label: string; version?: string }) {
  const displayVersion = version ?? (CONTROL_APP ? CONTROL_PLANE_VERSION : APP_VERSION);
  return (
    <span
      className="app-version"
      aria-label={label + ': ' + displayVersion}
      title={label + ': ' + displayVersion}
    >
      v{displayVersion}
    </span>
  );
}

/**
 * Language switch for the whole shell. Lives in the drawer (mobile) and the
 * topbar (desktop); both are one click away from any page.
 */
function LocaleToggle() {
  const { locale, setLocale } = useLocale();
  const { t } = useLocale();
  return (
    <div className="locale-toggle" role="group" aria-label={t('settings.language')}>
      <button
        type="button"
        className={'locale-toggle__option' + (locale === 'en' ? ' is-selected' : '')}
        aria-pressed={locale === 'en'}
        onClick={() => setLocale('en')}
      >
        EN
      </button>
      <button
        type="button"
        className={'locale-toggle__option' + (locale === 'th' ? ' is-selected' : '')}
        aria-pressed={locale === 'th'}
        onClick={() => setLocale('th')}
      >
        TH
      </button>
    </div>
  );
}

export interface ClientControlCommandStatus {
  commandType?: string;
  targetVersion?: string;
  state?: string;
  replayStatus: 'PROCESSING' | 'PROCESSED';
  progress?: ControlCommandProgress;
  updatedAt?: string;
}

export interface ClientControlStatus {
  deviceId?: string;
  installationId?: string;
  hostname?: string;
  isEnrolled: boolean;
  visibleToControlPlane: boolean;
  otaReady: boolean;
  otaState: string;
  connectionState: 'ONLINE' | 'DISCONNECTED';
  remoteCommand?: ClientControlCommandStatus | null;
  /** Broker endpoints issued at enrollment; null until this client is enrolled. */
  controlPlane?: { natsUrl: string; stream: string } | null;
}

const REMOTE_COMMAND_STATUS_POLL_INTERVAL_MS = 5_000;
const REMOTE_COMMAND_RECENT_WINDOW_MS = 30_000;
const GATEWAY_STATUS_STALE_AFTER_FAILURES = 2;
const REMOTE_COMMAND_FAILURE_STATES: Record<string, true> = {
  INSTALL_FAILED: true,
  HEALTH_CHECK_FAILED: true,
  ROLLBACK_FAILED: true,
  RECOVERY_REQUIRED: true,
  REJECTED: true,
  EXPIRED: true,
};

interface ClientControlStatusValue {
  status: ClientControlStatus | null;
  freshness: 'pending' | 'fresh' | 'stale';
}

const PENDING_CLIENT_CONTROL_STATUS: ClientControlStatusValue = {
  status: null,
  freshness: 'pending',
};

const ClientControlStatusContext = createContext<ClientControlStatusValue>(PENDING_CLIENT_CONTROL_STATUS);

/** Single owner of the `/v1/control/client-status` poll. Every gateway pill
 *  (drawer, mobile header, topbar, dashboard) reads this context instead of
 *  polling on its own, so the local service sees exactly one request cadence.
 *  Used without the provider, the hook falls back to the pending default —
 *  truthful "not verified yet" — rather than spawning another poller. */
function ClientControlStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ClientControlStatus | null>(null);
  const [freshness, setFreshness] = useState<ClientControlStatusValue['freshness']>('pending');

  useEffect(() => {
    if (CONTROL_APP) return; // Web Control build has no local broker to poll.
    let cancelled = false;
    let consecutiveFailures = 0;
    const fetchStatus = async () => {
      try {
        const res = await apiFetch<ClientControlStatus>('/v1/control/client-status');
        if (cancelled) return;
        consecutiveFailures = 0;
        setStatus(res);
        setFreshness('fresh');
      } catch {
        if (cancelled) return;
        consecutiveFailures += 1;
        // One failed poll may be a hiccup; two in a row (~10s) means the
        // state on screen is no longer verified.
        if (consecutiveFailures >= GATEWAY_STATUS_STALE_AFTER_FAILURES) setFreshness('stale');
      }
    };
    void fetchStatus();
    const interval = setInterval(() => { void fetchStatus(); }, REMOTE_COMMAND_STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <ClientControlStatusContext.Provider value={{ status, freshness }}>
      {children}
    </ClientControlStatusContext.Provider>
  );
}

function useClientControlStatus(): ClientControlStatusValue {
  return useContext(ClientControlStatusContext);
}

export function RemoteCommandIndicator({
  command,
  now = Date.now(),
}: {
  command?: ClientControlCommandStatus | null;
  now?: number;
}) {
  const { t } = useLocale();
  if (!command) return null;

  const isRunning = command.replayStatus === 'PROCESSING';
  const ageMs = command.updatedAt ? now - Date.parse(command.updatedAt) : Number.NaN;
  const isRecent = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= REMOTE_COMMAND_RECENT_WINDOW_MS;
  if (!isRunning && !isRecent) return null;

  const isFailed = !isRunning && (
    Boolean(command.state && REMOTE_COMMAND_FAILURE_STATES[command.state])
    || (command.state === 'ROLLED_BACK' && command.commandType !== 'OTA_ROLLBACK')
  );
  const statusClass = isRunning ? 'running' : isFailed ? 'failed' : 'completed';
  const label = isRunning
    ? t('client.control.commandInProgress')
    : isFailed
      ? t('client.control.commandFailed')
      : t('client.control.commandCompleted');

  return (
    <span
      className={`client-control-command-symbol client-control-command-symbol--${statusClass}`}
      title={label}
      aria-label={label}
      role="status"
      aria-live="polite"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="4" y="4" width="16" height="12" rx="2" />
        <path d="M8 20h8m-4-4v4M8 8l2 2-2 2m5 0h3" />
      </svg>
    </span>
  );
}

/**
 * Gateway indicator: reports only this station's Web Control visibility and
 * OTA readiness — never printer, runner or printer-queue state. The shared
 * AppShell-owned poll owns truth: before the first answer ("pending") and
 * after contact is lost ("stale") the pill says so in its own amber/neutral
 * tone instead of silently keeping the previous state on screen.
 */
export function ClientControlStatusBadge({ iconOnly = true }: { iconOnly?: boolean }) {
  const { t } = useLocale();
  const { status, freshness } = useClientControlStatus();

  const pending = freshness === 'pending' || status == null;
  const stale = freshness === 'stale';
  const connected = !pending && !stale
    && Boolean(status?.visibleToControlPlane) && Boolean(status?.otaReady);
  const blocked = !pending && !stale
    && Boolean(status?.visibleToControlPlane) && !status?.otaReady;
  const tone = stale
    ? 'stale'
    : pending
      ? 'pending'
      : connected ? 'connected' : blocked ? 'blocked' : 'offline';

  const label = stale
    ? t('client.control.staleBadge')
    : pending
      ? t('client.control.unknownBadge')
      : connected
        ? t('client.control.onlineBadge')
        : blocked
          ? t('client.control.blockedBadge')
          : t('client.control.offlineBadge');

  const tooltip = stale
    ? t('client.control.staleDesc')
    : pending
      ? t('client.control.unknownDesc')
      : connected
        ? `${t('client.control.onlineBadge')}: ${t('client.control.visibleDesc')}`
        : blocked
          ? `${t('client.control.blockedBadge')}: ${t('client.control.blockedDesc')}`
          : `${t('client.control.offlineBadge')}: ${t('client.control.offlineDesc')}`;

  // While the gateway state is unverified (pending or stale), the last known
  // command must not reach EITHER presentation: the ribbon below is gated and
  // the indicator inside the pill receives null as well.
  const command = pending || stale ? null : status?.remoteCommand ?? null;
  const commandAgeMs = command?.updatedAt ? Date.now() - Date.parse(command.updatedAt) : Number.NaN;
  const showCommandProgress = command != null && (
    command.replayStatus === 'PROCESSING'
    || (Number.isFinite(commandAgeMs) && commandAgeMs >= 0 && commandAgeMs <= REMOTE_COMMAND_RECENT_WINDOW_MS)
  );

  return (
    <div className={`client-control-status-stack${iconOnly ? ' client-control-status-stack--compact' : ''}`}>
      <div
        className="client-control-status-symbol"
        data-tone={tone}
        title={tooltip}
      >
        <svg
          role="img"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-label={tooltip}
          aria-hidden={iconOnly ? undefined : true}
        >
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
          {connected && <polyline points="9 13 12 16 15 13" />}
          {blocked && (
            <>
              <path d="M12 8.5v3.2" />
              <path d="M12 14.9h0.01" />
            </>
          )}
          {stale && <path d="M4.5 4.5 19.5 19.5" />}
        </svg>
        <RemoteCommandIndicator command={command} />
        {!iconOnly && <span className="client-control-status-symbol__label">{label}</span>}
      </div>
      {showCommandProgress && command?.progress && (
        <RemoteCommandProgress
          progress={command.progress}
          commandType={command.commandType}
          status={command.state}
          compact={iconOnly}
          dark={iconOnly}
        />
      )}
    </div>
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
  {
    to: '/control/devices',
    key: 'nav.controlDevices',
    roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'],
    group: 'operations',
  },
  {
    to: '/control/content',
    key: 'nav.controlContent',
    roles: ['OWNER', 'ADMIN'],
    group: 'operations',
  },
  {
    to: '/control/paper-profiles',
    key: 'nav.controlProfiles',
    roles: ['OWNER', 'ADMIN'],
    group: 'operations',
  },
  {
    to: '/control/templates',
    key: 'nav.controlTemplates',
    roles: ['OWNER', 'ADMIN'],
    group: 'operations',
  },
  {
    to: '/control/releases',
    key: 'nav.controlReleases',
    roles: ['OWNER', 'ADMIN', 'OPERATOR'],
    group: 'admin',
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
const VISIBLE_NAV_ITEMS = NAV_ITEMS.filter((item) =>
  CONTROL_APP ? item.to.startsWith('/control/') : !item.to.startsWith('/control/'),
);

// ----- startup / recovery -----

// SplashScreen was replaced by ServiceConnectionScreen (components/), which
// reports only what the caller's probe actually returned. Startup timers that
// announced fake progress are gone with it.

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
  const [view, setView] = useState<'login' | 'forgot' | 'recovery-saved'>('login');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('');
  const [savedRecoveryCode, setSavedRecoveryCode] = useState<string | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [view]);

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

  async function submitRecovery(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword !== newPasswordConfirmation) {
      setError(t('recovery.passwordMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await recoverPassword(email, recoveryCode, newPassword);
      logout();
      setSavedRecoveryCode(result.recoveryCode);
      setPassword('');
      setNewPassword('');
      setNewPasswordConfirmation('');
      setView('recovery-saved');
    } catch (err) {
      setError(errorMessage(err, t('recovery.resetError')));
    } finally {
      setSubmitting(false);
    }
  }

  if (view === 'recovery-saved') {
    return (
      <div className="login-screen">
        <div className="login-panel">
          <div className="login-panel__head">
            <h1 ref={headingRef} tabIndex={-1} style={{ outline: 'none' }}>{t('recovery.successTitle')}</h1>
            <LocaleToggle />
          </div>
          <div className="login-hint" role="status" style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>
            <code>{savedRecoveryCode}</code>
          </div>
          <p className="login-hint">{t('recovery.codeStore')}</p>
          <Button type="button" onClick={() => setView('login')}>
            {t('recovery.backToLogin')}
          </Button>
        </div>
      </div>
    );
  }

  if (view === 'forgot') {
    return (
      <div className="login-screen">
        <form className="login-panel" onSubmit={(event) => void submitRecovery(event)}>
          <div className="login-panel__head">
            <div>
              <h1 ref={headingRef} tabIndex={-1} style={{ outline: 'none' }}>{t('recovery.forgotTitle')}</h1>
              <p>{t('recovery.forgotDescription')}</p>
            </div>
            <LocaleToggle />
          </div>
          <FormField label={t('login.email')} required>
            {(control) => (
              <Input {...control} value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" maxLength={254} required />
            )}
          </FormField>
          <FormField label={t('recovery.codeLabel')} required>
            {(control) => (
              <Input
                {...control}
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value.trim())}
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={32}
                required
              />
            )}
          </FormField>
          <FormField label={t('recovery.newPassword')} required>
            {(control) => (
              <Input {...control} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
            )}
          </FormField>
          <FormField label={t('recovery.confirmPassword')} required>
            {(control) => (
              <Input {...control} value={newPasswordConfirmation} onChange={(event) => setNewPasswordConfirmation(event.target.value)} type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
            )}
          </FormField>
          {error && <div className="login-error" role="alert">{error}</div>}
          <Button type="submit" disabled={submitting} busy={submitting} style={{ marginTop: '0.5rem' }}>
            {submitting ? t('recovery.submitting') : t('recovery.submit')}
          </Button>
          <button type="button" className="login-secondary-action" onClick={() => { setError(null); setView('login'); }}>
            {t('recovery.backToLogin')}
          </button>
          <p className="login-hint">{t('recovery.noCodeHelp')}</p>
        </form>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <form className="login-panel" onSubmit={(event) => void submit(event)}>
        <div className="login-panel__head">
          <div>
            <h1 ref={headingRef} tabIndex={-1} style={{ outline: 'none' }}>{CONTROL_APP ? t('control.login.title') : t('login.title')}</h1>
            <p>{CONTROL_APP ? t('control.login.subtitle') : t('login.subtitle')}</p>
          </div>
          <LocaleToggle />
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

        <button type="button" className="login-secondary-action" onClick={() => { setError(null); setView('forgot'); }}>
          {t('recovery.forgotLink')}
        </button>

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
  const [setupRecovery, setSetupRecovery] = useState<{ user: SessionUser; recoveryCode: string } | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [setupRecovery]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const ownerAuthorization = bootstrap.state === 'READY'
        ? { authorizationEmail: authorizationEmail.trim(), authorizationPassword }
        : {};
      setSetupRecovery(await bootstrapOwner({ name, email, password, passwordConfirmation, ...ownerAuthorization }));
    } catch (err) {
      setError(errorMessage(err, t('setup.error')));
    } finally {
      setSubmitting(false);
    }
  }

  if (setupRecovery) {
    return (
      <div className="login-screen">
        <div className="login-panel">
          <h1 ref={headingRef} tabIndex={-1}>{t('recovery.setupTitle')}</h1>
          <p>{t('recovery.setupDescription')}</p>
          <div className="login-hint" role="status" style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>
            <code>{setupRecovery.recoveryCode}</code>
          </div>
          <p className="login-hint">{t('recovery.codeStore')}</p>
          <Button type="button" onClick={() => onComplete(setupRecovery.user)}>
            {t('recovery.setupContinue')}
          </Button>
        </div>
      </div>
    );
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
    () => VISIBLE_NAV_ITEMS.filter((item) => item.roles.includes(user.role) && (user.role === 'OWNER' || !user.allowedPages || user.allowedPages.includes(item.to))),
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

  /**
   * Closing records why: "navigate" moves focus into the routed page, every
   * other dismiss (overlay, close button, Escape, viewport change) hands
   * focus back to the element that opened the drawer.
   */
  const closeCauseRef = useRef<'navigate' | 'dismiss'>('dismiss');
  const closeDrawer = useCallback((cause: 'navigate' | 'dismiss') => {
    closeCauseRef.current = cause;
    setMobileOpen(false);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') closeDrawer('dismiss');
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen, closeDrawer]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(MOBILE_NAV_QUERY);
    const updateViewport = ({ matches }: { matches: boolean }) => {
      setIsMobileViewport(matches);
      if (!matches) closeDrawer('dismiss');
    };
    updateViewport(mediaQuery);
    mediaQuery.addEventListener('change', updateViewport);
    return () => mediaQuery.removeEventListener('change', updateViewport);
  }, [closeDrawer]);

  const toggleAdmin = useCallback(() => setAdminExpanded((prev) => !prev), []);

  // While the drawer covers the page, Tab must cycle inside it; focus that
  // escapes would land on controls hidden behind the overlay. The desktop
  // rail is a visible inline element, so it never traps.
  const trapDrawerFocus = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !mobileOpen || !isMobileViewport) return;
    const root = drawerRef.current;
    if (!root) return;
    const focusables = Array.from(root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (!root.contains(active)) {
      e.preventDefault();
      first.focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, [mobileOpen, isMobileViewport]);

  const renderNavLink = (item: NavItem) => (
    <li key={item.to}>
      <NavLink
        to={item.to}
        end={item.to === '/'}
        className={({ isActive }) =>
          'nav-link' + (isActive ? ' nav-link--active' : '')
        }
        onClick={() => closeDrawer('navigate')}
        title={t(item.key)}
      >
        <NavIcon route={item.to} />
        <span className="nav-link-label">{t(item.key)}</span>
      </NavLink>
    </li>
  );
  const currentNavItem = VISIBLE_NAV_ITEMS.find((item) =>
    item.to === '/' ? location.pathname === '/' : location.pathname === item.to || location.pathname.startsWith(item.to + '/'),
  );
  const breadcrumbLabel = currentNavItem ? t(currentNavItem.key) : null;
  const breadcrumb = (
    <nav className="app-breadcrumb" aria-label={t('nav.breadcrumbAria')}>
      <NavLink to="/" className="app-breadcrumb__home" onClick={() => closeDrawer('navigate')}>
        {CONTROL_APP ? t('nav.controlDevices') : t('nav.dashboard')}
      </NavLink>
      {breadcrumbLabel && currentNavItem && currentNavItem.to !== '/' && (
        <>
          <span className="app-breadcrumb__sep" aria-hidden="true">/</span>
          <span className="app-breadcrumb__current" aria-current="page">{breadcrumbLabel}</span>
        </>
      )}
    </nav>
  );

  const navContent = (
    <>
      <div className="app-nav__head">
        <h2 className="app-nav-brand">
          <span className="app-brand-name">{CONTROL_APP ? 'Web Control' : 'PrintOps'}</span>
          <AppVersionBadge label={CONTROL_APP ? 'Web Control' : t('app.version')} />
        </h2>
        {!CONTROL_APP && (
          <div className="app-nav__gateway">
            <ClientControlStatusBadge iconOnly />
          </div>
        )}
      </div>
      {breadcrumb}
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
        <div className="session-card__tools">
          <LocaleToggle />
        </div>
        <button
          type="button"
          className="session-signout-btn"
          onClick={onLogout}
        >
          <ActionIcon name="logout" />
          {t('common.signOut')}
        </button>
        <NavLink to="/account/security" className="session-signout-btn" onClick={() => closeDrawer('navigate')}>
          {t('recovery.manageNav')}
        </NavLink>
      </article>
    </>
  );

  const navId = 'app-nav';
  const drawerRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  // The drawer is the only place navigation exists below 1024px. It owns focus
  // on open; on close it hands focus back to the opener — except when the
  // close was really a navigation, which moves focus into the routed page.
  useEffect(() => {
    if (mobileOpen) {
      wasOpenRef.current = true;
      lastFocusedRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      const focusTimer = window.setTimeout(() => {
        const root = drawerRef.current;
        if (!root) return;
        const target =
          root.querySelector<HTMLElement>('[data-nav-initial-focus]') ??
          root.querySelector<HTMLElement>('a[href], button:not([disabled])');
        (target ?? root).focus();
      }, 0);
      return () => window.clearTimeout(focusTimer);
    }

    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    if (closeCauseRef.current === 'navigate') {
      document.getElementById('main-content')?.focus();
      return;
    }
    const opener = lastFocusedRef.current;
    lastFocusedRef.current = null;
    if (opener && opener.isConnected) {
      opener.focus();
    }
  }, [mobileOpen]);

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
          <span className="app-brand-name">{CONTROL_APP ? 'Web Control' : 'PrintOps'}</span>
          <AppVersionBadge label={CONTROL_APP ? 'Web Control' : t('app.version')} />
        </span>
        {!CONTROL_APP && <ClientControlStatusBadge />}
        <div className="app-header__tools">
          <LocaleToggle />
        </div>
      </header>

      {/* Overlay for mobile */}
      {mobileOpen && (
        <div
          className="nav-overlay"
          onClick={() => closeDrawer('dismiss')}
          aria-hidden="true"
        />
      )}

      <nav
        ref={drawerRef}
        id={navId}
        className={'app-nav d1-nav' + (mobileOpen ? ' app-nav--open' : '')}
        aria-label={t('nav.ariaLabel')}
        role={isMobileViewport && mobileOpen ? 'dialog' : undefined}
        aria-modal={isMobileViewport && mobileOpen ? true : undefined}
        inert={isMobileViewport && !mobileOpen ? '' : undefined}
        onKeyDown={trapDrawerFocus}
      >
        <button
          type="button"
          className="nav-drawer-close"
          data-nav-initial-focus={mobileOpen ? '' : undefined}
          onClick={() => closeDrawer('dismiss')}
          aria-label={t('nav.menu.close')}
          title={t('nav.menu.close')}
          tabIndex={isMobileViewport && !mobileOpen ? -1 : undefined}
        >
          <ActionIcon name="close" />
        </button>
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

/**
 * Desktop chrome: page trail on the left, global state and identity on the
 * right. Hidden below 1024px, where the drawer owns navigation.
 */
function AppTopbar({ user }: { user: SessionUser }) {
  const { t } = useLocale();
  const location = useLocation();
  const currentNavItem = VISIBLE_NAV_ITEMS.find((item) =>
    item.to === '/' ? location.pathname === '/' : location.pathname === item.to || location.pathname.startsWith(item.to + '/'),
  );
  const breadcrumbLabel = currentNavItem ? t(currentNavItem.key) : null;
  return (
    <div className="app-topbar">
      <nav className="app-breadcrumb" aria-label={t('nav.breadcrumbAria')}>
        <NavLink to="/" className="app-breadcrumb__home">
          {CONTROL_APP ? t('nav.controlDevices') : t('nav.dashboard')}
        </NavLink>
        {breadcrumbLabel && currentNavItem && currentNavItem.to !== '/' && (
          <>
            <span className="app-breadcrumb__sep" aria-hidden="true">/</span>
            <span className="app-breadcrumb__current" aria-current="page">{breadcrumbLabel}</span>
          </>
        )}
      </nav>
      <div className="app-topbar__gateway">
        {!CONTROL_APP && <ClientControlStatusBadge iconOnly />}
      </div>
      <div className="app-topbar__tools">
        <LocaleToggle />
        <NavLink
          to="/account/security"
          className="user-chip"
          title={`${user.name} · ${t('session.role.' + user.role)}`}
        >
          <span className="user-chip__avatar" aria-hidden="true">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <span className="user-chip__name">{user.name}</span>
          <span className="user-chip__role">{t('session.role.' + user.role)}</span>
        </NavLink>
      </div>
    </div>
  );
}

function AppShell({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const { t } = useLocale();
  const location = useLocation();
  const pagePath = VISIBLE_NAV_ITEMS.find((item) => item.to === '/' ? location.pathname === '/' : location.pathname === item.to || location.pathname.startsWith(item.to + '/'))?.to;
  const pageAllowed = user.role === 'OWNER' || !user.allowedPages || !pagePath || user.allowedPages.includes(pagePath);
  return (
    <SessionProvider user={user}>
    <ClientControlStatusProvider>
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{t('nav.skipToContent')}</a>
      <AppNav user={user} onLogout={onLogout} />
      <div className="app-content">
        <AppTopbar user={user} />
        <main id="main-content" className="app-main" tabIndex={-1}>
        {!pageAllowed ? <div className="not-authorized" role="alert"><h1>{t('auth.notAuthorized.title')}</h1><p>{t('auth.notAuthorized.message')}</p></div> : <Suspense fallback={<div className="loading-text" role="status">{t('common.loading')}</div>}>
          <Routes>
          <Route path="/account/security" element={<AccountSecurity />} />
          <Route path="/" element={CONTROL_APP ? <Navigate to="/control/devices" replace /> : <Dashboard />} />
          {!CONTROL_APP && <>
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
          </>}
          {CONTROL_APP && <>
            <Route path="/control/devices" element={<WebControlDevices />} />
            <Route path="/control/devices/:id" element={<WebControlDeviceDetail />} />
            <Route path="/control/content" element={<WebControlContent />} />
            <Route path="/control/templates" element={<Templates />} />
            <Route path="/control/paper-profiles" element={<PaperProfiles />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/paper-profiles" element={<PaperProfiles />} />
            <Route path="/control/releases" element={<WebControlReleases />} />
          </>}
          </Routes>
        </Suspense>}
        </main>
      </div>
    </div>
    </ClientControlStatusProvider>
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
    // Bundled desktop builds boot offline from the Tauri shell; once a real
    // API answers, hand the browser off to the operational origin so session
    // storage, CORS and routing line up. In that mode we never mark
    // `apiReady` here — the replace() takes the user to the server UI.
    const nativeOrigin = desktopBootstrapOrigin();
    const maxAttempts = nativeOrigin ? 60 : CONTROL_APP ? 30 : 15;
    // Keep the removed native supervision's timing: every probe capped at 2s,
    // the whole wait bounded at ~60s. Browser retry rhythm is unchanged.
    const nativeDeadline = nativeOrigin ? Date.now() + 60_000 : null;
    for (let i = 0; i < maxAttempts; i++) {
      if (cancelled) return;
      if (nativeDeadline !== null && Date.now() > nativeDeadline) break;
      try {
        const res = await fetch(
          healthUrl(),
          nativeOrigin ? { signal: AbortSignal.timeout(2000) } : undefined,
        );
        if (res.ok) {
          if (nativeOrigin) {
            window.location.replace(nativeOrigin);
          } else {
            setApiReady(true);
          }
          return;
        }
      } catch {
        // API not ready yet (timeout counts as not ready)
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
        <ServiceConnectionScreen error={apiError} onRetry={checkApi} controlApp={CONTROL_APP} />
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
