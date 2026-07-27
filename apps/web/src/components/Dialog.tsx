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

import { useEffect, useId, useRef, type ReactNode } from 'react';

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
