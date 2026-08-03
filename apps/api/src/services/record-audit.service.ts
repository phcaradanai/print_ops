import type {
  AuditRepositoryPort,
  AuditLog,
  CreateAuditLogInput,
  EventBusPort,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class RecordAuditService {
  constructor(
    private audit: AuditRepositoryPort,
    private events: EventBusPort
  ) {}

  async execute(input: CreateAuditLogInput): Promise<AuditLog> {
    const log = await this.audit.create(input);

    this.events.publish({
      eventId: generateId(),
      eventType: 'AuditRecorded',
      traceId: input.traceId,
      correlationId: input.traceId,
      occurredAt: new Date(),
      auditLogId: log.id,
      action: input.action,
    });

    return log;
  }
}
