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
import { IconButton } from '../../../components/ui/index.js';

interface MenuRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface TemplateRowMenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  danger?: boolean;
  restoreFocus?: boolean;
  onSelect: () => void;
}

export function computeTemplateMenuPosition(
  trigger: MenuRect,
  menu: Pick<MenuRect, 'width' | 'height'>,
  viewportWidth: number,
  viewportHeight: number,
  gap = 4,
  edge = 8,
) {
  const maxLeft = Math.max(edge, viewportWidth - menu.width - edge);
  const left = Math.min(maxLeft, Math.max(edge, trigger.right - menu.width));
  const below = trigger.bottom + gap;
  const above = trigger.top - menu.height - gap;
  const top = below + menu.height <= viewportHeight - edge
    ? below
    : Math.max(edge, above);
  return { top, left };
}

export function nextTemplateMenuIndex(
  currentIndex: number,
  key: string,
  itemCount: number,
): number | null {
  if (itemCount <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  if (key === 'ArrowDown') return (Math.max(0, currentIndex) + 1) % itemCount;
  if (key === 'ArrowUp') return (currentIndex <= 0 ? itemCount : currentIndex) - 1;
  return null;
}

export function TemplateRowMenu({
  label,
  icon,
  items,
}: {
  label: string;
  icon: ReactNode;
  items: TemplateRowMenuItem[];
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
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    setPosition(computeTemplateMenuPosition(
      triggerRect,
      menuRect,
      window.innerWidth,
      window.innerHeight,
    ));
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
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
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      setPosition(null);
      return;
    }
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    const currentIndex = controls.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = nextTemplateMenuIndex(currentIndex, event.key, controls.length);
    if (nextIndex == null) return;
    event.preventDefault();
    controls[nextIndex]?.focus();
  };

  return (
    <span className="tpl-menu-wrap">
      <IconButton
        size="sm"
        label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
      >
        {icon}
      </IconButton>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="tpl-row-menu-popover"
          role="menu"
          aria-label={label}
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
              className={item.danger ? 'tpl-row-menu-popover__item tpl-row-menu-popover__item--danger' : 'tpl-row-menu-popover__item'}
              onClick={() => {
                setOpen(false);
                setPosition(null);
                item.onSelect();
                if (item.restoreFocus !== false) requestAnimationFrame(() => triggerRef.current?.focus());
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
