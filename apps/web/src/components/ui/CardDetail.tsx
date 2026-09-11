import type { HTMLAttributes, ReactNode } from 'react';

export interface CardDetailProps extends HTMLAttributes<HTMLDListElement> {
  columns?: 1 | 2;
}

export function CardDetail({ columns = 2, className = '', ...props }: CardDetailProps) {
  return <dl {...props} className={`ui-card-detail ui-card-detail--cols-${columns}${className ? ` ${className}` : ''}`} />;
}

export interface CardDetailItemProps {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}

export function CardDetailItem({ label, children, className = '' }: CardDetailItemProps) {
  return (
    <div className={`ui-card-detail__item${className ? ` ${className}` : ''}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
