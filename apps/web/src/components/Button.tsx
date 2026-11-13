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
 *
 * An `onClick` that returns a Promise turns the button busy automatically
 * until that Promise settles, so every async action across the app and Web
 * Control gets a spinner and double-click protection without each page
 * threading its own `saving` flag. An explicit `busy` prop still wins.
 */

import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

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
  onClick,
  ...rest
}, ref) {
  const [autoBusy, setAutoBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleClick = onClick
    ? (event: MouseEvent<HTMLButtonElement>) => {
        const result: unknown = onClick(event);
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          setAutoBusy(true);
          const settle = () => {
            if (mounted.current) setAutoBusy(false);
          };
          (result as PromiseLike<unknown>).then(settle, settle);
        }
      }
    : undefined;

  busy = busy || autoBusy;
  const combinedClassName = `ui-button ui-button--${variant} ui-button--${size}${busy ? ' ui-button--busy' : ''}${className ? ` ${className}` : ''}`;
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      onClick={handleClick}
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
