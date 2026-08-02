import type { AnyDomainEvent, EventBusPort, EventHandler } from '@printerops/domain';

/**
 * In-process event bus.
 *
 * `publish()` stays synchronous (fire-and-forget) because it is called from
 * inside the print path, and a slow subscriber must never hold up a physical
 * print. Two things follow from that, and both used to bite:
 *
 *  - A handler that rejects became an unhandled promise rejection, which on
 *    Node 20 kills the process by default. Handler failures are isolated here.
 *  - Nothing could tell when handlers had finished, so a test asserting on a
 *    subscriber's side effect had to sleep and hope. `settled()` awaits every
 *    handler promise started so far instead.
 */
export class InMemoryEventBus implements EventBusPort {
  private handlers = new Map<string, EventHandler[]>();
  private inFlight = new Set<Promise<void>>();
  private onHandlerError?: (event: AnyDomainEvent, err: unknown) => void;

  constructor(opts?: { onHandlerError?: (event: AnyDomainEvent, err: unknown) => void }) {
    this.onHandlerError = opts?.onHandlerError;
  }

  publish(event: AnyDomainEvent): void {
    const handlers = this.handlers.get(event.eventType) ?? [];
    for (const handler of handlers) {
      let result: void | Promise<void>;
      try {
        result = handler(event);
      } catch (err) {
        this.reportHandlerError(event, err);
        continue;
      }
      if (!result || typeof (result as Promise<void>).then !== 'function') continue;
      const tracked = (result as Promise<void>)
        .catch((err: unknown) => {
          this.reportHandlerError(event, err);
        })
        .finally(() => {
          this.inFlight.delete(tracked);
        });
      this.inFlight.add(tracked);
    }
  }

  subscribe<T extends AnyDomainEvent>(
    eventType: T['eventType'],
    handler: EventHandler<T>
  ): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler as EventHandler);
    this.handlers.set(eventType, existing);
  }

  /**
   * Resolve once every handler started so far has finished — including handlers
   * a handler itself published into. Test-facing, but safe in production code
   * (e.g. a graceful-shutdown drain).
   */
  async settled(): Promise<void> {
    // Loop rather than a single Promise.all: a handler may publish a follow-up
    // event whose own handlers are only registered in `inFlight` once the first
    // batch runs.
    for (let guard = 0; guard < 100 && this.inFlight.size > 0; guard += 1) {
      await Promise.all([...this.inFlight]);
    }
  }

  private reportHandlerError(event: AnyDomainEvent, err: unknown): void {
    if (this.onHandlerError) {
      this.onHandlerError(event, err);
      return;
    }
    // eslint-disable-next-line no-console
    console.error(`[EventBus] subscriber for ${event.eventType} failed:`, err);
  }
}
