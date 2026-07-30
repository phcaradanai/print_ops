import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { fileToBase64 } from '../../api/client.js';
import { ApiError, errorMessage } from '../../api/errors.js';
import { useApiResource } from '../../hooks/useApiResource.js';
import { Alert } from '../../components/Alert.js';
import { EmptyState, ErrorBanner, ErrorState, LoadingState } from '../../components/PageState.js';
import { useLocale } from '../../i18n/index.js';
import { exportJsonFile } from '../../tauri.js';
import { renderBarcodeSvg } from '../../lib/barcode.js';
import {
  analyzePaperArtwork,
  createPaperProfile,
  createPaperProfileFromArtwork,
  deletePaperProfile,
  getPaperProfileArtwork,
  importPaperProfiles,
  listPaperProfiles,
  updatePaperProfile,
} from './api/paperProfilesApi.js';
import { stringifyProfiles } from './model/serialization.js';

import {
  DEFAULT_BARCODE_HEIGHT_MM,
  DEFAULT_FORM,
  DEFAULT_QR_SIZE_MM,
  DEFAULT_UX,
  DISPLAY_UNITS,
  DPI_OPTIONS,
  FONT_LIST,
  PAPER_PRESETS,
} from './model/defaults.js';
import {
  CANVAS_SCALE_MAX,
  CANVAS_SCALE_MIN,
  clampFontSize,
  clampGridSpacing,
  clampPreviewZoom,
  getVisualPaperGeometry,
  mapPrintablePointToVisual,
  mapVisualPointToPrintable,
  nudgePrintablePoint,
  stepPreviewZoom,
} from './model/geometry.js';
import {
  anchorTransform,
  anchorTransformOrigin,
  centerFieldAnchorHorizontal,
  centerFieldAnchorVertical,
  resolveSelectionAfterDelete,
} from './model/fieldGeometry.js';
import {
  ACCEPTED_IMPORT_MIME_TYPES,
  MAX_IMPORT_FILE_BYTES,
  buildImportRequestBody,
  generateImportCode,
  importFitModeToCss,
  inferMimeFromExtension,
  isAcceptedImportExtension,
  isAcceptedImportMime,
  isLowImportDpi,
  isValidImportFileSize,
  nextImportPhase,
} from './model/importDesign.js';
import { validateImportDraft, validatePaperForm } from './model/validation.js';
import { displayValue as displayVal, toMillimeters as toMm, toPixels as toPx } from './model/units.js';
import { nextSaveStatus } from './state/editorReducer.js';
import { getFieldInspectorState } from './state/selectors.js';
import type {
  ArtworkData,
  DynamicField,
  DynamicFieldBarcodeSymbology,
  DynamicFieldType,
  ImportAnalyzeResult,
  ImportFitMode,
  ImportFitModeLabel,
  ImportPhase,
  ImportRequestBody,
  ImportResult,
  PaperForm,
  PaperOrientation,
  PaperProfile,
  PaperProfileUx as UxOptions,
  SaveStatus,
  VisualPaperGeometry,
} from './model/types.js';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

