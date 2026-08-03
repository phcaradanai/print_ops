import type {
  PrinterRepositoryPort,
  PrinterStatus,
} from '@printerops/domain';
import type { AdapterRegistry } from '@printerops/adapters';
import { NotFoundError } from '@printerops/shared';

export class GetPrinterStatusService {
  constructor(
    private printers: PrinterRepositoryPort,
    private registry: AdapterRegistry
  ) {}

  async execute(printerId: string): Promise<PrinterStatus> {
    const printer = await this.printers.findById(printerId);
    if (!printer) throw new NotFoundError('Printer', printerId);

    const adapter = this.registry.getAdapterForPrinter(printer);
    const status = await adapter.getStatus(printer.connectionUri);

    await this.printers.update(printerId, { status });
    return status;
  }
}
