import { useMemo, useRef, useState } from 'react';
import type { PaperProfilePersistence } from '../hooks/usePaperProfilePersistence.js';
import type { PaperProfile } from '../model/types.js';
import type { Translate } from './types.js';
import { TransferIcon } from '../../../components/TransferIcon.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';
import {
  Alert,
  Badge,
  Button,
  DataCell,
  DataHead,
  DataTable,
  EmptyState,
  ErrorBanner,
  ErrorState,
  IconButton,
  Inline,
  Input,
  Label,
  LoadingState,
  Mono,
  SectionHeading,
  Select,
  Stack,
  Text,
} from '../../../components/ui/index.js';

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

  const orientationLabel = (profile: PaperProfile) =>
    profile.orientation === 'portrait' ? t('page.paperProfiles.portrait') : t('page.paperProfiles.landscape');

  // Column names are declared once and reused as the responsive per-cell labels,
  // so the header row and the mobile card labels cannot drift apart.
  const columns = {
    code: t('page.paperProfiles.codeLabel'),
    name: t('page.paperProfiles.nameLabel'),
    size: t('page.paperProfiles.size'),
    margins: t('page.paperProfiles.marginsHeader'),
    orient: t('page.paperProfiles.orient'),
    dpi: t('page.paperProfiles.dpi'),
    fields: t('page.paperProfiles.fields'),
    actions: t('page.paperProfiles.actions'),
  };

  return (
    <section className="pp-saved-profiles" aria-labelledby="paper-profile-library-title">
      <SectionHeading
        id="paper-profile-library-title"
        title={t('page.paperProfiles.profileLibrary')}
        description={t('page.paperProfiles.libraryHint')}
        actions={
          <>
            {/* Native file picker stays native — the browser behavior is the feature. */}
            <input type="file" ref={inputRef} accept=".json,application/json" hidden onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void persistence.importJson(file);
              event.target.value = '';
            }} />
            <Button variant="ghost" onClick={() => inputRef.current?.click()}
              title={t('page.paperProfiles.importJsonProfile')}>
              <TransferIcon action="import" /> {t('page.paperProfiles.importJsonProfile')}
            </Button>
            <Button variant="ghost" onClick={() => void persistence.exportAll()}
              disabled={persistence.profiles.length === 0} title={t('page.paperProfiles.exportAllProfiles')}>
              <TransferIcon action="export" /> {t('page.paperProfiles.exportAllProfiles')}
            </Button>
          </>
        }
      />

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
          hint={t('page.paperProfiles.noProfilesHint')} action={
            <Button onClick={onCreate}>
              <PaperProfileIcon name="plus" /> {t('page.paperProfiles.createProfile')}
            </Button>
          } /></div>
      )}
      {resource.data !== undefined && resource.data.length > 0 && (
        <>
          <div className="pp-library-controls">
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t('page.paperProfiles.searchProfiles')}
              placeholder={t('page.paperProfiles.searchPlaceholder')}
              leading={<PaperProfileIcon name="search" />}
            />
            <Inline gap="sm" className="pp-library-filter">
              <Label htmlFor="pp-orientation-filter">{t('page.paperProfiles.orientation')}</Label>
              <Select
                id="pp-orientation-filter"
                controlSize="sm"
                value={orientation}
                onChange={(event) => setOrientation(event.target.value as typeof orientation)}
              >
                <option value="all">{t('page.paperProfiles.allOrientations')}</option>
                <option value="portrait">{t('page.paperProfiles.portrait')}</option>
                <option value="landscape">{t('page.paperProfiles.landscape')}</option>
              </Select>
            </Inline>
            <Text size="label" tone="muted" role="status" aria-live="polite" className="pp-library-count">
              {t('page.paperProfiles.showingProfiles').replace('{shown}', String(filteredProfiles.length)).replace('{total}', String(persistence.profiles.length))}
            </Text>
          </div>

          {filteredProfiles.length === 0 ? (
            <div className="pp-saved-profiles__state"><EmptyState title={t('page.paperProfiles.noMatchingProfiles')}
              hint={t('page.paperProfiles.noMatchingProfilesHint')} action={
                <Button variant="secondary" onClick={clearFilters}>
                  {t('page.paperProfiles.clearFilters')}
                </Button>
              } /></div>
          ) : (
            /* One semantic table that becomes labelled cards under 1024px. This
               component used to mount a `<table>` AND a parallel `pp-profile-cards`
               list of the same profiles, so every Edit, Export and Delete control
               existed twice in the accessibility tree — including the destructive
               one, whose two copies passed different trigger elements to
               `requestDelete` and so restored focus to different places. */
            <DataTable label={t('page.paperProfiles.profileLibrary')} responsive>
              <thead>
                <tr>
                  <DataHead>{columns.code}</DataHead>
                  <DataHead>{columns.name}</DataHead>
                  <DataHead>{columns.size}</DataHead>
                  <DataHead>{columns.margins}</DataHead>
                  <DataHead>{columns.orient}</DataHead>
                  <DataHead>{columns.dpi}</DataHead>
                  <DataHead>{columns.fields}</DataHead>
                  <DataHead>{columns.actions}</DataHead>
                </tr>
              </thead>
              <tbody>
                {filteredProfiles.map((profile) => (
                  <tr key={profile.id}>
                    <DataCell label={columns.code}>
                      <Mono weight="semibold">{profile.code}</Mono>
                    </DataCell>
                    <DataCell label={columns.name}>
                      <Text weight="semibold" tone="strong">{profile.name}</Text>
                    </DataCell>
                    {/* Dimensions are the substance of this surface, so they keep
                        their unit rather than relying on a header two rows away —
                        the card view has no header to rely on at all. */}
                    <DataCell label={columns.size}>
                      <Mono nowrap>{profile.widthMm}×{profile.heightMm} mm</Mono>
                    </DataCell>
                    <DataCell label={columns.margins}>
                      <Mono nowrap>
                        {profile.marginTopMm}/{profile.marginRightMm}/{profile.marginBottomMm}/{profile.marginLeftMm} mm
                      </Mono>
                    </DataCell>
                    <DataCell label={columns.orient}>
                      <Badge>{orientationLabel(profile)}</Badge>
                    </DataCell>
                    <DataCell label={columns.dpi}>
                      <Mono>{profile.dpi}</Mono>
                    </DataCell>
                    <DataCell label={columns.fields}>
                      <Mono>{profile.fields?.length ?? 0}</Mono>
                    </DataCell>
                    <DataCell label={columns.actions} actions>
                      <Inline gap="xs" className="pp-saved-profiles__row-actions">
                        <Button variant="secondary" size="sm" className="pp-edit-profile" onClick={() => onEdit(profile)}>
                          <PaperProfileIcon name="edit" /> {t('page.paperProfiles.editProfile')}
                        </Button>
                        <IconButton
                          size="sm"
                          label={t('page.paperProfiles.exportProfile')}
                          onClick={() => void persistence.exportProfile(profile)}
                        >
                          <TransferIcon action="export" />
                        </IconButton>
                        {/* Deleting a profile is destructive and takes the
                            consequence variant. The trigger element is still
                            handed to `requestDelete` so focus returns here when
                            the confirmation closes. */}
                        <IconButton
                          size="sm"
                          variant="danger"
                          label={t('page.paperProfiles.deleteProfile')}
                          onClick={(event) => persistence.requestDelete(profile, event.currentTarget)}
                        >
                          <PaperProfileIcon name="trash" />
                        </IconButton>
                      </Inline>
                    </DataCell>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </>
      )}
    </section>
  );
}
