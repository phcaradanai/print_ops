import type { NetworkPrinterSearch, NetworkPrinterSearchRepositoryPort } from '@printerops/domain';
import { ConflictError, generateId } from '@printerops/shared';

/** No await between read/check/write: sql.js has one in-process writer. */
export abstract class NetworkPrinterSearchRepository implements NetworkPrinterSearchRepositoryPort {
  protected abstract read(id: string): NetworkPrinterSearch | undefined;
  protected abstract forRunner(runnerId: string): NetworkPrinterSearch[];
  protected abstract write(search: NetworkPrinterSearch): void;

  private expire(search: NetworkPrinterSearch | undefined, now: Date): NetworkPrinterSearch | undefined {
    if (search && (search.state === 'QUEUED' || search.state === 'RUNNING') && search.expiresAt <= now) {
      search.state = 'EXPIRED';
      search.finishedAt = now;
      this.write(search);
    }
    return search;
  }

  async create(search: NetworkPrinterSearch, now: Date): Promise<NetworkPrinterSearch> {
    const active = this.forRunner(search.runnerId).some(s => {
      const state = this.expire(s, now)?.state;
      return state === 'QUEUED' || state === 'RUNNING';
    });
    if (active) throw new ConflictError('A network printer search is already active for this Runner');
    this.write(search);
    return structuredClone(search);
  }

  async findById(id: string, now: Date): Promise<NetworkPrinterSearch | undefined> {
    return this.expire(this.read(id), now);
  }

  async latest(runnerId: string, now: Date): Promise<NetworkPrinterSearch | undefined> {
    return this.expire(this.forRunner(runnerId)[0], now);
  }

  async claim(runnerId: string, now: Date): Promise<NetworkPrinterSearch | undefined> {
    for (const candidate of this.forRunner(runnerId)) {
      const search = this.expire(candidate, now)!;
      if (search.state !== 'QUEUED') continue;
      search.state = 'RUNNING';
      search.claimToken = generateId();
      search.startedAt = now;
      search.expiresAt = new Date(now.getTime() + 75_000);
      this.write(search);
      return structuredClone(search);
    }
    return undefined;
  }

  async finish(runnerId: string, id: string, claimToken: string, addresses: string[], incomplete: boolean, now: Date): Promise<NetworkPrinterSearch> {
    const search = this.expire(this.read(id), now);
    if (!search || search.runnerId !== runnerId || !claimToken || search.claimToken !== claimToken) {
      throw new ConflictError('Invalid network search claim');
    }
    const state = incomplete ? 'FAILED' : 'COMPLETED';
    const normalized = [...new Set(addresses)].sort();
    if ((search.state === 'COMPLETED' || search.state === 'FAILED') && search.state === state
      && JSON.stringify(search.addresses) === JSON.stringify(normalized)) return search;
    if (search.state !== 'RUNNING') throw new ConflictError('Network search claim has expired or finished');
    search.state = state;
    search.addresses = normalized;
    search.finishedAt = now;
    this.write(search);
    return structuredClone(search);
  }
}
