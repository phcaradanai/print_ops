import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../../i18n/index.js';
import { CanvasToolbar, type CanvasOptions } from './components/CanvasToolbar.js';
import { DeleteProfileDialog } from './components/DeleteProfileDialog.js';
import { EditorDrawer } from './components/EditorDrawers.js';
import { FullPreviewDialog } from './components/FullPreviewDialog.js';
import { ImportDesignDrawer } from './components/ImportDesignDrawer.js';
import { PaperProfilePageHeader } from './components/PaperProfilePageHeader.js';
import { PreviewPanel } from './components/PreviewPanel.js';
import { ProfileFormPanel } from './components/ProfileFormPanel.js';
import { SavedProfilesTable } from './components/SavedProfilesTable.js';
import { useCanvasInteraction } from './hooks/useCanvasInteraction.js';
import { useImportDesign } from './hooks/useImportDesign.js';
import { usePaperProfileEditor } from './hooks/usePaperProfileEditor.js';
import { usePaperProfilePersistence } from './hooks/usePaperProfilePersistence.js';
import { usePaperProfilePopups } from './hooks/usePaperProfilePopups.js';
import { PaperProfileIcon } from './components/PaperProfileIcon.js';
import { UnsavedChangesDialog } from './components/UnsavedChangesDialog.js';
import type { PaperProfile } from './model/types.js';
import { PageLayout } from '../../components/PageLayout.js';

const DEFAULT_CANVAS_OPTIONS: CanvasOptions = {
  verticalGrid: false,
  horizontalGrid: false,
  rulers: false,
  alignmentGuides: false,
  dimensions: true,
  gridSpacingMm: 10,
};

export default function PaperProfileWorkspace() {
  const { t } = useLocale();
  const editor = usePaperProfileEditor();
  const [stage, setStage] = useState<'library' | 'editor'>('library');
  const [discardPromptOpen, setDiscardPromptOpen] = useState(false);
  const popups = usePaperProfilePopups(editor.state.editingProfileId);
  const interaction = useCanvasInteraction(editor);
  const [canvasOptions, setCanvasOptionsState] = useState(DEFAULT_CANVAS_OPTIONS);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const showNotice = useCallback((message: string) => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, 3000);
  }, []);
  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);
  const setCanvasOptions = useCallback((patch: Partial<CanvasOptions>) => {
    setCanvasOptionsState((current) => ({ ...current, ...patch }));
  }, []);

  const persistence = usePaperProfilePersistence(editor, {
    saveFailed: t('page.paperProfiles.saveFailed'),
    deleteFailed: t('page.paperProfiles.deleteFailed'),
    exportFailed: t('page.paperProfiles.exportFailed'),
    importFailed: t('page.paperProfiles.importJsonFailed'),
    importedCount: (count) => t('page.paperProfiles.importedCount').replace('{n}', String(count)),
    validationMessage: t,
  });
  const onArtworkFeedback = useCallback((message: string) => {
    persistence.setFeedback({ tone: 'error', text: message });
  }, [persistence.setFeedback]);
  const onImported = useCallback(async (profile: Parameters<typeof editor.startEditing>[0], duplicate: boolean) => {
    persistence.refresh();
    editor.startEditing(profile);
    setStage('editor');
    popups.closeDrawer();
    showNotice(duplicate ? t('page.paperProfiles.importDuplicate') : t('page.paperProfiles.importSuccess'));
  }, [editor.startEditing, persistence.refresh, popups.closeDrawer, showNotice, t]);
  const importDesign = useImportDesign(
    editor.state.editingProfileId,
    {
      invalidType: t('page.paperProfiles.importInvalidFileType'),
      tooLarge: t('page.paperProfiles.importFileTooLarge'),
      analyzeFailed: t('page.paperProfiles.importError'),
      importFailed: t('page.paperProfiles.importError'),
      artworkLoadFailed: t('page.paperProfiles.artworkLoadFailed'),
    },
    onImported,
    onArtworkFeedback,
  );
  const mainSheetRef = useRef<HTMLDivElement>(null);
  const hasUnsavedChanges = editor.state.saveStatus === 'dirty' || editor.state.saveStatus === 'error';

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedChanges]);

  const openCreate = useCallback(() => {
    editor.resetEditor();
    setStage('editor');
  }, [editor.resetEditor]);
  const openProfile = useCallback((profile: PaperProfile) => {
    editor.startEditing(profile);
    setStage('editor');
  }, [editor.startEditing]);
  const returnToLibrary = useCallback(() => {
    if (hasUnsavedChanges) {
      setDiscardPromptOpen(true);
      return;
    }
    popups.closeDrawer();
    editor.resetEditor();
    setStage('library');
  }, [editor.resetEditor, hasUnsavedChanges, popups.closeDrawer]);
  const discardAndReturn = useCallback(() => {
    setDiscardPromptOpen(false);
    popups.closeDrawer();
    editor.resetEditor();
    setStage('library');
  }, [editor.resetEditor, popups.closeDrawer]);
  const finishSave = useCallback(() => {
    editor.resetEditor();
    popups.closeDrawer();
    setStage('library');
  }, [editor.resetEditor, popups.closeDrawer]);

  return (
    <PageLayout
      className="paper-profiles-page"
      width="full"
      header={<PaperProfilePageHeader editor={editor} popups={popups} stage={stage}
        onCreate={openCreate} onBack={returnToLibrary} t={t} />}
    >
      {notice && <div className="pp-sticky-note" role="status"><PaperProfileIcon name="info" />{notice}</div>}
      {stage === 'library' ? (
        <SavedProfilesTable onEdit={openProfile} onCreate={openCreate} persistence={persistence} t={t} />
      ) : (
        <div className="pp-main-layout">
          <ProfileFormPanel editor={editor} persistence={persistence} popups={popups} t={t}
            onNotice={showNotice} onSaved={finishSave} onCancel={returnToLibrary} />
          <PreviewPanel editor={editor} popups={popups} interaction={interaction}
            options={canvasOptions} setOptions={setCanvasOptions} sheetRef={mainSheetRef}
            artwork={importDesign.currentArtwork} t={t} />
        </div>
      )}
      {popups.fullPreviewOpen && (
        <FullPreviewDialog editor={editor} popups={popups} interaction={interaction}
          options={canvasOptions} setOptions={setCanvasOptions}
          artwork={importDesign.currentArtwork} onNotice={showNotice} t={t} />
      )}
      {(popups.drawer === 'fields' || popups.drawer === 'appearance') && (
        <EditorDrawer editor={editor} popups={popups} t={t} />
      )}
      {popups.drawer === 'import' && (
        <ImportDesignDrawer controller={importDesign} popups={popups} t={t} />
      )}
      <DeleteProfileDialog persistence={persistence} t={t} />
      <UnsavedChangesDialog open={discardPromptOpen} profileCode={editor.form.code || t('page.paperProfiles.newProfile')}
        onContinue={() => setDiscardPromptOpen(false)} onDiscard={discardAndReturn} t={t} />
    </PageLayout>
  );
}

export { CanvasToolbar };
