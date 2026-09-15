import type { DiscoveredPrinterRepositoryPort, RunnerRepositoryPort, DiscoveryItem } from '@printerops/domain';

export class SyncPrinterDiscoveryService {
  constructor(
    private discoveredPrinters: DiscoveredPrinterRepositoryPort,
    private runners: RunnerRepositoryPort
  ) {}

  async execute(runnerId: string, items: DiscoveryItem[]): Promise<{ upserted: number }> {
    const runner = await this.runners.findById(runnerId);
    if (!runner) throw new Error(`Runner ${runnerId} not found`);

    for (const item of items) {
      await this.discoveredPrinters.upsert({
        runnerId,
        localPrinterName: item.localPrinterName,
        driverName: item.driverName,
        portName: item.portName,
        connectionType: item.connectionType,
        isDefault: item.isDefault,
        isShared: item.isShared,
        attributes: item.attributes,
        computerName: item.computerName,
        osName: item.osName,
      });
    }

    return { upserted: items.length };
  }
}