import { ColorInput, IconButton, Section, s } from './components/editorPrimitives.js';
import {
  FieldBarcodePreview,
  FieldTypeControls,
  PaperCanvas,
  RulerSheet,
} from './components/PaperCanvas.js';
export default function PaperProfiles() {
  const { t } = useLocale();
  /** One-line result strip for import/export, replacing four native alert()s. */
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [form, setForm] = useState<PaperForm>(DEFAULT_FORM);
  const [ux, setUx] = useState<UxOptions>(DEFAULT_UX);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const presetsTriggerRef = useRef<HTMLButtonElement>(null);
  const presetsContainerRef = useRef<HTMLDivElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const [showVerticalGrid, setShowVerticalGrid] = useState(false);
  const [showHorizontalGrid, setShowHorizontalGrid] = useState(false);
  const [showRulers, setShowRulers] = useState(false);
  const [showAlignmentGuides, setShowAlignmentGuides] = useState(false);
  const [showDimensions, setShowDimensions] = useState(true);
  const [gridSpacingMm, setGridSpacingMm] = useState(10); // 1–100 mm, default 10
  const [previewZoom, setPreviewZoom] = useState(1);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [showDrawer, setShowDrawer] = useState<'fields' | 'appearance' | 'import' | null>(null);
  const [stickyNote, setStickyNote] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const previewSheetRef = useRef<HTMLDivElement>(null);
  const mainPreviewSheetRef = useRef<HTMLDivElement>(null);
  const activeDragSheetRef = useRef<HTMLDivElement | null>(null);
  const activeDragScaleRef = useRef(1);
  const dragOffsetRef = useRef({ xMm: 0, yMm: 0 });
  const previewCanvasRef = useRef<HTMLDivElement>(null);
  const modalStageRef = useRef<HTMLDivElement>(null);
  const modalPanelRef = useRef<HTMLDivElement>(null);
  const modalCloseButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [modalStageSize, setModalStageSize] = useState({ width: 0, height: 0 });
  const saveInFlightRef = useRef(false);
  const [pendingDeleteProfile, setPendingDeleteProfile] = useState<PaperProfile | null>(null);

  // ── Import Design state ────────────────────────────────────────────
  const [importPhase, setImportPhase] = useState<ImportPhase>('select');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importObjectUrl, setImportObjectUrl] = useState<string | null>(null);
  const [importAnalyzeResult, setImportAnalyzeResult] = useState<ImportAnalyzeResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importFitMode, setImportFitMode] = useState<ImportFitMode>('contain');
  const [importedArtworkMap, setImportedArtworkMap] = useState<Record<string, { objectUrl: string; fitMode: ImportFitMode } | null>>({});
  const [importDraft, setImportDraft] = useState<PaperForm>(DEFAULT_FORM);
  const importDraftErrors = useMemo(() => validateImportDraft(importDraft), [importDraft]);
  const importInFlightRef = useRef(false);
  const importRequestGenerationRef = useRef(0);
  const importObjectUrlRef = useRef<string | null>(null);
  const importedArtworkMapRef = useRef(importedArtworkMap);

  useEffect(() => {
    importObjectUrlRef.current = importObjectUrl;
  }, [importObjectUrl]);

  useEffect(() => {
    importedArtworkMapRef.current = importedArtworkMap;
  }, [importedArtworkMap]);

  // Revoke object URLs on cleanup
  useEffect(() => {
    return () => {
      if (importObjectUrlRef.current) URL.revokeObjectURL(importObjectUrlRef.current);
      for (const entry of Object.values(importedArtworkMapRef.current)) {
        if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
      }
    };
  }, []);

  // ── Drawer focus management ────────────────────────────────────────
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerPrevFocusRef = useRef<HTMLElement | null>(null);
  const drawerCloseButtonRef = useRef<HTMLButtonElement>(null);

  // ── Section tracking (for sticky index & collapse/expand all) ──────
  type SectionKey = 'basicInfo' | 'dimensions' | 'margins' | 'fields';
  const [sectionsOpen, setSectionsOpen] = useState<Record<SectionKey, boolean>>({
    basicInfo: true, dimensions: true, margins: false, fields: true,
  });
  const basicInfoRef = useRef<HTMLDivElement>(null);
  const dimensionsRef = useRef<HTMLDivElement>(null);
  const marginsRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const sectionRefs: Record<SectionKey, React.RefObject<HTMLDivElement>> = {
    basicInfo: basicInfoRef, dimensions: dimensionsRef, margins: marginsRef, fields: fieldsRef,
  };
  function toggleSection(key: SectionKey) {
    setSectionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  function scrollToSection(key: SectionKey) {
    sectionRefs[key].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!sectionsOpen[key]) toggleSection(key);
  }
  function expandAll() {
    setSectionsOpen({ basicInfo: true, dimensions: true, margins: true, fields: true });
  }
  function collapseAll() {
    setSectionsOpen({ basicInfo: false, dimensions: false, margins: false, fields: false });
  }
  const allExpanded = Object.values(sectionsOpen).every(Boolean);

  const du = ux.displayUnit;
  const dpi = form.dpi;

  // ── Field helpers ──────────────────────────────────────────────────
  function patch<K extends keyof PaperForm>(key: K, val: PaperForm[K]) {
    setForm((f) => ({ ...f, [key]: val }));
    setSaveStatus((s) => nextSaveStatus(s, 'dirty'));
    setSaveError(null);
  }
  function uxPatch<K extends keyof UxOptions>(key: K, val: UxOptions[K]) {
    setUx((u) => ({ ...u, [key]: val }));
  }
  function numeric(key: keyof PaperForm, raw: string) {
    const v = parseFloat(raw);
    if (!isNaN(v)) patch(key, v);
  }
  function convertDim(valMm: number): string {
    return String(displayVal(valMm, du, dpi));
  }
  // Holds what the user is actively typing, keyed by form field. Without this,
  // the input's value snaps to the .toFixed(1)-formatted mm value on every
  // keystroke (convertDim re-runs each render), so typing "10.5" reformats to
  // "10.0" after the "." and the "5" can never land — decimals were
  // unreachable. The raw buffer wins over the formatted value while present;
  // it's cleared on blur so the field reformats once editing is done.
  const [dimRawInputs, setDimRawInputs] = useState<Partial<Record<keyof PaperForm, string>>>({});
  useEffect(() => { setDimRawInputs({}); }, [du]);
  function dimInput(key: keyof PaperForm, labelKey: string) {
    const mmVal = form[key] as number;
    const raw = dimRawInputs[key];
    return (
      <div>
        <label className="pp-label">{t(labelKey) + ' (' + du + ')'}</label>
        <input type="number" value={raw !== undefined ? raw : convertDim(mmVal)}
          onChange={(e) => {
            const text = e.target.value;
            setDimRawInputs((cur) => ({ ...cur, [key]: text }));
            const v = parseFloat(text);
            if (!isNaN(v)) patch(key, toMm(v, du, dpi));
          }}
          onBlur={() => {
            setDimRawInputs((cur) => {
              if (!(key in cur)) return cur;
              const next = { ...cur };
              delete next[key];
              return next;
            });
          }}
          className="pp-input" step="any" />
      </div>
    );
  }

  // ── Dynamic fields ─────────────────────────────────────────────────
  function addField() {
    const f: DynamicField = {
      id: uid(), key: '', label: '', defaultValue: '',
      type: 'text', xMm: 5, yMm: 5,
      fontSize: ux.fontSize, bold: ux.fontWeight === 'bold', color: ux.fontColor, align: 'left',
    };
    setUx((current) => ({
      ...current,
      dynamicFields: [...current.dynamicFields, f],
    }));
    setSelectedFieldId(f.id);
    setStickyNote(t('page.paperProfiles.addedFieldNote'));
    setTimeout(() => setStickyNote(null), 2500);
  }
  function updField(id: string, patchFields: Partial<DynamicField>) {
    setUx((current) => ({
      ...current,
      dynamicFields: current.dynamicFields.map((f) => (f.id === id ? { ...f, ...patchFields } : f)),
    }));
    setSaveStatus((status) => nextSaveStatus(status, 'dirty'));
    setSaveError(null);
  }
  function delField(id: string) {
    setUx((current) => {
      const nextDynamicFields = current.dynamicFields.filter((f) => f.id !== id);
      return { ...current, dynamicFields: nextDynamicFields };
    });
    // Resolve selection outside setUx updater to avoid StrictMode double-fire
    setSelectedFieldId((prev) => resolveSelectionAfterDelete(ux.dynamicFields, id, prev));
  }

  // ── Center helpers ────────────────────────────────────────────────
  function centerFieldHorizontal(id: string) {
    const geometry = getVisualPaperGeometry(form);
    setUx((current) => ({
      ...current,
      dynamicFields: current.dynamicFields.map((f) => {
        if (f.id !== id) return f;
        return { ...f, ...centerFieldAnchorHorizontal(f, geometry) };
      }),
    }));
    setStickyNote(t('page.paperProfiles.centerHorizontally'));
    setTimeout(() => setStickyNote(null), 2500);
  }

  function centerFieldVertical(id: string) {
    const geometry = getVisualPaperGeometry(form);
    setUx((current) => ({
      ...current,
      dynamicFields: current.dynamicFields.map((f) => {
        if (f.id !== id) return f;
        return { ...f, ...centerFieldAnchorVertical(f, geometry) };
      }),
    }));
    setStickyNote(t('page.paperProfiles.centerVertically'));
    setTimeout(() => setStickyNote(null), 2500);
  }

  function nudgeField(id: string, deltaVisualXmm: number, deltaVisualYmm: number) {
    const geometry = getVisualPaperGeometry(form);
    setUx((current) => ({
      ...current,
      dynamicFields: current.dynamicFields.map((field) => {
        if (field.id !== id) return field;
        const printablePoint = nudgePrintablePoint(
          field.xMm,
          field.yMm,
          deltaVisualXmm,
          deltaVisualYmm,
          geometry,
        );
        return {
          ...field,
          ...printablePoint,
        };
      }),
    }));
  }

  // ── API ────────────────────────────────────────────────────────────
  // Was `.then(setProfiles).catch(() => {})`, which rendered a failed request as
  // "no paper profiles" — an operator reading that recreates profiles that
  // already exist. The shared resource keeps the previous list on screen through
  // a refresh failure and states the reason (FE-02A D-5).
  const fetchProfiles = useCallback(listPaperProfiles, []);
  const profilesResource = useApiResource(fetchProfiles);
  const profiles = profilesResource.data ?? [];
  const load = profilesResource.refresh;

  async function save() {
    // Prevent duplicate submission
    if (saveStatus === 'saving' || saveInFlightRef.current) return;

    const errors = validatePaperForm(form);
    if (errors.length > 0) {
      setSaveError(errors.map((e) => t(e.messageKey)).join('; '));
      setSaveStatus('error');
      return;
    }

    saveInFlightRef.current = true;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      const body = {
        ...form,
        code: form.code || form.name.toLowerCase().replace(/\s+/g, '_'),
        fields: ux.dynamicFields,
      };
      if (editingId) {
        await updatePaperProfile(editingId, body);
      } else {
        await createPaperProfile(body);
      }
      setSaveStatus('saved');
      setEditingId(null);
      setForm(DEFAULT_FORM);
      load();
    } catch (err: unknown) {
      setSaveStatus('error');
      // A 409 "code already exists" is actionable; the old constant was not.
      setSaveError(errorMessage(err, t('page.paperProfiles.saveFailed')));
    } finally {
      saveInFlightRef.current = false;
    }
  }

  function dismissSaveError() {
    setSaveError(null);
    setSaveStatus('idle');
  }

  const jsonInputRef = useRef<HTMLInputElement>(null);

  /** Closes the preset menu and returns focus to the control that opened it. */
  const closePresets = useCallback(() => {
    setPresetsOpen(false);
    presetsTriggerRef.current?.focus();
  }, []);

  // Escape and outside-click. Previously only a second click on the trigger
  // closed the menu, so it could sit open over a drawer or after the panel
  // scrolled away from it (Phase 7).
  useEffect(() => {
    if (!presetsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closePresets();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const container = presetsContainerRef.current;
      if (container && event.target instanceof Node && !container.contains(event.target)) {
        // No focus return here: the operator is already elsewhere on the page.
        setPresetsOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [presetsOpen, closePresets]);

  // Only one popup layer at a time: opening a drawer or the full preview closes
  // the menu rather than leaving it floating above the backdrop.
  useEffect(() => {
    if (showDrawer !== null || previewOpen) setPresetsOpen(false);
  }, [showDrawer, previewOpen]);

  async function deleteProfile(profile: PaperProfile) {
    setPendingDeleteProfile(profile);
  }

  async function confirmDeleteProfile() {
    const profile = pendingDeleteProfile;
    if (!profile) return;
    setPendingDeleteProfile(null);

    try {
      await deletePaperProfile(profile.id);
      if (editingId === profile.id) {
        setEditingId(null);
        setForm(DEFAULT_FORM);
        setUx(DEFAULT_UX);
        setSelectedFieldId(null);
      }
      load();
    } catch (err: unknown) {
      setSaveError(errorMessage(err, t('page.paperProfiles.deleteFailed')));
      setSaveStatus('error');
    }
  }

  async function exportProfileJson(profile: PaperProfile) {
    const jsonStr = stringifyProfiles([profile]);
    const workspacePath = localStorage.getItem('printops-workspace-path') ?? '';
    const res = await exportJsonFile(`paper-profile-${profile.code}.json`, jsonStr, workspacePath || undefined);
    // Cancelling the native save dialog is not a failure.
    if (res.cancelled) return;
    if (!res.success) setFeedback({ tone: 'error', text: res.message || t('page.paperProfiles.exportFailed') });
  }

  async function exportAllProfilesJson() {
    if (profiles.length === 0) return;
    const jsonStr = stringifyProfiles(profiles);
    const workspacePath = localStorage.getItem('printops-workspace-path') ?? '';
    const res = await exportJsonFile('paper-profiles-export.json', jsonStr, workspacePath || undefined);
    // A user pressing Cancel in the save dialog is not an error.
    if (res.cancelled) return;
    if (!res.success) setFeedback({ tone: 'error', text: res.message || t('page.paperProfiles.exportFailed') });
  }

  async function importProfilesJsonFile(file: File) {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await importPaperProfiles(json);
      load();
      setFeedback({ tone: 'success', text: t('page.paperProfiles.importedCount').replace('{n}', String(res.count)) });
    } catch (err: unknown) {
      // The server's own reason, not a constant: "code already exists" and
      // "malformed JSON" need different actions from the operator.
      setFeedback({ tone: 'error', text: errorMessage(err, t('page.paperProfiles.importJsonFailed')) });
    }
  }

  // ── Import Design handlers ──────────────────────────────────────
  function openImportDrawer() {
    importRequestGenerationRef.current += 1;
    setImportPhase('select');
    setImportFile(null);
    setImportObjectUrl(null);
    setImportAnalyzeResult(null);
    setImportError(null);
    setImportFitMode('contain');
    setImportDraft(DEFAULT_FORM);
    // Show import drawer — reuse the drawer pattern
    setShowDrawer('import');
  }

  function resetImport() {
    importRequestGenerationRef.current += 1;
    if (importObjectUrl) { URL.revokeObjectURL(importObjectUrl); setImportObjectUrl(null); }
    setImportPhase('select');
    setImportFile(null);
    setImportAnalyzeResult(null);
    setImportError(null);
    setImportDraft(DEFAULT_FORM);
    importInFlightRef.current = false;
  }

  function handleImportFileSelected(file: File) {
    // Client-side validation — require valid extension
    if (!isAcceptedImportExtension(file.name)) {
      setImportError(t('page.paperProfiles.importInvalidFileType'));
      return;
    }
    // When browser provides a non-empty MIME, it must also be valid
    if (file.type && !isAcceptedImportMime(file.type)) {
      setImportError(t('page.paperProfiles.importInvalidFileType'));
      return;
    }
    if (!isValidImportFileSize(file.size)) {
      setImportError(t('page.paperProfiles.importFileTooLarge'));
      return;
    }
    setImportError(null);
    setImportFile(file);
    // Create object URL for thumbnail
    const objectUrl = URL.createObjectURL(file);
    // Revoke old
    if (importObjectUrl) URL.revokeObjectURL(importObjectUrl);
    setImportObjectUrl(objectUrl);
    setImportPhase('analyzing');
    // Trigger analysis
    const generation = ++importRequestGenerationRef.current;
    void analyzeFile(file, objectUrl, generation);
  }

  async function analyzeFile(file: File, objectUrl: string, generation: number) {
    try {
      const dataUri = await fileToBase64(file);
      // Extract base64 portion after the data URI prefix
      const base64Idx = dataUri.indexOf(';base64,');
      const dataBase64 = base64Idx >= 0 ? dataUri.slice(base64Idx + 8) : dataUri;
      // Infer declared MIME from extension; browser type may be empty or unreliable
      const declaredMimeType = inferMimeFromExtension(file.name) || file.type || 'image/png';
      const result = await analyzePaperArtwork({
        fileName: file.name,
        declaredMimeType,
        dataBase64,
      });
      if (generation !== importRequestGenerationRef.current) return;
      setImportAnalyzeResult(result);
      // Seed editable draft
      const basename = file.name.replace(/\.[^.]+$/, '');
      setImportDraft({
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
        unit: 'mm',
      });
      setImportPhase('review');
    } catch (_err) {
      if (generation !== importRequestGenerationRef.current) return;
      URL.revokeObjectURL(objectUrl);
      setImportObjectUrl(null);
      setImportError(t('page.paperProfiles.importError'));
      setImportPhase('error');
    }
  }

  async function submitImport() {
    if (!importFile || !importAnalyzeResult || importInFlightRef.current) return;
    const errors = validateImportDraft(importDraft);
    if (errors.length > 0) return;
    importInFlightRef.current = true;
    setImportPhase('importing');
    setImportError(null);
    try {
      const dataUri = await fileToBase64(importFile);
      const base64Idx = dataUri.indexOf(';base64,');
      const dataBase64 = base64Idx >= 0 ? dataUri.slice(base64Idx + 8) : dataUri;
      const declaredMimeType = inferMimeFromExtension(importFile.name) || importFile.type || 'image/png';
      const body = buildImportRequestBody(
        importFile.name,
        declaredMimeType,
        dataBase64,
        {
          code: importDraft.code,
          name: importDraft.name,
          widthMm: importDraft.widthMm,
          heightMm: importDraft.heightMm,
          marginTopMm: importDraft.marginTopMm,
          marginRightMm: importDraft.marginRightMm,
          marginBottomMm: importDraft.marginBottomMm,
          marginLeftMm: importDraft.marginLeftMm,
          dpi: importDraft.dpi,
          orientation: importDraft.orientation,
          unit: importDraft.unit,
        },
        importFitMode,
      );
      const result = await createPaperProfileFromArtwork(body);
      // Cache a separate URL; resetImport owns and revokes the thumbnail URL.
      if (result.profile?.id) {
        const cachedArtworkUrl = URL.createObjectURL(importFile);
        setImportedArtworkMap((prev) => {
          const previousArtwork = prev[result.profile.id];
          if (previousArtwork?.objectUrl) URL.revokeObjectURL(previousArtwork.objectUrl);
          return {
            ...prev,
            [result.profile.id]: { objectUrl: cachedArtworkUrl, fitMode: result.artwork.fitMode },
          };
        });
      }
      setImportPhase('success');
      // Reload profiles and select the returned profile
      await load();
      const msg = result.duplicate
        ? t('page.paperProfiles.importDuplicate')
        : t('page.paperProfiles.importSuccess');
      setStickyNote(msg);
      setTimeout(() => setStickyNote(null), 4000);
      // Close drawer and start editing the imported profile — no races
      setShowDrawer(null);
      resetImport();
      startEdit(result.profile);
    } catch (_err) {
      setImportError(t('page.paperProfiles.importError'));
      setImportPhase('error');
    } finally {
      importInFlightRef.current = false;
    }
  }

  // Fetch artwork for a profile when editing
  useEffect(() => {
    if (!editingId) return;
    if (editingId in importedArtworkMap) return;
    let cancelled = false;
    getPaperProfileArtwork(editingId)
      .then((data) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(
          base64ToBlob(data.dataBase64, data.mimeType)
        );
        setImportedArtworkMap((prev) => ({
          ...prev,
          [editingId]: { objectUrl, fitMode: data.fitMode },
        }));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 404 is a fact about the profile: it has no reference artwork. Any other
        // failure is a transport problem, and silently drawing the canvas without
        // the imported artwork would look like the import was lost (D-9).
        setImportedArtworkMap((prev) => ({ ...prev, [editingId]: null }));
        if (!(err instanceof ApiError && err.status === 404)) {
          setFeedback({ tone: 'error', text: errorMessage(err, t('page.paperProfiles.artworkLoadFailed')) });
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  function base64ToBlob(base64: string, mimeType: string): Blob {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  }

  function encodingURIComponent(s: string): string {
    return encodeURIComponent(s);
  }

  function startEdit(p: PaperProfile) {
    setForm({
      code: p.code, name: p.name,
      widthMm: p.widthMm, heightMm: p.heightMm,
      marginTopMm: p.marginTopMm, marginRightMm: p.marginRightMm,
      marginBottomMm: p.marginBottomMm, marginLeftMm: p.marginLeftMm,
      dpi: p.dpi, orientation: p.orientation, unit: p.unit,
    });
    setUx((u) => ({ ...u, dynamicFields: p.fields ?? [] }));
    setSelectedFieldId(null);
    setEditingId(p.id);
    setSaveStatus('idle');
    setSaveError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function applyPreset(p: typeof PAPER_PRESETS[number]) {
    setForm((f) => ({ ...f, widthMm: p.widthMm, heightMm: p.heightMm, dpi: p.dpi }));
    setSaveStatus((s) => nextSaveStatus(s, 'dirty'));
    setSaveError(null);
    setPresetsOpen(false);
  }

  // ── Preview calc ───────────────────────────────────────────────────
  // Desktop-first working scale: a 100 × 50 mm label renders at 500 × 250 px,
  // large enough to inspect and manipulate without opening the expanded view.
  const maxPvSize = 560;
  const visualGeometry = getVisualPaperGeometry(form);
  const previewWidthMm = visualGeometry.widthMm;
  const previewHeightMm = visualGeometry.heightMm;
  const scale = Math.min(maxPvSize / previewWidthMm, maxPvSize / previewHeightMm, 5);

  // Artwork for the currently editing profile
  const currentArtworkUrl: string | undefined = editingId ? importedArtworkMap[editingId]?.objectUrl : undefined;
  const currentArtworkFitMode: ImportFitMode | undefined = editingId ? importedArtworkMap[editingId]?.fitMode : undefined;

  useEffect(() => {
    if (!previewOpen) return;
    const previousOverflow = document.body.style.overflow;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewOpen(false);
      if (event.key === 'Tab' && modalPanelRef.current) {
        const focusable = Array.from(modalPanelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        )).filter((element) => element.offsetParent !== null);
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setPreviewZoom((value) => stepPreviewZoom(value, 1));
      } else if (event.key === '-') {
        event.preventDefault();
        setPreviewZoom((value) => stepPreviewZoom(value, -1));
      } else if (event.key === '0') {
        event.preventDefault();
        setPreviewZoom(1);
      }
    };
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    const focusFrame = window.requestAnimationFrame(() => modalCloseButtonRef.current?.focus());
    onResize();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      window.cancelAnimationFrame(focusFrame);
      previousFocusRef.current?.focus();
    };
  }, [previewOpen]);

  useEffect(() => {
    if (!previewOpen || !modalStageRef.current) return;
    const el = modalStageRef.current;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setModalStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [previewOpen]);

  const fitModalScale = useMemo(() => {
    const { width: stageW, height: stageH } = modalStageSize;
    if (stageW === 0 || stageH === 0) {
      return Math.max(0.35, Math.min(
        20,
        ((viewport.width <= 820 ? viewport.width * 0.92 : viewport.width * 0.62) - 80) / previewWidthMm,
        (viewport.height - (viewport.width <= 820 ? 420 : 190)) / previewHeightMm,
      ));
    }
    const margin = 24; // small breathing room so the sheet doesn't touch the edges
    const availableW = Math.max(1, stageW - margin * 2);
    const availableH = Math.max(1, stageH - margin * 2);
    const scale = Math.min(availableW / previewWidthMm, availableH / previewHeightMm);
    return Math.max(0.5, Math.min(20, scale));
  }, [modalStageSize, previewWidthMm, previewHeightMm, viewport.width, viewport.height]);

  const modalScale = Math.max(0.25, Math.min(20, fitModalScale * previewZoom));
  const fieldInspectorState = getFieldInspectorState(
    ux.dynamicFields.length,
    ux.dynamicFields.some((field) => field.id === selectedFieldId),
  );

  useEffect(() => {
    if (!draggingFieldId) return;
    const onPointerMove = (event: PointerEvent) => {
      const sheet = activeDragSheetRef.current;
      if (!sheet) return;
      const rect = sheet.getBoundingClientRect();
      const geometry = getVisualPaperGeometry(form);
      const printableWidth = Math.max(0, form.widthMm - form.marginLeftMm - form.marginRightMm);
      const printableHeight = Math.max(0, form.heightMm - form.marginTopMm - form.marginBottomMm);
      const dragScale = activeDragScaleRef.current;
      const pointerX = (event.clientX - rect.left) / dragScale - geometry.marginLeftMm;
      const pointerY = (event.clientY - rect.top) / dragScale - geometry.marginTopMm;
      const visualX = Math.max(0, Math.min(geometry.printableWidthMm, pointerX - dragOffsetRef.current.xMm));
      const visualY = Math.max(0, Math.min(geometry.printableHeightMm, pointerY - dragOffsetRef.current.yMm));
      const originalPoint = mapVisualPointToPrintable(visualX, visualY, geometry);
      let xMm = Math.min(printableWidth, Math.max(0, originalPoint.xMm));
      let yMm = Math.min(printableHeight, Math.max(0, originalPoint.yMm));

      // Snap to nearby field Y (baseline) and X (column) within 2mm tolerance
      const snapThreshold = 2;
      const otherFields = ux.dynamicFields.filter((f) => f.id !== draggingFieldId);
      for (const o of otherFields) {
        if (Math.abs(o.yMm - yMm) < snapThreshold) yMm = o.yMm;
        if (Math.abs(o.xMm - xMm) < snapThreshold) xMm = o.xMm;
      }

      setUx((current) => ({
        ...current,
        dynamicFields: current.dynamicFields.map((field) => (
          field.id === draggingFieldId
            ? { ...field, xMm: Number(xMm.toFixed(1)), yMm: Number(yMm.toFixed(1)) }
            : field
        )),
      }));
    };
    const onPointerUp = () => setDraggingFieldId(null);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
    };
  }, [draggingFieldId, form.heightMm, form.marginBottomMm, form.marginLeftMm, form.marginRightMm, form.marginTopMm, form.widthMm, modalScale, ux.dynamicFields]);

  function startDraggingField(event: React.PointerEvent<HTMLButtonElement>, id: string, sheet: HTMLDivElement | null = previewSheetRef.current, dragScale = modalScale) {
    event.currentTarget.focus();
    event.preventDefault();
    const field = ux.dynamicFields.find((candidate) => candidate.id === id);
    if (sheet && field) {
      const geometry = getVisualPaperGeometry(form);
      const rect = sheet.getBoundingClientRect();
      const point = mapPrintablePointToVisual(field.xMm, field.yMm, geometry);
      const pointerX = (event.clientX - rect.left) / dragScale - geometry.marginLeftMm;
      const pointerY = (event.clientY - rect.top) / dragScale - geometry.marginTopMm;
      dragOffsetRef.current = { xMm: pointerX - point.xMm, yMm: pointerY - point.yMm };
    }
    activeDragSheetRef.current = sheet;
    activeDragScaleRef.current = dragScale;
    setSelectedFieldId(id);
    setDraggingFieldId(id);
  }

  // ── Drawer focus trap, escape, and restoration ──────────────────────
  const closeDrawer = useCallback(() => {
    if (showDrawer === 'import') importRequestGenerationRef.current += 1;
    setShowDrawer(null);
  }, [showDrawer]);
  useEffect(() => {
    if (!showDrawer) {
      // Restore focus when drawer closes
      if (drawerPrevFocusRef.current) {
        const el = drawerPrevFocusRef.current;
        if (el.tabIndex === undefined || el.tabIndex > -2) {
          el.focus();
        }
        drawerPrevFocusRef.current = null;
      }
      return;
    }
    // Save current focus and move into drawer
    drawerPrevFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      if (drawerCloseButtonRef.current) {
        drawerCloseButtonRef.current.focus();
      } else {
        drawerRef.current?.focus();
      }
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowDrawer(null);
        return;
      }
      if (e.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.cancelAnimationFrame(frame);
    };
  }, [showDrawer, closeDrawer]);

  return (
    <div className="paper-profiles-page" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* ─── Sticky Note ─── */}
      {stickyNote && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 'var(--pp-z-note)' as unknown as number,
          padding: '0.55rem 0.85rem', borderRadius: 8,
          background: '#f9e2af', color: '#374151',
          fontSize: '0.85rem', fontWeight: 500,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          animation: 'ppStickyNoteIn 0.25s ease',
        }}>
          <span>💡</span> {stickyNote}
        </div>
      )}

      {/* ─── Top bar ─── */}
      <header className="pp-page-header">
        <div className="pp-page-heading">
          <span className="pp-page-heading__icon" aria-hidden="true">📄</span>
          <div>
            <h1>{t('page.paperProfiles.title')}</h1>
            <div className="pp-page-heading__meta">
              <span>{form.code || 'auto'}</span>
              <span>{displayVal(form.widthMm, du, dpi)} × {displayVal(form.heightMm, du, dpi)} {du}</span>
            </div>
          </div>
        </div>
        <div className="pp-toolbar" role="toolbar" aria-label={t('page.paperProfiles.pageActions')}>
          <IconButton icon="⛶" label={t('page.paperProfiles.fullPreview')} onClick={() => setPreviewOpen(true)} active />
          <IconButton icon="⚡" label={t('page.paperProfiles.toggleFields')} onClick={() => setShowDrawer(showDrawer === 'fields' ? null : 'fields')} active={showDrawer === 'fields'} />
          <IconButton icon="🎨" label={t('page.paperProfiles.toggleStyle')} onClick={() => setShowDrawer(showDrawer === 'appearance' ? null : 'appearance')} active={showDrawer === 'appearance'} />
          <IconButton icon="📥" label={t('page.paperProfiles.importDesign')} onClick={openImportDrawer} active={showDrawer === 'import'} />

        </div>
      </header>

      {/* ─── Main layout ─── */}
      <div className="pp-main-layout" style={{ flex: 1, display: 'flex', gap: '0.75rem', minHeight: 0, position: 'relative' }}>
        {/* ===== LEFT: Form ===== */}
        <div className="pp-form-panel" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {/* ── Unified toolbar ── */}
          <div className="pp-command-bar">
            <nav className="pp-index" role="navigation" aria-label={t('page.paperProfiles.sectionIndex')}>
              {(['basicInfo', 'dimensions', 'margins', 'fields'] as SectionKey[]).map((key) => (
                <button
                  type="button"
                  key={key}
                  className="pp-index-btn"
                  onClick={() => scrollToSection(key)}
                  title={t('page.paperProfiles.' + key)}
                  aria-label={t('page.paperProfiles.' + key)}
                >
                  <span aria-hidden="true">{key === 'basicInfo' ? '📄' : key === 'dimensions' ? '📐' : key === 'margins' ? '⬜' : '⚡'}</span>
                </button>
              ))}
            </nav>
            <div className="pp-command-actions">
              <div className="pp-command-status" aria-live="polite">
                  <span
                    className="pp-command-status__dot"
                    aria-hidden="true"
                    style={{
                      color: saveStatus === 'dirty' ? 'var(--semantic-warning, #f9e2af)'
                        : saveStatus === 'error' ? 'var(--semantic-error, #f38ba8)'
                        : saveStatus === 'saving' ? 'var(--semantic-progress, #fab387)'
                        : saveStatus === 'saved' ? 'var(--semantic-success, #a6e3a1)'
                        : 'var(--semantic-success, #65a765)',
                    }}
                  >●</span>
                  <span>
                    {saveStatus === 'dirty' ? t('page.paperProfiles.unsavedChanges')
                      : saveStatus === 'saving' ? t('page.paperProfiles.saving')
                      : saveStatus === 'saved' ? t('page.paperProfiles.saved')
                      : saveStatus === 'error' ? (saveError || t('common.error'))
                      : editingId ? t('page.paperProfiles.editingProfile') : t('page.paperProfiles.readyToSave')}
                  </span>
                {saveStatus === 'error' && (
                  <button
                    type="button"
                    onClick={dismissSaveError}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', padding: 0, color: '#6b7280' }}
                    aria-label={t('common.cancel')}
                  >✕</button>
                )}
              </div>
              <div className="pp-presets" ref={presetsContainerRef}>
                <button type="button" className="pp-icon-btn" ref={presetsTriggerRef} onClick={() => setPresetsOpen(!presetsOpen)}
                  title={t('page.paperProfiles.presets')} aria-label={t('page.paperProfiles.presets')} aria-expanded={presetsOpen} aria-haspopup="menu">
                  <span aria-hidden="true">📋</span>
                </button>
                {presetsOpen && (
                  <div className="pp-presets-menu" role="menu">
                    {PAPER_PRESETS.map((p) => (
                      <button type="button" key={p.label} className="pp-preset-option" role="menuitem" onClick={() => { applyPreset(p); closePresets(); }}>
                        <span aria-hidden="true">▸</span>{p.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <IconButton icon={allExpanded ? '▾' : '▸'} label={allExpanded ? t('page.paperProfiles.collapseAll') : t('page.paperProfiles.expandAll')} onClick={allExpanded ? collapseAll : expandAll} />
              <button type="button" className="ds-btn ds-btn--primary" style={{ opacity: saveStatus === 'saving' ? 0.6 : 1 }} onClick={() => void save()}
                disabled={saveStatus === 'saving'}
                title={editingId ? t('page.paperProfiles.updateProfile') : t('page.paperProfiles.saveProfile')}
                aria-label={editingId ? t('page.paperProfiles.updateProfile') : t('page.paperProfiles.saveProfile')}>
                <span aria-hidden="true">{saveStatus === 'saving' ? '⏳' : '💾'}</span>
              </button>
              {editingId && (
                <button type="button" className="pp-icon-btn" onClick={() => { setEditingId(null); setForm(DEFAULT_FORM); setUx(DEFAULT_UX); setSelectedFieldId(null); setSaveStatus('idle'); setSaveError(null); }}
                  title={t('common.cancel')} aria-label={t('common.cancel')}>
                  <span aria-hidden="true">✕</span>
                </button>
              )}
            </div>
          </div>

          <div className="pp-form-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

          <div ref={basicInfoRef} className="pp-section-anchor">
          <Section title={t('page.paperProfiles.basicInfo')} icon="📄" open={sectionsOpen.basicInfo} onToggle={() => toggleSection('basicInfo')}>
            <div className="pp-form-grid pp-form-grid--two">
              <div>
                <label className="pp-label">{t('page.paperProfiles.codeLabel')}</label>
                <input value={form.code} onChange={(e) => patch('code', e.target.value)} placeholder={t('page.paperProfiles.codePlaceholder')} className="pp-input" />
              </div>
              <div>
                <label className="pp-label">{t('page.paperProfiles.nameLabel')} *</label>
                <input value={form.name} onChange={(e) => patch('name', e.target.value)} placeholder={t('page.paperProfiles.namePlaceholder')} className="pp-input" />
              </div>
            </div>
          </Section>
          </div>

          <div ref={dimensionsRef} className="pp-section-anchor">
          <Section title={t('page.paperProfiles.dimensions')} icon="📐" open={sectionsOpen.dimensions} onToggle={() => toggleSection('dimensions')}>
            <div className="pp-form-grid pp-form-grid--three">
              <div>
                <label className="pp-label">{t('page.paperProfiles.displayUnitLabel')}</label>
                <select value={du} onChange={(e) => uxPatch('displayUnit', e.target.value as 'mm' | 'cm' | 'px')} className="pp-select">
                  {DISPLAY_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              {dimInput('widthMm', 'page.paperProfiles.width')}
              {dimInput('heightMm', 'page.paperProfiles.height')}
              <div>
                <label className="pp-label">{t('page.paperProfiles.orientation')}</label>
                <select value={form.orientation} onChange={(e) => {
                  const next = e.target.value as 'portrait' | 'landscape';
                  if (next === form.orientation) return;
                  const natural = form.widthMm > form.heightMm ? 'landscape' : 'portrait';
                  if (next !== natural) {
                    const w = form.widthMm;
                    setForm((f) => ({ ...f, widthMm: f.heightMm, heightMm: w, orientation: next }));
                  } else {
                    patch('orientation', next);
                  }
                }} className="pp-select">
                  <option value="portrait">{t('page.paperProfiles.portrait')}</option>
                  <option value="landscape">{t('page.paperProfiles.landscape')}</option>
                </select>
              </div>
              <div>
                <label className="pp-label">{t('page.paperProfiles.dpi')}</label>
                <select value={form.dpi} onChange={(e) => numeric('dpi', e.target.value)} className="pp-select">
                  {DPI_OPTIONS.map((d) => <option key={d} value={d}>{d} dpi</option>)}
                </select>
              </div>
              <div>
                <label className="pp-label">{t('page.paperProfiles.unitStorageLabel')}</label>
                <select value={form.unit} onChange={(e) => patch('unit', e.target.value as 'mm' | 'inch')} className="pp-select">
                  <option value="mm">mm</option>
                  <option value="inch">inch</option>
                </select>
              </div>
            </div>
          </Section>
          </div>

          <div ref={marginsRef} className="pp-section-anchor">
          <Section title={t('page.paperProfiles.margins')} icon="⬜" defaultOpen={false} open={sectionsOpen.margins} onToggle={() => toggleSection('margins')}>
            <div className="pp-form-grid pp-form-grid--four">
              {dimInput('marginTopMm', 'page.paperProfiles.top')}
              {dimInput('marginRightMm', 'page.paperProfiles.right')}
              {dimInput('marginBottomMm', 'page.paperProfiles.bottom')}
              {dimInput('marginLeftMm', 'page.paperProfiles.left')}
            </div>
          </Section>
          </div>

          {/* ── Dynamic fields (inline in form) ── */}
          <div ref={fieldsRef} className="pp-section-anchor">
          <Section title={t('page.paperProfiles.fieldsCount').replace('{n}', String(ux.dynamicFields.length))} icon='⚡' open={sectionsOpen.fields} onToggle={() => toggleSection('fields')}>
            {ux.dynamicFields.length === 0 && (
              <div className="pp-fields-empty">
                <div className="pp-fields-empty__copy">
                  <span className="pp-fields-empty__icon" aria-hidden="true">⚡</span>
                  <div>
                    <strong>{t('page.paperProfiles.noCustomFields')}</strong>
                    <p>{t('page.paperProfiles.clickAddField')}</p>
                  </div>
                </div>
                <button type="button" className="pp-tool-btn" onClick={addField}
                  title={t('page.paperProfiles.addField')} aria-label={t('page.paperProfiles.addField')}>+</button>
              </div>
            )}
            <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0.25rem 0 0.5rem', fontStyle: 'italic' }}>{t('page.paperProfiles.previewOnlyHint')}</p>
            <div className="pp-field-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {ux.dynamicFields.map((f) => (
                <div
                  key={f.id}
                  id={`paper-field-${f.id}`}
                  className={'pp-field-row' + (selectedFieldId === f.id ? ' is-selected' : '')}
                  onClick={() => setSelectedFieldId(f.id)}
                >
                  {/* Header: type, key, label, delete. Grid tracks, so a long
                      label consumes the flexible column instead of wrapping the
                      delete action onto another line or off the card. */}
                  <div className="pp-field-row__header">
                    <span className="pp-field-type-badge">{f.type === 'qrcode' ? 'QR' : f.type}</span>
                    <input className="pp-input pp-input--sm pp-input--mono pp-field-row__key" aria-label={t('page.paperProfiles.fieldKey')} placeholder={t('page.paperProfiles.fieldKey')} value={f.key} onChange={(e) => updField(f.id, { key: e.target.value })} />
                    <input className="pp-input pp-input--sm pp-field-row__label-input" aria-label={t('page.paperProfiles.fieldLabel')} placeholder={t('page.paperProfiles.fieldLabel')} value={f.label} onChange={(e) => updField(f.id, { label: e.target.value })} />
                    <button type="button" className="pp-field-delete" onClick={(e) => { e.stopPropagation(); delField(f.id); }} title={t('page.paperProfiles.remove')} aria-label={t('page.paperProfiles.remove')}>✕</button>
                  </div>
                  <div className="pp-field-row__group-label">{t('page.paperProfiles.groupContentOutput')}</div>
                  <div className="pp-field-row__content">
                    <input className="pp-input pp-input--sm" aria-label={t('page.paperProfiles.fieldDefault')} placeholder={t('page.paperProfiles.fieldDefault')} value={f.defaultValue} onChange={(e) => updField(f.id, { defaultValue: e.target.value })} />
                    <div className="pp-field-row__type-controls">
                      <FieldTypeControls
                        field={f}
                        onUpdate={(patchFields) => updField(f.id, patchFields)}
                        selectClassName="pp-select pp-select--sm"
                        numberClassName="pp-number pp-input--sm"
                      />
                    </div>
                  </div>
                  <div className="pp-field-row__group-label">{t('page.paperProfiles.groupPositionStyle')}</div>
                  <div className="pp-field-row__position">
                    <div className="pp-field-row__cell">
                      <label htmlFor={`pp-x-${f.id}`}>{t('page.paperProfiles.fieldXmm')}</label>
                      <input id={`pp-x-${f.id}`} className="pp-number pp-input--sm" aria-label={t('page.paperProfiles.fieldXmm')} type="number" step="0.1" value={f.xMm}
                        onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { xMm: v }); }} />
                    </div>
                    <div className="pp-field-row__cell">
                      <label htmlFor={`pp-y-${f.id}`}>{t('page.paperProfiles.fieldYmm')}</label>
                      <input id={`pp-y-${f.id}`} className="pp-number pp-input--sm" aria-label={t('page.paperProfiles.fieldYmm')} type="number" step="0.1" value={f.yMm}
                        onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { yMm: v }); }} />
                    </div>
                    <div className="pp-field-row__cell">
                      <label htmlFor={`pp-size-${f.id}`}>{t('page.paperProfiles.fieldFontSizePt')}</label>
                      <input id={`pp-size-${f.id}`} className="pp-number pp-input--sm" aria-label={t('page.paperProfiles.fieldFontSizePt')} type="number" value={f.fontSize} min={6} max={72}
                        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) updField(f.id, { fontSize: clampFontSize(v) }); }} />
                    </div>
                    <div className="pp-field-row__cell">
                      <label htmlFor={`pp-align-${f.id}`}>{t('page.paperProfiles.align')}</label>
                      <select id={`pp-align-${f.id}`} className="pp-select pp-select--sm" aria-label={t('page.paperProfiles.align')} value={f.align} onChange={(e) => updField(f.id, { align: e.target.value as DynamicField['align'] })}>
                        <option value="left">{t('page.paperProfiles.alignLeft')}</option>
                        <option value="center">{t('page.paperProfiles.alignCenter')}</option>
                        <option value="right">{t('page.paperProfiles.alignRight')}</option>
                      </select>
                    </div>
                    <div className="pp-field-row__cell">
                      <label htmlFor={`pp-color-${f.id}`}>{t('page.paperProfiles.fieldColor')}</label>
                      <input id={`pp-color-${f.id}`} className="pp-color" aria-label={t('page.paperProfiles.fieldColor')} type="color" value={f.color} onChange={(e) => updField(f.id, { color: e.target.value })} />
                    </div>
                    <div className="pp-field-row__cell pp-field-row__cell--tight">
                      <label className="pp-checkbox-label">
                        <input aria-label={t('page.paperProfiles.bold')} type="checkbox" checked={f.bold} onChange={(e) => updField(f.id, { bold: e.target.checked })} /> {t('page.paperProfiles.fieldBoldLabel')}
                      </label>
                    </div>
                  </div>
                  <FieldBarcodePreview field={f} />
                </div>
              ))}
            </div>
            {ux.dynamicFields.length > 0 && (
              <button type="button" className="pp-add-field" style={{ ...s.btnSmall, marginTop: '0.5rem', width: '100%', borderStyle: 'dashed', color: '#1e66f5', borderColor: '#89b4fa' }}
                onClick={addField} title={t('page.paperProfiles.addField')} aria-label={t('page.paperProfiles.addField')}><span aria-hidden="true">+</span></button>
            )}
          </Section>
          </div>

          </div> {/* end scrollable area */}
        </div> {/* end form panel */}

        {/* ===== RIGHT: Preview ===== */}
        <aside className="pp-preview-panel">
            <div className="pp-preview-panel__body" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div className="pp-preview-header">
              <div>
                <span className="pp-preview-header__title">{t('page.paperProfiles.labelCanvas')}</span>
                <span className="pp-preview-header__subtitle">{t('page.paperProfiles.canvasDragHint')}</span>
              </div>
              <div className="pp-preview-header__actions">
                <span className="pp-preview-header__size">
                  {displayVal(form.widthMm, du, dpi)} × {displayVal(form.heightMm, du, dpi)} {du}
                </span>
              </div>
            </div>
            <div className="pp-canvas-toolbar" role="toolbar" aria-label={t('page.paperProfiles.canvasControls')}>
              <IconButton icon="⊞" label={t('page.paperProfiles.toggleGrid')} onClick={() => { const next = !(showVerticalGrid || showHorizontalGrid); setShowVerticalGrid(next); setShowHorizontalGrid(next); }} active={showVerticalGrid || showHorizontalGrid} />
              <IconButton icon="📏" label={t('page.paperProfiles.toggleRulers')} onClick={() => setShowRulers(!showRulers)} active={showRulers} />
              <IconButton icon="↔" label={t('page.paperProfiles.showFieldDimensions')} onClick={() => setShowDimensions(!showDimensions)} active={showDimensions} />
              <button type="button" className="pp-canvas-fit" onClick={() => setPreviewOpen(true)}>{t('page.paperProfiles.expandCanvas')}</button>
            </div>
            <div className="pp-preview-stage">
              <div className="pp-preview-stage__meta">
                <span>{t('page.paperProfiles.previewCanvas')}</span>
                <span>{form.orientation === 'portrait' ? t('page.paperProfiles.portrait') : t('page.paperProfiles.landscape')}</span>
              </div>
              {ux.dynamicFields.length === 0 && <p className="pp-canvas-empty">{t('page.paperProfiles.canvasEmptyHint')}</p>}
              <RulerSheet form={form} scale={scale} showRulers={showRulers} unit={du}>
                <PaperCanvas
                  form={form} ux={ux} scale={scale}
                  sheetRef={mainPreviewSheetRef}
                  selectedFieldId={selectedFieldId}
                  onFieldPointerDown={(event, id) => startDraggingField(event, id, mainPreviewSheetRef.current, scale)}
                  onFieldSelect={(id) => {
                    setSelectedFieldId(id);
                    document.getElementById(`paper-field-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                  }}
                  onFieldNudge={nudgeField}
                  showVerticalGrid={showVerticalGrid}
                  showHorizontalGrid={showHorizontalGrid}
                  showAlignmentGuides={!!selectedFieldId}
                  showDimensions={showDimensions}
                  gridIntervalMm={gridSpacingMm}
                  artworkUrl={currentArtworkUrl}
                  artworkFitMode={currentArtworkFitMode}
                />
              </RulerSheet>
            </div>

            {/* Quick info */}
            <div className="pp-preview-quick-info">
              <span>{t('page.paperProfiles.quickSize')}: {form.widthMm} × {form.heightMm} mm</span>
              <span>{t('page.paperProfiles.quickDpi')}: {form.dpi}</span>
              <span>{t('page.paperProfiles.quickPrintable')}: {(form.widthMm - form.marginLeftMm - form.marginRightMm).toFixed(1)} × {(form.heightMm - form.marginTopMm - form.marginBottomMm).toFixed(1)} mm</span>
              <span>{t('page.paperProfiles.quickPixels')}: {Math.round(toPx(form.widthMm, form.dpi))} × {Math.round(toPx(form.heightMm, form.dpi))} px</span>
              <span>{t('page.paperProfiles.quickScale')}: {scale.toFixed(2)}x</span>
              <span>{t('page.paperProfiles.quickFields')}: {ux.dynamicFields.length}</span>
            </div>
            <div className="pp-selection-status" aria-live="polite">
              {selectedFieldId && ux.dynamicFields.find((field) => field.id === selectedFieldId)
                ? (() => {
                    const field = ux.dynamicFields.find((candidate) => candidate.id === selectedFieldId)!;
                    const size = field.type === 'qrcode'
                      ? `${field.qrSizeMm ?? DEFAULT_QR_SIZE_MM} × ${field.qrSizeMm ?? DEFAULT_QR_SIZE_MM} mm`
                      : field.type === 'barcode'
                        ? `${field.barcodeHeightMm ?? DEFAULT_BARCODE_HEIGHT_MM} mm high`
                        : `${field.fontSize} pt`;
                    return <><strong>{field.label || field.key || t('page.paperProfiles.untitledField')}</strong><span>{field.type} · X {field.xMm.toFixed(1)} · Y {field.yMm.toFixed(1)} mm · {size}</span></>;
                  })()
                : <><strong>{t('page.paperProfiles.noFieldSelected')}</strong><span>{t('page.paperProfiles.selectAnItemHint')}</span></>}
            </div>
            </div>
        </aside>
      </div>

      {previewOpen && (
        <div
          className="paper-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="paper-preview-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewOpen(false);
          }}
        >
          <div ref={modalPanelRef} className="paper-preview-modal__panel">
            <header className="paper-preview-modal__header">
              <div>
                <h2 id="paper-preview-title">{t('page.paperProfiles.fullPreviewTitle')}</h2>
                <p>{t('page.paperProfiles.dragHint')}</p>
              </div>
              <div className="paper-preview-modal__toolstrip" role="toolbar" aria-label="Preview tools">
                <div className="paper-preview-modal__zoom-control" role="group" aria-label={t('page.paperProfiles.zoomControls')}>
                  <IconButton icon="−" label={t('page.paperProfiles.zoomOut')} onClick={() => setPreviewZoom((value) => stepPreviewZoom(value, -1))} />
                  <button
                    type="button"
                    className="paper-preview-modal__zoom-readout"
                    onClick={() => setPreviewZoom(1)}
                    title={t('page.paperProfiles.resetZoom')}
                    aria-label={t('page.paperProfiles.resetZoom')}
                  >
                    {Math.round(previewZoom * 100)}%
                  </button>
                  <IconButton icon="+" label={t('page.paperProfiles.zoomIn')} onClick={() => setPreviewZoom((value) => stepPreviewZoom(value, 1))} />
                </div>
                <IconButton icon="⫶" label={t('page.paperProfiles.toggleVerticalGrid')} onClick={() => setShowVerticalGrid(!showVerticalGrid)} active={showVerticalGrid} />
                <IconButton icon="≡" label={t('page.paperProfiles.toggleHorizontalGrid')} onClick={() => setShowHorizontalGrid(!showHorizontalGrid)} active={showHorizontalGrid} />
                <IconButton icon="📏" label={t('page.paperProfiles.toggleRulers')} onClick={() => setShowRulers(!showRulers)} active={showRulers} />
                <IconButton icon="⊕" label={t('page.paperProfiles.toggleAlignmentGuides')} onClick={() => setShowAlignmentGuides(!showAlignmentGuides)} active={showAlignmentGuides} />
                <label className="paper-preview-modal__spacing-label" title={t('page.paperProfiles.gridSpacing')}>
                  <span className="paper-preview-modal__spacing-icon" aria-hidden="true">⊞</span>
                  <input
                    type="number"
                    className="paper-preview-modal__spacing-input"
                    value={gridSpacingMm}
                    min={1}
                    max={100}
                    step={1}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v)) setGridSpacingMm(clampGridSpacing(v));
                    }}
                    aria-label={t('page.paperProfiles.gridSpacing')}
                  />
                  <span className="paper-preview-modal__spacing-unit">mm</span>
                </label>
              </div>
              <button ref={modalCloseButtonRef} type="button" style={s.btnSmall} onClick={() => setPreviewOpen(false)}>
                {t('page.paperProfiles.closePreview')}
              </button>
            </header>

            <div className="paper-preview-modal__body">
              <section ref={previewCanvasRef} className="paper-preview-modal__canvas" aria-label={t('page.paperProfiles.previewCanvas')}>
                <div className="paper-preview-modal__canvas-label">
                  <span>{t('page.paperProfiles.previewCanvas')}</span>
                  <span>{form.widthMm} × {form.heightMm} mm · {form.dpi} DPI</span>
                </div>
                <div
                  ref={modalStageRef}
                  className="paper-preview-modal__sheet-stage"
                  onWheel={(event) => {
                    if (!(event.ctrlKey || event.metaKey)) return;
                    event.preventDefault();
                    setPreviewZoom((value) => stepPreviewZoom(value, event.deltaY > 0 ? -1 : 1));
                  }}
                >
                  <div className="paper-preview-modal__sheet-stage-inner">
              <RulerSheet form={form} scale={modalScale} showRulers={showRulers} unit={du}>
                    <PaperCanvas
                      form={form}
                      ux={ux}
                      scale={modalScale}
                      sheetRef={previewSheetRef}
                      selectedFieldId={selectedFieldId}
                      onFieldPointerDown={startDraggingField}
                      onFieldSelect={setSelectedFieldId}
                      onFieldNudge={nudgeField}
                      showVerticalGrid={showVerticalGrid}
                      showHorizontalGrid={showHorizontalGrid}
                      showAlignmentGuides={showAlignmentGuides}
                      showDimensions={showDimensions}
                      gridIntervalMm={gridSpacingMm}
                      artworkUrl={currentArtworkUrl}
                      artworkFitMode={currentArtworkFitMode}
                    />
                  </RulerSheet>
                  </div>
                </div>
                <div className="paper-preview-modal__canvas-meta">
                  <span>{t('page.paperProfiles.quickPrintable')}: {(form.widthMm - form.marginLeftMm - form.marginRightMm).toFixed(1)} × {(form.heightMm - form.marginTopMm - form.marginBottomMm).toFixed(1)} mm</span>
                  <span>{t('page.paperProfiles.quickFields')}: {ux.dynamicFields.length}</span>
                  <span>{t('page.paperProfiles.zoomLevel')}: {Math.round(previewZoom * 100)}% ({t('page.paperProfiles.fitIsHundred')})</span>
                  <span>{t('page.paperProfiles.pixelScale')}: {modalScale.toFixed(2)} px/mm</span>
                </div>
              </section>

              <aside className="paper-preview-modal__controls">
                <div className="paper-preview-modal__controls-heading">
                  <div>
                    <h3>{t('page.paperProfiles.positionFields')}</h3>
                    <p>{t('page.paperProfiles.positionFieldsHint')}</p>
                  </div>
                  <button
                    type="button"
                    className="pp-tool-btn"
                    onClick={addField}
                    title={t('page.paperProfiles.addField')}
                    aria-label={t('page.paperProfiles.addField')}
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
                {fieldInspectorState !== 'empty' && (
                  <div
                    className={'paper-preview-modal__alignment' + (fieldInspectorState === 'selection-required' ? ' is-disabled' : '')}
                    role="toolbar"
                    aria-label={t('page.paperProfiles.positionFields')}
                  >
                    <span className="paper-preview-modal__alignment-label">
                      {fieldInspectorState === 'selection-required'
                        ? t('page.paperProfiles.centerDisabledNoField')
                        : t('page.paperProfiles.align')}
                    </span>
                    <IconButton
                      icon="↔"
                      label={t('page.paperProfiles.centerHorizontally')}
                      onClick={() => { if (selectedFieldId) centerFieldHorizontal(selectedFieldId); }}
                      disabled={fieldInspectorState === 'selection-required'}
                      disabledReason={t('page.paperProfiles.centerDisabledNoField')}
                    />
                    <IconButton
                      icon="↕"
                      label={t('page.paperProfiles.centerVertically')}
                      onClick={() => { if (selectedFieldId) centerFieldVertical(selectedFieldId); }}
                      disabled={fieldInspectorState === 'selection-required'}
                      disabledReason={t('page.paperProfiles.centerDisabledNoField')}
                    />
                  </div>
                )}
                {fieldInspectorState === 'empty' && (
                  <div className="paper-preview-modal__empty">
                    <p>{t('page.paperProfiles.noCustomFields')}</p>
                    <button type="button" className="paper-preview-modal__empty-action" onClick={addField}>
                      <span aria-hidden="true">+</span>
                      {t('page.paperProfiles.addFirstField')}
                    </button>
                  </div>
                )}
                <div className="paper-preview-modal__field-list">
                  {ux.dynamicFields.map((f) => (
                    <div
                      key={f.id}
                      className={'paper-preview-modal__field' + (selectedFieldId === f.id ? ' is-selected' : '')}
                      onClick={() => setSelectedFieldId(f.id)}
                    >
                      <div className="paper-preview-modal__field-heading">
                        <code>{f.key || t('page.paperProfiles.noKey')}</code>
                        <button type="button" className="pp-field-delete" onClick={(e) => { e.stopPropagation(); delField(f.id); }}>
                          {t('page.paperProfiles.remove')}
                        </button>
                      </div>
                      <div className="paper-preview-modal__field-grid">
                        <label>{t('page.paperProfiles.fieldKey')}<input value={f.key} onChange={(e) => updField(f.id, { key: e.target.value })} /></label>
                        <label>{t('page.paperProfiles.fieldLabel')}<input value={f.label} onChange={(e) => updField(f.id, { label: e.target.value })} /></label>
                        <label>{t('page.paperProfiles.fieldType')}<FieldTypeControls field={f} onUpdate={(patchFields) => updField(f.id, patchFields)} /></label>
                        <label>{t('page.paperProfiles.positionX')}<input type="number" step="0.1" value={f.xMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { xMm: v }); }} /></label>
                        <label>{t('page.paperProfiles.positionY')}<input type="number" step="0.1" value={f.yMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { yMm: v }); }} /></label>
                        <label>{t('page.paperProfiles.fontSize')}<input type="number" min={6} max={72} value={f.fontSize} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) updField(f.id, { fontSize: clampFontSize(v) }); }} /></label>
                        <label>{t('page.paperProfiles.align')}<select value={f.align} onChange={(e) => updField(f.id, { align: e.target.value as DynamicField['align'] })}><option value="left">{t('page.paperProfiles.alignLeft')}</option><option value="center">{t('page.paperProfiles.alignCenter')}</option><option value="right">{t('page.paperProfiles.alignRight')}</option></select></label>
                      </div>
                      <div className="paper-preview-modal__field-footer">
                        <label><input type="color" value={f.color} onChange={(e) => updField(f.id, { color: e.target.value })} /> {t('page.paperProfiles.fieldColor')}</label>
                        <label><input type="checkbox" checked={f.bold} onChange={(e) => updField(f.id, { bold: e.target.checked })} /> {t('page.paperProfiles.bold')}</label>
                        <span>{f.xMm.toFixed(1)} × {f.yMm.toFixed(1)} mm</span>
                      </div>
                      <FieldBarcodePreview field={f} />
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}

      {/* ─── Drawer: Fields ─── */}
      {showDrawer === 'fields' && (
        <>
          <div className="pp-drawer-backdrop" onClick={closeDrawer} />
          <div className="pp-drawer" role="dialog" aria-modal="true" aria-label={t('page.paperProfiles.dynamicFieldsEditor')} ref={drawerRef} tabIndex={-1}>
          <div className="pp-drawer__header">
            <span className="pp-drawer__title">{t('page.paperProfiles.dynamicFieldsEditor')}</span>
            <button className="pp-tool-btn" style={{ width: 28, height: 26, fontSize: '0.8rem' }}
              title={t('common.cancel')} aria-label={t('common.cancel')}
              ref={drawerCloseButtonRef}
              onClick={closeDrawer}>✕</button>
          </div>
          <div className="pp-drawer__body">
            {ux.dynamicFields.length === 0 && (
              <p style={{ fontSize: '0.85rem', color: '#6b7280', textAlign: 'center', marginTop: '2rem' }}>
                {t('page.paperProfiles.fieldsDrawerEmpty')}<br />{t('page.paperProfiles.clickAddField')}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {ux.dynamicFields.map((f) => (
                <div key={f.id} style={{ padding: '0.65rem', border: '1px solid #e5e7eb', borderRadius: 6, background: '#f9fafb' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <code style={{ fontSize: '0.8rem', fontWeight: 600 }}>{f.key || t('page.paperProfiles.noKey')}</code>
                    <button type="button" className="pp-field-delete" onClick={(e) => { e.stopPropagation(); delField(f.id); }}>{t('page.paperProfiles.remove')}</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem', fontSize: '0.75rem' }}>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.fieldLabel')}</label><input value={f.label} onChange={(e) => updField(f.id, { label: e.target.value })} className="pp-input pp-input--sm" /></div>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.fieldDefault')}</label><input value={f.defaultValue} onChange={(e) => updField(f.id, { defaultValue: e.target.value })} className="pp-input pp-input--sm" /></div>
                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.35rem', alignItems: 'flex-end' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ color: '#6b7280', display: 'block' }}>{t('page.paperProfiles.fieldType')}</label>
                        <FieldTypeControls field={f} onUpdate={(patchFields) => updField(f.id, patchFields)} selectClassName="pp-select pp-select--sm" numberClassName="pp-number pp-input--sm" />
                      </div>
                    </div>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.fontSize')}</label><input type="number" min={6} max={72} value={f.fontSize} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) updField(f.id, { fontSize: clampFontSize(v) }); }} className="pp-input pp-input--sm" /></div>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.positionX')}</label><input type="number" value={f.xMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { xMm: v }); }} className="pp-input pp-input--sm" /></div>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.positionY')}</label><input type="number" value={f.yMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { yMm: v }); }} className="pp-input pp-input--sm" /></div>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.fieldColor')}</label><input type="color" value={f.color} onChange={(e) => updField(f.id, { color: e.target.value })} style={{ width: '100%', height: 28, padding: 0, border: '1px solid #d1d5db', borderRadius: 4 }} /></div>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.align')}</label><select value={f.align} onChange={(e) => updField(f.id, { align: e.target.value as DynamicField['align'] })} className="pp-select pp-select--sm"><option value="left">{t('page.paperProfiles.alignLeft')}</option><option value="center">{t('page.paperProfiles.alignCenter')}</option><option value="right">{t('page.paperProfiles.alignRight')}</option></select></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', gridColumn: '1 / -1' }}>
                      <input type="checkbox" id={'bold-'+f.id} checked={f.bold} onChange={(e) => updField(f.id, { bold: e.target.checked })} />
                      <label htmlFor={'bold-'+f.id} style={{ fontSize: '0.75rem' }}>{t('page.paperProfiles.bold')}</label>
                    </div>
                  </div>
                  <FieldBarcodePreview field={f} />
                </div>
              ))}
            </div>
            <button style={{ ...s.btnSmall, marginTop: '0.75rem', width: '100%', borderStyle: 'dashed', color: '#1e66f5', borderColor: '#89b4fa' }}
              onClick={addField}>{t('page.paperProfiles.addField')}</button>
          </div>
          </div>
        </>
      )}

      {/* ─── Drawer: Appearance ─── */}
      {showDrawer === 'appearance' && (
        <>
          <div className="pp-drawer-backdrop" onClick={closeDrawer} />
          <div className="pp-drawer" role="dialog" aria-modal="true" aria-label={t('page.paperProfiles.appearanceStyle')} ref={drawerRef} tabIndex={-1}>
          <div className="pp-drawer__header">
            <span className="pp-drawer__title">{t('page.paperProfiles.appearanceStyle')}</span>
            <button className="pp-tool-btn" style={{ width: 28, height: 26, fontSize: '0.8rem' }}
              title={t('common.cancel')} aria-label={t('common.cancel')}
              ref={drawerCloseButtonRef}
              onClick={closeDrawer}>✕</button>
          </div>
          <div className="pp-drawer__body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label className="pp-label">{t('page.paperProfiles.fontFamily')}</label>
                <select value={ux.fontFamily} onChange={(e) => uxPatch('fontFamily', e.target.value)} className="pp-select">
                  {FONT_LIST.map((f) => <option key={f} value={f}>{f.replace(/['"]/g, '')}</option>)}
                </select>
              </div>
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '0.5rem' }}>
                <h4 style={{ fontSize: '0.8rem', fontWeight: 600, margin: '0 0 0.5rem', color: '#374151' }}>
                  {t('page.paperProfiles.newFieldDefaults')}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div>
                    <label className="pp-label">{t('page.paperProfiles.fontSize')}</label>
                    <input type="number" value={ux.fontSize} min={6} max={72}
                      onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) uxPatch('fontSize', clampFontSize(v)); }}
                      className="pp-input" />
                  </div>
                  <div>
                    <label className="pp-label">{t('page.paperProfiles.fontWeight')}</label>
                    <select value={ux.fontWeight} onChange={(e) => uxPatch('fontWeight', e.target.value as 'normal' | 'bold')} className="pp-select">
                      <option value="normal">{t('page.paperProfiles.normal')}</option>
                      <option value="bold">{t('page.paperProfiles.bold')}</option>
                    </select>
                  </div>
                </div>
                <ColorInput label={t('page.paperProfiles.fontColor')} value={ux.fontColor} onChange={(v) => uxPatch('fontColor', v)} />
              </div>
              <ColorInput label={t('page.paperProfiles.background')} value={ux.bgColor} onChange={(v) => uxPatch('bgColor', v)} />
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '0.5rem' }}>
                <label className="pp-label">{t('page.paperProfiles.watermarkText')}</label>
                <input value={ux.watermarkText} onChange={(e) => uxPatch('watermarkText', e.target.value)}
                  placeholder={t('page.paperProfiles.watermarkPlaceholder')} className="pp-input" />
              </div>
              <div>
                <label className="pp-label">{t('page.paperProfiles.watermarkOpacity')}: {ux.watermarkOpacity}%</label>
                <input type="range" min={0} max={50} value={ux.watermarkOpacity}
                  onChange={(e) => uxPatch('watermarkOpacity', parseInt(e.target.value))}
                  style={{ width: '100%' }} />
              </div>
            </div>
          </div>
          </div>
        </>
      )}

      {/* ─── Import Design Drawer ─── */}
      {showDrawer === 'import' && (
        <>
          <div className="pp-drawer-backdrop" onClick={closeDrawer} />
          <div className="pp-drawer" role="dialog" aria-modal="true" aria-label={t('page.paperProfiles.importDesignTitle')} ref={drawerRef} tabIndex={-1}>
            <div className="pp-drawer__header">
              <span className="pp-drawer__title">{t('page.paperProfiles.importDesignTitle')}</span>
              <button className="pp-tool-btn" style={{ width: 28, height: 26, fontSize: '0.8rem' }}
                title={t('common.cancel')} aria-label={t('common.cancel')}
                ref={drawerCloseButtonRef}
                onClick={() => { resetImport(); closeDrawer(); }}>✕</button>
            </div>
            <div className="pp-drawer__body" aria-live="polite">
              {/* ── Phase: select ── */}
              {(importPhase === 'select' || importPhase === 'error') && (
                <div>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.5rem', color: '#1e1e2e' }}>
                    {t('page.paperProfiles.importSelectTitle')}
                  </h3>
                  <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0 0 1rem', lineHeight: 1.5 }}>
                    {t('page.paperProfiles.importSelectHint')}
                  </p>
                  <label
                    className="pp-import-dropzone"
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('pp-import-dropzone--dragover'); }}
                    onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('pp-import-dropzone--dragover'); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('pp-import-dropzone--dragover');
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleImportFileSelected(file);
                    }}
                  >
                    <span className="pp-import-dropzone__icon" aria-hidden="true">📁</span>
                    <span className="pp-import-dropzone__text">{t('page.paperProfiles.importDropLabel')}</span>
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                      style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImportFileSelected(file);
                        // Reset the input so the same file can be re-selected
                        e.target.value = '';
                      }}
                      aria-label={t('page.paperProfiles.importBrowseLabel')}
                    />
                  </label>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.75rem', color: '#6b7280' }}>
                    <span>{t('page.paperProfiles.importMaxSize')}</span>
                    <span>{t('page.paperProfiles.importAcceptedFormats')}</span>
                  </div>

                  {importError && (
                    <div className="pp-import-error" role="alert" style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#f38ba8', color: '#111827', borderRadius: 6, fontSize: '0.875rem' }}>
                      {importError}
                      <button
                        type="button"
                        onClick={() => { setImportPhase('select'); setImportError(null); }}
                        style={{ marginLeft: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', color: '#111827', textDecoration: 'underline', fontSize: '0.75rem' }}
                      >
                        {t('page.paperProfiles.importRetry')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Phase: analyzing ── */}
              {importPhase === 'analyzing' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, gap: '0.75rem' }}>
                  <div className="pp-import-spinner" aria-hidden="true" />
                  <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>{t('page.paperProfiles.importAnalyzing')}</span>
                </div>
              )}

              {/* ── Phase: review ── */}
              {importPhase === 'review' && importAnalyzeResult && (
                <div>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.75rem', color: '#1e1e2e' }}>
                    {t('page.paperProfiles.importReviewTitle')}
                  </h3>

                  {/* Thumbnail */}
                  {importObjectUrl && (
                    <div style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
                      <img
                        src={importObjectUrl}
                        alt={t('page.paperProfiles.importThumbnail')}
                        style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 4, border: '1px solid #e5e7eb', objectFit: 'contain' }}
                      />
                    </div>
                  )}

                  {/* File info grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.75rem' }}>
                    <div><span style={{ color: '#6b7280' }}>{t('page.paperProfiles.importFileName')}</span><br /><strong>{importFile?.name}</strong></div>
                    <div><span style={{ color: '#6b7280' }}>{t('page.paperProfiles.importFileSize')}</span><br /><strong>{(importAnalyzeResult.fileSizeBytes / 1024).toFixed(1)} KB</strong></div>
                    <div><span style={{ color: '#6b7280' }}>{t('page.paperProfiles.importMimeType')}</span><br /><strong>{importAnalyzeResult.detectedMimeType}</strong></div>
                    <div><span style={{ color: '#6b7280' }}>{t('page.paperProfiles.importPixelDimensions')}</span><br /><strong>{importAnalyzeResult.pixelWidth} × {importAnalyzeResult.pixelHeight} px</strong></div>
                    <div><span style={{ color: '#6b7280' }}>{t('page.paperProfiles.importDetectedDpi')}</span><br /><strong>{importAnalyzeResult.detectedDpi !== null ? importAnalyzeResult.detectedDpi : '—'}</strong></div>
                    <div><span style={{ color: '#6b7280' }}>{t('page.paperProfiles.importSuggestedDpi')}</span><br /><strong>{importAnalyzeResult.suggestedDpi} DPI</strong></div>
                    <div><span style={{ color: '#6b7280' }}>{t('page.paperProfiles.importSuggestedDimensions')}</span><br /><strong>{importAnalyzeResult.suggestedWidthMm.toFixed(1)} × {importAnalyzeResult.suggestedHeightMm.toFixed(1)} mm</strong></div>
                    <div></div>
                  </div>

                  {/* Warnings */}
                  {importAnalyzeResult.detectedDpi === null && (
                    <div style={{ padding: '0.35rem 0.5rem', background: '#f9e2af', color: '#374151', borderRadius: 4, fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                      ⚠ {t('page.paperProfiles.importWarningNoDpi').replace('{dpi}', String(importAnalyzeResult.suggestedDpi))}
                    </div>
                  )}
                  {isLowImportDpi(importAnalyzeResult.detectedDpi) && importAnalyzeResult.detectedDpi !== null && (
                    <div style={{ padding: '0.35rem 0.5rem', background: '#f9e2af', color: '#374151', borderRadius: 4, fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                      ⚠ {t('page.paperProfiles.importWarningLowDpi')
                        .replace('{detected}', String(importAnalyzeResult.detectedDpi))
                        .replace('{suggested}', String(importAnalyzeResult.suggestedDpi))}
                    </div>
                  )}

                  {/* Editable fields */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <div>
                      <label className="pp-label">{t('page.paperProfiles.nameLabel')} *</label>
                      <input
                        value={importDraft.name}
                        onChange={(e) => setImportDraft((d) => ({ ...d, name: e.target.value }))}
                        className="pp-input" aria-invalid={importDraftErrors.some((err) => err.field === 'name') || undefined}
                      />
                    </div>
                    <div>
                      <label className="pp-label">{t('page.paperProfiles.codeLabel')} *</label>
                      <input
                        value={importDraft.code}
                        onChange={(e) => setImportDraft((d) => ({ ...d, code: e.target.value }))}
                        className="pp-input" aria-invalid={importDraftErrors.some((err) => err.field === 'code') || undefined}
                        placeholder={t('page.paperProfiles.codePlaceholder')}
                      />
                    </div>
                    <div className="pp-form-grid pp-form-grid--two">
                      <div>
                        <label className="pp-label">{t('page.paperProfiles.width')} (mm)</label>
                        <input
                          type="number"
                          value={importDraft.widthMm}
                          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setImportDraft((d) => ({ ...d, widthMm: v })); }}
                          className="pp-input" aria-invalid={importDraftErrors.some((err) => err.field === 'widthMm') || undefined}
                        />
                      </div>
                      <div>
                        <label className="pp-label">{t('page.paperProfiles.height')} (mm)</label>
                        <input
                          type="number"
                          value={importDraft.heightMm}
                          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setImportDraft((d) => ({ ...d, heightMm: v })); }}
                          className="pp-input" aria-invalid={importDraftErrors.some((err) => err.field === 'heightMm') || undefined}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="pp-label">{t('page.paperProfiles.dpi')}</label>
                      <input
                        type="number"
                        value={importDraft.dpi}
                        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) setImportDraft((d) => ({ ...d, dpi: v })); }}
                        className="pp-input" aria-invalid={importDraftErrors.some((err) => err.field === 'dpi') || undefined}
                      />
                    </div>
                    <div>
                      <label className="pp-label">{t('page.paperProfiles.orientation')}</label>
                      <select
                        value={importDraft.orientation}
                        onChange={(e) => {
                          const next = e.target.value as 'portrait' | 'landscape';
                          if (next === importDraft.orientation) return;
                          const natural = importDraft.widthMm > importDraft.heightMm ? 'landscape' : 'portrait';
                          if (next !== natural) {
                            setImportDraft((d) => ({ ...d, widthMm: d.heightMm, heightMm: d.widthMm, orientation: next }));
                          } else {
                            setImportDraft((d) => ({ ...d, orientation: next }));
                          }
                        }}
                        className="pp-select"
                      >
                        <option value="portrait">{t('page.paperProfiles.portrait')}</option>
                        <option value="landscape">{t('page.paperProfiles.landscape')}</option>
                      </select>
                    </div>
                  </div>

                  {/* Margins */}
                  <div className="pp-form-grid pp-form-grid--four" style={{ marginBottom: '0.75rem' }}>
                    {(['marginTopMm', 'marginRightMm', 'marginBottomMm', 'marginLeftMm'] as const).map((mk) => (
                      <div key={mk}>
                        <label className="pp-label">{t('page.paperProfiles.' + (mk === 'marginTopMm' ? 'top' : mk === 'marginRightMm' ? 'right' : mk === 'marginBottomMm' ? 'bottom' : 'left'))} (mm)</label>
                        <input
                          type="number"
                          value={importDraft[mk]}
                          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setImportDraft((d) => ({ ...d, [mk]: v })); }}
                          className="pp-input" aria-invalid={importDraftErrors.some((err) => err.field === mk || err.field === 'margins') || undefined}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Field errors */}
                  {importDraftErrors.length > 0 && (
                    <div style={{ padding: '0.5rem', background: '#f38ba8', color: '#111827', borderRadius: 4, fontSize: '0.75rem', marginBottom: '0.75rem' }}>
                      {importDraftErrors.map((err) => t(err.messageKey)).join('; ')}
                    </div>
                  )}

                  {/* Fit mode */}
                  <div style={{ marginBottom: '1rem' }}>
                    <label className="pp-label">{t('page.paperProfiles.importFitMode')}</label>
                    <select value={importFitMode} onChange={(e) => setImportFitMode(e.target.value as ImportFitMode)} className="pp-select">
                      <option value="contain">{t('page.paperProfiles.importFitContain')}</option>
                      <option value="cover">{t('page.paperProfiles.importFitCover')}</option>
                      <option value="stretch">{t('page.paperProfiles.importFitStretch')}</option>
                    </select>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="button" style={{ ...s.btnSmall }} onClick={() => { resetImport(); }}>
                      {t('page.paperProfiles.importBack')}
                    </button>
                    <button
                      type="button"
                      className="pp-save-button"
                      style={{ ...s.btn, flex: 1, opacity: importDraftErrors.length > 0 ? 0.5 : 1 }}
                      onClick={() => void submitImport()}
                      disabled={importDraftErrors.length > 0}
                    >
                      {t('page.paperProfiles.importButton')}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Phase: importing ── */}
              {importPhase === 'importing' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, gap: '0.75rem' }}>
                  <div className="pp-import-spinner" aria-hidden="true" />
                  <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>{t('page.paperProfiles.importImporting')}</span>
                </div>
              )}

              {/* ── Phase: success ── */}
              {importPhase === 'success' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, gap: '0.75rem' }}>
                  <span style={{ fontSize: '2rem' }} aria-hidden="true">✅</span>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>{t('page.paperProfiles.importSuccess')}</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ─── Profile list ─── */}
      <div style={{ background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ padding: '0.65rem 0.85rem', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ fontSize: '0.875rem', margin: 0 }}>{t('page.paperProfiles.savedProfiles').replace('{n}', String(profiles.length))}</h2>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              type="file"
              ref={jsonInputRef}
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void importProfilesJsonFile(file);
                  e.target.value = '';
                }
              }}
            />
            <button
              type="button"
              className="ds-btn ds-btn--ghost"
              onClick={() => jsonInputRef.current?.click()}
              title={t('page.paperProfiles.importJsonProfile')}
            >
              ⤓ {t('page.paperProfiles.importJsonProfile')}
            </button>
            <button
              type="button"
              className="ds-btn ds-btn--ghost"
              onClick={exportAllProfilesJson}
              disabled={profiles.length === 0}
              title={t('page.paperProfiles.exportAllProfiles')}
            >
              ⤒ {t('page.paperProfiles.exportAllProfiles')}
            </button>
          </div>
        </div>
        {/* Import/export result, in place of the four native alert() dialogs.
            A blocked WebView modal is worse than an inline strip, and this one is
            localized and dismissible. */}
        {feedback && (
          <div style={{ padding: '0.65rem 0.85rem 0' }}>
            <Alert
              tone={feedback.tone}
              onDismiss={() => setFeedback(null)}
              dismissLabel={t('error.dismiss')}
            >
              {feedback.text}
            </Alert>
          </div>
        )}

        {/* A failed list is never rendered as an empty one. */}
        {profilesResource.error != null && profilesResource.data === undefined && (
          <div style={{ padding: '0.85rem' }}>
            <ErrorState
              error={profilesResource.error}
              title={t('page.paperProfiles.loadFailed')}
              onRetry={profilesResource.refresh}
            />
          </div>
        )}
        {profilesResource.error != null && profilesResource.data !== undefined && (
          <div style={{ padding: '0.65rem 0.85rem 0' }}>
            <ErrorBanner
              error={profilesResource.error}
              title={t('page.paperProfiles.loadFailed')}
              onRetry={profilesResource.refresh}
            />
          </div>
        )}
        {profilesResource.loading && profilesResource.data === undefined && profilesResource.error == null && (
          <div style={{ padding: '0.85rem' }}><LoadingState /></div>
        )}
        {profilesResource.data !== undefined && profilesResource.data.length === 0 && (
          <div style={{ padding: '0.85rem' }}>
            <EmptyState title={t('page.paperProfiles.noProfiles')} />
          </div>
        )}
        <div style={{ overflowX: 'auto', maxHeight: 200, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {[t('page.paperProfiles.codeLabel'), t('page.paperProfiles.nameLabel'), t('page.paperProfiles.size'), t('page.paperProfiles.marginsHeader'), t('page.paperProfiles.orient'), t('page.paperProfiles.dpi'), t('page.paperProfiles.actions')].map((h) => (
                  <th key={h} style={{ padding: '0.5rem 0.6rem', textAlign: 'left', fontSize: '0.75rem', textTransform: 'uppercase', color: '#6b7280', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.5rem 0.6rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{p.code}</td>
                  <td style={{ padding: '0.5rem 0.6rem' }}>{p.name}</td>
                  <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.75rem' }}>{p.widthMm}×{p.heightMm}</td>
                  <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.75rem', color: '#6b7280' }}>{p.marginTopMm}/{p.marginRightMm}/{p.marginBottomMm}/{p.marginLeftMm}</td>
                  <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.75rem' }}>{p.orientation === 'portrait' ? t('page.paperProfiles.portrait') : t('page.paperProfiles.landscape')}</td>
                  <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.75rem' }}>{p.dpi}</td>
                  <td style={{ padding: '0.5rem 0.6rem', display: 'flex', gap: '0.25rem' }}>
                    <button className="ds-btn ds-btn--icon" onClick={() => startEdit(p)} title={t('page.paperProfiles.editingProfile')}>✏️</button>
                    <button className="ds-btn ds-btn--icon" onClick={() => exportProfileJson(p)} title={t('page.paperProfiles.exportProfile')}>⤒</button>
                    <button className="ds-btn ds-btn--icon ds-btn--danger" onClick={() => void deleteProfile(p)} title={t('page.paperProfiles.deleteProfile')}>🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Confirm Delete Profile Modal ── */}
      {pendingDeleteProfile && (
        <div className="ds-modal" role="dialog" aria-modal="true" onClick={() => setPendingDeleteProfile(null)}>
          <div className="ds-modal__panel ds-modal__panel--sm" onClick={(e) => e.stopPropagation()}>
            <div className="ds-modal__header">
              <h2>{t('page.paperProfiles.deleteProfile')}</h2>
              <button
                type="button"
                className="ds-btn ds-btn--icon"
                onClick={() => setPendingDeleteProfile(null)}
                aria-label={t('common.cancel')}
              >✕</button>
            </div>
            <div className="ds-confirm__body">
              <p>{t('page.paperProfiles.confirmDelete').replace('{code}', pendingDeleteProfile.code)}</p>
              <code>{pendingDeleteProfile.code}</code>
            </div>
            <div className="ds-modal__actions">
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setPendingDeleteProfile(null)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="ds-btn ds-btn--danger" onClick={() => void confirmDeleteProfile()}>
                🗑 {t('page.paperProfiles.deleteProfile')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
