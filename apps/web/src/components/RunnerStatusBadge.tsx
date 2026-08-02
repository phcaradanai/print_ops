import { type ReactNode } from 'react';

interface RunnerStatusPresentation {
  bg: string;
  text: string;
  symbol: ReactNode;
}

const RUNNER_STATUS: Record<string, RunnerStatusPresentation> = {
  online: { bg: '#a6e3a1', text: '#1e1e2e', symbol: '●' },
  offline: { bg: '#f38ba8', text: '#1e1e2e', symbol: '●' },
  busy: { bg: '#fab387', text: '#1e1e2e', symbol: '◐' },
  draining: { bg: '#f9e2af', text: '#1e1e2e', symbol: '↓' },
};

const FALLBACK: RunnerStatusPresentation = {
  bg: '#cccccc',
  text: '#1e1e2e',
  symbol: '?',
};

/**
 * Runner lifecycle status is a different domain from print-job status.
 * Keeping a dedicated component prevents an `online` runner from being fed
 * through the print-job palette while still giving every page one accessible
 * presentation for runner health.
 */
export function RunnerStatusBadge({
  status,
  size = 'sm',
  title,
}: {
  status: string;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
}) {
  const normalized = status.trim().toLowerCase();
  const presentation = RUNNER_STATUS[normalized] ?? FALLBACK;

  return (
    <span
      className={`status-badge status-badge--${size}`}
      style={{ background: presentation.bg, color: presentation.text }}
      title={title}
      aria-label={status || 'unknown'}
    >
      <span aria-hidden="true">{presentation.symbol}</span>
      <span>{status || 'unknown'}</span>
    </span>
  );
}
