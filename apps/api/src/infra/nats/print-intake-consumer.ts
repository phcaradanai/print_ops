/**
 * Idempotent JetStream consumer lifecycle for PrintOps intake.
 *
 * The small interfaces in this file intentionally mirror the nats.js surface
 * rather than importing nats.js.  This keeps the lifecycle testable with a
 * deterministic fake and lets the connection layer own its NATS dependency.
 */

export type ConsumerAction = 'CREATED' | 'REUSED' | 'UPDATED';

export interface PrintIntakeConfig {
  stream: string;
  subjectPrefix: string;
  clientId: string;
  ackWait?: number;
  maxDeliver?: number;
}

export interface ConsumerConfig {
  durable_name?: string;
  name?: string;
  filter_subject?: string;
  ack_policy?: string;
  deliver_policy?: string;
  replay_policy?: string;
  max_deliver?: number;
  ack_wait?: number;
  deliver_subject?: string;
  deliver_group?: string;
}

export interface ConsumerInfo {
  config: ConsumerConfig;
  delivered?: { stream_seq?: number; consumer_seq?: number };
  pending?: number;
  ack_floor?: { stream_seq?: number; consumer_seq?: number };
}

export interface ConsumerHandle extends ConsumerInfo {
  consume?: (options?: { callback?: (message: unknown) => void }) => Promise<unknown>;
}

export interface ConsumerManager {
  info(stream: string, durable: string): Promise<ConsumerInfo>;
  add(stream: string, config: ConsumerConfig): Promise<ConsumerInfo>;
  update?(stream: string, durable: string, config: ConsumerConfig): Promise<ConsumerInfo>;
}

export interface StreamManager {
  info(stream: string): Promise<unknown>;
}

export interface JetStreamManagerLike {
  streams: StreamManager;
  consumers: ConsumerManager;
}

export interface ConsumerLookup {
  consumers: Pick<ConsumerManager, 'info'>;
}

export interface NatsOperationErrorShape {
  stage:
    | 'CORE_CONNECT'
    | 'JETSTREAM_ACCOUNT'
    | 'STREAM_LOOKUP'
    | 'CONSUMER_LOOKUP'
    | 'CONSUMER_CREATE'
    | 'CONSUMER_UPDATE'
    | 'CONSUMER_BIND'
    | 'CONSUME_LOOP';
  code?: string | number;
  apiErrorCode?: number;
  message: string;
  cause?: unknown;
}

export class NatsOperationError extends Error implements NatsOperationErrorShape {
  override readonly name = 'NatsOperationError';

  constructor(
    public readonly stage: NatsOperationErrorShape['stage'],
    message: string,
    public readonly details: Omit<NatsOperationErrorShape, 'stage' | 'message'> = {},
  ) {
    super(message);
  }

  get code(): string | number | undefined { return this.details.code; }
  get apiErrorCode(): number | undefined { return this.details.apiErrorCode; }
  override get cause(): unknown { return this.details.cause; }
}

export interface ConsumerDifference {
  field: keyof ConsumerConfig;
  expected: unknown;
  actual: unknown;
}

export class ConsumerConfigConflictError extends Error {
  override readonly name = 'ConsumerConfigConflictError';
  readonly code = 'CONSUMER_CONFIG_CONFLICT';

  constructor(
    public readonly stream: string,
    public readonly durable: string,
    public readonly differences: ConsumerDifference[],
  ) {
    super(`Consumer configuration conflict for ${stream}/${durable}`);
  }
}

export class ConsumerInUseError extends Error {
  override readonly name = 'ConsumerInUseError';
  readonly code = 'CONSUMER_IN_USE';

  constructor(public readonly stream: string, public readonly durable: string) {
    super(
      `Consumer ${stream}/${durable} may already be active on another PrintOps workstation. ` +
      'Each workstation must use a unique Client ID.',
    );
  }
}

export interface EnsureResult {
  consumer: ConsumerInfo;
  action: ConsumerAction;
  stream: string;
  durable: string;
  subject: string;
}

export interface PrintIntakeDiagnostics {
  setupGeneration: number;
  setupInFlight: boolean;
  consumeLoopActive: boolean;
  consumerAction?: ConsumerAction;
  stream?: string;
  durable?: string;
  subject?: string;
  lastError?: NatsOperationErrorShape | ConsumerConfigConflictError;
}

const missingConsumerCodes = new Set([404, 10014, 'CONSUMER_NOT_FOUND', 'JS-404']);
const mutableFields: ReadonlySet<keyof ConsumerConfig> = new Set(['ack_wait', 'max_deliver']);

