import type { SqlValue } from 'sql.js';
import type { Job, CreateJobInput, JobRepositoryPort, ListOptions, JobStatus } from '@printerops/domain';
import { PRIORITY_WEIGHT } from '@printerops/domain';
import { getDb } from '../../db/sqlite.js';
import { toJson, fromJson, toBool, dateStr, toDate } from '../../db/json.js';

function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: row['id'] as string,
    printerId: row['printer_id'] as string,
    printerCode: (row['printer_code'] as string) || undefined,
    templateCode: (row['template_code'] as string) || undefined,
    resolvedTemplateCode: (row['resolved_template_code'] as string) || undefined,
    paperProfileId: (row['paper_profile_id'] as string) || undefined,
    routePolicyId: (row['route_policy_id'] as string) || undefined,
    renderedPrintPayload: (row['rendered_print_payload'] as string) || undefined,
    createdBy: row['created_by'] as string,
    sourceSystem: (row['source_system'] as string) || undefined,
    sourceReference: (row['source_reference'] as string) || undefined,
    requestId: (row['request_id'] as string) || undefined,
    status: row['status'] as JobStatus,
    priority: Number(row['priority']),
    priorityLabel: row['priority_label'] as Job['priorityLabel'],
    traceId: row['trace_id'] as string,
    correlationId: row['correlation_id'] as string,
    documentUrl: (row['document_url'] as string) || undefined,
    documentBase64: (row['document_base64'] as string) || undefined,
    payloadSnapshot: (row['payload_snapshot'] as string) || undefined,
    mimeType: row['mime_type'] as string,
    copies: Number(row['copies']),
    duplex: toBool(row['duplex']),
    colorMode: row['color_mode'] as Job['colorMode'],
    mediaType: (row['media_type'] as string) || undefined,
    resolution: (row['resolution'] as string) || undefined,
    retryCount: Number(row['retry_count']),
    maxRetries: Number(row['max_retries']),
    receivedAt: (row['received_at'] as string) ? toDate(row['received_at']) : undefined,
    validatedAt: (row['validated_at'] as string) ? toDate(row['validated_at']) : undefined,
    queuedAt: (row['queued_at'] as string) ? toDate(row['queued_at']) : undefined,
    dispatchedAt: (row['dispatched_at'] as string) ? toDate(row['dispatched_at']) : undefined,
    runnerReceivedAt: (row['runner_received_at'] as string) ? toDate(row['runner_received_at']) : undefined,
    spoolerSentAt: (row['spooler_sent_at'] as string) ? toDate(row['spooler_sent_at']) : undefined,
    printerAckAt: (row['printer_ack_at'] as string) ? toDate(row['printer_ack_at']) : undefined,
    startedAt: (row['started_at'] as string) ? toDate(row['started_at']) : undefined,
    finishedAt: (row['finished_at'] as string) ? toDate(row['finished_at']) : undefined,
    completedAt: (row['completed_at'] as string) ? toDate(row['completed_at']) : undefined,
    latency: fromJson<Job['latency']>(row['latency'], undefined),
    templateTiming: fromJson<Job['templateTiming']>(row['template_timing'], undefined),
    errorCode: (row['error_code'] as string) || undefined,
    errorMessage: (row['error_message'] as string) || undefined,
    runnerId: (row['runner_id'] as string) || undefined,
    adapterUsed: (row['adapter_used'] as string) || undefined,
    metadata: fromJson<Record<string, unknown>>(row['metadata'], {}),
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

