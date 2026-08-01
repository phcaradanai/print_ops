import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  children: ReactNode;
  variant?: 'neutral' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
}

export function IconButton({
  label,
  children,
  variant = 'neutral',
  size = 'md',
  busy = false,
  disabled,
  className = '',
  title,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`ui-icon-button ui-icon-button--${variant} ui-icon-button--${size}${busy ? ' ui-icon-button--busy' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      aria-busy={busy || undefined}
      title={title ?? label}
      disabled={disabled || busy}
    >
      {busy ? <span className="ui-button__spinner" aria-hidden="true" /> : children}
    </button>
  );
}


