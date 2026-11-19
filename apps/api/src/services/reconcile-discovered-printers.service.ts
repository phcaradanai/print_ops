import type { DiscoveredPrinterRepositoryPort, RunnerRepositoryPort } from '@printerops/domain';

/**
 * Rows removed by one reconciliation pass. `orphanRunnerIds` names the runner ids
 * whose discovery rows were removed so the caller can log/report the cause.
 */
export interface DiscoveryReconcileResult {
  /** Discovered-printer rows inspected. */
  scanned: number;
  /** Discovered-printer rows deleted (their runner registration is gone). */
  deleted: number;
  /** Runner ids that still owned rows but no longer exist. */
  orphanRunnerIds: string[];
}

/**
 * Deletes discovered printers whose runner registration no longer exists.
 *
 * Discovery rows are keyed by runnerId and are upserted by the runner's discovery
 * sync; no other code path looks them up by anything except runnerId. So when a
 * runner row disappears — deleted by a build that did not clean up, a crash
 * between the two writes, or a hand-edited database — its rows become unreachable
 * orphans that the Discovery page renders forever and that no reconciliation
 * inside the runner cycle can ever fix. This pass is the backstop for exactly
 * that state.
 *
 * Deliberately NOT age-based: `lastSeenAt` only advances when the runner's discovery
 * loop syncs (every cycle while the process is running), but a *registered* runner
 * can be powered off, uninstalled or offline for longer than any retention window
 * while still being a live registration whose discovered printers the operator may
 * want to inspect or register from. An age cutoff would delete exactly those rows, so
 * liveness of the runner record is the only criterion used here — it can never remove
 * a live runner's data. Rows are removed through the repository so both storage modes
 * share the same logic, and a registered printer (a real `Printer` row) is untouched
 * — it owns its own record.
 */
export class ReconcileDiscoveredPrintersService {
  constructor(
    private readonly discoveredPrinters: DiscoveredPrinterRepositoryPort,
    private readonly runners: RunnerRepositoryPort,
  ) {}

  async execute(): Promise<DiscoveryReconcileResult> {
    const [printers, runners] = await Promise.all([
      this.discoveredPrinters.findAll(),
      this.runners.findAll(),
    ]);

    const liveRunnerIds = new Set(runners.map((runner) => runner.id));
    const orphanRunnerIds = Array.from(
      new Set(
        printers
          .filter((printer) => !liveRunnerIds.has(printer.runnerId))
          .map((printer) => printer.runnerId),
      ),
    );

    let deleted = 0;
    for (const runnerId of orphanRunnerIds) {
      deleted += await this.discoveredPrinters.deleteByRunner(runnerId);
    }

    return { scanned: printers.length, deleted, orphanRunnerIds };
  }
}
