import type {
  PrinterRepositoryPort,
  EventBusPort,
  AuditRepositoryPort,
  CreatePrinterInput,
  Printer,
} from '@printerops/domain';
import { generateId, generateTraceId, generateCorrelationId } from '@printerops/shared';

export class CreatePrinterService {
  constructor(
    private printers: PrinterRepositoryPort,
    private events: EventBusPort,
    private audit: AuditRepositoryPort
  ) {}

  async execute(input: CreatePrinterInput, actorId: string): Promise<Printer> {
    const printer = await this.printers.create(input);
    const traceId = generateTraceId();

    await this.audit.create({
      traceId,
      action: 'printer.created',
      actorId,
      resourceType: 'printer',
      resourceId: printer.id,
      after: printer as unknown as Record<string, unknown>,
      metadata: {},
    });

    this.events.publish({
      eventId: generateId(),
      eventType: 'PrinterRegistered',
      traceId,
      correlationId: generateCorrelationId(),
      occurredAt: new Date(),
      printerId: printer.id,
      printerName: printer.name,
    });

    return printer;
  }
}
