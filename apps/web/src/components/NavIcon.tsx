import type { ReactNode } from 'react';

/**
 * Navigation icon set.
 *
 * These replace the emoji that previously stood in for icons. Emoji render as
 * whatever glyph the host platform ships — a different weight, colour and
 * optical size on every machine — which is exactly what an operator scanning
 * the same rail on a Windows print station and a macOS admin laptop should not
 * get. These are authored instead, so the whole set shares one geometry.
 *
 * Every icon is drawn on a 16x16 grid at stroke-width 1.5 and rendered at 16px,
 * giving a 1.5px stroke that matches the disclosure caret in `AppNav`. Shapes
 * stay inside a 1px margin so nothing clips against the row.
 */
const ICON_PATHS: Record<string, ReactNode> = {
  // Dashboard — panel grid, not a house: this is a control surface.
  '/': (
    <>
      <rect x="2.25" y="2.25" width="5" height="5" rx="1" />
      <rect x="8.75" y="2.25" width="5" height="5" rx="1" />
      <rect x="2.25" y="8.75" width="5" height="5" rx="1" />
      <rect x="8.75" y="8.75" width="5" height="5" rx="1" />
    </>
  ),

  // Printers — lid, body, output tray.
  '/printers': (
    <>
      <path d="M4.5 6.5v-4h7v4" />
      <path d="M4.5 12H3A1.5 1.5 0 0 1 1.5 10.5V8A1.5 1.5 0 0 1 3 6.5h10A1.5 1.5 0 0 1 14.5 8v2.5A1.5 1.5 0 0 1 13 12h-1.5" />
      <rect x="4.5" y="9.75" width="7" height="3.75" rx="0.75" />
    </>
  ),

  // Job Queue — ordered rows, each with its position marker.
  '/jobs': <path d="M2.25 4h1.5M2.25 8h1.5M2.25 12h1.5M6.75 4h7M6.75 8h7M6.75 12h7" />,

  // Runners — the local agent process doing the work.
  '/runners': <path d="M9.5 1.75 3.5 9.25h3.75L6.5 14.25 12.5 6.75H8.75l.75-5Z" />,

  // Templates — a document with a folded corner.
  '/templates': (
    <>
      <path d="M9.5 1.75H4.5A1.5 1.5 0 0 0 3 3.25v9.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.25L9.5 1.75Z" />
      <path d="M9.5 1.75v3.5H13" />
      <path d="M5.5 8.75h5M5.5 11.25h3.5" />
    </>
  ),

  // Paper Profiles — a sheet with measurement ticks on two edges.
  '/paper-profiles': (
    <>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1.5" />
      <path d="M2.25 6h2.25M2.25 10h2.25M6 2.25v2.25M10 2.25v2.25" />
    </>
  ),

  // Printer Discovery — search the network.
  '/discovered-printers': (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14.25 14.25" />
    </>
  ),

  // Local Diagnostics — a live signal trace.
  '/diagnostics': <path d="M1.5 8h3l2-4.75L9.5 12.25l2-4.25h3" />,

  // Template Sandbox — try it before it reaches paper.
  '/template-sandbox': (
    <>
      <path d="M6.5 1.75V6L2.9 12a1.5 1.5 0 0 0 1.3 2.25h7.6A1.5 1.5 0 0 0 13.1 12L9.5 6V1.75" />
      <path d="M5.5 1.75h5" />
      <path d="M4.6 9.5h6.8" />
    </>
  ),

  // Webhooks — two halves of a link.
  '/webhooks': (
    <>
      <path d="M6.6 9.4a2.75 2.75 0 0 0 4.15.3l1.75-1.75a2.75 2.75 0 0 0-3.9-3.9l-1 1" />
      <path d="M9.4 6.6a2.75 2.75 0 0 0-4.15-.3L3.5 8.05a2.75 2.75 0 0 0 3.9 3.9l1-1" />
    </>
  ),

  // Route Policies — one job, a decision, two destinations.
  '/route-policies': (
    <>
      <path d="M8 14.25V9l-3.9-3.4M8 9l3.9-3.4" />
      <circle cx="3.25" cy="4.25" r="1.5" />
      <circle cx="12.75" cy="4.25" r="1.5" />
    </>
  ),

  // Printer Bindings — this template bound to that printer.
  '/printer-bindings': (
    <>
      <rect x="1.5" y="5.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="5.5" width="5" height="5" rx="1" />
      <path d="M6.5 8h3" />
    </>
  ),

  // Print Flow — the intake loop.
  '/print-flow': (
    <>
      <path d="M2.5 6.75A5.75 5.75 0 0 1 12.75 5.5" />
      <path d="M13.5 9.25A5.75 5.75 0 0 1 3.25 10.5" />
      <path d="M10.5 5.5h2.5V3" />
      <path d="M5.5 10.5H3V13" />
    </>
  ),

  // Audit Logs — the record, and that it was checked.
  '/audit-logs': (
    <>
      <path d="M9.5 1.75H4.5A1.5 1.5 0 0 0 3 3.25v9.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.25L9.5 1.75Z" />
      <path d="M9.5 1.75v3.5H13" />
      <path d="m5.75 10.25 1.5 1.5 3-3" />
    </>
  ),

  // Users & Roles — more than one person, different standing.
  '/users': (
    <>
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M1.75 13.75a4.25 4.25 0 0 1 8.5 0" />
      <path d="M10.75 3.4a2.5 2.5 0 0 1 0 4.2" />
      <path d="M11.75 9.9a4.25 4.25 0 0 1 2.5 3.85" />
    </>
  ),

  // Export Center — data leaving the system.
  '/export': (
    <>
      <path d="M8 10V2.25" />
      <path d="m5 5.25 3-3 3 3" />
      <path d="M2.5 10.5v2A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </>
  ),

  // Settings — sliders read better than a gear at 16px.
  '/settings': (
    <>
      <path d="M2.25 4.5h2.25M7.5 4.5h6.25" />
      <circle cx="6" cy="4.5" r="1.5" />
      <path d="M2.25 8h6.75M12 8h1.75" />
      <circle cx="10.5" cy="8" r="1.5" />
      <path d="M2.25 11.5h1.25M6.5 11.5h7.25" />
      <circle cx="5" cy="11.5" r="1.5" />
    </>
  ),
};

/** Decorative by contract: the adjacent label carries the meaning. */
export function NavIcon({ route }: { route: string }) {
  const path = ICON_PATHS[route];
  if (!path) return <span className="nav-link-icon" aria-hidden="true" />;
  return (
    <svg
      className="nav-link-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {path}
    </svg>
  );
}
