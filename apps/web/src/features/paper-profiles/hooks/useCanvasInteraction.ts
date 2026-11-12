import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getVisualPaperGeometry, mapPrintablePointToVisual, mapVisualPointToPrintable } from '../model/geometry.js';
import { resizeFieldPatch } from '../model/fieldGeometry.js';
import type { DynamicField } from '../model/types.js';
import type { PaperProfileEditor } from './usePaperProfileEditor.js';

const SNAP_THRESHOLD_MM = 2;

export function registerPointerDragListeners(
  target: Pick<Document, 'addEventListener' | 'removeEventListener'>,
  onMove: (event: PointerEvent) => void,
  onEnd: () => void,
) {
  target.addEventListener('pointermove', onMove as EventListener);
  target.addEventListener('pointerup', onEnd);
  target.addEventListener('pointercancel', onEnd);
  return () => {
    target.removeEventListener('pointermove', onMove as EventListener);
    target.removeEventListener('pointerup', onEnd);
    target.removeEventListener('pointercancel', onEnd);
  };
}

export function useCanvasInteraction(editor: PaperProfileEditor) {
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const activeSheetRef = useRef<HTMLDivElement | null>(null);
  const activeScaleRef = useRef(1);
  const dragOffsetRef = useRef({ xMm: 0, yMm: 0 });
  const stateRef = useRef(editor.state);
  const updateFieldRef = useRef(editor.updateField);
  const selectFieldRef = useRef(editor.selectField);
  stateRef.current = editor.state;
  updateFieldRef.current = editor.updateField;
  selectFieldRef.current = editor.selectField;

  const endDrag = useCallback(() => {
    setDraggingFieldId(null);
    activeSheetRef.current = null;
  }, []);

  useEffect(() => {
    if (!draggingFieldId) return;
    const onPointerMove = (event: PointerEvent) => {
      const sheet = activeSheetRef.current;
      const { form, ux } = stateRef.current;
      if (!sheet) return;
      const rect = sheet.getBoundingClientRect();
      const geometry = getVisualPaperGeometry(form);
      // The design canvas is upright (no print transform), so screen = paper.
      const pointerX = (event.clientX - rect.left) / activeScaleRef.current - dragOffsetRef.current.xMm - geometry.marginLeftMm;
      const pointerY = (event.clientY - rect.top) / activeScaleRef.current - dragOffsetRef.current.yMm - geometry.marginTopMm;
      const visualX = Math.max(0, Math.min(
        geometry.printableWidthMm,
        pointerX,
      ));
      const visualY = Math.max(0, Math.min(
        geometry.printableHeightMm,
        pointerY,
      ));
      const printable = mapVisualPointToPrintable(visualX, visualY, geometry);
      let xMm = Math.min(
        Math.max(0, form.widthMm - form.marginLeftMm - form.marginRightMm),
        Math.max(0, printable.xMm),
      );
      let yMm = Math.min(
        Math.max(0, form.heightMm - form.marginTopMm - form.marginBottomMm),
        Math.max(0, printable.yMm),
      );
      for (const field of ux.dynamicFields) {
        if (field.id === draggingFieldId) continue;
        if (Math.abs(field.xMm - xMm) < SNAP_THRESHOLD_MM) xMm = field.xMm;
        if (Math.abs(field.yMm - yMm) < SNAP_THRESHOLD_MM) yMm = field.yMm;
      }
      updateFieldRef.current(draggingFieldId, {
        xMm: Number(xMm.toFixed(1)),
        yMm: Number(yMm.toFixed(1)),
      });
    };
    return registerPointerDragListeners(document, onPointerMove, endDrag);
  }, [draggingFieldId, endDrag]);

  const startDrag = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
    id: string,
    sheet: HTMLDivElement | null,
    scale: number,
  ) => {
    event.currentTarget.focus();
    event.preventDefault();
    const { form, ux } = stateRef.current;
    const field = ux.dynamicFields.find((candidate) => candidate.id === id);
    if (sheet && field) {
      const geometry = getVisualPaperGeometry(form);
      const rect = sheet.getBoundingClientRect();
      const point = mapPrintablePointToVisual(field.xMm, field.yMm, geometry);
      dragOffsetRef.current = {
        xMm: (event.clientX - rect.left) / scale - (geometry.marginLeftMm + point.xMm),
        yMm: (event.clientY - rect.top) / scale - (geometry.marginTopMm + point.yMm),
      };
    }
    activeSheetRef.current = sheet;
    activeScaleRef.current = scale;
    selectFieldRef.current(id);
    setDraggingFieldId(id);
  }, []);

  const [resizingFieldId, setResizingFieldId] = useState<string | null>(null);
  const resizeStartRef = useRef<{ field: DynamicField; clientX: number; clientY: number; scale: number; heightMm: number } | null>(null);

  useEffect(() => {
    if (!resizingFieldId) return;
    const onPointerMove = (event: PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      updateFieldRef.current(resizingFieldId, resizeFieldPatch(
        start.field,
        (event.clientX - start.clientX) / start.scale,
        (event.clientY - start.clientY) / start.scale,
        start.heightMm,
      ));
    };
    return registerPointerDragListeners(document, onPointerMove, () => setResizingFieldId(null));
  }, [resizingFieldId]);

  /** Corner-handle resize; the handle sits inside the field's button. */
  const startResize = useCallback((event: ReactPointerEvent<HTMLElement>, id: string, scale: number) => {
    event.stopPropagation();
    event.preventDefault();
    const field = stateRef.current.ux.dynamicFields.find((candidate) => candidate.id === id);
    const box = event.currentTarget.closest('.pp-canvas-field')?.getBoundingClientRect();
    if (!field || !box) return;
    resizeStartRef.current = { field, clientX: event.clientX, clientY: event.clientY, scale, heightMm: box.height / scale };
    setResizingFieldId(id);
  }, []);

  return { draggingFieldId, startDrag, endDrag, resizingFieldId, startResize };
}

export { SNAP_THRESHOLD_MM };
