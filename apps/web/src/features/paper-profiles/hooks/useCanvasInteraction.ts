import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { clampGroupDelta, getDesignPaperGeometry, mapPrintablePointToVisual, mapVisualPointToPrintable, nudgePrintablePoint } from '../model/geometry.js';
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
  const updateFieldsRef = useRef(editor.updateFields);
  updateFieldsRef.current = editor.updateFields;
  /** Every dragged field as it was when the drag began; more than one = group drag. */
  const groupStartRef = useRef<DynamicField[]>([]);
  const selectFieldRef = useRef(editor.selectField);
  const toggleSelectionRef = useRef(editor.toggleFieldSelection);
  toggleSelectionRef.current = editor.toggleFieldSelection;
  const breakHistoryRef = useRef(editor.breakHistory);
  breakHistoryRef.current = editor.breakHistory;
  stateRef.current = editor.state;
  updateFieldRef.current = editor.updateField;
  selectFieldRef.current = editor.selectField;

  const endDrag = useCallback(() => {
    setDraggingFieldId(null);
    activeSheetRef.current = null;
    breakHistoryRef.current(); // one drag = one undo step
  }, []);

  useEffect(() => {
    if (!draggingFieldId) return;
    const onPointerMove = (event: PointerEvent) => {
      const sheet = activeSheetRef.current;
      const { form, ux } = stateRef.current;
      if (!sheet) return;
      const rect = sheet.getBoundingClientRect();
      const geometry = getDesignPaperGeometry(form);
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
        geometry.sourcePrintableWidthMm,
        Math.max(0, printable.xMm),
      );
      let yMm = Math.min(
        geometry.sourcePrintableHeightMm,
        Math.max(0, printable.yMm),
      );
      const group = groupStartRef.current;
      const inGroup = new Set(group.map((field) => field.id));
      for (const field of ux.dynamicFields) {
        if (field.id === draggingFieldId || inGroup.has(field.id)) continue;
        if (Math.abs(field.xMm - xMm) < SNAP_THRESHOLD_MM) xMm = field.xMm;
        if (Math.abs(field.yMm - yMm) < SNAP_THRESHOLD_MM) yMm = field.yMm;
      }
      const start = group.find((field) => field.id === draggingFieldId);
      if (group.length > 1 && start) {
        // Same visual delta for the whole group, clamped so it stops at the edge as one piece.
        const from = mapPrintablePointToVisual(start.xMm, start.yMm, geometry);
        const to = mapPrintablePointToVisual(xMm, yMm, geometry);
        const { dxMm, dyMm } = clampGroupDelta(group, to.xMm - from.xMm, to.yMm - from.yMm, geometry);
        updateFieldsRef.current(group.map((field) => ({
          id: field.id,
          patch: nudgePrintablePoint(field.xMm, field.yMm, dxMm, dyMm, geometry),
        })));
        return;
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
    // Shift/Cmd/Ctrl-click edits the selection, like Figma; it does not drag.
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      toggleSelectionRef.current(id);
      return;
    }
    const { form, ux, selectedFieldIds } = stateRef.current;
    const groupIds = selectedFieldIds.length > 1 && selectedFieldIds.includes(id) ? selectedFieldIds : [id];
    groupStartRef.current = ux.dynamicFields.filter((candidate) => groupIds.includes(candidate.id));
    const field = ux.dynamicFields.find((candidate) => candidate.id === id);
    if (sheet && field) {
      const geometry = getDesignPaperGeometry(form);
      const rect = sheet.getBoundingClientRect();
      const point = mapPrintablePointToVisual(field.xMm, field.yMm, geometry);
      dragOffsetRef.current = {
        xMm: (event.clientX - rect.left) / scale - (geometry.marginLeftMm + point.xMm),
        yMm: (event.clientY - rect.top) / scale - (geometry.marginTopMm + point.yMm),
      };
    }
    activeSheetRef.current = sheet;
    activeScaleRef.current = scale;
    if (groupIds.length === 1) selectFieldRef.current(id);
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
    return registerPointerDragListeners(document, onPointerMove, () => {
      setResizingFieldId(null);
      breakHistoryRef.current();
    });
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
