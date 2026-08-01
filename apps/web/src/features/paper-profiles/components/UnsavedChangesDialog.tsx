import { useRef } from 'react';
import { useModalFocusTrap } from '../../../components/Dialog.js';
import type { Translate } from './types.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';

export function UnsavedChangesDialog({ open, profileCode, onContinue, onDiscard, t }: {
  open: boolean;
  profileCode: string;
  onContinue: () => void;
  onDiscard: () => void;
  t: Translate;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(open, panelRef, onContinue);
  if (!open) return null;
  return (
    <div className="ds-modal" role="dialog" aria-modal="true" aria-labelledby="paper-profile-unsaved-title"
      onClick={onContinue}>
      <div ref={panelRef} tabIndex={-1} className="ds-modal__panel ds-modal__panel--sm"
        onClick={(event) => event.stopPropagation()}>
        <div className="ds-modal__header">
          <h2 id="paper-profile-unsaved-title">{t('page.paperProfiles.unsavedTitle')}</h2>
          <button type="button" className="ds-btn ds-btn--icon" onClick={onContinue}
            aria-label={t('common.close')}><PaperProfileIcon name="close" /></button>
        </div>
        <div className="ds-confirm__body">
          <p>{t('page.paperProfiles.unsavedBody').replace('{code}', profileCode)}</p>
          <code>{profileCode}</code>
        </div>
        <div className="ds-modal__actions">
          <button type="button" className="ds-btn ds-btn--secondary" onClick={onContinue}>
            {t('page.paperProfiles.continueEditing')}
          </button>
          <button type="button" className="ds-btn ds-btn--danger" onClick={onDiscard}>
            {t('page.paperProfiles.discardChanges')}
          </button>
        </div>
      </div>
    </div>
  );
}
