import type { DiscoveredPrinterRepositoryPort, RunnerRepositoryPort, DiscoveryItem } from '@printerops/domain';

/**
 * Identity of one physical printer as seen by a runner: the reporting host plus the
 * local queue name, both trimmed and case-folded. A blank/missing computerName is
 * normalised to the empty host, so two rows that both lack a hostname still match
 * each other (the display-level dedupe in the global view deliberately falls back to
 * runnerId instead, because a live runner without a hostname must not be collapsed
 * with another live runner; this key is only used to remove rows of *dead* runners).
 */
export function discoveryIdentityKey(computerName: string | undefined, localPrinterName: string): string {
  const host = computerName?.trim().toLowerCase() ?? '';
  const name = localPrinterName.trim().toLowerCase();
  return `${host}\u0000${name}`;
}

export class SyncPrinterDiscoveryService {
  constructor(
    private discoveredPrinters: DiscoveredPrinterRepositoryPort,
    private runners: RunnerRepositoryPort
  ) {}

  async execute(runnerId: string, items: DiscoveryItem[]): Promise<{ upserted: number }> {
    const runner = await this.runners.findById(runnerId);
    if (!runner) throw new Error(`Runner ${runnerId} not found`);

    // Do this before the upserts so the sync never leaves the stale row visible for
    // another cycle. Two live runners are never merged: a row is only removed when its
    // runner registration no longer exists.
    await this.removeOrphanedDuplicates(runnerId, items);

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

  /**
   * A runner that re-registers (new runner row, new id — for example after the
   * operator deleted the old registration) reports the same printers under a new
   * runnerId. Upserting keys on (runnerId, localPrinterName), so the old row is kept,
   * and the global view renders it as a duplicate printer.
   *
   * Rows are removed only when BOTH hold:
   *  - the row belongs to a runner that is no longer registered (so it is orphaned
   *    data no future sync can ever update), and
   *  - the row has the same normalised (computerName, localPrinterName) identity as
   *    an item in this sync (so a dead row for a *different* host is left to the
   *    explicit reconcile pass rather than guessed at here).
   *
   * Runner liveness is looked up once per distinct runnerId in the sync, not per row.
   */
  private async removeOrphanedDuplicates(runnerId: string, items: DiscoveryItem[]): Promise<void> {
    const syncedIdentities = new Set(
      items.map((item) => discoveryIdentityKey(item.computerName, item.localPrinterName)),
    );
    if (syncedIdentities.size === 0) return;

    const existing = await this.discoveredPrinters.findAll();
    const runnerIsLive = new Map<string, boolean>();

    for (const row of existing) {
      if (row.runnerId === runnerId) continue;
      if (!syncedIdentities.has(discoveryIdentityKey(row.computerName, row.localPrinterName))) continue;

      if (!runnerIsLive.has(row.runnerId)) {
        runnerIsLive.set(row.runnerId, (await this.runners.findById(row.runnerId)) !== undefined);
      }
      if (runnerIsLive.get(row.runnerId)) continue;

      await this.discoveredPrinters.deleteById(row.id);
    }
  }
}
