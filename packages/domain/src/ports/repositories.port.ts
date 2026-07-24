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
import type { IntakeAttempt, CreateIntakeAttemptInput, IntakeOutcome, IntakeSource } from '../models/intake-attempt.js';

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

export interface PrinterTemplateBindingRepositoryPort {
  findById(id: string): Promise<PrinterTemplateBinding | undefined>;
  findAll(opts?: ListOptions & { printerCode?: string; templateCode?: string }): Promise<PrinterTemplateBinding[]>;
  create(input: CreatePrinterTemplateBindingInput): Promise<PrinterTemplateBinding>;
  update(id: string, patch: Partial<PrinterTemplateBinding>): Promise<PrinterTemplateBinding>;
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
