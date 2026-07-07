import { Routes, Route, NavLink } from 'react-router-dom';
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

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/printers', label: 'Printers' },
  { to: '/discovered-printers', label: 'Discovery' },
  { to: '/diagnostics', label: 'Diagnostics' },
  { to: '/jobs', label: 'Job Queue' },
  { to: '/runners', label: 'Runners' },
  { to: '/audit-logs', label: 'Audit Logs' },
  { to: '/users', label: 'Users & Roles' },
  { to: '/export', label: 'Export' },
  { to: '/settings', label: 'Settings' },
];

export default function App() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <nav style={{ width: 200, background: '#1e1e2e', color: '#fff', padding: '1rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '1.5rem', color: '#89b4fa' }}>PrinterOps</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {navItems.map((item) => (
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
      </nav>
      <main style={{ flex: 1, padding: '2rem', background: '#f5f5f5' }}>
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
