import type { Printer, CreatePrinterInput } from '../models/printer.js';
import type { Job, JobTrace, CreateJobInput, JobStatus } from '../models/job.js';
import type { Runner, RegisterRunnerInput } from '../models/runner.js';
import type { AuditLog, CreateAuditLogInput } from '../models/audit.js';
import type { User } from '../models/user.js';

export interface ListOptions {
  limit?: number;
  offset?: number;
}

export interface PrinterRepositoryPort {
  findById(id: string): Promise<Printer | undefined>;
  findAll(opts?: ListOptions): Promise<Printer[]>;
  create(input: CreatePrinterInput): Promise<Printer>;
  update(id: string, patch: Partial<Printer>): Promise<Printer>;
  delete(id: string): Promise<void>;
}

export interface JobRepositoryPort {
  findById(id: string): Promise<Job | undefined>;
  findAll(opts?: ListOptions & { status?: JobStatus }): Promise<Job[]>;
  create(input: CreateJobInput & { id: string; traceId: string; correlationId: string }): Promise<Job>;
  update(id: string, patch: Partial<Job>): Promise<Job>;
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
  findAll(opts?: ListOptions & { resourceType?: string; resourceId?: string }): Promise<AuditLog[]>;
}

export interface UserRepositoryPort {
  findById(id: string): Promise<User | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
  findAll(opts?: ListOptions): Promise<User[]>;
  create(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
  update(id: string, patch: Partial<User>): Promise<User>;
}
