/**
 * Shared PrintOps dialog adapter.
 *
 * The public API and visual class names remain owned by PrintOps while Radix
 * owns modal semantics, focus containment, Escape handling, outside dismissal,
 * scroll locking, portal rendering, and focus restoration.
 */

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Compatibility hook for non-Dialog overlays that have not migrated to a
 * headless primitive yet. New dialogs must use the shared Dialog adapter.
 */
export function useModalFocusTrap(open: boolean, panelRef: RefObject<HTMLElement>, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .filter((element) => !element.hasAttribute('hidden') && element.offsetParent !== null);
    const moveFocusInside = () => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) (focusable()[0] ?? panel).focus();
    };
    moveFocusInside();
    const frame = requestAnimationFrame(moveFocusInside);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      if (controls.length === 0) { event.preventDefault(); panelRef.current?.focus(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!panelRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, [open, panelRef]);
}

export interface DialogProps {
  open: boolean;
  /** Called for an allowed dismissal path or an explicit close/cancel action. */
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Accessible label for an explicit close control in the header. */
  closeLabel?: string;
  /** Action row, typically Cancel + the confirming Button. */
  footer?: ReactNode;
  /** Prominent warning shown under the title (e.g. duplicate-copy risk). */
  warning?: ReactNode;
  /** Disable for destructive dialogs so an incidental backdrop click cannot discard the confirmation context. */
  dismissOnBackdrop?: boolean;
  /** Escape normally performs a safe cancel; disable only for flows that require an explicit choice. */
  dismissOnEscape?: boolean;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  closeLabel,
  footer,
  warning,
  dismissOnBackdrop = true,
  dismissOnEscape = true,
}: DialogProps) {
  if (!open) return null;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-dialog-overlay" />
        <DialogPrimitive.Content
          className="ui-dialog"
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            if (!dismissOnEscape) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (!dismissOnBackdrop) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (!dismissOnBackdrop) event.preventDefault();
          }}
        >
          <div className="ui-dialog-header">
            <DialogPrimitive.Title asChild>
              <h2 className="ui-dialog-title">{title}</h2>
            </DialogPrimitive.Title>
            {closeLabel && (
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  className="ui-dialog-close"
                  aria-label={closeLabel}
                  title={closeLabel}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </DialogPrimitive.Close>
            )}
          </div>
          {warning && (
            <p className="ui-dialog-warning" role="alert">
              {warning}
            </p>
          )}
          <div className="ui-dialog-body">{children}</div>
          {footer && <div className="ui-dialog-footer">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
