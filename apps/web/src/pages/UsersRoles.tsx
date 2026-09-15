import { useCallback, useState, type FormEvent } from 'react';
import { useLocale } from '../i18n/index.js';
import { apiFetch, getCurrentUser, type SessionUser } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
import {
  Badge,
  Button,
  StateBadge,
  Switch,
  Checkbox,
  DataCell,
  DataHead,
  DataTable,
  ErrorState,
  Fieldset,
  Freshness,
  Grid,
  Inline,
  Input,
  LoadingState,
  PageLayout,
  Stack,
  Text,
} from '../components/ui/index.js';

interface UserItem {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
  isActive: boolean;
  createdAt: string;
  allowedPages?: string[];
}

const PAGE_OPTIONS = ['/', '/printers', '/jobs', '/runners', '/templates', '/paper-profiles', '/discovered-printers', '/diagnostics', '/template-sandbox', '/webhooks', '/route-policies', '/printer-bindings', '/print-flow', '/audit-logs', '/users', '/export', '/settings'];

const ROLE_LEVELS: Record<SessionUser['role'], number> = {
  VIEWER: 1,
  OPERATOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

export default function UsersRoles() {
  const { t } = useLocale();

  const fetchDirectory = useCallback(async () => {
    const [users, currentUser] = await Promise.all([
      apiFetch<UserItem[]>('/v1/users'),
      getCurrentUser(),
    ]);
    return { users, currentUser };
  }, []);

  const directory = useApiResource(fetchDirectory);
  const users = directory.data?.users ?? [];
  const currentUser: SessionUser | null = directory.data?.currentUser ?? null;

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [accessUserId, setAccessUserId] = useState<string | null>(null);
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [statusUserId, setStatusUserId] = useState<string | null>(null);

  const changePassword = useApiAction(async (targetId: string, password: string) => {
    await apiFetch(`/v1/users/${targetId}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    });
    return true;
  });
  const submitting = changePassword.pending;
  const editError = changePassword.error != null ? errorMessage(changePassword.error) : null;
  const changeAccess = useApiAction(async (targetId: string, allowedPages: string[]) => {
    await apiFetch(`/v1/users/${targetId}/access`, { method: 'PUT', body: JSON.stringify({ allowedPages }) });
    return true;
  });
  const changeStatus = useApiAction(async (targetId: string, isActive: boolean) => {
    await apiFetch(`/v1/users/${targetId}/status`, { method: 'PUT', body: JSON.stringify({ isActive }) });
    return true;
  });

  const canEditPassword = (target: UserItem) => {
    if (!currentUser) return false;
    if (currentUser.id === target.id) return true;
    const currentLevel = ROLE_LEVELS[currentUser.role] ?? 0;
    const targetLevel = ROLE_LEVELS[target.role] ?? 0;
    return currentLevel > targetLevel;
  };
  const canEditAccess = (target: UserItem) => Boolean(currentUser && target.role !== 'OWNER' && currentUser.id !== target.id && ROLE_LEVELS[currentUser.role] > ROLE_LEVELS[target.role]);
  const canEditStatus = (target: UserItem) => Boolean(currentUser && target.role !== 'OWNER' && currentUser.id !== target.id && ROLE_LEVELS[currentUser.role] > ROLE_LEVELS[target.role]);

  const handleStatusChange = async (target: UserItem) => {
    setStatusUserId(target.id);
    const ok = await changeStatus.run(target.id, !target.isActive);
    if (ok) {
      changeStatus.reset();
      setStatusUserId(null);
      await directory.refresh();
    }
  };

  const handlePasswordSubmit = async (e: FormEvent, targetId: string) => {
    e.preventDefault();
    if (!newPassword) return;
    const ok = await changePassword.run(targetId, newPassword);
    if (ok) {
      setEditingUserId(null);
      setNewPassword('');
      setShowPassword(false);
      changePassword.reset();
    }
  };

  const cancelPasswordEdit = () => {
    setEditingUserId(null);
    setNewPassword('');
    setShowPassword(false);
    changePassword.reset();
  };

  const renderUserActions = (user: UserItem) => (
    <Stack gap="sm">
      {accessUserId === user.id ? (
        <Fieldset legend={t('page.usersRoles.pageAccess')}>
          <Grid columns="auto" gap="sm" dense>
            {PAGE_OPTIONS.map((page) => (
              <Checkbox
                key={page}
                label={page}
                checked={selectedPages.includes(page)}
                onChange={() => setSelectedPages((pages) => pages.includes(page) ? pages.filter((item) => item !== page) : [...pages, page])}
              />
            ))}
          </Grid>
          <Inline gap="sm">
            <Button
              size="sm"
              busy={changeAccess.pending}
              busyLabel={t('common.saving')}
              onClick={() => void changeAccess.run(user.id, selectedPages).then((ok) => {
                if (ok) {
                  setAccessUserId(null);
                  void directory.refresh();
                }
              })}
            >
              {t('common.save')}
            </Button>
            <Button size="sm" variant="secondary" disabled={changeAccess.pending} onClick={() => setAccessUserId(null)}>
              {t('common.cancel')}
            </Button>
          </Inline>
        </Fieldset>
      ) : canEditAccess(user) ? (
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setAccessUserId(user.id);
              setSelectedPages(user.allowedPages ?? PAGE_OPTIONS);
              changeAccess.reset();
            }}
          >
            {t('page.usersRoles.pageAccess')}
          </Button>
        </div>
      ) : null}

      {changeAccess.error != null && accessUserId === user.id && (
        <Text tone="danger" size="label" role="alert">{errorMessage(changeAccess.error, t('page.usersRoles.accessError'))}</Text>
      )}

      {editingUserId === user.id ? (
        <Inline as="form" gap="sm" onSubmit={(event) => void handlePasswordSubmit(event, user.id)}>
          <Input
            type={showPassword ? 'text' : 'password'}
            controlSize="sm"
            aria-label={t('page.usersRoles.newPassword')}
            placeholder={t('page.usersRoles.newPassword')}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            autoFocus
          />
          <Button size="sm" variant="ghost" onClick={() => setShowPassword((visible) => !visible)}>
            {showPassword ? t('page.usersRoles.hidePassword') : t('page.usersRoles.showPassword')}
          </Button>
          <Button type="submit" size="sm" busy={submitting} busyLabel={t('common.saving')} disabled={!newPassword}>
            {t('common.save')}
          </Button>
          <Button size="sm" variant="secondary" disabled={submitting} onClick={cancelPasswordEdit}>
            {t('common.cancel')}
          </Button>
        </Inline>
      ) : canEditPassword(user) ? (
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEditingUserId(user.id);
              setNewPassword('');
              setShowPassword(false);
              changePassword.reset();
            }}
          >
            {t('page.usersRoles.changePassword')}
          </Button>
        </div>
      ) : (
        <Text tone="muted" size="label">{t('page.usersRoles.readOnly')}</Text>
      )}

      {editError && editingUserId === user.id && <Text tone="danger" size="label" role="alert">{editError}</Text>}

      {canEditStatus(user) && (
        <div>
          <Switch
            label={t('page.usersRoles.status')}
            onLabel={t('page.usersRoles.active')}
            offLabel={t('page.usersRoles.inactive')}
            checked={user.isActive}
            busy={changeStatus.pending && statusUserId === user.id}
            disabled={changeStatus.pending && statusUserId !== user.id}
            aria-label={user.isActive ? t('page.usersRoles.deactivateUser') : t('page.usersRoles.activateUser')}
            onChange={() => void handleStatusChange(user)}
          />
        </div>
      )}
      {changeStatus.error != null && statusUserId === user.id && (
        <Text tone="danger" size="label" role="alert">{errorMessage(changeStatus.error, t('page.usersRoles.statusError'))}</Text>
      )}
    </Stack>
  );

  if (directory.loading && !directory.data) {
    return <PageLayout title={t('page.usersRoles.title')}><LoadingState /></PageLayout>;
  }

  if (!directory.data && directory.error != null) {
    return (
      <PageLayout title={t('page.usersRoles.title')} description={t('page.usersRoles.description')}>
        <ErrorState error={directory.error} onRetry={directory.refresh} />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={t('page.usersRoles.title')}
      description={t('page.usersRoles.description')}
      density="compact"
      width="full"
      actions={<Freshness
            lastSuccessAt={directory.lastSuccessAt}
            stale={directory.stale}
            refreshing={directory.refreshing}
            onRefresh={directory.refresh}
          />}
    >

      <DataTable label={t('page.usersRoles.directory')} responsive>
          <thead>
            <tr>
              <DataHead>{t('page.usersRoles.name')}</DataHead>
              <DataHead>{t('page.usersRoles.email')}</DataHead>
              <DataHead>{t('page.usersRoles.role')}</DataHead>
              <DataHead>{t('page.usersRoles.status')}</DataHead>
              <DataHead>{t('page.usersRoles.actions')}</DataHead>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <DataCell label={t('page.usersRoles.name')}>
                  <Inline gap="xs">
                    <Text weight="semibold" tone="strong">{user.name}</Text>
                    {currentUser?.id === user.id && (
                      <Text size="label" tone="muted" weight="medium">{t('page.usersRoles.you')}</Text>
                    )}
                  </Inline>
                </DataCell>
                <DataCell label={t('page.usersRoles.email')}>{user.email}</DataCell>
                <DataCell label={t('page.usersRoles.role')}><Badge>{user.role}</Badge></DataCell>
                <DataCell label={t('page.usersRoles.status')}>
                  <StateBadge
                    value={user.isActive}
                    onLabel={t('page.usersRoles.active')}
                    offLabel={t('page.usersRoles.inactive')}
                  />
                </DataCell>
                <DataCell label={t('page.usersRoles.actions')} actions>{renderUserActions(user)}</DataCell>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <DataCell colSpan={5}>{t('page.usersRoles.noUsers')}</DataCell>
              </tr>
            )}
          </tbody>
      </DataTable>
    </PageLayout>
  );
}
