import type {
  CreateWebhookEndpointInput,
  CreateWebhookRoutePolicyInput,
  ListOptions,
  WebhookEndpoint,
  WebhookEndpointRepositoryPort,
  WebhookRoutePolicy,
  WebhookRoutePolicyRepositoryPort,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class InMemoryWebhookEndpointRepository implements WebhookEndpointRepositoryPort {
  private store = new Map<string, WebhookEndpoint>();

  async findById(id: string): Promise<WebhookEndpoint | undefined> {
    return this.store.get(id);
  }

  async findByCode(endpointCode: string): Promise<WebhookEndpoint | undefined> {
    return Array.from(this.store.values()).find((e) => e.endpointCode === endpointCode);
  }

  async findAll(opts?: ListOptions): Promise<WebhookEndpoint[]> {
    const all = Array.from(this.store.values()).sort((a, b) => a.endpointCode.localeCompare(b.endpointCode));
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async create(input: CreateWebhookEndpointInput): Promise<WebhookEndpoint> {
    const now = new Date();
    const endpoint: WebhookEndpoint = { ...input, id: generateId(), createdAt: now, updatedAt: now };
    this.store.set(endpoint.id, endpoint);
    return endpoint;
  }

  async update(id: string, patch: Partial<WebhookEndpoint>): Promise<WebhookEndpoint> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`WebhookEndpoint ${id} not found`);
    const updated: WebhookEndpoint = { ...existing, ...patch, id, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

export class InMemoryWebhookRoutePolicyRepository implements WebhookRoutePolicyRepositoryPort {
  private store = new Map<string, WebhookRoutePolicy>();

  async findById(id: string): Promise<WebhookRoutePolicy | undefined> {
    return this.store.get(id);
  }

  async findByCode(policyCode: string): Promise<WebhookRoutePolicy | undefined> {
    return Array.from(this.store.values()).find((p) => p.policyCode === policyCode);
  }

  async findAll(opts?: ListOptions): Promise<WebhookRoutePolicy[]> {
    const all = Array.from(this.store.values()).sort((a, b) => a.policyCode.localeCompare(b.policyCode));
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async create(input: CreateWebhookRoutePolicyInput): Promise<WebhookRoutePolicy> {
    const now = new Date();
    const policy: WebhookRoutePolicy = { ...input, id: generateId(), createdAt: now, updatedAt: now };
    this.store.set(policy.id, policy);
    return policy;
  }

  async update(id: string, patch: Partial<WebhookRoutePolicy>): Promise<WebhookRoutePolicy> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`WebhookRoutePolicy ${id} not found`);
    const updated: WebhookRoutePolicy = { ...existing, ...patch, id, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}
