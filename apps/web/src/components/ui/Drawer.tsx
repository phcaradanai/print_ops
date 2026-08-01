import { useId, useRef, type ReactNode } from 'react';
import { useModalFocusTrap } from '../Dialog.js';
import { ActionIcon } from '../ActionIcon.js';
import { IconButton } from './IconButton.js';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'start' | 'end';
  className?: string;
}

export function Drawer({ open, onClose, title, closeLabel, children, footer, side = 'end', className = '' }: DrawerProps) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  useModalFocusTrap(open, panelRef, onClose);
  if (!open) return null;
  return (
    <div className="ui-drawer-layer">
      <button type="button" className="ui-drawer-backdrop" aria-label={closeLabel} onClick={onClose} />
      <aside
        ref={panelRef}
        className={`ui-drawer ui-drawer--${side}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="ui-drawer__header">
          <h2 id={titleId} className="ui-drawer__title">{title}</h2>
          <IconButton label={closeLabel} size="sm" onClick={onClose}><ActionIcon name="close" /></IconButton>
        </header>
        <div className="ui-drawer__body">{children}</div>
        {footer != null && <footer className="ui-drawer__footer">{footer}</footer>}
      </aside>
    </div>
  );
}

