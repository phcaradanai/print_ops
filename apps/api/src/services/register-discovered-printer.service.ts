import type {
  DiscoveredPrinterRepositoryPort,
  PrinterRepositoryPort,
  AuditRepositoryPort,
  PermissionContext,
} from '@printerops/domain';
import { generateTraceId } from '@printerops/shared';
import { CheckPermissionService } from './check-permission.service.js';

export class RegisterDiscoveredPrinterService {
  constructor(
    private discoveredPrinters: DiscoveredPrinterRepositoryPort,
    private printers: PrinterRepositoryPort,
    private audit: AuditRepositoryPort,
    private checkPermission: CheckPermissionService
  ) {}

  async execute(
    discoveredPrinterId: string,
    ctx: PermissionContext,
    opts: { printerCode?: string; location?: string } = {}
  ) {
    this.checkPermission.assertCan(ctx, 'printer:create');

    const dp = await this.discoveredPrinters.findById(discoveredPrinterId);
    if (!dp) throw new Error(`DiscoveredPrinter ${discoveredPrinterId} not found`);
    if (dp.registeredPrinterId) throw new Error(`Already registered as printer ${dp.registeredPrinterId}`);

    const code =
      opts.printerCode ??
      dp.localPrinterName.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');

    const existing = await this.printers.findByCode(code);
    if (existing) throw new Error(`Printer code ${code} already in use`);

    const printer = await this.printers.create({
      code,
      name: dp.localPrinterName,
      location: opts.location,
      protocol: 'windows_spooler',
      connectionUri: `spooler://${dp.runnerId}/${encodeURIComponent(dp.localPrinterName)}`,
      metadata: {
        runnerId: dp.runnerId,
        localPrinterName: dp.localPrinterName,
        driverName: dp.driverName,
        portName: dp.portName,
        connectionType: dp.connectionType,
        registeredFromDiscoveryId: dp.id,
      },
    });

    await this.discoveredPrinters.update(discoveredPrinterId, { registeredPrinterId: printer.id });

    const traceId = generateTraceId();
    await this.audit.create({
      traceId,
      action: 'printer.registered_from_discovery',
      actorId: ctx.userId,
      resourceType: 'printer',
      resourceId: printer.id,
      metadata: { discoveredPrinterId, printerCode: code, runnerId: dp.runnerId },
    });

    return printer;
  }
}
