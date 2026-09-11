import type { ElementType, HTMLAttributes, ReactNode } from 'react';

export type Space = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

export type Align = 'stretch' | 'start' | 'center' | 'end';

interface LayoutProps extends HTMLAttributes<HTMLDivElement> {
  /** Render as a different element when the layout is also the semantic owner
   *  — most often `form`, so a row of controls does not need a wrapper div. */
  as?: ElementType;
  gap?: Space;
  children: ReactNode;
}

export interface StackProps extends LayoutProps {
  /**
   * Cross-axis alignment. `stretch` is the default and makes children fill the
   * width — which is right for panels and fields, and wrong for a column of
   * buttons, where it stretches each one to the widest label.
   */
  align?: Align;
}

export function Stack({ as: Component = 'div', gap = 'lg', align = 'stretch', className = '', children, ...props }: StackProps) {
  return (
    <Component {...props} className={`ui-stack ui-gap--${gap} ui-align--${align}${className ? ` ${className}` : ''}`}>
      {children}
    </Component>
  );
}

export function Inline({ as: Component = 'div', gap = 'sm', className = '', children, ...props }: LayoutProps) {
  return <Component {...props} className={`ui-inline ui-gap--${gap}${className ? ` ${className}` : ''}`}>{children}</Component>;
}

export interface GridProps extends LayoutProps {
  columns?: 1 | 2 | 3 | 4 | 'auto';
  /**
   * Narrower auto tracks, for grids of short values such as a checkbox list of
   * route paths. Only meaningful with `columns="auto"`.
   */
  dense?: boolean;
}

export function Grid({ as: Component = 'div', columns = 2, gap = 'lg', dense = false, className = '', children, ...props }: GridProps) {
  return (
    <Component
      {...props}
      className={`ui-grid ui-grid--${columns}${dense ? ' ui-grid--dense' : ''} ui-gap--${gap}${className ? ` ${className}` : ''}`}
    >
      {children}
    </Component>
  );
}

export function Spacer({ size = 'lg' }: { size?: Space }) {
  return <span className={`ui-spacer ui-spacer--${size}`} aria-hidden="true" />;
}

export function Divider({ className = '', ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr {...props} className={`ui-divider${className ? ` ${className}` : ''}`} />;
}

