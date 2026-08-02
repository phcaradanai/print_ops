/**
 * Modal wrapper over the native `<dialog>` element (FE-01.1).
 *
 * `showModal()` gives us focus trapping, inert background and Escape handling
 * from the platform. React remains the source of truth for open state so focus
 * restoration and cancellation stay consistent across pages.
 */

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Shared keyboard, scroll-lock and focus-return behaviour for div-based modals. */
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
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      className="ui-dialog"
      aria-labelledby={titleId}
      onClick={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissOnEscape) onClose();
      }}
    >
      <div className="ui-dialog-header">
        <h2 className="ui-dialog-title" id={titleId}>
          {title}
        </h2>
        {closeLabel && (
          <button
            type="button"
            className="ui-dialog-close"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      {warning && (
        <p className="ui-dialog-warning" role="alert">
          {warning}
        </p>
      )}
      <div className="ui-dialog-body">{children}</div>
      {footer && <div className="ui-dialog-footer">{footer}</div>}
    </dialog>
  );
}
