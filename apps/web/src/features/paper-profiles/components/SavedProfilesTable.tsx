import { useMemo, useRef, useState } from 'react';
import { Alert } from '../../../components/Alert.js';
import { EmptyState, ErrorBanner, ErrorState, LoadingState } from '../../../components/PageState.js';
import type { PaperProfilePersistence } from '../hooks/usePaperProfilePersistence.js';
import type { PaperProfile } from '../model/types.js';
import type { Translate } from './types.js';
import { TransferIcon } from '../../../components/TransferIcon.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';

export function SavedProfilesTable({ onEdit, onCreate, persistence, t }: {
  onEdit: (profile: PaperProfile) => void;
  onCreate: () => void;
  persistence: PaperProfilePersistence;
  t: Translate;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [orientation, setOrientation] = useState<'all' | 'portrait' | 'landscape'>('all');
  const resource = persistence.profilesResource;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredProfiles = useMemo(() => persistence.profiles.filter((profile) => {
    const matchesQuery = normalizedQuery.length === 0
      || profile.code.toLocaleLowerCase().includes(normalizedQuery)
      || profile.name.toLocaleLowerCase().includes(normalizedQuery);
    return matchesQuery && (orientation === 'all' || profile.orientation === orientation);
  }), [normalizedQuery, orientation, persistence.profiles]);
  const clearFilters = () => { setQuery(''); setOrientation('all'); };
  const profileFacts = (profile: PaperProfile) => [
    { label: t('page.paperProfiles.size'), value: `${profile.widthMm} × ${profile.heightMm} mm` },
    { label: t('page.paperProfiles.marginsHeader'), value: `${profile.marginTopMm}/${profile.marginRightMm}/${profile.marginBottomMm}/${profile.marginLeftMm} mm` },
    { label: t('page.paperProfiles.orient'), value: profile.orientation === 'portrait' ? t('page.paperProfiles.portrait') : t('page.paperProfiles.landscape') },
    { label: t('page.paperProfiles.dpi'), value: String(profile.dpi) },
    { label: t('page.paperProfiles.fields'), value: String(profile.fields?.length ?? 0) },
  ];
  return (
    <section className="pp-saved-profiles" aria-labelledby="paper-profile-library-title">
      <div className="pp-saved-profiles__header">
        <div>
          <h2 id="paper-profile-library-title">{t('page.paperProfiles.profileLibrary')}</h2>
          <p>{t('page.paperProfiles.libraryHint')}</p>
        </div>
        <div className="pp-saved-profiles__actions">
          <input type="file" ref={inputRef} accept=".json,application/json" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void persistence.importJson(file);
            event.target.value = '';
          }} />
          <button type="button" className="ds-btn ds-btn--ghost" onClick={() => inputRef.current?.click()}
            title={t('page.paperProfiles.importJsonProfile')}><TransferIcon action="import" /> {t('page.paperProfiles.importJsonProfile')}</button>
          <button type="button" className="ds-btn ds-btn--ghost" onClick={() => void persistence.exportAll()}
            disabled={persistence.profiles.length === 0} title={t('page.paperProfiles.exportAllProfiles')}>
            <TransferIcon action="export" /> {t('page.paperProfiles.exportAllProfiles')}
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
        <div className="pp-saved-profiles__state"><LoadingState label={t('page.paperProfiles.loadingProfiles')} /></div>
      )}
      {resource.data !== undefined && resource.data.length === 0 && (
        <div className="pp-saved-profiles__state"><EmptyState title={t('page.paperProfiles.noProfiles')}
          hint={t('page.paperProfiles.noProfilesHint')} action={<button type="button" className="ds-btn ds-btn--primary" onClick={onCreate}>
            <PaperProfileIcon name="plus" /> {t('page.paperProfiles.createProfile')}
          </button>} /></div>
      )}
      {resource.data !== undefined && resource.data.length > 0 && (
        <>
      <div className="pp-library-controls">
        <label className="pp-library-search">
          <PaperProfileIcon name="search" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            aria-label={t('page.paperProfiles.searchProfiles')}
            placeholder={t('page.paperProfiles.searchPlaceholder')} />
        </label>
        <label className="pp-library-filter">
          <span>{t('page.paperProfiles.orientation')}</span>
          <select value={orientation} onChange={(event) => setOrientation(event.target.value as typeof orientation)}>
            <option value="all">{t('page.paperProfiles.allOrientations')}</option>
            <option value="portrait">{t('page.paperProfiles.portrait')}</option>
            <option value="landscape">{t('page.paperProfiles.landscape')}</option>
          </select>
        </label>
        <span className="pp-library-count" role="status" aria-live="polite">
          {t('page.paperProfiles.showingProfiles').replace('{shown}', String(filteredProfiles.length)).replace('{total}', String(persistence.profiles.length))}
        </span>
      </div>
      {filteredProfiles.length === 0 ? (
        <div className="pp-saved-profiles__state"><EmptyState title={t('page.paperProfiles.noMatchingProfiles')}
          hint={t('page.paperProfiles.noMatchingProfilesHint')} action={<button type="button" className="ds-btn ds-btn--secondary" onClick={clearFilters}>
            {t('page.paperProfiles.clearFilters')}
          </button>} /></div>
      ) : <>
      <div className="pp-saved-profiles__table-wrap">
        <table>
          <thead><tr>
            {[t('page.paperProfiles.codeLabel'), t('page.paperProfiles.nameLabel'), t('page.paperProfiles.size'),
              t('page.paperProfiles.marginsHeader'), t('page.paperProfiles.orient'), t('page.paperProfiles.dpi'),
              t('page.paperProfiles.fields'), t('page.paperProfiles.actions')].map((heading) => <th key={heading}>{heading}</th>)}
          </tr></thead>
          <tbody>
            {filteredProfiles.map((profile) => (
              <tr key={profile.id}>
                <td><code>{profile.code}</code></td><td><strong>{profile.name}</strong></td>
                <td>{profile.widthMm}×{profile.heightMm}</td>
                <td>{profile.marginTopMm}/{profile.marginRightMm}/{profile.marginBottomMm}/{profile.marginLeftMm}</td>
                <td>{profile.orientation === 'portrait' ? t('page.paperProfiles.portrait') : t('page.paperProfiles.landscape')}</td>
                <td>{profile.dpi}</td>
                <td>{profile.fields?.length ?? 0}</td>
                <td className="pp-saved-profiles__row-actions">
                  <button type="button" className="ds-btn ds-btn--secondary pp-edit-profile" onClick={() => onEdit(profile)}>
                    <PaperProfileIcon name="edit" /> {t('page.paperProfiles.editProfile')}
                  </button>
                  <button type="button" className="ds-btn ds-btn--icon" onClick={() => void persistence.exportProfile(profile)}
                    title={t('page.paperProfiles.exportProfile')} aria-label={t('page.paperProfiles.exportProfile')}><TransferIcon action="export" /></button>
                  <button type="button" className="ds-btn ds-btn--icon ds-btn--danger"
                    onClick={(event) => persistence.requestDelete(profile, event.currentTarget)}
                    title={t('page.paperProfiles.deleteProfile')} aria-label={t('page.paperProfiles.deleteProfile')}><PaperProfileIcon name="trash" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pp-profile-cards">
        {filteredProfiles.map((profile) => (
          <article className="pp-profile-card" key={profile.id}>
            <div className="pp-profile-card__heading">
              <div><code>{profile.code}</code><h3>{profile.name}</h3></div>
              <button type="button" className="ds-btn ds-btn--secondary" onClick={() => onEdit(profile)}>
                <PaperProfileIcon name="edit" /> {t('page.paperProfiles.editProfile')}
              </button>
            </div>
            <dl>{profileFacts(profile).map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
            <div className="pp-profile-card__actions">
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => void persistence.exportProfile(profile)}>
                <TransferIcon action="export" /> {t('page.paperProfiles.exportProfile')}
              </button>
              <button type="button" className="ds-btn ds-btn--ghost pp-profile-card__delete"
                onClick={(event) => persistence.requestDelete(profile, event.currentTarget)}>
                <PaperProfileIcon name="trash" /> {t('page.paperProfiles.deleteProfile')}
              </button>
            </div>
          </article>
        ))}
      </div>
      </>}
      </>
      )}
    </section>
  );
}
