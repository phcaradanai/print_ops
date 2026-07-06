export type AuditAction =
  | 'printer.created'
  | 'printer.updated'
  | 'printer.deleted'
  | 'printer.test_print'
  | 'job.created'
  | 'job.queued'
  | 'job.started'
  | 'job.succeeded'
  | 'job.failed'
  | 'job.cancelled'
  | 'job.retried'
  | 'runner.registered'
  | 'runner.heartbeat'
  | 'runner.offline'
  | 'user.login'
  | 'user.created'
  | 'user.updated'
  | 'permission.denied';

export interface AuditLog {
  id: string;
  traceId: string;
  action: AuditAction;
  actorId?: string;
  actorEmail?: string;
  resourceType: string;
  resourceId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}

export type CreateAuditLogInput = Omit<AuditLog, 'id' | 'occurredAt'>;
