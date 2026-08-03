import { v4 as uuidv4 } from 'uuid';

export function generateId(): string {
  return uuidv4();
}

export function generateTraceId(): string {
  return `trace_${uuidv4()}`;
}

export function generateCorrelationId(): string {
  return `corr_${uuidv4()}`;
}
