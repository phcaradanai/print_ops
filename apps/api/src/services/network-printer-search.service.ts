import { isIPv4 } from 'node:net';
import type { AuditRepositoryPort, DiscoveredPrinterRepositoryPort, NetworkPrinterSearchRepositoryPort, RunnerRepositoryPort } from '@printerops/domain';
import { generateId, generateTraceId, NotFoundError, ValidationError } from '@printerops/shared';

function ipv4Number(value: string): number {
  if (!isIPv4(value)) throw new ValidationError('Enter valid IPv4 addresses, CIDR, or an IPv4 range');
  return value.split('.').reduce((n, octet) => n * 256 + Number(octet), 0);
}
function ipv4String(value: number): string {
  return [24, 16, 8, 0].map(bits => (value >>> bits) & 255).join('.');
}

export function parseNetworkTargets(input: unknown): string[] {
  if (typeof input !== 'string' || !input.trim() || input.length > 4096) throw new ValidationError('IPv4 targets are required (maximum 256 addresses)');
  const targets = new Set<string>();
  for (const part of input.split(/[,\n]+/).map(s => s.trim())) {
    let first: number;
    let last: number;
    if (part.includes('/')) {
      const [address, prefix, extra] = part.split('/');
      if (!prefix || !/^\d+$/.test(prefix) || Number(prefix) > 32 || extra !== undefined) throw new ValidationError('Invalid IPv4 CIDR prefix');
      const size = 2 ** (32 - Number(prefix));
      first = Math.floor(ipv4Number(address!) / size) * size;
      last = first + size - 1;
    } else if (part.includes('-')) {
      const [start, end, extra] = part.split('-').map(s => s.trim());
      if (extra !== undefined) throw new ValidationError('Invalid IPv4 range');
      first = ipv4Number(start!);
      last = ipv4Number(end!);
    } else { first = last = ipv4Number(part); }
    if (last < first || last - first >= 256) throw new ValidationError('Search must contain at most 256 IPv4 addresses in ascending ranges');
    for (let n = first; n <= last; n++) targets.add(ipv4String(n));
    if (targets.size > 256) throw new ValidationError('Search must contain at most 256 IPv4 addresses');
  }
  return [...targets];
}

export class NetworkPrinterSearchService {
  constructor(private searches: NetworkPrinterSearchRepositoryPort, private runners: RunnerRepositoryPort,
    private discovered: DiscoveredPrinterRepositoryPort, private audit: AuditRepositoryPort,
    private clock = () => new Date()) {}

  async start(runnerId: string, input: unknown, actorId: string) {
    const targets = parseNetworkTargets(input);
    const runner = await this.runners.findById(runnerId);
    if (!runner) throw new NotFoundError('Runner', runnerId);
    if (runner.metadata['network_printer_search'] !== true) throw new ValidationError('Update this Runner to enable network printer search');
    const now = this.clock();
    const search = await this.searches.create({ id: generateId(), runnerId, targets, state: 'QUEUED',
      createdAt: now, expiresAt: new Date(now.getTime() + 120_000), addresses: [] }, now);
    await this.audit.create({ traceId: generateTraceId(), action: 'printer.network_search_requested', actorId,
      resourceType: 'runner', resourceId: runnerId, metadata: { searchId: search.id, targetCount: targets.length } });
    return search;
  }
  async get(id: string) {
    const search = await this.searches.findById(id, this.clock());
    if (!search) throw new NotFoundError('NetworkPrinterSearch', id);
    return search;
  }
  async latest(runnerId: string) { return this.searches.latest(runnerId, this.clock()); }
  async claim(runnerId: string) { return this.searches.claim(runnerId, this.clock()); }

  async finish(runnerId: string, id: string, claimToken: unknown, addresses: unknown, incomplete: unknown) {
    const current = await this.get(id);
    if (typeof claimToken !== 'string' || !Array.isArray(addresses) || addresses.length > 256
      || typeof incomplete !== 'boolean' || !addresses.every(a => typeof a === 'string' && current.targets.includes(a))) {
      throw new ValidationError('Invalid network search results');
    }
    const result = await this.searches.finish(runnerId, id, claimToken, addresses as string[], incomplete, this.clock());
    // Idempotent result retries also repair a sync interrupted after persisting completion.
    for (const address of result.addresses) {
      await this.discovered.upsert({ runnerId, localPrinterName: `TCP ${address}:9100`, portName: `${address}:9100`,
        connectionType: 'tcp_ip', isDefault: false, isShared: false,
        attributes: { discoverySource: 'network_scan', networkAddress: address, networkPort: 9100 } });
    }
    return result;
  }
}
