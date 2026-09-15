import type { PrinterAdapterPort, Printer } from '@printerops/domain';

export class AdapterRegistry {
  private adapters = new Map<string, PrinterAdapterPort>();

  registerAdapter(adapter: PrinterAdapterPort): void {
    this.adapters.set(adapter.protocol, adapter);
  }

  getAdapterByProtocol(protocol: string): PrinterAdapterPort {
    const adapter = this.adapters.get(protocol);
    if (!adapter) {
      throw new Error(`No adapter registered for protocol: ${protocol}`);
    }
    return adapter;
  }

  getAdapterForPrinter(printer: Printer): PrinterAdapterPort {
    return this.getAdapterByProtocol(printer.protocol);
  }

  listAdapters(): Array<{ protocol: string; adapterName: string }> {
    return Array.from(this.adapters.values()).map((a) => ({
      protocol: a.protocol,
      adapterName: a.adapterName,
    }));
  }

  hasAdapter(protocol: string): boolean {
    return this.adapters.has(protocol);
  }
}
