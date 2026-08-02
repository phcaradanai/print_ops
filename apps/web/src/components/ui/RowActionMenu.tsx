import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton.js';
import './RowActionMenu.css';

export interface RowActionMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export function computeRowActionMenuPosition(
  trigger: Rect,
  menu: Pick<Rect, 'width' | 'height'>,
  viewportWidth: number,
  viewportHeight: number,
  gap = 4,
  edge = 8,
) {
  const left = Math.min(
    Math.max(edge, viewportWidth - menu.width - edge),
    Math.max(edge, trigger.right - menu.width),
  );
  const below = trigger.bottom + gap;
  const above = trigger.top - menu.height - gap;
  const top = below + menu.height <= viewportHeight - edge
    ? below
    : Math.max(edge, above);
  return { top, left };
}

export function RowActionMenu({
  label,
  items,
}: {
  label: string;
  items: RowActionMenuItem[];
}) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setPosition(null);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    triggerRef.current = event.currentTarget;
    if (open) {
      close(true);
      return;
    }
    setPosition(null);
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    setPosition(computeRowActionMenuPosition(
      trigger.getBoundingClientRect(),
      menu.getBoundingClientRect(),
      window.innerWidth,
      window.innerHeight,
    ));
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onViewportChange = () => close(false);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      setPosition(null);
      return;
    }
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'),
    );
    if (controls.length === 0) return;
    const currentIndex = controls.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = controls.length - 1;
    if (event.key === 'ArrowDown') nextIndex = (Math.max(0, currentIndex) + 1) % controls.length;
    if (event.key === 'ArrowUp') nextIndex = (currentIndex <= 0 ? controls.length : currentIndex) - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    controls[nextIndex]?.focus();
  };

  return (
    <span className="ui-row-action-menu">
      <IconButton
        size="sm"
        label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
      >
        <span className="ui-row-action-menu__dots" aria-hidden="true">•••</span>
      </IconButton>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="ui-row-action-menu__popover"
          onKeyDown={onMenuKeyDown}
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            visibility: position ? 'visible' : 'hidden',
          }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={item.danger
                ? 'ui-row-action-menu__item ui-row-action-menu__item--danger'
                : 'ui-row-action-menu__item'}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}
