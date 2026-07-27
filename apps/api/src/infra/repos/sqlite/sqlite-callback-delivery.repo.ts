import type { SqlValue } from 'sql.js';
import type {
  CallbackDelivery,
  CallbackDeliveryRepositoryPort,
  CallbackDeliveryStatus,
  CallbackTransport,
  CreateCallbackDeliveryInput,
  ListOptions,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../db/sqlite.js';
import { toDate, dateStr, fromJson, toJson } from '../../db/json.js';

function rowToDelivery(row: Record<string, unknown>): CallbackDelivery {
  return {
    id: row['id'] as string,
    eventId: row['event_id'] as string,
    printJobId: row['print_job_id'] as string,
    requestId: row['request_id'] != null ? (row['request_id'] as string) : undefined,
    sourceSystem: row['source_system'] != null ? (row['source_system'] as string) : undefined,
    transport: row['transport'] as CallbackTransport,
    target: row['target'] as string,
    trigger: 'PRINT_RESULT',
    deliveryStatus: row['delivery_status'] as CallbackDeliveryStatus,
    guarantee: row['guarantee'] != null ? (row['guarantee'] as CallbackDelivery['guarantee']) : undefined,
    attemptCount: Number(row['attempt_count'] ?? 0),
    maxAttempts: Number(row['max_attempts'] ?? 5),
    lastAttemptAt: row['last_attempt_at'] != null ? toDate(row['last_attempt_at']) : undefined,
    nextAttemptAt: row['next_attempt_at'] != null ? toDate(row['next_attempt_at']) : undefined,
    deliveredAt: row['delivered_at'] != null ? toDate(row['delivered_at']) : undefined,
    lastHttpStatus: row['last_http_status'] != null ? Number(row['last_http_status']) : undefined,
    lastErrorCode: row['last_error_code'] != null ? (row['last_error_code'] as string) : undefined,
    lastErrorMessage: row['last_error_message'] != null ? (row['last_error_message'] as string) : undefined,
    printStatus: row['print_status'] as string,
    payload: fromJson<Record<string, unknown>>(row['payload'], {}),
    endpointId: row['endpoint_id'] != null ? (row['endpoint_id'] as string) : undefined,
    endpointCode: row['endpoint_code'] != null ? (row['endpoint_code'] as string) : undefined,
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

export class SqliteCallbackDeliveryRepository implements CallbackDeliveryRepositoryPort {
  async findById(id: string): Promise<CallbackDelivery | undefined> {
    return this.selectOne('SELECT * FROM callback_deliveries WHERE id = ?', [id]);
  }

  async findByKey(
    printJobId: string,
    transport: CallbackTransport,
    target: string,
  ): Promise<CallbackDelivery | undefined> {
    return this.selectOne(
      'SELECT * FROM callback_deliveries WHERE print_job_id = ? AND transport = ? AND target = ?',
      [printJobId, transport, target],
    );
  }

  async findAll(opts?: ListOptions & {
    printJobId?: string;
    requestId?: string;
    eventId?: string;
    deliveryStatus?: CallbackDeliveryStatus;
    transport?: CallbackTransport;
    endpointId?: string;
  }): Promise<CallbackDelivery[]> {
    const clauses: string[] = [];
    const values: SqlValue[] = [];
    const eq = (col: string, val: string | undefined) => {
      if (!val) return;
      clauses.push(`${col} = ?`);
      values.push(val);
    };
    eq('print_job_id', opts?.printJobId);
    eq('request_id', opts?.requestId);
    eq('event_id', opts?.eventId);
    eq('delivery_status', opts?.deliveryStatus);
    eq('transport', opts?.transport);
    eq('endpoint_id', opts?.endpointId);

    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const limit = opts?.limit != null ? opts.limit : -1;
    const offset = opts?.offset ?? 0;
    values.push(limit as SqlValue, offset as SqlValue);

    return this.selectMany(
      `SELECT * FROM callback_deliveries${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      values,
    );
  }

  async findDue(now: Date, limit = 50): Promise<CallbackDelivery[]> {
    return this.selectMany(
      `SELECT * FROM callback_deliveries
       WHERE delivery_status = 'RETRY_SCHEDULED' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?
       ORDER BY next_attempt_at ASC LIMIT ?`,
      [dateStr(now), limit as SqlValue],
    );
  }

  async createIfAbsent(
    input: CreateCallbackDeliveryInput,
  ): Promise<{ delivery: CallbackDelivery; created: boolean }> {
    const existing = await this.findByKey(input.printJobId, input.transport, input.target);
    // Return the stored row untouched. Re-arming a delivery that already ran is
    // exactly the duplicate-callback bug the unique key exists to prevent.
    if (existing) return { delivery: existing, created: false };

    const db = getDb();
    const id = generateId();
    const now = dateStr(new Date());
    try {
      db.run(
        `INSERT INTO callback_deliveries (
          id, event_id, print_job_id, request_id, source_system, transport, target,
          trigger_kind, delivery_status, guarantee, attempt_count, max_attempts,
          last_attempt_at, next_attempt_at, delivered_at, last_http_status,
          last_error_code, last_error_message, print_status, payload,
          endpoint_id, endpoint_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.eventId,
          input.printJobId,
          input.requestId ?? null,
          input.sourceSystem ?? null,
          input.transport,
          input.target,
          input.trigger,
          input.deliveryStatus,
          input.guarantee ?? null,
          input.attemptCount ?? 0,
          input.maxAttempts,
          input.lastAttemptAt ? dateStr(input.lastAttemptAt) : null,
          input.nextAttemptAt ? dateStr(input.nextAttemptAt) : null,
          input.deliveredAt ? dateStr(input.deliveredAt) : null,
          input.lastHttpStatus ?? null,
          input.lastErrorCode ?? null,
          input.lastErrorMessage ?? null,
          input.printStatus,
          toJson(input.payload),
          input.endpointId ?? null,
          input.endpointCode ?? null,
          now,
          now,
        ],
      );
    } catch (err) {
      // Lost the race against a concurrent insert on the unique key — the other
      // writer's row is the winner, and it is still exactly one callback.
      const raced = await this.findByKey(input.printJobId, input.transport, input.target);
      if (raced) return { delivery: raced, created: false };
      throw err;
    }
    return { delivery: (await this.findById(id))!, created: true };
  }

  async update(id: string, patch: Partial<CallbackDelivery>): Promise<CallbackDelivery> {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) throw new Error(`CallbackDelivery ${id} not found`);

    const fields: string[] = [];
    const values: SqlValue[] = [];
    const add = (col: string, val: unknown) => {
      fields.push(`${col} = ?`);
      values.push(val as SqlValue);
    };

    if ('eventId' in patch) add('event_id', patch.eventId);
    if ('deliveryStatus' in patch) add('delivery_status', patch.deliveryStatus);
    if ('guarantee' in patch) add('guarantee', patch.guarantee ?? null);
    if ('attemptCount' in patch) add('attempt_count', patch.attemptCount ?? 0);
    if ('maxAttempts' in patch) add('max_attempts', patch.maxAttempts ?? 5);
    if ('lastAttemptAt' in patch) add('last_attempt_at', patch.lastAttemptAt ? dateStr(patch.lastAttemptAt) : null);
    if ('nextAttemptAt' in patch) add('next_attempt_at', patch.nextAttemptAt ? dateStr(patch.nextAttemptAt) : null);
    if ('deliveredAt' in patch) add('delivered_at', patch.deliveredAt ? dateStr(patch.deliveredAt) : null);
    if ('lastHttpStatus' in patch) add('last_http_status', patch.lastHttpStatus ?? null);
    if ('lastErrorCode' in patch) add('last_error_code', patch.lastErrorCode ?? null);
    if ('lastErrorMessage' in patch) add('last_error_message', patch.lastErrorMessage ?? null);
    if ('printStatus' in patch) add('print_status', patch.printStatus);
    if ('payload' in patch) add('payload', toJson(patch.payload ?? {}));

    add('updated_at', dateStr(new Date()));
    values.push(id as SqlValue);
    db.run(`UPDATE callback_deliveries SET ${fields.join(', ')} WHERE id = ?`, values);
    return (await this.findById(id))!;
  }

  async claim(
    id: string,
    fromStatuses: CallbackDeliveryStatus[],
    patch: Partial<CallbackDelivery>,
  ): Promise<CallbackDelivery | undefined> {
    const db = getDb();
    // Conditional write, not read-then-write: the subscriber firing immediately
    // and the retry sweep can otherwise both send the same attempt. The marker
    // status is applied first so the row is off-limits to the other worker even
    // before `patch` lands.
    const placeholders = fromStatuses.map(() => '?').join(', ');
    db.run(
      `UPDATE callback_deliveries SET delivery_status = 'DELIVERING', updated_at = ?
       WHERE id = ? AND delivery_status IN (${placeholders})`,
      [dateStr(new Date()), id, ...fromStatuses] as SqlValue[],
    );
    if (db.getRowsModified() === 0) return undefined;
    return this.update(id, patch);
  }

  private selectOne(sql: string, values: SqlValue[]): Promise<CallbackDelivery | undefined> {
    const db = getDb();
    const stmt = db.prepare(sql);
    stmt.bind(values);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return Promise.resolve(rowToDelivery(row));
    }
    stmt.free();
    return Promise.resolve(undefined);
  }

  private selectMany(sql: string, values: SqlValue[]): Promise<CallbackDelivery[]> {
    const db = getDb();
    const stmt = db.prepare(sql);
    stmt.bind(values);
    const results: CallbackDelivery[] = [];
    while (stmt.step()) results.push(rowToDelivery(stmt.getAsObject()));
    stmt.free();
    return Promise.resolve(results);
  }
}
