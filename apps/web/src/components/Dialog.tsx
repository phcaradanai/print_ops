/**
 * Modal wrapper over the native `<dialog>` element (FE-01.1).
 *
 * `JobQueue`'s reprint confirmation is the only modal in the app and it wires
 * `showModal()` / `close()` / `onCancel` by hand through a ref and an effect.
 * That is the part everyone gets wrong: forgetting `onCancel` leaves Escape
 * closing the element without telling React, so the dialog reopens on the next
 * render. Centralised here, together with the labelling.
 *
 * `showModal()` gives us focus trapping, inert background and Escape handling
 * from the platform — no focus-management library needed. Nothing here creates
 * a `window.confirm`-style blocking dialog.
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
    const frame = requestAnimationFrame(() => (focusable()[0] ?? panelRef.current)?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      if (controls.length === 0) { event.preventDefault(); panelRef.current?.focus(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
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
  /** Called for Escape, backdrop dismissal and the close button. */
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Action row, typically Cancel + the confirming Button. */
  footer?: ReactNode;
  /** Prominent warning shown under the title (e.g. duplicate-copy risk). */
  warning?: ReactNode;
}

export function Dialog({ open, onClose, title, children, footer, warning }: DialogProps) {
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
      onCancel={(event) => {
        // Let React own the open state: without this the element would close
        // itself on Escape and immediately be reopened by the next render.
        event.preventDefault();
        onClose();
      }}
    >
      <h2 className="ui-dialog-title" id={titleId}>
        {title}
      </h2>
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
