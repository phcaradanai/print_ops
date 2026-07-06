import type {
  PrinterAdapterPort,
  PrinterAdapterResult,
  QueueEntry,
  PrinterCapability,
  PrinterStatus,
  PrintCommand,
} from '@printerops/domain';

export class SnmpPrinterStatusAdapter implements PrinterAdapterPort {
  readonly protocol = 'snmp';
  readonly adapterName = 'SnmpPrinterStatusAdapter';

  async detect(_uri: string): Promise<boolean> {
    throw new Error('SnmpPrinterStatusAdapter: not yet implemented');
  }
  async getStatus(_uri: string): Promise<PrinterStatus> {
    throw new Error('SnmpPrinterStatusAdapter: not yet implemented');
  }
  async getCapabilities(_uri: string): Promise<PrinterCapability> {
    throw new Error('SnmpPrinterStatusAdapter: not yet implemented');
  }
  async executeCommand(_cmd: PrintCommand): Promise<PrinterAdapterResult> {
    throw new Error('SnmpPrinterStatusAdapter: not yet implemented');
  }
  async printTestPage(_uri: string, _id: string): Promise<PrinterAdapterResult> {
    throw new Error('SnmpPrinterStatusAdapter: not yet implemented');
  }
  async listQueue(_uri: string): Promise<QueueEntry[]> {
    throw new Error('SnmpPrinterStatusAdapter: not yet implemented');
  }
  async cancelJob(_uri: string, _jobId: string): Promise<PrinterAdapterResult> {
    throw new Error('SnmpPrinterStatusAdapter: not yet implemented');
  }
}
