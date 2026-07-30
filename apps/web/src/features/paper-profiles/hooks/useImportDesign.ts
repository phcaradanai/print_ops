import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fileToBase64 } from '../../../api/client.js';
import { ApiError, errorMessage } from '../../../api/errors.js';
import {
  analyzePaperArtwork,
  createPaperProfileFromArtwork,
  getPaperProfileArtwork,
} from '../api/paperProfilesApi.js';
import { DEFAULT_FORM } from '../model/defaults.js';
import {
  buildImportRequestBody,
  generateImportCode,
  inferMimeFromExtension,
  isAcceptedImportExtension,
  isAcceptedImportMime,
  isValidImportFileSize,
} from '../model/importDesign.js';
import type {
  ImportAnalyzeResult,
  ImportFitMode,
  ImportPhase,
  PaperForm,
  PaperProfile,
} from '../model/types.js';
import { validateImportDraft } from '../model/validation.js';

interface ArtworkEntry {
  objectUrl: string;
  fitMode: ImportFitMode;
}

export interface ImportDesignMessages {
  invalidType: string;
  tooLarge: string;
  analyzeFailed: string;
  importFailed: string;
  artworkLoadFailed: string;
}

function toBase64Payload(dataUri: string) {
  const index = dataUri.indexOf(';base64,');
  return index >= 0 ? dataUri.slice(index + 8) : dataUri;
}

function base64ToBlob(base64: string, mimeType: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

export function useImportDesign(
  editingProfileId: string | null,
  messages: ImportDesignMessages,
  onImported: (profile: PaperProfile, duplicate: boolean) => Promise<void> | void,
  onFeedback: (message: string) => void,
) {
  const [phase, setPhase] = useState<ImportPhase>('select');
  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fitMode, setFitMode] = useState<ImportFitMode>('contain');
  const [draft, setDraft] = useState<PaperForm>(DEFAULT_FORM);
  const [artwork, setArtwork] = useState<Record<string, ArtworkEntry | null>>({});
  // Import analysis and persisted-artwork loading are independent request
  // domains. Sharing one generation counter meant closing/resetting the import
  // drawer could invalidate an in-flight artwork load for the profile being
  // edited, leaving that artwork absent without any dependency change to retry.
  const analysisGenerationRef = useRef(0);
  const artworkGenerationRef = useRef(0);
  const submitInFlightRef = useRef(false);
  const objectUrlRef = useRef<string | null>(null);
  const artworkRef = useRef(artwork);
  objectUrlRef.current = objectUrl;
  artworkRef.current = artwork;
  const draftErrors = useMemo(() => validateImportDraft(draft), [draft]);

  const replaceObjectUrl = useCallback((next: string | null) => {
    setObjectUrl((current) => {
      if (current && current !== next) URL.revokeObjectURL(current);
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    analysisGenerationRef.current += 1;
    replaceObjectUrl(null);
    setPhase('select');
    setFile(null);
    setAnalysis(null);
    setError(null);
    setFitMode('contain');
    setDraft(DEFAULT_FORM);
    submitInFlightRef.current = false;
  }, [replaceObjectUrl]);
  const invalidate = useCallback(() => {
    analysisGenerationRef.current += 1;
  }, []);

  const analyze = useCallback(async (selected: File, generation: number) => {
    try {
      const result = await analyzePaperArtwork({
        fileName: selected.name,
        declaredMimeType: inferMimeFromExtension(selected.name) || selected.type || 'image/png',
        dataBase64: toBase64Payload(await fileToBase64(selected)),
      });
      if (generation !== analysisGenerationRef.current) return;
      const basename = selected.name.replace(/\.[^.]+$/, '');
      setAnalysis(result);
      setDraft({
        ...DEFAULT_FORM,
        code: generateImportCode(basename),
        name: basename,
        widthMm: result.suggestedWidthMm,
        heightMm: result.suggestedHeightMm,
        marginTopMm: 0,
        marginRightMm: 0,
        marginBottomMm: 0,
        marginLeftMm: 0,
        dpi: result.suggestedDpi,
        orientation: result.suggestedWidthMm >= result.suggestedHeightMm ? 'landscape' : 'portrait',
      });
      setPhase('review');
    } catch (err: unknown) {
      if (generation !== analysisGenerationRef.current) return;
      replaceObjectUrl(null);
      setError(errorMessage(err, messages.analyzeFailed));
      setPhase('error');
    }
  }, [messages.analyzeFailed, replaceObjectUrl]);

  const selectFile = useCallback((selected: File) => {
    if (!isAcceptedImportExtension(selected.name) || (selected.type && !isAcceptedImportMime(selected.type))) {
      setError(messages.invalidType);
      return;
    }
    if (!isValidImportFileSize(selected.size)) {
      setError(messages.tooLarge);
      return;
    }
    setError(null);
    setFile(selected);
    const url = URL.createObjectURL(selected);
    replaceObjectUrl(url);
    setPhase('analyzing');
    const generation = ++analysisGenerationRef.current;
    void analyze(selected, generation);
  }, [analyze, messages.invalidType, messages.tooLarge, replaceObjectUrl]);

  const submit = useCallback(async () => {
    if (!file || !analysis || draftErrors.length > 0 || submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setPhase('importing');
    setError(null);
    try {
      const result = await createPaperProfileFromArtwork(buildImportRequestBody(
        file.name,
        inferMimeFromExtension(file.name) || file.type || 'image/png',
        toBase64Payload(await fileToBase64(file)),
        draft,
        fitMode,
      ));
      if (result.profile?.id) {
        const cachedUrl = URL.createObjectURL(file);
        setArtwork((current) => {
          const previous = current[result.profile.id];
          if (previous?.objectUrl) URL.revokeObjectURL(previous.objectUrl);
          return { ...current, [result.profile.id]: { objectUrl: cachedUrl, fitMode: result.artwork.fitMode } };
        });
      }
      setPhase('success');
      await onImported(result.profile, result.duplicate);
      reset();
    } catch (err: unknown) {
      setError(errorMessage(err, messages.importFailed));
      setPhase('error');
    } finally {
      submitInFlightRef.current = false;
    }
  }, [analysis, draft, draftErrors.length, file, fitMode, messages.importFailed, onImported, reset]);

  useEffect(() => {
    const generation = ++artworkGenerationRef.current;
    if (!editingProfileId || editingProfileId in artwork) return;
    getPaperProfileArtwork(editingProfileId).then((data) => {
      if (generation !== artworkGenerationRef.current) return;
      const url = URL.createObjectURL(base64ToBlob(data.dataBase64, data.mimeType));
      setArtwork((current) => ({
        ...current,
        [editingProfileId]: { objectUrl: url, fitMode: data.fitMode },
      }));
    }).catch((err: unknown) => {
      if (generation !== artworkGenerationRef.current) return;
      setArtwork((current) => ({ ...current, [editingProfileId]: null }));
      if (!(err instanceof ApiError && err.status === 404)) onFeedback(errorMessage(err, messages.artworkLoadFailed));
    });
  }, [artwork, editingProfileId, messages.artworkLoadFailed, onFeedback]);

  useEffect(() => () => {
    analysisGenerationRef.current += 1;
    artworkGenerationRef.current += 1;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    for (const entry of Object.values(artworkRef.current)) {
      if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    }
  }, []);

  return {
    phase, file, objectUrl, analysis, error, fitMode, draft, draftErrors,
    setFitMode, setDraft, selectFile, submit, reset, invalidate,
    currentArtwork: editingProfileId ? artwork[editingProfileId] ?? undefined : undefined,
  };
}

export type ImportDesignController = ReturnType<typeof useImportDesign>;
