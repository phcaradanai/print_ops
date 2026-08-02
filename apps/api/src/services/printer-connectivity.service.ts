import type {
  PrinterRepositoryPort,
  PrinterConnectivityResult,
  ConnectivityReport,
} from '@printerops/domain';
import type { AdapterRegistry } from '@printerops/adapters';
import { generateId } from '@printerops/shared';

export class PrinterConnectivityService {
  constructor(
    private printers: PrinterRepositoryPort,
    private registry: AdapterRegistry,
  ) {}

  /** Check connectivity for a single printer. */
  async checkPrinter(printerId: string): Promise<PrinterConnectivityResult> {
    const t0 = Date.now();
    const printer = await this.printers.findById(printerId);
    if (!printer) {
      return {
        printerId,
        printerCode: 'unknown',
        detected: false,
        statusCode: 'unknown',
        statusMessage: 'Printer not found in database',
        adapterUsed: 'none',
        protocol: 'none',
        connectionUri: '',
        error: 'Not found',
        errorCode: 'NOT_FOUND',
        checkTimeMs: Date.now() - t0,
        checkedAt: new Date(),
      };
    }

    const adapter = this.registry.getAdapterForPrinter(printer);
    let detected = false;
    let statusCode = 'unknown';
    let statusMessage = '';
    let tonerLevels: Record<string, number> | undefined;
    let paperLevels: Record<string, number> | undefined;
    let error: string | undefined;
    let errorCode: string | undefined;

    // Phase 1: Detect
    try {
      detected = await adapter.detect(printer.connectionUri);
      if (!detected) {
        statusCode = 'offline';
        statusMessage = 'Printer not detected on network';
      }
    } catch (err) {
      detected = false;
      statusCode = 'offline';
      error = err instanceof Error ? err.message : String(err);
      errorCode = 'DETECT_FAILED';
      statusMessage = 'Detection failed';
    }

    // Phase 2: Get detailed status (only if detected)
    if (detected) {
      try {
        const status = await adapter.getStatus(printer.connectionUri);
        statusCode = status.code;
        statusMessage = status.message ?? '';
        tonerLevels = status.tonerLevels;
        paperLevels = status.paperLevels;

        // Update printer status in repo
        await this.printers.update(printerId, { status });
      } catch (err) {
        statusCode = 'error';
        error = err instanceof Error ? err.message : String(err);
        errorCode = 'STATUS_FAILED';
        statusMessage = 'Printer detected but status query failed';
      }
    }

    const checkTimeMs = Date.now() - t0;

    return {
      printerId: printer.id,
      printerCode: printer.code,
      detected,
      statusCode,
      statusMessage,
      tonerLevels,
      paperLevels,
      adapterUsed: adapter.adapterName,
      protocol: adapter.protocol,
      connectionUri: printer.connectionUri,
      error,
      errorCode,
      checkTimeMs,
      checkedAt: new Date(),
    };
  }

  /** Check connectivity for ALL printers and return a summary report. */
  async checkAll(): Promise<ConnectivityReport> {
    const printers = await this.printers.findAll();
    const results: PrinterConnectivityResult[] = [];

    for (const printer of printers) {
      const result = await this.checkPrinter(printer.id);
      results.push(result);
    }

    return {
      reportId: generateId(),
      checkedAt: new Date(),
      total: results.length,
      online: results.filter((r) => r.detected && r.statusCode === 'online' || r.statusCode === 'idle').length,
      offline: results.filter((r) => !r.detected).length,
      error: results.filter((r) => r.error != null).length,
      results,
    };
  }
}
