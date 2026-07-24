import { useEffect, useState, type FormEvent } from 'react';
import { useLocale } from '../i18n/index.js';
import { apiFetch, getCurrentUser, type SessionUser } from '../api/client.js';

interface UserItem {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
  isActive: boolean;
  password?: string;
  createdAt: string;
}

const ROLE_LEVELS: Record<SessionUser['role'], number> = {
  VIEWER: 1,
  OPERATOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

export default function UsersRoles() {
  const { t } = useLocale();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<UserItem[]>('/v1/users'),
      getCurrentUser(),
    ])
      .then(([usersData, user]) => {
        if (!active) return;
        setUsers(usersData);
        setCurrentUser(user);
        setLoading(false);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, []);

  const canEditPassword = (target: UserItem) => {
    if (!currentUser) return false;
    if (currentUser.id === target.id) return true;
    const currentLevel = ROLE_LEVELS[currentUser.role] ?? 0;
    const targetLevel = ROLE_LEVELS[target.role] ?? 0;
    return currentLevel > targetLevel;
  };

  const handlePasswordSubmit = async (e: FormEvent, targetId: string) => {
    e.preventDefault();
    if (!newPassword) return;
    setSubmitting(true);
    setEditError(null);
    try {
      await apiFetch(`/v1/users/${targetId}/password`, {
        method: 'PUT',
        body: JSON.stringify({ password: newPassword }),
      });
      setEditingUserId(null);
      setNewPassword('');
      setShowPassword(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="p-4">{t('common.loading')}</div>;
  }

  if (error) {
    return (
      <div className="p-4 text-red-600">
        <h2>{t('error.title')}</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="page-container" style={{ padding: '2rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#111827', margin: 0 }}>
          {t('page.usersRoles.title')}
        </h1>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', marginTop: '0.35rem' }}>
          {t('page.usersRoles.description')}
        </p>
      </header>

      <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: '#f0f0f0', borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#374151' }}>Name</th>
              <th style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#374151' }}>Email</th>
              <th style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#374151' }}>Role</th>
              <th style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#374151' }}>Status</th>
              <th style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#374151' }}>Password</th>
              <th style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#374151' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#111827' }}>
                  {u.name} {currentUser?.id === u.id && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>(You)</span>}
                </td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#111827' }}>{u.email}</td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#111827' }}>
                  <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem' }}>
                    {u.role}
                  </span>
                </td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#111827' }}>
                  {u.isActive ? (
                    <span style={{ color: '#059669', fontSize: '0.75rem', fontWeight: 500 }}>Active</span>
                  ) : (
                    <span style={{ color: '#dc2626', fontSize: '0.75rem', fontWeight: 500 }}>Inactive</span>
                  )}
                </td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#111827' }}>
                  {canEditPassword(u) ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontFamily: 'monospace', minWidth: '80px', color: '#4b5563' }}>
                        {visiblePasswords[u.id] ? (u.password || '—') : '••••••••'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setVisiblePasswords(prev => ({ ...prev, [u.id]: !prev[u.id] }))}
                        style={{
                          background: 'transparent',
                          border: '1px solid #d1d5db',
                          borderRadius: '4px',
                          padding: '0.15rem 0.4rem',
                          fontSize: '0.7rem',
                          cursor: 'pointer',
                          color: '#6b7280',
                        }}
                      >
                        {visiblePasswords[u.id] ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  ) : (
                    <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>••••••••</span>
                  )}
                </td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#111827' }}>
                  {editingUserId === u.id ? (
                    <form onSubmit={(e) => void handlePasswordSubmit(e, u.id)} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #d1d5db', background: '#ffffff', borderRadius: '6px', overflow: 'hidden' }}>
                        <input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="New Password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            padding: '0.4rem 0.6rem',
                            fontSize: '0.8rem',
                            outline: 'none',
                            width: '120px'
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(p => !p)}
                          title={showPassword ? "Hide password" : "Show password"}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: '0 0.5rem',
                            cursor: 'pointer',
                            color: '#6b7280',
                            fontSize: '0.75rem',
                            fontWeight: 500,
                          }}
                        >
                          {showPassword ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      <button
                        type="submit"
                        disabled={submitting || !newPassword}
                        style={{
                          background: '#1e1e2e',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '0.4rem 0.8rem',
                          fontWeight: 700,
                          fontSize: '0.75rem',
                          cursor: (submitting || !newPassword) ? 'not-allowed' : 'pointer',
                          opacity: (submitting || !newPassword) ? 0.7 : 1,
                        }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingUserId(null);
                          setNewPassword('');
                          setShowPassword(false);
                          setEditError(null);
                        }}
                        disabled={submitting}
                        style={{
                          background: 'transparent',
                          color: '#6b7280',
                          border: 'none',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                      {editError && <span style={{ color: '#dc2626', fontSize: '0.7rem' }}>{editError}</span>}
                    </form>
                  ) : (
                    canEditPassword(u) ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingUserId(u.id);
                          setNewPassword('');
                          setShowPassword(false);
                          setEditError(null);
                        }}
                        style={{
                          background: '#f3f4f6',
                          color: '#374151',
                          border: '1px solid #e5e7eb',
                          borderRadius: '6px',
                          padding: '0.3rem 0.6rem',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                        }}
                      >
                        Change Password
                      </button>
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Read-only</span>
                    )
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280', fontSize: '0.875rem' }}>
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
