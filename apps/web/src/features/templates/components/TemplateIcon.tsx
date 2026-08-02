import { type TemplateIconName } from '../hooks/helpers.js';

export function TemplateIcon({ name, spin = false }: { name: TemplateIconName; spin?: boolean }) {
  const path = {
    back: <path d="m10.5 3.5-4.5 4.5 4.5 4.5M6 8h8" />,
    barcode: <path d="M2 3v10M4.5 3v10M7.5 3v10M9.5 3v10M13 3v10" />,
    braces: <path d="M6 2.5H5A1.5 1.5 0 0 0 3.5 4v2.25C3.5 7.3 3 8 2 8c1 0 1.5.7 1.5 1.75V12A1.5 1.5 0 0 0 5 13.5h1m4-11h1A1.5 1.5 0 0 1 12.5 4v2.25C12.5 7.3 13 8 14 8c-1 0-1.5.7-1.5 1.75V12a1.5 1.5 0 0 1-1.5 1.5h-1" />,
    check: <path d="m3.25 8.25 3 3 6.5-6.5" />,
    close: <path d="m3.5 3.5 9 9m0-9-9 9" />,
    code: <path d="m5.75 3.5-4 4.5 4 4.5m4.5-9 4 4.5-4 4.5M9.5 2l-3 12" />,
    delete: <path d="M3.5 5h9M6 5V3.25h4V5m1.5 0-.5 8H5L4.5 5M6.75 7.5v3.25m2.5-3.25v3.25" />,
    duplicate: <><rect x="5" y="5" width="8" height="8" rx="1.25" /><path d="M3 10.5H2.75A1.75 1.75 0 0 1 1 8.75v-6A1.75 1.75 0 0 1 2.75 1h6A1.75 1.75 0 0 1 10.5 2.75V3" /></>,
    edit: <path d="m3 11.75.5-3 7.75-7.25 3.25 3.25-7.25 7.75-3 .5Zm6.75-8.75 3.25 3.25" />,
    expand: <path d="M6 2H2v4m0-4 4.5 4.5M10 14h4v-4m0 4-4.5-4.5" />,
    label: <><path d="M2.5 4.5v7h7l4-3.5-4-3.5h-7Z" /><circle cx="5.25" cy="8" r=".7" fill="currentColor" stroke="none" /></>,
    more: <><circle cx="3" cy="8" r=".75" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r=".75" fill="currentColor" stroke="none" /><circle cx="13" cy="8" r=".75" fill="currentColor" stroke="none" /></>,
    next: <path d="m6 3.5 4.5 4.5L6 12.5" />,
    pdf: <><path d="M9.5 1.75H4.5A1.5 1.5 0 0 0 3 3.25v9.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.25Z" /><path d="M9.5 1.75v3.5H13M5.25 9h5.5M5.25 11.5h3.5" /></>,
    plus: <path d="M8 2.5v11M2.5 8h11" />,
    preview: <><path d="M1.5 8s2.25-4 6.5-4 6.5 4 6.5 4-2.25 4-6.5 4-6.5-4-6.5-4Z" /><circle cx="8" cy="8" r="2" /></>,
    printer: <><path d="M4.5 5V2.5h7V5M4 11H2.75A1.25 1.25 0 0 1 1.5 9.75V6.5A1.5 1.5 0 0 1 3 5h10a1.5 1.5 0 0 1 1.5 1.5v3.25A1.25 1.25 0 0 1 13.25 11H12" /><path d="M4 9h8v4.5H4Z" /></>,
    qrcode: <><rect x="2" y="2" width="4" height="4" /><rect x="10" y="2" width="4" height="4" /><rect x="2" y="10" width="4" height="4" /><path d="M10 10h2v2h2v2h-4v-4Z" /></>,
    refresh: <path d="M13 5.25A5.5 5.5 0 1 0 13.5 10M13 2.5v2.75h-2.75" />,
    save: <><path d="M2.5 2.5h9l2 2v9h-11Z" /><path d="M5 2.5v4h5v-4M5 13.5V9h6v4.5" /></>,
    search: <><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></>,
    sortAsc: <path d="M8 13V3m-3 3 3-3 3 3" />,
    sortDesc: <path d="M8 3v10m-3-3 3 3 3-3" />,
    terminal: <><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" /><path d="m4.25 6 2 2-2 2M8.25 10h3" /></>,
    text: <path d="M2.5 3h11M2.5 6.5h11M2.5 10h8M2.5 13h5" />,
  }[name];

  return (
    <svg className={`tpl-action-icon${spin ? ' tpl-action-icon--spin' : ''}`} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}
