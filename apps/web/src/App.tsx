import { Routes, Route, NavLink } from 'react-router-dom';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
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

const navItems = [
  { to: '/', label: 'Dashboard', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] },
  { to: '/printers', label: 'Printers', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] },
  { to: '/discovered-printers', label: 'Discovery', roles: ['OWNER', 'ADMIN'] },
  { to: '/diagnostics', label: 'Diagnostics', roles: ['OWNER', 'ADMIN', 'OPERATOR'] },
  { to: '/templates', label: 'Templates', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] },
  { to: '/paper-profiles', label: 'Paper Profiles', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] },
  { to: '/template-sandbox', label: 'Sandbox', roles: ['OWNER'] },
  { to: '/webhooks', label: 'Webhooks', roles: ['OWNER', 'ADMIN'] },
  { to: '/route-policies', label: 'Route Policies', roles: ['OWNER', 'ADMIN'] },
  { to: '/printer-bindings', label: 'Bindings', roles: ['OWNER', 'ADMIN'] },
  { to: '/jobs', label: 'Job Queue', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] },
  { to: '/runners', label: 'Runners', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] },
  { to: '/audit-logs', label: 'Audit Logs', roles: ['OWNER', 'ADMIN'] },
  { to: '/users', label: 'Users & Roles', roles: ['OWNER'] },
  { to: '/export', label: 'Export', roles: ['OWNER', 'ADMIN'] },
  { to: '/settings', label: 'Settings', roles: ['OWNER', 'ADMIN'] },
];

const ROLE_LABEL: Record<SessionUser['role'], string> = {
  OWNER: 'Sysadmin',
  ADMIN: 'Admin',
  OPERATOR: 'User',
  VIEWER: 'Viewer',
};

function SplashScreen() {
  const [status, setStatus] = useState('PrintOps is starting...');

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    async function waitForApi() {
      while (!cancelled && attempts < 120) {
        attempts++;
        try {
          const res = await fetch(healthUrl());
          if (res.ok) {
            if (!cancelled) setStatus('System Ready');
            return;
          }
        } catch {
          // retrying...
        }
        if (!cancelled) {
          setStatus(`Starting... (${attempts}/120)`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (!cancelled) setStatus('Unable to connect to server');
    }
    void waitForApi();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="splash-screen">
      <div className="splash-content">
        <div className="splash-logo">PrinterOps</div>
        <p className="splash-tagline">Print Gateway for Hospitals</p>
        <div className="splash-status">{status}</div>
        <div className="splash-spinner" />
      </div>
    </div>
  );
}

function LoginView({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [email, setEmail] = useState('sysadmin@printerops.local');
  const [password, setPassword] = useState('dev-password');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onLogin(await login(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-panel" onSubmit={(event) => void submit(event)}>
        <div>
          <h1>PrinterOps</h1>
          <p>Sign in to manage local printing operations.</p>
        </div>

        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
        </label>

        <label>
          Password
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
        </label>

        {error && <div className="login-error">{error}</div>}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>

        <div className="login-hint">
          Dev accounts: sysadmin@printerops.local, admin@printerops.local, user@printerops.local, viewer@printerops.local
        </div>
      </form>
    </div>
  );
}


export default function App() {
  const [apiReady, setApiReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    if (apiReady) return;
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
    return () => { cancelled = true; };
  }, [apiReady]);

  useEffect(() => {
    if (!apiReady) return;
    getCurrentUser()
      .then(setUser)
      .catch(() => logout())
      .finally(() => setCheckingSession(false));
  }, [apiReady]);

  const visibleNav = useMemo(
    () => navItems.filter((item) => user && item.roles.includes(user.role)),
    [user]
  );

  if (!apiReady || checkingSession) {
    return <SplashScreen />;
  }

  if (!user) {
    return <LoginView onLogin={setUser} />;
  }

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <h2 style={{ fontSize: '1rem', marginBottom: '1.5rem', color: '#89b4fa' }}>PrinterOps</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {visibleNav.map((item) => (
            <li key={item.to} style={{ marginBottom: '0.5rem' }}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                style={({ isActive }) => ({
                  color: isActive ? '#89b4fa' : '#cdd6f4',
                  textDecoration: 'none',
                  fontSize: '0.875rem',
                })}
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="session-card">
          <div>{user.name}</div>
          <span>{ROLE_LABEL[user.role]}</span>
          <button
            type="button"
            onClick={() => {
              logout();
              setUser(null);
            }}
          >
            Sign out
          </button>
        </div>
      </nav>
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
