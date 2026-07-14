import { useLocale } from '../i18n/index.js';

export default function UsersRoles() {
  const { t } = useLocale();
  return (
    <div>
      <h1>{t('page.usersRoles.title')}</h1>
      <p style={{ color: '#888', marginTop: '1rem' }}>{t('page.usersRoles.description')}</p>
    </div>
  );
}
