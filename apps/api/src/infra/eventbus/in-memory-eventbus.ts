import type { AnyDomainEvent, EventBusPort, EventHandler } from '@printerops/domain';

export class InMemoryEventBus implements EventBusPort {
  private handlers = new Map<string, EventHandler[]>();

  publish(event: AnyDomainEvent): void {
    const handlers = this.handlers.get(event.eventType) ?? [];
    for (const handler of handlers) {
      void handler(event);
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
}
