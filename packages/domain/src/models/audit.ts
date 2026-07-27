export type AuditAction =
  | 'printer.created'
  | 'printer.updated'
  | 'printer.deleted'
  | 'printer.test_print'
  | 'job.created'
  | 'job.accepted'
  | 'job.validated'
  | 'job.queued'
  | 'job.dispatched'
  | 'job.started'
  | 'job.printing'
  | 'job.succeeded'
  | 'job.failed'
  | 'job.cancelled'
  | 'job.retried'
  | 'job.reprint_confirmed'
  | 'runner.registered'
  | 'runner.reconnected'
  | 'runner.heartbeat'
  | 'runner.offline'
  | 'user.login'
  | 'user.created'
  | 'user.updated'
  | 'permission.denied'
  | 'printer.registered_from_discovery'
  | 'template.created'
  | 'template.auto_created'
  | 'template.updated'
  | 'template.published'
  | 'template.deleted'
  | 'template.test_print.requested'
  | 'paper_profile.created'
  | 'paper_profile.updated'
  | 'paper_profile.deleted'
  | 'paper_profile.exported'
  | 'paper_profile.imported'
  | 'paper_profile.artwork_imported'
  | 'webhook_endpoint.created'
  | 'webhook_endpoint.updated'
  | 'webhook_endpoint.tested'
  | 'webhook_endpoint.deleted'
  | 'webhook_policy.created'
  | 'webhook_policy.updated'
  | 'webhook.intake.accepted'
  | 'sandbox.test_print'
  | 'sandbox.run'
  | 'sandbox.batch_run'
  | 'connectivity.check'
  | 'connectivity.report';

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
