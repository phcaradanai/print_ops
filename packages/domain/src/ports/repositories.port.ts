import type { Printer, CreatePrinterInput } from '../models/printer.js';
import type { Job, JobTrace, CreateJobInput, JobStatus } from '../models/job.js';
import type { Runner, RegisterRunnerInput } from '../models/runner.js';
import type { AuditLog, CreateAuditLogInput } from '../models/audit.js';
import type { User } from '../models/user.js';
import type { ServiceAccount, CreateServiceAccountInput } from '../models/service-account.js';
import type { DiscoveredPrinter, CreateDiscoveredPrinterInput } from '../models/discovered-printer.js';
import type {
  PrintTemplate,
  CreatePrintTemplateInput,
  PaperProfile,
  CreatePaperProfileInput,
  PrinterTemplateBinding,
  CreatePrinterTemplateBindingInput,
  WebhookEndpoint,
  CreateWebhookEndpointInput,
  WebhookRoutePolicy,
  CreateWebhookRoutePolicyInput,
} from '../models/template.js';
import type { ImportedDesign, CreateImportedDesignInput } from '../models/imported-design.js';
import type {
  PrinterPaperCalibration,
  CreatePrinterPaperCalibrationInput,
  UpdatePrinterPaperCalibrationInput,
} from '../models/printer-calibration.js';
import type { IntakeAttempt, CreateIntakeAttemptInput, IntakeOutcome, IntakeSource } from '../models/intake-attempt.js';
import type {
  WebhookCallbackAttempt,
  CreateWebhookCallbackAttemptInput,
  CallbackAttemptOutcome,
  CallbackAttemptTransport,
} from '../models/webhook-callback-attempt.js';

import type {
  CallbackDelivery,
  CreateCallbackDeliveryInput,
  CallbackDeliveryStatus,
  CallbackTransport,
} from '../models/callback-delivery.js';
import type {
  OtaUpdateStateRecord,
  ContentHistoryRecord,
  ContentType,
  UpdateState,
} from '../models/ota.js';

export interface ListOptions {
  limit?: number;
  offset?: number;
}

export interface PrinterRepositoryPort {
  findById(id: string): Promise<Printer | undefined>;
  findByCode(code: string): Promise<Printer | undefined>;
  findAll(opts?: ListOptions): Promise<Printer[]>;
  create(input: CreatePrinterInput): Promise<Printer>;
  update(id: string, patch: Partial<Printer>): Promise<Printer>;
  delete(id: string): Promise<void>;
}

export interface JobRepositoryPort {
  findById(id: string): Promise<Job | undefined>;
  findByRequestId(requestId: string, sourceSystem: string): Promise<Job | undefined>;
  findAll(opts?: ListOptions & { status?: JobStatus; printerId?: string }): Promise<Job[]>;
  create(input: CreateJobInput & { id: string; traceId: string; correlationId: string }): Promise<Job>;
  update(id: string, patch: Partial<Job>): Promise<Job>;
  /**
   * Apply `patch` only if the job is currently in one of `fromStatuses`, and
   * report whether the caller won.
   *
   * Reading the status and then updating leaves a gap in which a second caller
   * reads the same status: both then print the same document. Claiming has to
   * be one conditional write for that to be impossible.
   *
   * Returns the updated job, or undefined when the job was already claimed by
   * someone else (or no longer exists).
   */
  claim(id: string, fromStatuses: JobStatus[], patch: Partial<Job>): Promise<Job | undefined>;
}

export interface TraceRepositoryPort {
  findByJobId(jobId: string): Promise<JobTrace | undefined>;
  create(trace: Omit<JobTrace, 'id'>): Promise<JobTrace>;
  update(id: string, patch: Partial<JobTrace>): Promise<JobTrace>;
}

export interface RunnerRepositoryPort {
  findById(id: string): Promise<Runner | undefined>;
  findAll(opts?: ListOptions): Promise<Runner[]>;
  create(input: RegisterRunnerInput & { id: string }): Promise<Runner>;
  update(id: string, patch: Partial<Runner>): Promise<Runner>;
}

export interface AuditRepositoryPort {
  create(input: CreateAuditLogInput): Promise<AuditLog>;
  findAll(opts?: ListOptions & { resourceType?: string; resourceId?: string; actorId?: string }): Promise<AuditLog[]>;
}

