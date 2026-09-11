import { useCallback, useRef, useState } from 'react';
import { errorMessage } from '../../../api/errors.js';
import { useApiAction } from '../../../hooks/useApiAction.js';
import { useApiResource } from '../../../hooks/useApiResource.js';
import { exportJsonFile } from '../../../tauri.js';
import {
  createPaperProfile,
  deletePaperProfile,
  importPaperProfiles,
  listPaperProfiles,
  updatePaperProfile,
} from '../api/paperProfilesApi.js';
import { stringifyProfiles } from '../model/serialization.js';
import { validateDynamicFields, validatePaperForm } from '../model/validation.js';
import type { PaperProfile } from '../model/types.js';
import type { PaperProfileEditor } from './usePaperProfileEditor.js';

export interface PersistenceMessages {
  saveFailed: string;
  deleteFailed: string;
  exportFailed: string;
  importFailed: string;
  importedCount: (count: number) => string;
  validationMessage: (key: string) => string;
}

export function usePaperProfilePersistence(
  editor: PaperProfileEditor,
  messages: PersistenceMessages,
) {
  const fetchProfiles = useCallback(listPaperProfiles, []);
  const profilesResource = useApiResource(fetchProfiles);
  const profiles = profilesResource.data ?? [];
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [pendingDeleteProfile, setPendingDeleteProfile] = useState<PaperProfile | null>(null);
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null);

  const saveAction = useApiAction(async () => {
    const issues = [
      ...validatePaperForm(editor.form),
      ...validateDynamicFields(editor.form, editor.ux.dynamicFields),
    ];
    if (issues.length > 0) throw new Error(issues.map((issue) => messages.validationMessage(issue.messageKey)).join('; '));
    const payload = {
      ...editor.form,
      code: editor.form.code || editor.form.name.toLowerCase().replace(/\s+/g, '_'),
      fields: editor.ux.dynamicFields,
    };
    return editor.state.editingProfileId
      ? updatePaperProfile(editor.state.editingProfileId, payload)
      : createPaperProfile(payload);
  });
  const deleteAction = useApiAction(deletePaperProfile);

  const save = useCallback(async () => {
    if (saveAction.pending) return false;
    editor.saveStarted();
    const profile = await saveAction.run();
    const err = saveAction.getError();
    if (err) {
      editor.saveFailed(errorMessage(err, messages.saveFailed));
      return false;
    }
    editor.saveSucceeded(profile?.id);
    profilesResource.refresh();
    return true;
  }, [editor, messages.saveFailed, profilesResource, saveAction]);

  const requestDelete = useCallback((profile: PaperProfile, returnFocus?: HTMLElement | null) => {
    deleteReturnFocusRef.current = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setPendingDeleteProfile(profile);
  }, []);
  const cancelDelete = useCallback(() => {
    if (deleteAction.pending) return;
    setPendingDeleteProfile(null);
    requestAnimationFrame(() => deleteReturnFocusRef.current?.focus());
  }, [deleteAction.pending]);
  const confirmDelete = useCallback(async () => {
    const profile = pendingDeleteProfile;
    if (!profile || deleteAction.pending) return;
    const result = await deleteAction.run(profile.id);
    const err = deleteAction.getError();
    if (err) {
      setFeedback({ tone: 'error', text: errorMessage(err, messages.deleteFailed) });
      setPendingDeleteProfile(null);
      requestAnimationFrame(() => deleteReturnFocusRef.current?.focus());
      return;
    }
    void result;
    setPendingDeleteProfile(null);
    if (editor.state.editingProfileId === profile.id) editor.resetEditor();
    profilesResource.refresh();
    requestAnimationFrame(() => deleteReturnFocusRef.current?.focus());
  }, [deleteAction, editor, messages.deleteFailed, pendingDeleteProfile, profilesResource]);

  const exportProfiles = useCallback(async (selected: PaperProfile[], fileName: string) => {
    if (selected.length === 0) return;
    const workspacePath = localStorage.getItem('printops-workspace-path') ?? '';
    const result = await exportJsonFile(fileName, stringifyProfiles(selected), workspacePath || undefined);
    if (!result.cancelled && !result.success) {
      setFeedback({ tone: 'error', text: result.message || messages.exportFailed });
    }
  }, [messages.exportFailed]);
  const importJson = useCallback(async (file: File) => {
    try {
      const result = await importPaperProfiles(JSON.parse(await file.text()));
      profilesResource.refresh();
      setFeedback({ tone: 'success', text: messages.importedCount(result.count) });
    } catch (err: unknown) {
      setFeedback({ tone: 'error', text: errorMessage(err, messages.importFailed) });
    }
  }, [messages, profilesResource]);

  return {
    profilesResource,
    profiles,
    feedback,
    dismissFeedback: () => setFeedback(null),
    setFeedback,
    save,
    savePending: saveAction.pending,
    pendingDeleteProfile,
    deletePending: deleteAction.pending,
    requestDelete,
    cancelDelete,
    confirmDelete,
    exportProfile: (profile: PaperProfile) => exportProfiles([profile], `paper-profile-${profile.code}.json`),
    exportAll: () => exportProfiles(profiles, 'paper-profiles-export.json'),
    importJson,
    refresh: profilesResource.refresh,
  };
}

export type PaperProfilePersistence = ReturnType<typeof usePaperProfilePersistence>;
