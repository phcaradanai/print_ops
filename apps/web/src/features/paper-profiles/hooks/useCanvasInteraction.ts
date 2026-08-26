import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getVisualPaperGeometry, mapPrintablePointToVisual, mapVisualPointToPrintable } from '../model/geometry.js';
import { inverseTransformPoint, resolveRenderTransform, transformPoint } from '@printerops/shared';
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
      const transform = resolveRenderTransform(form);
      const pointerPageX = (event.clientX - rect.left) / activeScaleRef.current - dragOffsetRef.current.xMm;
      const pointerPageY = (event.clientY - rect.top) / activeScaleRef.current - dragOffsetRef.current.yMm;
      const contentPoint = inverseTransformPoint(
        pointerPageX,
        pointerPageY,
        geometry.widthMm,
        geometry.heightMm,
        transform,
      );
      const pointerX = contentPoint.x - geometry.marginLeftMm;
      const pointerY = contentPoint.y - geometry.marginTopMm;
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
      const transform = resolveRenderTransform(form);
      const point = mapPrintablePointToVisual(field.xMm, field.yMm, geometry);
      const transformedPoint = transformPoint(
        geometry.marginLeftMm + point.xMm,
        geometry.marginTopMm + point.yMm,
        geometry.widthMm,
        geometry.heightMm,
        transform,
      );
      dragOffsetRef.current = {
        xMm: (event.clientX - rect.left) / scale - transformedPoint.x,
        yMm: (event.clientY - rect.top) / scale - transformedPoint.y,
      };
    }
    activeSheetRef.current = sheet;
    activeScaleRef.current = scale;
    selectFieldRef.current(id);
    setDraggingFieldId(id);
  }, []);

  return { draggingFieldId, startDrag, endDrag };
}

export { SNAP_THRESHOLD_MM };