function errorCode(error: unknown): string | number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as Record<string, unknown>;
  return typeof value.code === 'string' || typeof value.code === 'number' ? value.code : undefined;
}

function apiErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as Record<string, unknown>;
  return typeof value.api_error_code === 'number'
    ? value.api_error_code
    : typeof value.apiErrorCode === 'number' ? value.apiErrorCode : undefined;
}

function asOperationError(stage: NatsOperationErrorShape['stage'], error: unknown): NatsOperationError {
  const message = error instanceof Error ? error.message : String(error);
  return new NatsOperationError(stage, message, { code: errorCode(error), apiErrorCode: apiErrorCode(error), cause: error });
}

function isMissingConsumer(error: unknown): boolean {
  const code = errorCode(error) ?? apiErrorCode(error);
  return code !== undefined && missingConsumerCodes.has(code);
}

function isAlreadyExistingConsumer(error: unknown): boolean {
  const code = errorCode(error) ?? apiErrorCode(error);
  if (code !== undefined && new Set([10013, 10058, 'CONSUMER_ALREADY_EXISTS', 'JS-10013']).has(code)) return true;
  return error instanceof Error && /consumer already exists|consumer name.*in use/i.test(error.message);
}

function durableName(config: PrintIntakeConfig): string {
  return `printops-print-intake-${config.clientId}`;
}

function subject(config: PrintIntakeConfig): string {
  return `${config.subjectPrefix}.${config.clientId}`;
}

function configKey(config: PrintIntakeConfig): string {
  return JSON.stringify(config);
}

function expectedConfig(config: PrintIntakeConfig): ConsumerConfig {
  return {
    durable_name: durableName(config),
    filter_subject: subject(config),
    ack_policy: 'explicit',
    deliver_policy: 'all',
    replay_policy: 'instant',
    max_deliver: config.maxDeliver ?? -1,
    ack_wait: config.ackWait ?? 30_000_000_000,
    // Omitted deliberately: this is a pull consumer.
    deliver_subject: undefined,
    deliver_group: undefined,
  };
}

function normalized(value: unknown): unknown {
  return value === undefined || value === null ? undefined : value;
}

function differences(expected: ConsumerConfig, actual: ConsumerConfig): ConsumerDifference[] {
  const fields: (keyof ConsumerConfig)[] = [
    'durable_name', 'name', 'filter_subject', 'ack_policy', 'deliver_policy',
    'replay_policy', 'max_deliver', 'ack_wait', 'deliver_subject', 'deliver_group',
  ];
  return fields.flatMap((field) => {
    let expectedValue = normalized(expected[field]);
    let actualValue = normalized(actual[field]);
    // nats.js/server versions expose the durable identity as either
    // durable_name or name. Treat those equivalent representations alike.
    if (field === 'durable_name' || field === 'name') {
      expectedValue = normalized(expected.durable_name ?? expected.name);
      actualValue = normalized(actual.durable_name ?? actual.name);
    }
    return Object.is(expectedValue, actualValue) ? [] : [{ field, expected: expectedValue, actual: actualValue }];
  });
}

export async function ensurePrintIntakeConsumer(
  jsm: JetStreamManagerLike,
  config: PrintIntakeConfig,
): Promise<EnsureResult> {
  const durable = durableName(config);
  const intakeSubject = subject(config);
  const expected = expectedConfig(config);

  try {
    await jsm.streams.info(config.stream);
  } catch (error) {
    throw asOperationError('STREAM_LOOKUP', error);
  }

  let existing: ConsumerInfo;
  try {
    existing = await jsm.consumers.info(config.stream, durable);
  } catch (error) {
    if (!isMissingConsumer(error)) throw asOperationError('CONSUMER_LOOKUP', error);
    try {
      const consumer = await jsm.consumers.add(config.stream, expected);
      return { consumer, action: 'CREATED', stream: config.stream, durable, subject: intakeSubject };
    } catch (createError) {
      // Another concurrent process may have won the create race. Re-read and
      // compare it instead of deleting or blindly retrying the durable.
      if (!isAlreadyExistingConsumer(createError)) {
        throw asOperationError('CONSUMER_CREATE', createError);
      }
      try {
        existing = await jsm.consumers.info(config.stream, durable);
      } catch (lookupError) {
        throw asOperationError('CONSUMER_LOOKUP', lookupError);
      }
    }
  }

  const diff = differences(expected, existing.config);
  if (diff.length === 0) {
    return { consumer: existing, action: 'REUSED', stream: config.stream, durable, subject: intakeSubject };
  }

  const unsafe = diff.filter(({ field }) => !mutableFields.has(field));
  if (unsafe.length > 0 || !jsm.consumers.update) {
    throw new ConsumerConfigConflictError(config.stream, durable, diff);
  }

  try {
    const updated = await jsm.consumers.update(config.stream, durable, {
      ...existing.config,
      ...Object.fromEntries(diff.map(({ field, expected: value }) => [field, value])),
    });
    return { consumer: updated, action: 'UPDATED', stream: config.stream, durable, subject: intakeSubject };
  } catch (error) {
    throw asOperationError('CONSUMER_UPDATE', error);
  }
}

