import type { HTMLAttributes, ReactNode } from 'react';

export type Space = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

interface LayoutProps extends HTMLAttributes<HTMLDivElement> {
  gap?: Space;
  children: ReactNode;
}

export function Stack({ gap = 'lg', className = '', children, ...props }: LayoutProps) {
  return <div {...props} className={`ui-stack ui-gap--${gap}${className ? ` ${className}` : ''}`}>{children}</div>;
}

export function Inline({ gap = 'sm', className = '', children, ...props }: LayoutProps) {
  return <div {...props} className={`ui-inline ui-gap--${gap}${className ? ` ${className}` : ''}`}>{children}</div>;
}

export interface GridProps extends LayoutProps {
  columns?: 1 | 2 | 3 | 4 | 'auto';
}

export function Grid({ columns = 2, gap = 'lg', className = '', children, ...props }: GridProps) {
  return (
    <div {...props} className={`ui-grid ui-grid--${columns} ui-gap--${gap}${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  );
}

export function Spacer({ size = 'lg' }: { size?: Space }) {
  return <span className={`ui-spacer ui-spacer--${size}`} aria-hidden="true" />;
}

export function Divider({ className = '', ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr {...props} className={`ui-divider${className ? ` ${className}` : ''}`} />;
}

