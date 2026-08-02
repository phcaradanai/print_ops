export type TransferAction = 'import' | 'export';

/**
 * Shared import/export mark.
 *
 * Import moves data down into the application tray. Export moves data up and
 * out of it. Keeping both directions in one component prevents the labels and
 * arrows from drifting apart across administrative pages.
 */
export function TransferIcon({
  action,
  className = '',
}: {
  action: TransferAction;
  className?: string;
}) {
  return (
    <svg
      className={`transfer-icon${className ? ` ${className}` : ''}`}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 11.25v1.25c0 .7.55 1.25 1.25 1.25h8.5c.7 0 1.25-.55 1.25-1.25v-1.25" />
      {action === 'import' ? (
        <path d="M8 2.25v7.5m-3-3 3 3 3-3" />
      ) : (
        <path d="M8 10V2.5m-3 3 3-3 3 3" />
      )}
    </svg>
  );
}
