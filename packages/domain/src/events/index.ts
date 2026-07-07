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