export interface UserRepositoryPort {
  findById(id: string): Promise<User | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
  findAll(opts?: ListOptions): Promise<User[]>;
  create(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
  update(id: string, patch: Partial<User>): Promise<User>;
  seed(user: User): void;
}

export interface ServiceAccountRepositoryPort {
  findById(id: string): Promise<ServiceAccount | undefined>;
  findBySourceSystem(sourceSystem: string): Promise<ServiceAccount | undefined>;
  findAll(opts?: ListOptions): Promise<ServiceAccount[]>;
  create(input: CreateServiceAccountInput): Promise<ServiceAccount>;
  update(id: string, patch: Partial<ServiceAccount>): Promise<ServiceAccount>;
}

export interface DiscoveredPrinterRepositoryPort {
  findById(id: string): Promise<DiscoveredPrinter | undefined>;
  findAll(opts?: ListOptions & { runnerId?: string }): Promise<DiscoveredPrinter[]>;
  upsert(input: CreateDiscoveredPrinterInput): Promise<DiscoveredPrinter>;
  update(id: string, patch: Partial<DiscoveredPrinter>): Promise<DiscoveredPrinter>;
}

export interface PrintTemplateRepositoryPort {
  findById(id: string): Promise<PrintTemplate | undefined>;
  findByCode(templateCode: string): Promise<PrintTemplate | undefined>;
  findAll(opts?: ListOptions & { status?: string }): Promise<PrintTemplate[]>;
  create(input: CreatePrintTemplateInput): Promise<PrintTemplate>;
  update(id: string, patch: Partial<PrintTemplate>): Promise<PrintTemplate>;
  delete(id: string): Promise<void>;
}

export interface PaperProfileRepositoryPort {
  findById(id: string): Promise<PaperProfile | undefined>;
  findByCode(code: string): Promise<PaperProfile | undefined>;
  findAll(opts?: ListOptions): Promise<PaperProfile[]>;
  create(input: CreatePaperProfileInput): Promise<PaperProfile>;
  update(id: string, patch: Partial<PaperProfile>): Promise<PaperProfile>;
  delete(id: string): Promise<void>;
}

export interface PrinterPaperCalibrationRepositoryPort {
  findById(id: string): Promise<PrinterPaperCalibration | undefined>;
  findByKey(printerId: string, paperProfileId: string, dpi: number): Promise<PrinterPaperCalibration | undefined>;
  findAll(opts?: ListOptions & { printerId?: string; paperProfileId?: string }): Promise<PrinterPaperCalibration[]>;
  create(input: CreatePrinterPaperCalibrationInput): Promise<PrinterPaperCalibration>;
  update(id: string, patch: UpdatePrinterPaperCalibrationInput): Promise<PrinterPaperCalibration>;
  delete(id: string): Promise<void>;
}

export interface PrinterTemplateBindingRepositoryPort {
  findById(id: string): Promise<PrinterTemplateBinding | undefined>;
  findAll(opts?: ListOptions & { printerCode?: string; templateCode?: string }): Promise<PrinterTemplateBinding[]>;
  create(input: CreatePrinterTemplateBindingInput): Promise<PrinterTemplateBinding>;
  update(id: string, patch: Partial<PrinterTemplateBinding>): Promise<PrinterTemplateBinding>;
  delete(id: string): Promise<void>;
}

export interface WebhookEndpointRepositoryPort {
  findById(id: string): Promise<WebhookEndpoint | undefined>;
  findByCode(endpointCode: string): Promise<WebhookEndpoint | undefined>;
  findAll(opts?: ListOptions): Promise<WebhookEndpoint[]>;
  create(input: CreateWebhookEndpointInput): Promise<WebhookEndpoint>;
  update(id: string, patch: Partial<WebhookEndpoint>): Promise<WebhookEndpoint>;
  delete(id: string): Promise<void>;
}

export interface WebhookRoutePolicyRepositoryPort {
  findById(id: string): Promise<WebhookRoutePolicy | undefined>;
  findByCode(policyCode: string): Promise<WebhookRoutePolicy | undefined>;
  findAll(opts?: ListOptions): Promise<WebhookRoutePolicy[]>;
  create(input: CreateWebhookRoutePolicyInput): Promise<WebhookRoutePolicy>;
  update(id: string, patch: Partial<WebhookRoutePolicy>): Promise<WebhookRoutePolicy>;
}

export interface ImportedDesignRepositoryPort {
  findById(id: string): Promise<ImportedDesign | undefined>;
  findBySha256(sha256: string): Promise<ImportedDesign | undefined>;
  findByPaperProfileId(paperProfileId: string): Promise<ImportedDesign | undefined>;
  create(input: CreateImportedDesignInput): Promise<ImportedDesign>;
  delete(id: string): Promise<void>;
}

/**
 * Records every dynamic-print-flow intake attempt (NATS or HTTP), including
 * rejected/dead-lettered ones, so a failure is always visible on the
 * dashboard instead of only in process logs.
 */
export interface IntakeAttemptRepositoryPort {
  record(input: CreateIntakeAttemptInput): Promise<IntakeAttempt>;
  findAll(opts?: ListOptions & { outcome?: IntakeOutcome; source?: IntakeSource }): Promise<IntakeAttempt[]>;
}

/**
 * Diagnostic ring buffer of webhook callback delivery attempts (HTTP/NATS),
 * both live and sandbox test fires — so "did the webhook actually succeed?"
 * has a real, visible answer instead of only showing up in process logs.
 */
export interface WebhookCallbackAttemptRepositoryPort {
  record(input: CreateWebhookCallbackAttemptInput): Promise<WebhookCallbackAttempt>;
  findAll(opts?: ListOptions & {
    outcome?: CallbackAttemptOutcome;
    transport?: CallbackAttemptTransport;
    endpointId?: string;
    printJobId?: string;
    requestId?: string;
  }): Promise<WebhookCallbackAttempt[]>;
}

/**
 * Durable record of terminal result-callback deliveries.
 *
 * Separate from WebhookCallbackAttemptRepositoryPort on purpose: that one is a
 * capped in-memory ring buffer of individual attempts (a diagnostic view), and
 * a retry worker cannot use a ring buffer as its source of truth — "restart with
 * a pending delivery" would silently lose work. This repository is persisted in
 * SQLite mode.
 */
export interface CallbackDeliveryRepositoryPort {
  findById(id: string): Promise<CallbackDelivery | undefined>;
  /** Look up by the idempotency key `(printJobId, transport, target)`. */
  findByKey(
    printJobId: string,
    transport: CallbackTransport,
    target: string,
  ): Promise<CallbackDelivery | undefined>;
  findAll(opts?: ListOptions & {
    printJobId?: string;
    requestId?: string;
    eventId?: string;
    deliveryStatus?: CallbackDeliveryStatus;
    transport?: CallbackTransport;
    endpointId?: string;
  }): Promise<CallbackDelivery[]>;
  /** Deliveries whose `nextAttemptAt` has come due, oldest first. */
  findDue(now: Date, limit?: number): Promise<CallbackDelivery[]>;
  /**
   * Insert, or return the existing row for the same idempotency key WITHOUT
   * modifying it. This is what makes a redelivered terminal event a no-op
   * instead of a second callback.
   */
  createIfAbsent(input: CreateCallbackDeliveryInput): Promise<{ delivery: CallbackDelivery; created: boolean }>;
  update(id: string, patch: Partial<CallbackDelivery>): Promise<CallbackDelivery>;
  /**
   * Conditional status transition: apply `patch` only while the delivery is in
   * one of `fromStatuses`. Two workers (the subscriber firing immediately and
   * the retry sweep) can otherwise both send the same attempt.
   */
  claim(
    id: string,
    fromStatuses: CallbackDeliveryStatus[],
    patch: Partial<CallbackDelivery>,
  ): Promise<CallbackDelivery | undefined>;
}

/**
 * Persistent state for the application OTA update state machine.
 * Singleton row (id=1) in ota_update_state table.
 */
export interface OtaUpdateStateRepositoryPort {
  get(): Promise<OtaUpdateStateRecord>;
  update(patch: Partial<OtaUpdateStateRecord>): Promise<OtaUpdateStateRecord>;
}

/**
 * History of applied content manifests. Each row represents one content sync
 * operation (profiles or templates) with the full manifest JSON for rollback.
 */
export interface ContentHistoryRepositoryPort {
  create(input: Omit<ContentHistoryRecord, 'id'>): Promise<ContentHistoryRecord>;
  findByType(contentType: ContentType, limit?: number): Promise<ContentHistoryRecord[]>;
  findByTypeAndVersion(contentType: ContentType, version: number): Promise<ContentHistoryRecord | undefined>;
}
