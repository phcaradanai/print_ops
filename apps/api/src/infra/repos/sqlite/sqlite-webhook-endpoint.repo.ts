import type { SqlValue } from 'sql.js';
import type { WebhookEndpoint, CreateWebhookEndpointInput, WebhookEndpointRepositoryPort, ListOptions } from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../db/sqlite.js';
import { toDate, dateStr, fromJson, toJson } from '../../db/json.js';

function rowToWebhookEndpoint(row: Record<string, unknown>): WebhookEndpoint {
  return {
    id: row['id'] as string,
    endpointCode: row['endpoint_code'] as string,
    name: row['name'] as string,
    sourceSystem: row['source_system'] as string,
    authMode: row['auth_mode'] as WebhookEndpoint['authMode'],
    apiKey: row['api_key'] != null ? (row['api_key'] as string) : undefined,
    enabled: row['enabled'] === 1 || row['enabled'] === true,
    routePolicyId: row['route_policy_id'] as string,
    callbackTransport: (row['callback_transport'] as WebhookEndpoint['callbackTransport']) ?? 'NONE',
    callbackUrl: row['callback_url'] != null ? (row['callback_url'] as string) : undefined,
    callbackNatsSubject: row['callback_nats_subject'] != null ? (row['callback_nats_subject'] as string) : undefined,
    callbackPayloadTemplate: row['callback_payload_template'] != null
      ? fromJson<Record<string, unknown>>(row['callback_payload_template'], {})
      : undefined,
    callbackOnPrintResult: row['callback_on_print_result'] === 1 || row['callback_on_print_result'] === true,
    callbackSigningSecretRef: row['callback_signing_secret_ref'] != null ? String(row['callback_signing_secret_ref']) : undefined,
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

export class SqliteWebhookEndpointRepository implements WebhookEndpointRepositoryPort {
  async findById(id: string): Promise<WebhookEndpoint | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM webhook_endpoints WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToWebhookEndpoint(row);
    }
    stmt.free();
    return undefined;
  }

  async findByCode(endpointCode: string): Promise<WebhookEndpoint | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM webhook_endpoints WHERE endpoint_code = ?');
    stmt.bind([endpointCode]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToWebhookEndpoint(row);
    }
    stmt.free();
    return undefined;
  }

  async findAll(opts?: ListOptions): Promise<WebhookEndpoint[]> {
    const db = getDb();
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit != null ? opts.limit : -1;
    const stmt = db.prepare('SELECT * FROM webhook_endpoints ORDER BY source_system ASC LIMIT ? OFFSET ?');
    stmt.bind([limit, offset]);
    const results: WebhookEndpoint[] = [];
    while (stmt.step()) {
      results.push(rowToWebhookEndpoint(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  async create(input: CreateWebhookEndpointInput): Promise<WebhookEndpoint> {
    const db = getDb();
    const id = generateId();
    const now = dateStr(new Date());

    db.run(
      `INSERT INTO webhook_endpoints (id, endpoint_code, name, source_system, auth_mode, api_key, enabled, route_policy_id, callback_transport, callback_url, callback_nats_subject, callback_payload_template, callback_on_print_result, callback_signing_secret_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.endpointCode,
        input.name,
        input.sourceSystem,
        input.authMode,
        input.apiKey ?? null,
        input.enabled ? 1 : 0,
        input.routePolicyId,
        input.callbackTransport ?? 'NONE',
        input.callbackUrl ?? null,
        input.callbackNatsSubject ?? null,
        input.callbackPayloadTemplate ? toJson(input.callbackPayloadTemplate) : null,
        input.callbackOnPrintResult ? 1 : 0,
        input.callbackSigningSecretRef ?? null,
        now,
        now,
      ],
    );

    const stmt = db.prepare('SELECT * FROM webhook_endpoints WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return rowToWebhookEndpoint(row);
  }

  async update(id: string, patch: Partial<WebhookEndpoint>): Promise<WebhookEndpoint> {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) throw new Error(`WebhookEndpoint ${id} not found`);

    const fields: string[] = [];
    const values: SqlValue[] = [];

    const add = (col: string, val: unknown) => {
      fields.push(`${col} = ?`);
      values.push(val as SqlValue);
    };

    if ('endpointCode' in patch) add('endpoint_code', patch.endpointCode);
    if ('name' in patch) add('name', patch.name);
    if ('sourceSystem' in patch) add('source_system', patch.sourceSystem);
    if ('authMode' in patch) add('auth_mode', patch.authMode);
    if ('apiKey' in patch) add('api_key', patch.apiKey ?? null);
    if ('enabled' in patch) add('enabled', patch.enabled ? 1 : 0);
    if ('routePolicyId' in patch) add('route_policy_id', patch.routePolicyId);
    if ('callbackTransport' in patch) add('callback_transport', patch.callbackTransport ?? 'NONE');
    if ('callbackUrl' in patch) add('callback_url', patch.callbackUrl ?? null);
    if ('callbackNatsSubject' in patch) add('callback_nats_subject', patch.callbackNatsSubject ?? null);
    if ('callbackPayloadTemplate' in patch) add('callback_payload_template', patch.callbackPayloadTemplate ? toJson(patch.callbackPayloadTemplate) : null);
    if ('callbackOnPrintResult' in patch) add('callback_on_print_result', patch.callbackOnPrintResult ? 1 : 0);
    if ('callbackSigningSecretRef' in patch) add('callback_signing_secret_ref', patch.callbackSigningSecretRef ?? null);

    add('updated_at', dateStr(new Date()));

    const sql = `UPDATE webhook_endpoints SET ${fields.join(', ')} WHERE id = ?`;
    values.push(id as SqlValue);
    db.run(sql, values);

    return (await this.findById(id))!;
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    db.run('DELETE FROM webhook_endpoints WHERE id = ?', [id]);
  }
}
