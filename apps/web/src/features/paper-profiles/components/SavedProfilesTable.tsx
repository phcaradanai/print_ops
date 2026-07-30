import { useRef } from 'react';
import { Alert } from '../../../components/Alert.js';
import { EmptyState, ErrorBanner, ErrorState, LoadingState } from '../../../components/PageState.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { PaperProfilePersistence } from '../hooks/usePaperProfilePersistence.js';
import type { Translate } from './types.js';

export function SavedProfilesTable({ editor, persistence, t }: {
  editor: PaperProfileEditor;
  persistence: PaperProfilePersistence;
  t: Translate;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resource = persistence.profilesResource;
  return (
    <div className="pp-saved-profiles">
      <div className="pp-saved-profiles__header">
        <h2>{t('page.paperProfiles.savedProfiles').replace('{n}', String(persistence.profiles.length))}</h2>
        <div className="pp-saved-profiles__actions">
          <input type="file" ref={inputRef} accept=".json,application/json" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void persistence.importJson(file);
            event.target.value = '';
          }} />
          <button type="button" className="ds-btn ds-btn--ghost" onClick={() => inputRef.current?.click()}
            title={t('page.paperProfiles.importJsonProfile')}>⤓ {t('page.paperProfiles.importJsonProfile')}</button>
          <button type="button" className="ds-btn ds-btn--ghost" onClick={() => void persistence.exportAll()}
            disabled={persistence.profiles.length === 0} title={t('page.paperProfiles.exportAllProfiles')}>
            ⤒ {t('page.paperProfiles.exportAllProfiles')}
          </button>
        </div>
      </div>
      {persistence.feedback && (
        <div className="pp-saved-profiles__feedback">
          <Alert tone={persistence.feedback.tone} onDismiss={persistence.dismissFeedback}
            dismissLabel={t('error.dismiss')}>{persistence.feedback.text}</Alert>
        </div>
      )}
      {resource.error != null && resource.data === undefined && (
        <div className="pp-saved-profiles__state"><ErrorState error={resource.error}
          title={t('page.paperProfiles.loadFailed')} onRetry={resource.refresh} /></div>
      )}
      {resource.error != null && resource.data !== undefined && (
        <div className="pp-saved-profiles__state"><ErrorBanner error={resource.error}
          title={t('page.paperProfiles.loadFailed')} onRetry={resource.refresh} /></div>
      )}
      {resource.loading && resource.data === undefined && resource.error == null && (
        <div className="pp-saved-profiles__state"><LoadingState /></div>
      )}
      {resource.data !== undefined && resource.data.length === 0 && (
        <div className="pp-saved-profiles__state"><EmptyState title={t('page.paperProfiles.noProfiles')} /></div>
      )}
      <div className="pp-saved-profiles__table-wrap">
        <table>
          <thead><tr>
            {[t('page.paperProfiles.codeLabel'), t('page.paperProfiles.nameLabel'), t('page.paperProfiles.size'),
              t('page.paperProfiles.marginsHeader'), t('page.paperProfiles.orient'), t('page.paperProfiles.dpi'),
              t('page.paperProfiles.actions')].map((heading) => <th key={heading}>{heading}</th>)}
          </tr></thead>
          <tbody>
            {persistence.profiles.map((profile) => (
              <tr key={profile.id}>
                <td><code>{profile.code}</code></td><td>{profile.name}</td>
                <td>{profile.widthMm}×{profile.heightMm}</td>
                <td>{profile.marginTopMm}/{profile.marginRightMm}/{profile.marginBottomMm}/{profile.marginLeftMm}</td>
                <td>{profile.orientation === 'portrait' ? t('page.paperProfiles.portrait') : t('page.paperProfiles.landscape')}</td>
                <td>{profile.dpi}</td>
                <td className="pp-saved-profiles__row-actions">
                  <button className="ds-btn ds-btn--icon" onClick={() => editor.startEditing(profile)}
                    title={t('page.paperProfiles.editingProfile')}>✏️</button>
                  <button className="ds-btn ds-btn--icon" onClick={() => void persistence.exportProfile(profile)}
                    title={t('page.paperProfiles.exportProfile')}>⤒</button>
                  <button className="ds-btn ds-btn--icon ds-btn--danger"
                    onClick={(event) => persistence.requestDelete(profile, event.currentTarget)}
                    title={t('page.paperProfiles.deleteProfile')}>🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
