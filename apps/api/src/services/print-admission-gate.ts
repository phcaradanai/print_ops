import { ConflictError } from '@printerops/shared';

/**
 * Coordinates print admission with maintenance operations such as OTA.
 *
 * A simple boolean check is not sufficient: an accepted print can be between
 * validation and queue insertion when an installer decides the queue is idle.
 * The gate keeps that whole admission operation in flight, then lets OTA close
 * admission and wait for the last creator to finish before draining the queue.
 */
export interface PrintAdmissionGatePort {
  run<T>(operation: () => Promise<T>): Promise<T>;
  beginMaintenance(): Promise<() => void>;
  isMaintenanceActive(): boolean;
  pauseMaintenance(): void;
  resumeMaintenance(): void;
}

export class PrintAdmissionGate implements PrintAdmissionGatePort {
  private maintenance = false;
  private activeAdmissions = 0;
  private readonly drainedWaiters: Array<() => void> = [];

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.maintenance) {
      throw new ConflictError('Print admission is temporarily paused while maintenance is in progress');
    }

    this.activeAdmissions += 1;
    try {
      return await operation();
    } finally {
      this.activeAdmissions -= 1;
      if (this.activeAdmissions === 0) {
        for (const resolve of this.drainedWaiters.splice(0)) resolve();
      }
    }
  }

  async beginMaintenance(): Promise<() => void> {
    if (this.maintenance) {
      throw new ConflictError('Print maintenance is already in progress');
    }
    this.maintenance = true;

    if (this.activeAdmissions > 0) {
      await new Promise<void>((resolve) => this.drainedWaiters.push(resolve));
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.maintenance = false;
    };
  }

  isMaintenanceActive(): boolean {
    return this.maintenance;
  }

  /** Fails closed when an API restart finds an unfinished OTA handoff. */
  pauseMaintenance(): void {
    this.maintenance = true;
  }

  /** Reopens admission after a persisted external updater outcome. */
  resumeMaintenance(): void {
    this.maintenance = false;
  }
}
