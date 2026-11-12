import type { NetworkPrinterSearch } from '@printerops/domain';
import { getDb } from '../../db/sqlite.js';
import { NetworkPrinterSearchRepository } from '../network-printer-search.repo.js';

function decode(raw: unknown): NetworkPrinterSearch {
  const data = JSON.parse(String(raw)) as NetworkPrinterSearch;
  return { ...data, createdAt: new Date(data.createdAt), expiresAt: new Date(data.expiresAt),
    startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
    finishedAt: data.finishedAt ? new Date(data.finishedAt) : undefined };
}

export class SqliteNetworkPrinterSearchRepository extends NetworkPrinterSearchRepository {
  protected read(id: string) {
    const stmt = getDb().prepare('SELECT data FROM network_printer_searches WHERE id = ?');
    try { stmt.bind([id]); return stmt.step() ? decode(stmt.getAsObject()['data']) : undefined; }
    finally { stmt.free(); }
  }
  protected forRunner(runnerId: string) {
    const stmt = getDb().prepare('SELECT data FROM network_printer_searches WHERE runner_id = ? ORDER BY created_at DESC, rowid DESC');
    try {
      stmt.bind([runnerId]);
      const searches: NetworkPrinterSearch[] = [];
      while (stmt.step()) searches.push(decode(stmt.getAsObject()['data']));
      return searches;
    } finally { stmt.free(); }
  }
  protected write(search: NetworkPrinterSearch) {
    getDb().run(`INSERT INTO network_printer_searches (id, runner_id, state, created_at, data)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, data = excluded.data`,
    [search.id, search.runnerId, search.state, search.createdAt.toISOString(), JSON.stringify(search)]);
  }
}
