export interface DomainEvent {
  eventId: string;
  eventType: string;
  traceId: string;
  correlationId: string;
  occurredAt: Date;
}

export interface PrinterRegistered extends DomainEvent {
  eventType: 'PrinterRegistered';
  printerId: string;
  printerName: string;
}

export interface JobAccepted extends DomainEvent {
  eventType: 'JobAccepted';
  jobId: string;
  printerId: string;
  requestId?: string;
  sourceSystem?: string;
  createdBy: string;
}

export interface JobCreated extends DomainEvent {
  eventType: 'JobCreated';
  jobId: string;
  printerId: string;
  createdBy: string;
}

export interface JobValidated extends DomainEvent {
  eventType: 'JobValidated';
  jobId: string;
  validationMs: number;
}

export interface JobQueued extends DomainEvent {
  eventType: 'JobQueued';
  jobId: string;
  printerId: string;
}

export interface JobDispatched extends DomainEvent {
  eventType: 'JobDispatched';
  jobId: string;
  runnerId: string;
  printerId: string;
}

export interface JobStarted extends DomainEvent {
  eventType: 'JobStarted';
  jobId: string;
  runnerId: string;
  printerId: string;
}

export interface JobPrinting extends DomainEvent {
  eventType: 'JobPrinting';
  jobId: string;
  runnerId: string;
  adapterName: string;
}

export interface JobSucceeded extends DomainEvent {
  eventType: 'JobSucceeded';
  jobId: string;
  durationMs: number;
}

export interface JobFailed extends DomainEvent {
  eventType: 'JobFailed';
  jobId: string;
  errorCode: string;
  errorMessage: string;
}

export interface JobTimedOut extends DomainEvent {
  eventType: 'JobTimedOut';
  jobId: string;
}

export interface JobCancelled extends DomainEvent {
  eventType: 'JobCancelled';
  jobId: string;
  cancelledBy: string;
}

export interface JobDuplicateReturned extends DomainEvent {
  eventType: 'JobDuplicateReturned';
  existingJobId: string;
  requestId: string;
  sourceSystem: string;
}

/**
 * Terminal print statuses — the ones from which a job never moves again, and
 * therefore the only ones that can carry a print RESULT.
 *
 * `UNVERIFIED` and `TIMEOUT` are in this list deliberately. This codebase is
 * built around "could not confirm ≠ did not print": collapsing UNVERIFIED into
 * FAILED would tell an integrator a label did not come out when a page may well
 * be sitting in the tray. `DUPLICATE_RETURNED` is NOT terminal-print — it is an
 * acceptance outcome for a request that never created a new print.
 */
export const TERMINAL_PRINT_STATUSES = [
  'SUCCESS',
  'FAILED',
  'UNVERIFIED',
  'TIMEOUT',
  'CANCELLED',
] as const;

export type TerminalPrintStatus = (typeof TERMINAL_PRINT_STATUSES)[number];

export function isTerminalPrintStatus(status: string): status is TerminalPrintStatus {
  return (TERMINAL_PRINT_STATUSES as readonly string[]).includes(status);
}

/**
 * The one canonical "the print is over, here is how it ended" event.
 *
 * Emitted exactly once per job, only after the terminal job state is durably
 * persisted, from every site that can move a job to a terminal status:
 * ExecuteJobService (in-process/desktop worker), POST /runners/:id/jobs/:id/result
 * (Go runner), and CancelJobService. `JobSucceeded` / `JobFailed` remain as-is
 * for existing subscribers; this event is what result callbacks key off, because
 * it is status-preserving (UNVERIFIED stays UNVERIFIED) and carries the
 * identifiers a callback receiver needs to correlate.
 *
 * It deliberately carries no print payload: a callback is a notification, not a
 * copy of the document.
 */
export interface PrintJobTerminal extends DomainEvent {
  eventType: 'PrintJobTerminal';
  jobId: string;
  status: TerminalPrintStatus;
  requestId?: string;
  sourceSystem?: string;
  printerCode?: string;
  printerId?: string;
  runnerId?: string;
  errorCode?: string;
  errorMessage?: string;
  finishedAt?: Date;
}

export interface RunnerRegistered extends DomainEvent {
  eventType: 'RunnerRegistered';
  runnerId: string;
  runnerName: string;
}

export interface RunnerHeartbeatReceived extends DomainEvent {
  eventType: 'RunnerHeartbeatReceived';
  runnerId: string;
}

export interface PermissionDenied extends DomainEvent {
  eventType: 'PermissionDenied';
  userId: string;
  permission: string;
  resource: string;
}

export interface AuditRecorded extends DomainEvent {
  eventType: 'AuditRecorded';
  auditLogId: string;
  action: string;
}

export interface TraceRecorded extends DomainEvent {
  eventType: 'TraceRecorded';
  traceId: string;
  jobId: string;
}

export type AnyDomainEvent =
  | PrinterRegistered
  | JobAccepted
  | JobCreated
  | JobValidated
  | JobQueued
  | JobDispatched
  | JobStarted
  | JobPrinting
  | JobSucceeded
  | JobFailed
  | JobTimedOut
  | JobCancelled
  | JobDuplicateReturned
  | PrintJobTerminal
  | RunnerRegistered
  | RunnerHeartbeatReceived
  | PermissionDenied
  | AuditRecorded
  | TraceRecorded;

export type EventHandler<T extends DomainEvent = AnyDomainEvent> = (
  event: T
) => void | Promise<void>;

export interface EventBusPort {
  publish(event: AnyDomainEvent): void | Promise<void>;
  subscribe<T extends AnyDomainEvent>(
    eventType: T['eventType'],
    handler: EventHandler<T>
  ): void;
}
