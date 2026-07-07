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
import { getCurrentUser, login, logout, type SessionUser } from './api/client.js';

const navItems = [
  { to: '/', label: 'Dashboard', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] },
  { to: '/printers', label: 'Printers', roles: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] },
  { to: '/discovered-printers', label: 'Discovery', roles: ['OWNER', 'ADMIN'] },
  { to: '/diagnostics', label: 'Diagnostics', roles: ['OWNER', 'ADMIN', 'OPERATOR'] },
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
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => logout())
      .finally(() => setCheckingSession(false));
  }, []);

  const visibleNav = useMemo(
    () => navItems.filter((item) => user && item.roles.includes(user.role)),
    [user]
  );

  if (checkingSession) {
    return <div className="login-screen"><p style={{ color: '#6b7280' }}>Loading...</p></div>;
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
          <Route path="/audit-logs" element={<AuditLogs />} />
          <Route path="/users" element={<UsersRoles />} />
          <Route path="/export" element={<ExportCenter />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
