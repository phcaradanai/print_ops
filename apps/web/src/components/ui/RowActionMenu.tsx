import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { useRef, type ReactNode } from 'react';
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

/**
 * @deprecated Radix now owns runtime placement for RowActionMenu. This pure
 * helper remains exported temporarily for compatibility with existing tests
 * and external imports and can be removed after repository-wide usage is zero.
 */
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
  // Selection frequently opens a PrintOps dialog. Prevent menu focus return
  // from stealing focus from the newly opened workflow. Escape still restores
  // focus to the trigger through the Radix default.
  const suppressCloseAutoFocusRef = useRef(false);

  return (
    <DropdownMenuPrimitive.Root
      modal={false}
      onOpenChange={(open) => {
        if (open) suppressCloseAutoFocusRef.current = false;
      }}
    >
      <span className="ui-row-action-menu">
        <DropdownMenuPrimitive.Trigger asChild>
          <IconButton
            size="sm"
            label={label}
            title={label}
          >
            <span className="ui-row-action-menu__dots" aria-hidden="true">•••</span>
          </IconButton>
        </DropdownMenuPrimitive.Trigger>
      </span>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          className="ui-row-action-menu__popover"
          aria-label={label}
          align="end"
          side="bottom"
          sideOffset={4}
          collisionPadding={8}
          loop
          onPointerDownOutside={() => {
            suppressCloseAutoFocusRef.current = true;
          }}
          onCloseAutoFocus={(event) => {
            if (!suppressCloseAutoFocusRef.current) return;
            event.preventDefault();
            suppressCloseAutoFocusRef.current = false;
          }}
        >
          {items.map((item) => (
            <DropdownMenuPrimitive.Item
              key={item.id}
              disabled={item.disabled}
              className={item.danger
                ? 'ui-row-action-menu__item ui-row-action-menu__item--danger'
                : 'ui-row-action-menu__item'}
              onSelect={() => {
                suppressCloseAutoFocusRef.current = true;
                item.onSelect();
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </DropdownMenuPrimitive.Item>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
