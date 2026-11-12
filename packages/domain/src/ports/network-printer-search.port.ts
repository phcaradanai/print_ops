import type { NetworkPrinterSearch } from '../models/network-printer-search.js';

/** Mutations are atomic in the single-writer store; expired leases cannot finish. */
export interface NetworkPrinterSearchRepositoryPort {
  create(search: NetworkPrinterSearch, now: Date): Promise<NetworkPrinterSearch>;
  findById(id: string, now: Date): Promise<NetworkPrinterSearch | undefined>;
  latest(runnerId: string, now: Date): Promise<NetworkPrinterSearch | undefined>;
  claim(runnerId: string, now: Date): Promise<NetworkPrinterSearch | undefined>;
  finish(runnerId: string, id: string, claimToken: string, addresses: string[], incomplete: boolean, now: Date): Promise<NetworkPrinterSearch>;
}
