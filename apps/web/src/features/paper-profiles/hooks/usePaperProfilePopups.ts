import { useCallback, useEffect, useRef, useState } from 'react';
import { useModalFocusTrap } from '../../../components/Dialog.js';

export type PaperProfileDrawer = 'fields' | 'appearance' | 'import';

export function usePaperProfilePopups(profileId: string | null) {
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [drawer, setDrawer] = useState<PaperProfileDrawer | null>(null);
  const [fullPreviewOpen, setFullPreviewOpen] = useState(false);
  const presetsTriggerRef = useRef<HTMLButtonElement>(null);
  const presetsContainerRef = useRef<HTMLDivElement>(null);
  const previewPanelRef = useRef<HTMLDivElement>(null);
  const previewCloseButtonRef = useRef<HTMLButtonElement>(null);
  const closePresets = useCallback((restore = true) => {
    setPresetsOpen(false);
    if (restore) requestAnimationFrame(() => presetsTriggerRef.current?.focus());
  }, []);
  const togglePresets = useCallback(() => {
    setPresetsOpen((open) => !open);
  }, []);
  const openDrawer = useCallback((next: PaperProfileDrawer) => {
    setPresetsOpen(false);
    setFullPreviewOpen(false);
    setDrawer(next);
  }, []);
  const toggleDrawer = useCallback((next: PaperProfileDrawer) => {
    if (drawer === next) {
      setDrawer(null);
    } else {
      openDrawer(next);
    }
  }, [drawer, openDrawer]);
  const closeDrawer = useCallback(() => {
    setDrawer(null);
  }, []);
  const openFullPreview = useCallback(() => {
    setPresetsOpen(false);
    setDrawer(null);
    setFullPreviewOpen(true);
  }, []);
  const closeFullPreview = useCallback(() => {
    setFullPreviewOpen(false);
  }, []);

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
      if (container && event.target instanceof Node && !container.contains(event.target)) closePresets(false);
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [closePresets, presetsOpen]);

  useModalFocusTrap(fullPreviewOpen, previewPanelRef, closeFullPreview);

  useEffect(() => {
    setPresetsOpen(false);
    setDrawer(null);
    setFullPreviewOpen(false);
  }, [profileId]);

  return {
    presetsOpen,
    presetsTriggerRef,
    presetsContainerRef,
    togglePresets,
    closePresets,
    drawer,
    openDrawer,
    toggleDrawer,
    closeDrawer,
    fullPreviewOpen,
    previewPanelRef,
    previewCloseButtonRef,
    openFullPreview,
    closeFullPreview,
  };
}

export type PaperProfilePopups = ReturnType<typeof usePaperProfilePopups>;
