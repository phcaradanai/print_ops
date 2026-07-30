import { useCallback, useEffect, useRef, useState } from 'react';

export type PaperProfileDrawer = 'fields' | 'appearance' | 'import';

export function usePaperProfilePopups(profileId: string | null) {
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [drawer, setDrawer] = useState<PaperProfileDrawer | null>(null);
  const [fullPreviewOpen, setFullPreviewOpen] = useState(false);
  const presetsTriggerRef = useRef<HTMLButtonElement>(null);
  const presetsContainerRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerCloseButtonRef = useRef<HTMLButtonElement>(null);
  const previewPanelRef = useRef<HTMLDivElement>(null);
  const previewCloseButtonRef = useRef<HTMLButtonElement>(null);
  const layerReturnFocusRef = useRef<HTMLElement | null>(null);

  const rememberFocus = () => {
    layerReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const restoreFocus = useCallback(() => {
    requestAnimationFrame(() => layerReturnFocusRef.current?.focus());
  }, []);
  const closePresets = useCallback((restore = true) => {
    setPresetsOpen(false);
    if (restore) requestAnimationFrame(() => presetsTriggerRef.current?.focus());
  }, []);
  const togglePresets = useCallback(() => {
    setPresetsOpen((open) => {
      if (!open) rememberFocus();
      return !open;
    });
  }, []);
  const openDrawer = useCallback((next: PaperProfileDrawer) => {
    rememberFocus();
    setPresetsOpen(false);
    setFullPreviewOpen(false);
    setDrawer(next);
  }, []);
  const toggleDrawer = useCallback((next: PaperProfileDrawer) => {
    if (drawer === next) {
      setDrawer(null);
      restoreFocus();
    } else {
      openDrawer(next);
    }
  }, [drawer, openDrawer, restoreFocus]);
  const closeDrawer = useCallback(() => {
    setDrawer(null);
    restoreFocus();
  }, [restoreFocus]);
  const openFullPreview = useCallback(() => {
    rememberFocus();
    setPresetsOpen(false);
    setDrawer(null);
    setFullPreviewOpen(true);
  }, []);
  const closeFullPreview = useCallback(() => {
    setFullPreviewOpen(false);
    restoreFocus();
  }, [restoreFocus]);

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

  useEffect(() => {
    const active = drawer ? drawerRef.current : fullPreviewOpen ? previewPanelRef.current : null;
    if (!active) return;
    const close = drawer ? closeDrawer : closeFullPreview;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      (drawer ? drawerCloseButtonRef.current : previewCloseButtonRef.current)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(active.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeDrawer, closeFullPreview, drawer, fullPreviewOpen]);

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
    drawerRef,
    drawerCloseButtonRef,
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
