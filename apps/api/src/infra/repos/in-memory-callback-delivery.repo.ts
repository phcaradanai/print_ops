import type {
  CallbackDelivery,
  CallbackDeliveryRepositoryPort,
  CallbackDeliveryStatus,
  CallbackTransport,
  CreateCallbackDeliveryInput,
  ListOptions,
} from '@printerops/domain';
import { deliveryKey } from '@printerops/domain';
import { generateId } from '@printerops/shared';

/**
 * In-memory CallbackDelivery store.
 *
 * Unlike the callback ATTEMPT log this is not a capped ring buffer: dropping the
 * oldest entry here would drop a delivery the retry worker still owes a caller.
 * Growth is bounded by job volume, and in SQLite mode the retention sweep prunes
 * terminal rows alongside the jobs they belong to.
 */
export class InMemoryCallbackDeliveryRepository implements CallbackDeliveryRepositoryPort {
  private store = new Map<string, CallbackDelivery>();
  /** idempotency key -> delivery id */
  private byKey = new Map<string, string>();

  async findById(id: string): Promise<CallbackDelivery | undefined> {
    return this.store.get(id);
  }

  async findByKey(
    printJobId: string,
    transport: CallbackTransport,
    target: string,
  ): Promise<CallbackDelivery | undefined> {
    const id = this.byKey.get(deliveryKey(printJobId, transport, target));
    return id ? this.store.get(id) : undefined;
  }

  async findAll(opts?: ListOptions & {
    printJobId?: string;
    requestId?: string;
    eventId?: string;
    deliveryStatus?: CallbackDeliveryStatus;
    transport?: CallbackTransport;
    endpointId?: string;
  }): Promise<CallbackDelivery[]> {
    let results = [...this.store.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    if (opts?.printJobId) results = results.filter((d) => d.printJobId === opts.printJobId);
    if (opts?.requestId) results = results.filter((d) => d.requestId === opts.requestId);
    if (opts?.eventId) results = results.filter((d) => d.eventId === opts.eventId);
    if (opts?.deliveryStatus) results = results.filter((d) => d.deliveryStatus === opts.deliveryStatus);
    if (opts?.transport) results = results.filter((d) => d.transport === opts.transport);
    if (opts?.endpointId) results = results.filter((d) => d.endpointId === opts.endpointId);
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  async findDue(now: Date, limit = 50): Promise<CallbackDelivery[]> {
    return [...this.store.values()]
      .filter(
        (d) =>
          d.deliveryStatus === 'RETRY_SCHEDULED' &&
          d.nextAttemptAt !== undefined &&
          d.nextAttemptAt.getTime() <= now.getTime(),
      )
      .sort((a, b) => (a.nextAttemptAt!.getTime() - b.nextAttemptAt!.getTime()))
      .slice(0, limit);
  }

  async createIfAbsent(
    input: CreateCallbackDeliveryInput,
  ): Promise<{ delivery: CallbackDelivery; created: boolean }> {
    const key = deliveryKey(input.printJobId, input.transport, input.target);
    const existingId = this.byKey.get(key);
    if (existingId) {
      const existing = this.store.get(existingId);
      // Return it untouched — re-arming a delivery that already ran is exactly
      // the duplicate-callback bug this key exists to prevent.
      if (existing) return { delivery: existing, created: false };
    }
    const now = new Date();
    const delivery: CallbackDelivery = {
      ...input,
      attemptCount: input.attemptCount ?? 0,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(delivery.id, delivery);
    this.byKey.set(key, delivery.id);
    return { delivery, created: true };
  }

  async update(id: string, patch: Partial<CallbackDelivery>): Promise<CallbackDelivery> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`CallbackDelivery ${id} not found`);
    const updated: CallbackDelivery = { ...existing, ...patch, id, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }

  async claim(
    id: string,
    fromStatuses: CallbackDeliveryStatus[],
    patch: Partial<CallbackDelivery>,
  ): Promise<CallbackDelivery | undefined> {
    const existing = this.store.get(id);
    if (!existing || !fromStatuses.includes(existing.deliveryStatus)) return undefined;
    return this.update(id, patch);
  }
}
