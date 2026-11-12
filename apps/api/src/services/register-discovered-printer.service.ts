import type {
  DiscoveredPrinterRepositoryPort,
  PrinterRepositoryPort,
  AuditRepositoryPort,
  PermissionContext,
} from '@printerops/domain';
import { generateTraceId, ValidationError } from '@printerops/shared';
import { isIPv4 } from 'node:net';
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

    const network = dp.attributes['discoverySource'] === 'network_scan';
    const address = dp.attributes['networkAddress'];
    if (network && (typeof address !== 'string' || !isIPv4(address) || dp.attributes['networkPort'] !== 9100)) {
      throw new ValidationError('Invalid network printer endpoint; run network search again');
    }

    const code =
      opts.printerCode ??
      (network
        ? `TCP_${(address as string).replace(/\./g, '_')}_9100_${dp.id.replace(/-/g, '').toUpperCase()}`
        : ((dp.localPrinterName.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')) ||
          `PRINTER_${discoveredPrinterId.slice(0, 8).toUpperCase()}`));

    const existing = await this.printers.findByCode(code);
    if (existing) throw new Error(`Printer code ${code} already in use`);

    const printer = await this.printers.create({
      code,
      name: dp.localPrinterName,
      location: opts.location,
      protocol: network ? 'raw_tcp_9100' : 'windows_spooler',
      connectionUri: network ? `tcp://${address}:9100` : `spooler://${dp.runnerId}/${encodeURIComponent(dp.localPrinterName)}`,
      metadata: {
        runnerId: dp.runnerId,
        localPrinterName: dp.localPrinterName,
        driverName: dp.driverName,
        portName: dp.portName,
        connectionType: dp.connectionType,
        discoveryAttributes: dp.attributes,
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
