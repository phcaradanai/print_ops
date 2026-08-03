import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  children: ReactNode;
  variant?: 'neutral' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
  /** Toggle state. Reflected as `aria-pressed`, never carried by colour alone. */
  pressed?: boolean;
  /**
   * Why this control is unavailable. Supplying it keeps the button focusable
   * and blocks activation via `aria-disabled` instead of `disabled`, so the
   * reason stays reachable by keyboard — a bare disabled control tells an
   * operator nothing about what to do next.
   */
  disabledReason?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  label,
  children,
  variant = 'neutral',
  size = 'md',
  busy = false,
  pressed,
  disabled,
  disabledReason,
  className = '',
  title,
  type = 'button',
  onClick,
  onKeyDown,
  ...props
}, ref) {
  const blocked = Boolean(disabled) && !busy;
  // With a reason to convey, stay in the tab order and refuse the action.
  const softDisabled = blocked && Boolean(disabledReason);
  const accessibleName = softDisabled ? `${label}: ${disabledReason}` : label;

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={`ui-icon-button ui-icon-button--${variant} ui-icon-button--${size}${busy ? ' ui-icon-button--busy' : ''}${className ? ` ${className}` : ''}`}
      aria-label={accessibleName}
      aria-busy={busy || undefined}
      aria-pressed={pressed}
      aria-disabled={softDisabled || undefined}
      title={title ?? (blocked && disabledReason ? disabledReason : label)}
      disabled={softDisabled ? undefined : disabled || busy}
      onClick={(event) => {
        if (softDisabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      onKeyDown={(event) => {
        if (softDisabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          return;
        }
        onKeyDown?.(event);
      }}
    >
      {busy ? <span className="ui-button__spinner" aria-hidden="true" /> : children}
    </button>
  );
});


