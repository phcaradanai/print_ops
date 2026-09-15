import type {
  WebhookCallbackAttempt,
  CreateWebhookCallbackAttemptInput,
  WebhookCallbackAttemptRepositoryPort,
  ListOptions,
  CallbackAttemptOutcome,
  CallbackAttemptTransport,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';

/** Bounded ring buffer: keeps only the most recent entries so a burst of
 * failed callbacks can never grow this beyond a fixed memory footprint.
 * Deliberately in-memory only in both DB modes — this is an operational log
 * for "what just happened", not durable business data. */
const MAX_ENTRIES = 500;

export class InMemoryWebhookCallbackAttemptRepository implements WebhookCallbackAttemptRepositoryPort {
  private store: WebhookCallbackAttempt[] = [];

  async record(input: CreateWebhookCallbackAttemptInput): Promise<WebhookCallbackAttempt> {
    const attempt: WebhookCallbackAttempt = { ...input, id: generateId(), occurredAt: new Date() };
    this.store.push(attempt);
    if (this.store.length > MAX_ENTRIES) {
      this.store.splice(0, this.store.length - MAX_ENTRIES);
    }
    return attempt;
  }

  async findAll(
    opts?: ListOptions & {
      outcome?: CallbackAttemptOutcome;
      transport?: CallbackAttemptTransport;
      endpointId?: string;
      printJobId?: string;
      requestId?: string;
    },
  ): Promise<WebhookCallbackAttempt[]> {
    // Newest first: that's what a sysadmin scanning for "did it actually
    // deliver?" wants to see at the top.
    let results = [...this.store].reverse();
    if (opts?.outcome) results = results.filter((a) => a.outcome === opts.outcome);
    if (opts?.transport) results = results.filter((a) => a.transport === opts.transport);
    if (opts?.endpointId) results = results.filter((a) => a.endpointId === opts.endpointId);
    // printJobId / requestId were already stored but not filterable, so the Job
    // Detail page had to download the whole log to show one job's attempts.
    if (opts?.printJobId) results = results.filter((a) => a.printJobId === opts.printJobId);
    if (opts?.requestId) results = results.filter((a) => a.requestId === opts.requestId);
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }
}
