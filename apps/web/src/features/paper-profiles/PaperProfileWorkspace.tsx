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
import { Button, Inline } from '../../components/ui/index.js';
import { TransferIcon } from '../../components/TransferIcon.js';

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

  // Figma shortcuts. Text inputs keep their own native undo.
  useEffect(() => {
    if (stage !== 'editor') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) editor.undo();
      else if ((key === 'z' && event.shiftKey) || key === 'y') editor.redo();
      else if (key === 'd' && editor.state.selectedFieldId) editor.duplicateField(editor.state.selectedFieldId);
      else if (key === 'c' && editor.state.selectedFieldId) editor.copySelection();
      else if (key === 'v') editor.pasteFields();
      else if (key === 'l' && event.shiftKey && editor.state.selectedFieldId) editor.toggleLock(editor.state.selectedFieldId);
      else if ((key === ']' || key === '[') && editor.state.selectedFieldId) editor.reorderFields(editor.state.selectedFieldId, key === ']' ? 'front' : 'back');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stage, editor.undo, editor.redo, editor.duplicateField, editor.copySelection, editor.pasteFields, editor.toggleLock, editor.reorderFields, editor.state.selectedFieldId]);

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
      title={stage === 'library' ? t('page.paperProfiles.title') : undefined}
      description={stage === 'library' ? t('page.paperProfiles.libraryDescription') : undefined}
      actions={
        stage === 'library' ? (
          <Inline gap="sm">
            <Button
              variant="secondary"
              onClick={() => {
                const input = document.getElementById('pp-import-json-input') as HTMLInputElement | null;
                input?.click();
              }}
            >
              <TransferIcon action="import" /> {t('page.paperProfiles.importJsonProfile')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void persistence.exportAll()}
              disabled={persistence.profiles.length === 0}
            >
              <TransferIcon action="export" /> {t('page.paperProfiles.exportAllProfiles')}
            </Button>
            <Button onClick={openCreate}>
              <PaperProfileIcon name="plus" /> {t('page.paperProfiles.createProfile')}
            </Button>
          </Inline>
        ) : undefined
      }
      header={
        stage === 'editor' ? (
          <PaperProfilePageHeader
            editor={editor}
            popups={popups}
            stage={stage}
            onCreate={openCreate}
            onBack={returnToLibrary}
            t={t}
          />
        ) : undefined
      }
    >
      {notice && <div className="pp-sticky-note" role="status"><PaperProfileIcon name="info" />{notice}</div>}
      {stage === 'library' ? (
        <SavedProfilesTable onEdit={openProfile} onCreate={openCreate} persistence={persistence} t={t} />
      ) : (
        // Two panes, one task: the form and the canvas edit the same profile
        // and both are primary work, so this stays in `children` rather than
        // moving the canvas into PageLayout's `detail` slot.
        // See docs/frontend/LAYOUT_COMPONENT_STANDARD.md.
        <div className="pp-main-layout">
          <ProfileFormPanel editor={editor} persistence={persistence} popups={popups} t={t}
            onNotice={showNotice} onSaved={finishSave} onCancel={returnToLibrary} profiles={persistence.profiles} />
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