export interface PrintIntakeManagerOptions {
  jsm: JetStreamManagerLike;
  bind: (consumer: ConsumerInfo, config: PrintIntakeConfig) => Promise<void>;
}

export class PrintIntakeManager {
  private setupInFlight?: Promise<EnsureResult>;
  private setupInFlightGeneration?: number;
  private generation = 0;
  private consumeLoopActive = false;
  private current?: PrintIntakeConfig;
  private lastAction?: ConsumerAction;
  private lastError?: NatsOperationErrorShape | ConsumerConfigConflictError;

  constructor(private readonly options: PrintIntakeManagerOptions) {}

  get diagnostics(): PrintIntakeDiagnostics {
    return {
      setupGeneration: this.generation,
      setupInFlight: this.setupInFlight !== undefined,
      consumeLoopActive: this.consumeLoopActive,
      consumerAction: this.lastAction,
      stream: this.current?.stream,
      durable: this.current ? durableName(this.current) : undefined,
      subject: this.current ? subject(this.current) : undefined,
      lastError: this.lastError,
    };
  }

  async setup(config: PrintIntakeConfig): Promise<EnsureResult | undefined> {
    const sameSettings = this.current !== undefined && configKey(this.current) === configKey(config);
    this.current = config;
    const setupGeneration = sameSettings ? this.generation : ++this.generation;
    if (!this.setupInFlight) {
      this.setupInFlight = this.runSetup(config, setupGeneration).finally(() => {
        this.setupInFlight = undefined;
        this.setupInFlightGeneration = undefined;
      });
      this.setupInFlightGeneration = setupGeneration;
    }
    const startedGeneration = this.setupInFlightGeneration;
    const result = await this.setupInFlight;
    if (setupGeneration !== this.generation) return undefined;
    // The promise may have belonged to an older settings generation. The
    // latest caller owns the new generation and must run it once the old one
    // has settled, rather than returning stale diagnostics/configuration.
    if (startedGeneration !== setupGeneration && this.current === config) {
      this.setupInFlight = this.runSetup(config, setupGeneration).finally(() => {
        this.setupInFlight = undefined;
        this.setupInFlightGeneration = undefined;
      });
      this.setupInFlightGeneration = setupGeneration;
      return await this.setupInFlight;
    }
    return result;
  }

  invalidate(): void {
    this.generation += 1;
    this.current = undefined;
  }

  async testConnection(config: PrintIntakeConfig): Promise<{
    valid: true;
    consumerExists: boolean;
    message: string;
    stream: string;
    durable: string;
    subject: string;
  }> {
    try {
      await this.options.jsm.streams.info(config.stream);
    } catch (error) {
      throw asOperationError('STREAM_LOOKUP', error);
    }
    try {
      const existing = await this.options.jsm.consumers.info(config.stream, durableName(config));
      const diff = differences(expectedConfig(config), existing.config);
      if (diff.length > 0) throw new ConsumerConfigConflictError(config.stream, durableName(config), diff);
      return { valid: true, consumerExists: true, message: 'Connection valid; existing consumer is compatible.', stream: config.stream, durable: durableName(config), subject: subject(config) };
    } catch (error) {
      if (!isMissingConsumer(error)) throw error;
      return { valid: true, consumerExists: false, message: 'Connection valid; the production consumer will be created when settings are applied.', stream: config.stream, durable: durableName(config), subject: subject(config) };
    }
  }

  private async runSetup(config: PrintIntakeConfig, setupGeneration: number): Promise<EnsureResult> {
    try {
      const result = await ensurePrintIntakeConsumer(this.options.jsm, config);
      if (setupGeneration !== this.generation) return result;
      this.lastAction = result.action;
      if (!this.consumeLoopActive) {
        this.consumeLoopActive = true;
        try {
          await this.options.bind(result.consumer, config);
        } catch (error) {
          this.consumeLoopActive = false;
          throw asOperationError('CONSUMER_BIND', error);
        }
      }
      return result;
    } catch (error) {
      this.lastError = error instanceof NatsOperationError || error instanceof ConsumerConfigConflictError ? error : asOperationError('CONSUMER_LOOKUP', error);
      throw error;
    }
  }
}
