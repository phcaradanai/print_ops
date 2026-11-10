/**
 * Shared health bucketing for runner and printer lists (unified redesign).
 *
 * The dashboard attention strip, the printers table and the runner tables must
 * all agree on what counts as "needs attention", otherwise the strip and the
 * per-page filters would disagree about the same machine. An unknown or
 * missing condition is never healthy — `statusTone()` documents that rule;
 * this module enforces it for lists.
 */
import { statusTone } from '../components/ui/status.js';

/** Runner lifecycles that mean the runner is reachable and can take work. */
const RUNNER_IS_HEALTHY: Record<string, boolean> = {
  online: true,
  busy: true,
  draining: true,
};

export type RunnerHealth = 'healthy' | 'attention';

/**
 * Runner heartbeat bucket. `busy` and `draining` are working states, not
 * problems; `offline`, unknown values and a missing status all need eyes.
 */
export function runnerHealth(status: string | null | undefined): RunnerHealth {
  if (!status) return 'attention';
  return RUNNER_IS_HEALTHY[status.trim().toLowerCase()] === true ? 'healthy' : 'attention';
}

export type PrinterHealth = 'ready' | 'attention';

/**
 * Printer bucket: enabled with a known-good (ok/busy) condition is ready.
 * A disabled printer, a down condition, and a condition this build cannot
 * interpret (incl. no status ever reported) need attention — never painted
 * healthy on a guess.
 */
export function printerHealth(
  isActive: boolean | undefined,
  statusCode: string | null | undefined,
): PrinterHealth {
  if (!isActive) return 'attention';
  const tone = statusTone(statusCode);
  return tone === 'down' || tone === 'unknown' ? 'attention' : 'ready';
}

const CONNECTION_LABEL: Record<string, string> = {
  usb: 'USB',
  tcp_ip: 'TCP/IP',
  wsd: 'WSD',
  lpt_com: 'LPT/COM',
  network_share: 'Network share',
  unknown: 'Unknown',
};

/**
 * Human label for a Windows discovery connection type. An unrecognised value
 * is shown verbatim rather than lying "Unknown" — the raw value still tells
 * whoever reads it what the agent actually reported.
 */
export function connectionTypeLabel(connectionType: string | null | undefined): string {
  if (!connectionType) return CONNECTION_LABEL.unknown;
  return CONNECTION_LABEL[connectionType.toLowerCase()] ?? connectionType;
}