export class SqliteJobRepository implements JobRepositoryPort {
  async findById(id: string): Promise<Job | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToJob(row);
    }
    stmt.free();
    return undefined;
  }

  async findByRequestId(requestId: string, sourceSystem: string): Promise<Job | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM jobs WHERE request_id = ? AND source_system = ?');
    stmt.bind([requestId, sourceSystem]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToJob(row);
    }
    stmt.free();
    return undefined;
  }

  async findAll(opts?: ListOptions & { status?: JobStatus; printerId?: string }): Promise<Job[]> {
    const db = getDb();
    const clauses: string[] = [];
    const params: SqlValue[] = [];

    if (opts?.status) {
      clauses.push('status = ?');
      params.push(opts.status as SqlValue);
    }
    if (opts?.printerId) {
      clauses.push('printer_id = ?');
      params.push(opts.printerId as SqlValue);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit != null ? opts.limit : -1;

    const sql = `SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit as SqlValue, offset as SqlValue);

    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results: Job[] = [];
    while (stmt.step()) {
      results.push(rowToJob(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  async create(
    input: CreateJobInput & { id: string; traceId: string; correlationId: string },
  ): Promise<Job> {
    const db = getDb();
    const now = new Date();
    const nowStr = dateStr(now);

    const priority = input.priority ?? PRIORITY_WEIGHT[input.priorityLabel ?? 'normal'];
    const priorityLabel = input.priorityLabel ?? 'normal';

    db.run(
      `INSERT INTO jobs (
        id, printer_id, printer_code, template_code, resolved_template_code,
        paper_profile_id, route_policy_id, rendered_print_payload,
        created_by, source_system, source_reference, request_id,
        status, priority, priority_label, trace_id, correlation_id,
        document_url, document_base64, payload_snapshot,
        mime_type, copies, duplex, color_mode, media_type, resolution,
        retry_count, max_retries, received_at, template_timing, metadata,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.printerId,
        input.printerCode ?? null,
        input.templateCode ?? null,
        input.resolvedTemplateCode ?? null,
        input.paperProfileId ?? null,
        input.routePolicyId ?? null,
        input.renderedPrintPayload ?? null,
        input.createdBy,
        input.sourceSystem ?? null,
        input.sourceReference ?? null,
        input.requestId ?? null,
        'ACCEPTED',
        priority,
        priorityLabel,
        input.traceId,
        input.correlationId,
        input.documentUrl ?? null,
        input.documentBase64 ?? null,
        input.payloadSnapshot ?? null,
        input.mimeType,
        input.copies,
        input.duplex ? 1 : 0,
        input.colorMode,
        input.mediaType ?? null,
        input.resolution ?? null,
        0,
        input.maxRetries ?? 3,
        nowStr,
        input.templateTiming ? toJson(input.templateTiming) : null,
        toJson(input.metadata),
        nowStr,
        nowStr,
      ],
    );

    const stmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
    stmt.bind([input.id]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return rowToJob(row);
  }

  async update(id: string, patch: Partial<Job>): Promise<Job> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Job ${id} not found`);

    const { fields, values, callerFieldCount } = buildJobPatch(patch);
    // A patch the caller actually asked nothing of is a no-op: it must not bump
    // updated_at (which buildJobPatch always appends) and must not issue a write.
    if (callerFieldCount > 0) {
      getDb().run(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`, [...values, id as SqlValue]);
    }

    return (await this.findById(id))!;
  }

  async claim(id: string, fromStatuses: JobStatus[], patch: Partial<Job>): Promise<Job | undefined> {
    const { fields, values, callerFieldCount } = buildJobPatch(patch);
    // An empty patch would otherwise issue UPDATE ... SET updated_at=? WHERE
    // id=? AND status IN (...), match the row, report rowsModified===1, and
    // hand back a "successfully claimed" job that changed no status. That is
    // not a claim. Guarding on the caller's own field count (updated_at is
    // always appended, so fields.length alone would never be 0) closes that.
    if (callerFieldCount === 0) return undefined;

    // One conditional write. A caller that reads the status first and updates
    // second leaves a window in which a second caller sees the same status —
    // and both then print the same document.
    const db = getDb();
    const placeholders = fromStatuses.map(() => '?').join(', ');
    db.run(
      `UPDATE jobs SET ${fields.join(', ')} WHERE id = ? AND status IN (${placeholders})`,
      [...values, id as SqlValue, ...(fromStatuses as SqlValue[])]
    );

    if (db.getRowsModified() === 0) return undefined;
    return await this.findById(id);
  }
}

/**
 * Turn a job patch into a SET clause plus its bound values, so `update` and
 * `claim` cannot drift apart on which columns they know how to write.
 *
 * `callerFieldCount` counts only the fields the caller supplied, NOT the
 * `updated_at` this helper always appends. Callers guard on it to tell a real
 * no-op patch from one that merely touches updated_at.
 */
