import type { ReactNode } from 'react';

export type ActionIconName = 'check' | 'close' | 'delete' | 'edit' | 'link' | 'pause' | 'play' | 'refresh' | 'search';

const paths: Record<ActionIconName, ReactNode> = {
  check: <path d="m3 8 3.25 3.25L13 4.5" />,
  close: <path d="m3.5 3.5 9 9m0-9-9 9" />,
  delete: <path d="M3 4.5h10M6 4.5v-2h4v2m2 0-.65 9H4.65L4 4.5m3 2.25v4.5m2-4.5v4.5" />,
  edit: <><path d="m3 11.5-.5 2 2-.5 7.75-7.75-1.5-1.5L3 11.5Z" /><path d="m9.75 4.75 1.5 1.5" /></>,
  link: <><path d="M6.5 9.5 9.5 6.5" /><path d="M5.5 11.5H4a3 3 0 0 1 0-6h2.5M10.5 4.5H12a3 3 0 0 1 0 6H9.5" /></>,
  pause: <><path d="M5.25 3.5v9" /><path d="M10.75 3.5v9" /></>,
  play: <path d="m5 3 7 5-7 5V3Z" />,
  refresh: <><path d="M13 5.5A5.5 5.5 0 1 0 13 10" /><path d="M13 2.5v3h-3" /></>,
  search: <><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></>,
};

export function ActionIcon({ name }: { name: ActionIconName }) {
  return (
    <svg className="action-icon" viewBox="0 0 16 16" width="16" height="16" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
