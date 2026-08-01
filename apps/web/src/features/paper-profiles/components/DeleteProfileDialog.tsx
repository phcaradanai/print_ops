import { useRef } from 'react';
import { useModalFocusTrap } from '../../../components/Dialog.js';
import type { PaperProfilePersistence } from '../hooks/usePaperProfilePersistence.js';
import type { Translate } from './types.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';

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
            disabled={persistence.deletePending} aria-label={t('common.cancel')}><PaperProfileIcon name="close" /></button></div>
        <div className="ds-confirm__body">
          <p>{t('page.paperProfiles.confirmDelete').replace('{code}', profile.code)}</p><code className="ui-text ui-text--mono ui-text--wrap">{profile.code}</code>
        </div>
        <div className="ds-modal__actions">
          <div data-impeccable-variants="484d7fee" data-impeccable-variant-count="3" style={{ display: "contents" }}>
            {/* impeccable-variants-start 484d7fee */}
            {/* Original */}
            <div data-impeccable-variant="original">
              <button type="button" className="ds-btn ds-btn--ghost" onClick={persistence.cancelDelete}
                disabled={persistence.deletePending}>{t('common.cancel')}</button>
            </div>
            {/* Variants: insert below this line */}
            <style data-impeccable-css="484d7fee">{`
              @scope ([data-impeccable-variant="1"]) {
                :scope > button {
                  background-color: var(--neutral-subtle);
                  border: 1px solid transparent;
                }
                :scope > button:hover {
                  background-color: var(--neutral-border);
                }
              }
              
              @scope ([data-impeccable-variant="2"]) {
                :scope > button {
                  color: var(--semantic-info);
                  background: transparent;
                }
                :scope > button:hover {
                  background-color: rgba(137, 180, 250, 0.1);
                  color: var(--nav-active);
                }
              }

              @scope ([data-impeccable-variant="3"]) {
                :scope > button {
                  padding: 0;
                  background: transparent;
                  color: var(--neutral-text);
                }
                :scope > button:hover {
                  background: transparent;
                  text-decoration: underline;
                  color: var(--neutral-inverse);
                }
              }
            `}</style>
            <div data-impeccable-variant="1" data-impeccable-params='[]'>
              <button type="button" className="ds-btn ds-btn--ghost" onClick={persistence.cancelDelete} disabled={persistence.deletePending}>{t('common.cancel')}</button>
            </div>
            <div data-impeccable-variant="2" data-impeccable-params='[]' style={{ display: "none" }}>
              <button type="button" className="ds-btn ds-btn--ghost" onClick={persistence.cancelDelete} disabled={persistence.deletePending}>{t('common.cancel')}</button>
            </div>
            <div data-impeccable-variant="3" data-impeccable-params='[]' style={{ display: "none" }}>
              <button type="button" className="ds-btn ds-btn--ghost" onClick={persistence.cancelDelete} disabled={persistence.deletePending}>{t('common.cancel')}</button>
            </div>
            {/* impeccable-variants-end 484d7fee */}
          </div>
          <button type="button" className="ds-btn ds-btn--danger" onClick={() => void persistence.confirmDelete()}
            disabled={persistence.deletePending}><PaperProfileIcon name="trash" /> {t('page.paperProfiles.deleteProfile')}</button>
        </div>
      </div>
    </div>
  );
}
