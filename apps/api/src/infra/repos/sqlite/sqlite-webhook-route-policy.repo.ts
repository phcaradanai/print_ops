import type { SqlValue } from 'sql.js';
import type { WebhookRoutePolicy, CreateWebhookRoutePolicyInput, WebhookRoutePolicyRepositoryPort, ListOptions } from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../db/sqlite.js';
import { toJson, fromJson, toDate, dateStr } from '../../db/json.js';

function rowToRoutePolicy(row: Record<string, unknown>): WebhookRoutePolicy {
  return {
    id: row['id'] as string,
    policyCode: row['policy_code'] as string,
    name: row['name'] as string,
    matchRules: fromJson<WebhookRoutePolicy['matchRules']>(row['match_rules'], { when: [] }),
    printerMapping: fromJson<Record<string, unknown>>(row['printer_mapping'], {}),
    templateMapping: fromJson<Record<string, unknown>>(row['template_mapping'], {}),
    payloadMapping: fromJson<Record<string, string>>(row['payload_mapping'], {}),
    priorityMapping: fromJson<Record<string, unknown> | undefined>(row['priority_mapping'], undefined),
    enabled: row['enabled'] === 1 || row['enabled'] === true,
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

export class SqliteWebhookRoutePolicyRepository implements WebhookRoutePolicyRepositoryPort {
  async findById(id: string): Promise<WebhookRoutePolicy | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM webhook_route_policies WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToRoutePolicy(row);
    }
    stmt.free();
    return undefined;
  }

  async findByCode(policyCode: string): Promise<WebhookRoutePolicy | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM webhook_route_policies WHERE policy_code = ?');
    stmt.bind([policyCode]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToRoutePolicy(row);
    }
    stmt.free();
    return undefined;
  }

  async findAll(opts?: ListOptions): Promise<WebhookRoutePolicy[]> {
    const db = getDb();
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit != null ? opts.limit : -1;
    const stmt = db.prepare('SELECT * FROM webhook_route_policies ORDER BY policy_code ASC LIMIT ? OFFSET ?');
    stmt.bind([limit, offset]);
    const results: WebhookRoutePolicy[] = [];
    while (stmt.step()) {
      results.push(rowToRoutePolicy(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  async create(input: CreateWebhookRoutePolicyInput): Promise<WebhookRoutePolicy> {
    const db = getDb();
    const id = generateId();
    const now = dateStr(new Date());

    db.run(
      `INSERT INTO webhook_route_policies (id, policy_code, name, match_rules, printer_mapping, template_mapping, payload_mapping, priority_mapping, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.policyCode,
        input.name,
        toJson(input.matchRules),
        toJson(input.printerMapping),
        toJson(input.templateMapping),
        toJson(input.payloadMapping),
        input.priorityMapping ? toJson(input.priorityMapping) : null,
        input.enabled ? 1 : 0,
        now,
        now,
      ],
    );

    const stmt = db.prepare('SELECT * FROM webhook_route_policies WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return rowToRoutePolicy(row);
  }

  async update(id: string, patch: Partial<WebhookRoutePolicy>): Promise<WebhookRoutePolicy> {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) throw new Error(`WebhookRoutePolicy ${id} not found`);

    const fields: string[] = [];
    const values: SqlValue[] = [];

    const add = (col: string, val: unknown) => {
      fields.push(`${col} = ?`);
      values.push(val as SqlValue);
    };

    if ('policyCode' in patch) add('policy_code', patch.policyCode);
    if ('name' in patch) add('name', patch.name);
    if ('matchRules' in patch) add('match_rules', toJson(patch.matchRules));
    if ('printerMapping' in patch) add('printer_mapping', toJson(patch.printerMapping));
    if ('templateMapping' in patch) add('template_mapping', toJson(patch.templateMapping));
    if ('payloadMapping' in patch) add('payload_mapping', toJson(patch.payloadMapping));
    if ('priorityMapping' in patch) add('priority_mapping', patch.priorityMapping ? toJson(patch.priorityMapping) : null);
    if ('enabled' in patch) add('enabled', patch.enabled ? 1 : 0);

    add('updated_at', dateStr(new Date()));

    const sql = `UPDATE webhook_route_policies SET ${fields.join(', ')} WHERE id = ?`;
    values.push(id as SqlValue);
    db.run(sql, values);

    return (await this.findById(id))!;
  }
}