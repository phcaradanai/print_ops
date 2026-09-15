import type { SqlValue } from 'sql.js';
import type { ServiceAccount, CreateServiceAccountInput, ServiceAccountRepositoryPort, ListOptions } from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../db/sqlite.js';
import { toJson, fromJson, dateStr, toDate } from '../../db/json.js';

function rowToServiceAccount(row: Record<string, unknown>): ServiceAccount {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    sourceSystem: row['source_system'] as string,
    apiKeyHash: row['api_key_hash'] as string,
    apiKeyPrefix: row['api_key_prefix'] as string,
    isActive: row['is_active'] === 1 || row['is_active'] === true,
    allowedPrinterCodes: fromJson<string[]>(row['allowed_printer_codes'], []),
    allowedTemplateCodes: fromJson<string[]>(row['allowed_template_codes'], []),
    maxCopiesPerJob: row['max_copies_per_job'] as number,
    maxPayloadBytes: row['max_payload_bytes'] as number,
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

export class SqliteServiceAccountRepository implements ServiceAccountRepositoryPort {
  async findById(id: string): Promise<ServiceAccount | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM service_accounts WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToServiceAccount(row);
    }
    stmt.free();
    return undefined;
  }

  async findBySourceSystem(sourceSystem: string): Promise<ServiceAccount | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM service_accounts WHERE source_system = ? AND is_active = 1');
    stmt.bind([sourceSystem]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToServiceAccount(row);
    }
    stmt.free();
    return undefined;
  }

  async findAll(opts?: ListOptions): Promise<ServiceAccount[]> {
    const db = getDb();
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit != null ? opts.limit : -1;
    const stmt = db.prepare('SELECT * FROM service_accounts ORDER BY source_system ASC LIMIT ? OFFSET ?');
    stmt.bind([limit, offset]);
    const results: ServiceAccount[] = [];
    while (stmt.step()) {
      results.push(rowToServiceAccount(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  async create(input: CreateServiceAccountInput): Promise<ServiceAccount> {
    const db = getDb();
    const id = generateId();
    const now = dateStr(new Date());

    db.run(
      `INSERT INTO service_accounts (id, name, source_system, api_key_hash, api_key_prefix, is_active, allowed_printer_codes, allowed_template_codes, max_copies_per_job, max_payload_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.name,
        input.sourceSystem,
        input.apiKeyHash,
        input.apiKeyPrefix,
        input.isActive ? 1 : 0,
        toJson(input.allowedPrinterCodes),
        toJson(input.allowedTemplateCodes),
        input.maxCopiesPerJob,
        input.maxPayloadBytes,
        now,
        now,
      ],
    );

    const stmt = db.prepare('SELECT * FROM service_accounts WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return rowToServiceAccount(row);
  }

  async update(id: string, patch: Partial<ServiceAccount>): Promise<ServiceAccount> {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) throw new Error(`ServiceAccount ${id} not found`);

    const fields: string[] = [];
    const values: SqlValue[] = [];

    const add = (col: string, val: unknown) => {
      fields.push(`${col} = ?`);
      values.push(val as SqlValue);
    };

    if ('name' in patch) add('name', patch.name);
    if ('sourceSystem' in patch) add('source_system', patch.sourceSystem);
    if ('apiKeyHash' in patch) add('api_key_hash', patch.apiKeyHash);
    if ('apiKeyPrefix' in patch) add('api_key_prefix', patch.apiKeyPrefix);
    if ('isActive' in patch) add('is_active', patch.isActive ? 1 : 0);
    if ('allowedPrinterCodes' in patch) add('allowed_printer_codes', toJson(patch.allowedPrinterCodes ?? []));
    if ('allowedTemplateCodes' in patch) add('allowed_template_codes', toJson(patch.allowedTemplateCodes ?? []));
    if ('maxCopiesPerJob' in patch) add('max_copies_per_job', patch.maxCopiesPerJob);
    if ('maxPayloadBytes' in patch) add('max_payload_bytes', patch.maxPayloadBytes);

    add('updated_at', dateStr(new Date()));

    const sql = `UPDATE service_accounts SET ${fields.join(', ')} WHERE id = ?`;
    values.push(id as SqlValue);
    db.run(sql, values);

    return (await this.findById(id))!;
  }

  seed(account: ServiceAccount): void {
    const db = getDb();
    db.run(
      `INSERT OR REPLACE INTO service_accounts (id, name, source_system, api_key_hash, api_key_prefix, is_active, allowed_printer_codes, allowed_template_codes, max_copies_per_job, max_payload_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        account.id, account.name, account.sourceSystem, account.apiKeyHash, account.apiKeyPrefix,
        account.isActive ? 1 : 0, toJson(account.allowedPrinterCodes), toJson(account.allowedTemplateCodes),
        account.maxCopiesPerJob, account.maxPayloadBytes, dateStr(account.createdAt), dateStr(account.updatedAt),
      ],
    );
  }
}