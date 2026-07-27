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

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows `busyLabel` (or the children) and blocks further clicks. */
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  busy = false,
  busyLabel,
  disabled,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={`ui-button ui-button--${variant} ui-button--${size}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