function buildJobPatch(patch: Partial<Job>): { fields: string[]; values: SqlValue[]; callerFieldCount: number } {
  const now = dateStr(new Date());
  const fields: string[] = [];
  const values: SqlValue[] = [];

  const add = (col: string, val: unknown) => {
    fields.push(`${col} = ?`);
    values.push(val as SqlValue);
  };

    if ('printerId' in patch) add('printer_id', patch.printerId);
    if ('printerCode' in patch) add('printer_code', patch.printerCode ?? null);
    if ('templateCode' in patch) add('template_code', patch.templateCode ?? null);
    if ('resolvedTemplateCode' in patch) add('resolved_template_code', patch.resolvedTemplateCode ?? null);
    if ('paperProfileId' in patch) add('paper_profile_id', patch.paperProfileId ?? null);
    if ('routePolicyId' in patch) add('route_policy_id', patch.routePolicyId ?? null);
    if ('renderedPrintPayload' in patch) add('rendered_print_payload', patch.renderedPrintPayload ?? null);
    if ('createdBy' in patch) add('created_by', patch.createdBy);
    if ('sourceSystem' in patch) add('source_system', patch.sourceSystem ?? null);
    if ('sourceReference' in patch) add('source_reference', patch.sourceReference ?? null);
    if ('requestId' in patch) add('request_id', patch.requestId ?? null);
    if ('status' in patch) add('status', patch.status);
    if ('priority' in patch) add('priority', patch.priority);
    if ('priorityLabel' in patch) add('priority_label', patch.priorityLabel);
    if ('traceId' in patch) add('trace_id', patch.traceId);
    if ('correlationId' in patch) add('correlation_id', patch.correlationId);
    if ('documentUrl' in patch) add('document_url', patch.documentUrl ?? null);
    if ('documentBase64' in patch) add('document_base64', patch.documentBase64 ?? null);
    if ('payloadSnapshot' in patch) add('payload_snapshot', patch.payloadSnapshot ?? null);
    if ('mimeType' in patch) add('mime_type', patch.mimeType);
    if ('copies' in patch) add('copies', patch.copies);
    if ('duplex' in patch) add('duplex', patch.duplex ? 1 : 0);
    if ('colorMode' in patch) add('color_mode', patch.colorMode);
    if ('mediaType' in patch) add('media_type', patch.mediaType ?? null);
    if ('resolution' in patch) add('resolution', patch.resolution ?? null);
    if ('retryCount' in patch) add('retry_count', patch.retryCount);
    if ('maxRetries' in patch) add('max_retries', patch.maxRetries);
    if ('receivedAt' in patch) add('received_at', patch.receivedAt ? dateStr(patch.receivedAt) : null);
    if ('validatedAt' in patch) add('validated_at', patch.validatedAt ? dateStr(patch.validatedAt) : null);
    if ('queuedAt' in patch) add('queued_at', patch.queuedAt ? dateStr(patch.queuedAt) : null);
    if ('dispatchedAt' in patch) add('dispatched_at', patch.dispatchedAt ? dateStr(patch.dispatchedAt) : null);
    if ('runnerReceivedAt' in patch) add('runner_received_at', patch.runnerReceivedAt ? dateStr(patch.runnerReceivedAt) : null);
    if ('spoolerSentAt' in patch) add('spooler_sent_at', patch.spoolerSentAt ? dateStr(patch.spoolerSentAt) : null);
    if ('printerAckAt' in patch) add('printer_ack_at', patch.printerAckAt ? dateStr(patch.printerAckAt) : null);
    if ('startedAt' in patch) add('started_at', patch.startedAt ? dateStr(patch.startedAt) : null);
    if ('finishedAt' in patch) add('finished_at', patch.finishedAt ? dateStr(patch.finishedAt) : null);
    if ('completedAt' in patch) add('completed_at', patch.completedAt ? dateStr(patch.completedAt) : null);
    if ('latency' in patch) add('latency', patch.latency != null ? toJson(patch.latency) : null);
    if ('templateTiming' in patch) add('template_timing', patch.templateTiming != null ? toJson(patch.templateTiming) : null);
    if ('errorCode' in patch) add('error_code', patch.errorCode ?? null);
    if ('errorMessage' in patch) add('error_message', patch.errorMessage ?? null);
    if ('runnerId' in patch) add('runner_id', patch.runnerId ?? null);
    if ('adapterUsed' in patch) add('adapter_used', patch.adapterUsed ?? null);
    if ('metadata' in patch) add('metadata', toJson(patch.metadata ?? {}));

    // Capture how many columns the caller asked to change BEFORE updated_at is
    // appended. Callers guard on this (not fields.length) so a truly empty
    // patch stays a no-op instead of silently bumping updated_at.
    const callerFieldCount = fields.length;
    add('updated_at', now);

  return { fields, values, callerFieldCount };
}