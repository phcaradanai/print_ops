import { useRef } from 'react';
import { useModalFocusTrap } from '../../../components/Dialog.js';
import type { PaperProfilePersistence } from '../hooks/usePaperProfilePersistence.js';
import type { Translate } from './types.js';

export function DeleteProfileDialog({ persistence, t }: {
  persistence: PaperProfilePersistence;
  t: Translate;
}) {
  const profile = persistence.pendingDeleteProfile;
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(Boolean(profile), panelRef, persistence.cancelDelete);
  if (!profile) return null;
  return (
    <div className="ds-modal" role="dialog" aria-modal="true" aria-labelledby="paper-profile-delete-title"
      onClick={() => { if (!persistence.deletePending) persistence.cancelDelete(); }}>
      <div ref={panelRef} tabIndex={-1} className="ds-modal__panel ds-modal__panel--sm" onClick={(event) => event.stopPropagation()}>
        <div className="ds-modal__header"><h2 id="paper-profile-delete-title">{t('page.paperProfiles.deleteProfile')}</h2>
          <button type="button" className="ds-btn ds-btn--icon" onClick={persistence.cancelDelete}
            disabled={persistence.deletePending} aria-label={t('common.cancel')}>✕</button></div>
        <div className="ds-confirm__body">
          <p>{t('page.paperProfiles.confirmDelete').replace('{code}', profile.code)}</p><code>{profile.code}</code>
        </div>
        <div className="ds-modal__actions">
          <button type="button" className="ds-btn ds-btn--ghost" onClick={persistence.cancelDelete}
            disabled={persistence.deletePending}>{t('common.cancel')}</button>
          <button type="button" className="ds-btn ds-btn--danger" onClick={() => void persistence.confirmDelete()}
            disabled={persistence.deletePending}>🗑 {t('page.paperProfiles.deleteProfile')}</button>
        </div>
      </div>
    </div>
  );
}
