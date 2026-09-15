import { describe, it, expect } from 'vitest';
import { printIntakeConfigFromEnv, redactNatsUrl } from '../infra/nats/print-intake.js';

const base = { NATS_URL: 'nats://nats:4222' } as NodeJS.ProcessEnv;

describe('print-intake NATS config', () => {
  it('is disabled when no NATS url is set', () => {
    expect(printIntakeConfigFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('fails closed when NATS is enabled without a target client identity', () => {
    expect(() => printIntakeConfigFromEnv({ ...base }))
      .toThrow('PRINTOPS_NATS_CLIENT_ID is required');
  });

  it('derives a client-scoped subject and durable from the target client identity', () => {
    const cfg = printIntakeConfigFromEnv({
      ...base,
      PRINTOPS_NATS_CLIENT_ID: 'pharmacy-counter-01',
    });
    expect(cfg?.stream).toBe('MEDISYNC');
    expect(cfg?.clientId).toBe('pharmacy-counter-01');
    expect(cfg?.subject).toBe('medisync.print.intake.pharmacy-counter-01');
    expect(cfg?.durable).toBe('printops-print-intake-pharmacy-counter-01');
    expect(cfg?.dlqPrefix).toBe('medisync.dlq.');
    expect(cfg?.maxDeliver).toBe(5);
  });

  it('honours custom stream, subject and durable', () => {
    const cfg = printIntakeConfigFromEnv({
      ...base,
      PRINTOPS_NATS_CLIENT_ID: 'ward-a',
      PRINTOPS_NATS_SUBJECT_PREFIX: 'custom.intake',
      PRINTOPS_NATS_DURABLE: 'custom-ward-a',
      PRINTOPS_NATS_STREAM: 'CUSTOM',
      PRINTOPS_NATS_MAX_DELIVER: '9',
    });
    expect(cfg?.subject).toBe('custom.intake.ward-a');
    expect(cfg?.durable).toBe('custom-ward-a');
    expect(cfg?.stream).toBe('CUSTOM');
    expect(cfg?.maxDeliver).toBe(9);
  });

  it('prefers PRINTOPS_NATS_URL over NATS_URL', () => {
    const cfg = printIntakeConfigFromEnv({
      ...base,
      PRINTOPS_NATS_URL: 'nats://other:4222',
      PRINTOPS_NATS_CLIENT_ID: 'counter-01',
    });
    expect(cfg?.url).toBe('nats://other:4222');
  });

  it('redacts credentials from the NATS url', () => {
    expect(redactNatsUrl('nats://user:secret@nats:4222')).toBe('nats://***@nats:4222');
    expect(redactNatsUrl('nats://nats:4222')).toBe('nats://nats:4222');
  });

  it('rejects a NATS client id that could escape its subject token', () => {
    expect(() => printIntakeConfigFromEnv({
      ...base,
      PRINTOPS_NATS_CLIENT_ID: 'counter.*',
    })).toThrow('PRINTOPS_NATS_CLIENT_ID');
  });

  it('rejects an explicitly shared durable that could compete with another client', () => {
    expect(() => printIntakeConfigFromEnv({
      ...base,
      PRINTOPS_NATS_CLIENT_ID: 'counter-01',
      PRINTOPS_NATS_DURABLE: 'printops-print-intake',
    })).toThrow('PRINTOPS_NATS_DURABLE');
  });
});
