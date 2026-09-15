import type { SVGProps } from 'react';

export type PaperProfileIconName =
  | 'align-horizontal'
  | 'align-vertical'
  | 'arrow-left'
  | 'chevron'
  | 'close'
  | 'dimensions'
  | 'edit'
  | 'expand'
  | 'fields'
  | 'grid'
  | 'guides'
  | 'horizontal-grid'
  | 'info'
  | 'library'
  | 'margins'
  | 'minus'
  | 'palette'
  | 'plus'
  | 'presets'
  | 'profile'
  | 'ruler'
  | 'save'
  | 'search'
  | 'spinner'
  | 'trash'
  | 'vertical-grid'
  | 'warning';

export function PaperProfileIcon({
  name,
  className,
  ...props
}: { name: PaperProfileIconName } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  const path = {
    'align-horizontal': <><path d="M10 3v14" /><path d="m7 7-3 3 3 3M13 7l3 3-3 3" /></>,
    'align-vertical': <><path d="M3 10h14" /><path d="m7 7 3-3 3 3M7 13l3 3 3-3" /></>,
    'arrow-left': <><path d="M17 10H4" /><path d="m9 5-5 5 5 5" /></>,
    chevron: <path d="m7.5 4.5 5.5 5.5-5.5 5.5" />,
    close: <path d="m5 5 10 10M15 5 5 15" />,
    dimensions: <><path d="M3 10h14" /><path d="m6 7-3 3 3 3M14 7l3 3-3 3" /></>,
    edit: <><path d="m4 13.5-.5 3 3-.5L16 6.5 13.5 4 4 13.5Z" /><path d="m11.75 5.75 2.5 2.5" /></>,
    expand: <><path d="M8 3H3v5M3 3l5.5 5.5M12 17h5v-5m0 5-5.5-5.5" /></>,
    fields: <><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M6 8h8M6 12h5" /></>,
    grid: <><rect x="3" y="3" width="14" height="14" rx="1.5" /><path d="M8 3v14M13 3v14M3 8h14M3 13h14" /></>,
    guides: <><circle cx="10" cy="10" r="3" /><path d="M10 2v4M10 14v4M2 10h4M14 10h4" /></>,
    'horizontal-grid': <><rect x="3" y="3" width="14" height="14" rx="1.5" /><path d="M3 8h14M3 13h14" /></>,
    info: <><circle cx="10" cy="10" r="7" /><path d="M10 9v5" /><path d="M10 6.25h.01" /></>,
    library: <><path d="M3 4.5h14v12H3z" /><path d="M3 8h14M7 8v8" /></>,
    margins: <><path d="M7 3H3v4M13 3h4v4M7 17H3v-4M13 17h4v-4" /><rect x="6.5" y="6.5" width="7" height="7" rx=".75" /></>,
    minus: <path d="M4 10h12" />,
    palette: <><path d="M10 3a7 7 0 1 0 0 14h1.25a1.75 1.75 0 0 0 0-3.5H10a1.5 1.5 0 0 1 0-3h2.5A4.5 4.5 0 0 0 17 6c0-2-3.1-3-7-3Z" /><path d="M6.5 7h.01M9 5.5h.01M5.5 10h.01" /></>,
    plus: <path d="M10 4v12M4 10h12" />,
    presets: <><rect x="4" y="4" width="12" height="13" rx="1.5" /><path d="M7 4V2.75h6V4M7 8h6M7 11h6M7 14h4" /></>,
    profile: <><path d="M5 2.75h6l4 4V17H5V2.75Z" /><path d="M11 2.75V7h4M7.5 10h5M7.5 13h5" /></>,
    ruler: <><path d="m4 15.5 11.5-11.5 2.5 2.5L6.5 18 4 15.5Z" /><path d="m8 13-1.5-1.5M10.5 10.5 9 9M13 8l-1.5-1.5" /></>,
    save: <><path d="M4 3h10l3 3v11H3V4a1 1 0 0 1 1-1Z" /><path d="M6 3v5h7V3M6.5 17v-5h7v5" /></>,
    search: <><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></>,
    spinner: <><circle cx="10" cy="10" r="7" opacity=".3" /><path d="M10 3a7 7 0 0 1 7 7" /></>,
    trash: <><path d="M4 6h12M8 6V4h4v2M6 6l.75 11h6.5L14 6M8.5 9v5M11.5 9v5" /></>,
    'vertical-grid': <><rect x="3" y="3" width="14" height="14" rx="1.5" /><path d="M8 3v14M13 3v14" /></>,
    warning: <><path d="M10 3 18 17H2L10 3Z" /><path d="M10 8v4M10 14.5h.01" /></>,
  }[name];

  return (
    <svg
      aria-hidden="true"
      className={`pp-icon${className ? ` ${className}` : ''}`}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 20 20"
      {...props}
    >
      {path}
    </svg>
  );
}
