/**
 * Shared button (FE-01.1).
 *
 * Buttons were previously a mix of bare `<button>` with the global stylesheet,
 * `className="btn-secondary"`, and one-off inline styles. Three things kept
 * getting forgotten and are non-negotiable here:
 *   - `type="button"` by default, so a button inside a form does not submit it;
 *   - a busy state that disables the button, so a slow print action cannot be
 *     double-submitted into two physical copies;
 *   - `aria-busy`, so the state is not conveyed by a spinner alone.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows `busyLabel` (or the children) and blocks further clicks. */
  busy?: boolean;
  busyLabel?: string;
  className?: string;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'primary',
  size = 'md',
  busy = false,
  busyLabel,
  disabled,
  type = 'button',
  className = '',
  children,
  ...rest
}, ref) {
  const combinedClassName = `ui-button ui-button--${variant} ui-button--${size}${busy ? ' ui-button--busy' : ''}${className ? ` ${className}` : ''}`;
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={combinedClassName}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? (
        <>
          <span className="ui-button__spinner" aria-hidden="true" />
          <span>{busyLabel ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
});
