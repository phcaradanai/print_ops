import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

export type CardTone = 'default' | 'subtle';
export type CardPadding = 'none' | 'md' | 'lg' | 'xl';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  tone?: CardTone;
  padding?: CardPadding;
}

export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { tone = 'default', padding = 'lg', className = '', children, ...props },
  ref
) {
  return (
    <article {...props} ref={ref} className={`ui-card ui-card--${tone} ui-card--pad-${padding}${className ? ` ${className}` : ''}`}>
      {children}
    </article>
  );
});
