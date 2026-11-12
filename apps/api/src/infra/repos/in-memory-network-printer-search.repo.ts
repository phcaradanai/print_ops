import type { NetworkPrinterSearch } from '@printerops/domain';
import { NetworkPrinterSearchRepository } from './network-printer-search.repo.js';

export class InMemoryNetworkPrinterSearchRepository extends NetworkPrinterSearchRepository {
  private searches = new Map<string, NetworkPrinterSearch>();
  protected read(id: string) { return structuredClone(this.searches.get(id)); }
  protected forRunner(runnerId: string) {
    return structuredClone([...this.searches.values()].filter(s => s.runnerId === runnerId).reverse()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
  }
  protected write(search: NetworkPrinterSearch) { this.searches.set(search.id, structuredClone(search)); }
}
