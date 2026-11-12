import { useState } from 'react';
import { Button } from '../../../components/ui/index.js';
import { listPaperProfileVersions, restorePaperProfileVersion, type PaperProfileVersion } from '../api/paperProfilesApi.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import { IconButton } from './editorPrimitives.js';
import type { Translate } from './types.js';

/** Saved versions of the profile being edited; restoring saves it as the newest version. */
export function VersionHistoryMenu({ editor, t, onRestored }: { editor: PaperProfileEditor; t: Translate; onRestored: () => void }) {
  const profileId = editor.state.editingProfileId;
  const [versions, setVersions] = useState<PaperProfileVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!profileId) return null;
  // Restoring loads the version into the editor, so unsaved edits would be lost.
  const dirty = editor.state.saveStatus === 'dirty';
  const open = versions !== null;
  const toggle = () => {
    if (open) return setVersions(null);
    setError(null);
    listPaperProfileVersions(profileId).then(setVersions, (e: Error) => { setVersions([]); setError(e.message); });
  };
  const restore = async (versionId: string) => {
    setBusy(true);
    try {
      editor.startEditing(await restorePaperProfileVersion(profileId, versionId));
      setVersions(null);
      onRestored();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ position: 'relative' }}>
      <IconButton icon={<span aria-hidden="true">⟲</span>} label={t('page.paperProfiles.versionHistory')} active={open} onClick={toggle} />
      {open && (
        <div role="dialog" aria-label={t('page.paperProfiles.versionHistory')} className="ui-card"
          style={{ position: 'absolute', right: 0, top: '100%', zIndex: 30, width: 320, maxHeight: 360, overflow: 'auto', padding: '0.5rem', background: 'var(--neutral-surface, #fff)', boxShadow: '0 8px 24px rgb(0 0 0 / 0.15)' }}>
          {dirty && <p style={{ margin: '0 0 0.5rem' }}><small>{t('page.paperProfiles.versionSaveFirst')}</small></p>}
          {error && <p role="alert" style={{ margin: 0, color: 'var(--state-danger-text)' }}><small>{error}</small></p>}
          {versions.length === 0 && !error && <p style={{ margin: 0 }}><small>{t('page.paperProfiles.versionNone')}</small></p>}
          {versions.map((version, index) => (
            <div key={version.versionId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{version.profile.name}</strong>
                <br /><small>{new Date(version.occurredAt).toLocaleString()} · {version.profile.fields?.length ?? 0} {t('page.paperProfiles.fields')}</small>
              </span>
              {index === 0
                ? <small>{t('page.paperProfiles.versionCurrent')}</small>
                : <Button size="sm" variant="secondary" disabled={dirty || busy} onClick={() => void restore(version.versionId)}>{t('page.paperProfiles.versionRestore')}</Button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
