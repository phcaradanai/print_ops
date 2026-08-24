/**
 * The small, shared safety policy used before a physical printer action.
 *
 * Windows printer APIs are inconsistent across transports. In particular,
 * USB queues can be detected successfully while reporting PrinterStatus as
 * Unknown. Readiness therefore blocks only a state that Windows explicitly
 * reports as unsafe; an unknown state is usable when the queue was detected
 * and Windows does not say it is working offline.
 */

export type PrinterReadinessBlockedBy =
  | 'not-detected'
  | 'offline'
  | 'error'
  | 'paused'
  | 'status-unavailable';

export type PrinterReadinessWarning = 'unknown-status';

export interface PrinterReadinessInput {
  /** Whether the operating system detected the named printer. */
  detected?: boolean;
  /** Normalized status exposed by the adapter/API. */
  statusCode?: unknown;
  /** Raw Windows PrinterStatus value, when available. */
  rawStatus?: unknown;
  /** Raw Windows PrinterState/flags value, when available. */
  rawState?: unknown;
  /** Windows Win32_Printer.WorkOffline value, when available. */
  workOffline?: boolean | null;
}

export interface PrinterReadiness {
  ready: boolean;
  blockedBy?: PrinterReadinessBlockedBy;
  warning?: PrinterReadinessWarning;
}

const EXPLICIT_BLOCKED_STATES = new Set<PrinterReadinessBlockedBy>([
  'offline',
  'error',
  'paused',
]);

function statusText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function statusTokens(value: unknown): string[] {
  const text = statusText(value);
  return text
    ? text.split(/[,|]/).map((part) => part.trim()).filter(Boolean)
    : [];
}

function blockedStateFromToken(token: string): PrinterReadinessBlockedBy | undefined {
  if (EXPLICIT_BLOCKED_STATES.has(token as PrinterReadinessBlockedBy)) {
    return token as PrinterReadinessBlockedBy;
  }
  return undefined;
}

/**
 * Evaluate a printer using explicit Windows evidence.
 *
 * Raw status/state are retained alongside the normalized code so values such
 * as PaperOut remain distinguishable from an explicit ERROR. The print
 * executor's device and spooler verification remains responsible for physical
 * safety after this gate.
 */
export function evaluatePrinterReadiness(input: PrinterReadinessInput): PrinterReadiness {
  if (input.detected === false) return { ready: false, blockedBy: 'not-detected' };

  if (input.workOffline === true) return { ready: false, blockedBy: 'offline' };

  const hasStatusEvidence = [input.statusCode, input.rawStatus, input.rawState]
    .some((value) => statusText(value) !== '');
  if (!hasStatusEvidence && input.workOffline !== false) {
    return { ready: false, blockedBy: 'status-unavailable' };
  }

  // Every explicitly reported value is evidence. Raw Windows fields are kept
  // alongside the normalized code so values such as PaperOut do not need to
  // be guessed as ERROR by a platform adapter.
  const evidence = [input.statusCode, input.rawStatus, input.rawState].flatMap(statusTokens);

  for (const token of evidence) {
    const blockedBy = blockedStateFromToken(token);
    if (blockedBy) return { ready: false, blockedBy };
  }

  const isUnknown = [input.statusCode, input.rawStatus, input.rawState]
    .every((value) => {
      const status = statusText(value);
      return status === '' || status === 'unknown' || status === 'none';
    });

  if (isUnknown) {
    // USB drivers commonly return Unknown while WorkOffline is explicitly
    // false. That is a warning, not a refusal to send a safety-confirmed test.
    return { ready: true, warning: 'unknown-status' };
  }

  return { ready: true };
}
