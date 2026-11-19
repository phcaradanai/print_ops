/**
 * Operator-editable NATS print-intake settings for the server/browser build.
 *
 * The desktop shell has always persisted these four fields to
 * `nats-settings.json` in its per-user data directory and re-launched
 * `server.exe` with `PRINTOPS_NATS_*` environment variables. That made NATS
 * configuration desktop-only: a Linux server install could only be configured
 * through environment variables and the dashboard reported "NATS settings are
 * unavailable". This module gives the API the same file, schema and validation
 * rules so both builds configure intake identically.
 *
 * Wire shape and validation deliberately mirror
 * `apps/desktop/src-tauri/src/lib.rs` (`NatsSettings`, `validate_nats_settings`,
 * `is_nats_token`, `is_nats_subject_prefix`) so a settings file written by one
 * build is valid for the other, and so the dashboard can show the same error
 * text from either path.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ValidationError } from '@printerops/shared';
import { printIntakeConfigFor, type PrintIntakeConfig } from './print-intake.js';

export interface NatsSettings {
  enabled: boolean;
  url: string;
  clientId: string;
  subjectPrefix: string;
}

export type NatsSettingsSource = 'file' | 'env' | 'default';

export const DEFAULT_NATS_SETTINGS: NatsSettings = {
  enabled: false,
  url: '',
  clientId: '',
  subjectPrefix: 'medisync.print.intake',
};

/** A client id (and each subject token) must be one literal NATS token. */
export function isNatsToken(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value);
}

/** A subject prefix is one or more literal NATS tokens separated by dots. */
export function isNatsSubjectPrefix(value: string): boolean {
  return value.length > 0 && value.split('.').every(isNatsToken);
}

function optionalString(value: unknown, field: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new ValidationError(`NATS settings field "${field}" must be a string`);
  }
  return value;
}

/**
 * Validates a settings payload with exactly the desktop shell's rules.
 *
 * Disabled settings are accepted with empty fields (that is how an operator
 * turns intake off). When enabled, every rule below is the desktop shell's own
 * message, so the dashboard shows identical text for either build.
 */
export function validateNatsSettings(input: unknown): NatsSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError(
      'NATS settings must be a JSON object with enabled, url, clientId and subjectPrefix',
    );
  }
  const body = input as Record<string, unknown>;
  if (typeof body['enabled'] !== 'boolean') {
    throw new ValidationError('NATS settings must include "enabled" as true or false');
  }
  const settings: NatsSettings = {
    enabled: body['enabled'],
    url: optionalString(body['url'], 'url'),
    clientId: optionalString(body['clientId'], 'clientId'),
    subjectPrefix: optionalString(body['subjectPrefix'], 'subjectPrefix'),
  };
  if (!settings.enabled) return settings;
  if (settings.url.trim().length === 0) {
    throw new ValidationError('NATS URL is required when NATS is enabled');
  }
  if (!settings.url.trim().startsWith('nats://')) {
    throw new ValidationError('NATS URL must start with nats://');
  }
  if (!isNatsToken(settings.clientId)) {
    throw new ValidationError('Client ID may contain only letters, digits, _ and -');
  }
  if (!isNatsSubjectPrefix(settings.subjectPrefix)) {
    throw new ValidationError('Subject prefix must contain literal NATS tokens separated by dots');
  }
  return settings;
}

/**
 * Where the API keeps `nats-settings.json`.
 *
 * `PRINTOPS_DATA_DIR` is the documented server data directory. When only
 * `PRINTOPS_DB_PATH` is set — which is exactly what the desktop shell does —
 * the settings file sits next to `printops.db` inside the shell's app-data
 * directory, i.e. the same file the shell itself reads and writes. That keeps
 * one physical source of truth whether an operator saves from the dashboard or
 * from the desktop shell's own bridge.
 */
export function natsSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env['PRINTOPS_NATS_SETTINGS_PATH']?.trim();
  if (explicit) return resolve(explicit);
  const dataDir = env['PRINTOPS_DATA_DIR']?.trim();
  if (dataDir) return join(resolve(dataDir), 'nats-settings.json');
  const dbPath = env['PRINTOPS_DB_PATH']?.trim();
  if (dbPath) return join(dirname(resolve(dbPath)), 'nats-settings.json');
  return join(resolve('data'), 'nats-settings.json');
}

export interface NatsSettingsStore {
  /** Absolute path of the settings file, for logs and support bundles. */
  readonly file: string;
  /** Persisted settings, or undefined when the file is missing or invalid. */
  read(): Promise<NatsSettings | undefined>;
  save(settings: NatsSettings): Promise<void>;
}

export function createNatsSettingsStore(env: NodeJS.ProcessEnv = process.env): NatsSettingsStore {
  const file = natsSettingsPath(env);
  const directory = dirname(file);
  return {
    file,
    async read(): Promise<NatsSettings | undefined> {
      let raw: string;
      try {
        raw = await readFile(file, 'utf8');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
        throw error;
      }
      try {
        return validateNatsSettings(JSON.parse(raw));
      } catch {
        // A hand-edited or half-written file must not take the API down, and it
        // must not silently change which broker receives clinical print jobs.
        // The desktop shell ignores an invalid file the same way; the effective
        // configuration then comes from the environment.
        return undefined;
      }
    },
    async save(settings: NatsSettings): Promise<void> {
      await mkdir(directory, { recursive: true });
      const temporary = join(directory, `.nats-settings-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    },
  };
}

/** The four editable fields behind an effective intake configuration. */
export function natsSettingsFromConfig(cfg: PrintIntakeConfig): NatsSettings {
  const suffix = `.${cfg.clientId}`;
  return {
    enabled: true,
    url: cfg.url,
    clientId: cfg.clientId,
    // printIntakeConfigFromEnv derives subject as "<prefix>.<clientId>".
    subjectPrefix: cfg.subject.endsWith(suffix) ? cfg.subject.slice(0, -suffix.length) : cfg.subject,
  };
}

/**
 * Builds the effective intake configuration for validated settings.
 *
 * Stream, durable, DLQ prefix and max-deliver still come from the environment,
 * so a site that tunes those keeps tuning them in one place; the dashboard only
 * owns the four fields the desktop shell owns.
 */
export function printIntakeConfigFromSettings(
  settings: NatsSettings,
  env: NodeJS.ProcessEnv = process.env,
): PrintIntakeConfig {
  return printIntakeConfigFor(
    { url: settings.url, clientId: settings.clientId, subjectPrefix: settings.subjectPrefix },
    env,
  );
}
