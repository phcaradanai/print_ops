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
  /** Same-name runner records that lost their discovery rows to the newest one. */
  shadowedRunnerIds: string[];
}

/**
 * Deletes discovered printers whose runner registration no longer exists, and
 * those held by a duplicate record of the same logical runner.
 *
 * Discovery rows are keyed by runnerId and are upserted by the runner's discovery
 * sync; no other code path looks them up by anything except runnerId. So when a
 * runner row disappears — deleted by a build that did not clean up, a crash
 * between the two writes, or a hand-edited database — its rows become unreachable
 * orphans that the Discovery page renders forever and that no reconciliation
 * inside the runner cycle can ever fix. This pass is the backstop for exactly
 * that state.
 *
 * The second rule covers a record left behind by an older build that keyed runner
 * identity on the hostname: a Docker runner's hostname is its container id, so
 * every redeploy created another runner record and another copy of every
 * discovered printer. The runner name is the logical identity now, so rows owned
 * by a duplicate record of a name that also has a newer record are the stale ones.
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

    // Keep the newest record per runner name; any older same-name record is a
    // duplicate of the same logical runner and must not hold discovery rows.
    const newestByName = new Map<string, { id: string; at: number }>();
    for (const runner of runners) {
      const at = new Date(runner.lastHeartbeatAt ?? 0).getTime() || 0;
      const current = newestByName.get(runner.name);
      if (!current || at > current.at) newestByName.set(runner.name, { id: runner.id, at });
    }
    const shadowedRunnerIds = Array.from(
      new Set(
        printers
          .filter((printer) => liveRunnerIds.has(printer.runnerId))
          .map((printer) => printer.runnerId)
          .filter((runnerId) => {
            const owner = runners.find((runner) => runner.id === runnerId);
            if (!owner) return false;
            const newest = newestByName.get(owner.name);
            return newest !== undefined && newest.id !== runnerId;
          }),
      ),
    );

    let deleted = 0;
    for (const runnerId of new Set([...orphanRunnerIds, ...shadowedRunnerIds])) {
      deleted += await this.discoveredPrinters.deleteByRunner(runnerId);
    }

    return { scanned: printers.length, deleted, orphanRunnerIds, shadowedRunnerIds };
  }
}
