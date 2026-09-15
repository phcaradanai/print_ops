export interface LogContext {
  traceId?: string;
  correlationId?: string;
  jobId?: string;
  runnerId?: string;
  printerId?: string;
  [key: string]: unknown;
}

export interface Logger {
  info(message: string, ctx?: LogContext): void;
  warn(message: string, ctx?: LogContext): void;
  error(message: string, ctx?: LogContext): void;
  debug(message: string, ctx?: LogContext): void;
}

export const consoleLogger: Logger = {
  info: (msg, ctx) => console.log(JSON.stringify({ level: 'info', msg, ...sanitize(ctx) })),
  warn: (msg, ctx) => console.warn(JSON.stringify({ level: 'warn', msg, ...sanitize(ctx) })),
  error: (msg, ctx) => console.error(JSON.stringify({ level: 'error', msg, ...sanitize(ctx) })),
  debug: (msg, ctx) => console.debug(JSON.stringify({ level: 'debug', msg, ...sanitize(ctx) })),
};

function sanitize(ctx?: LogContext): LogContext | undefined {
  if (!ctx) return undefined;
  const safe: LogContext = {};
  for (const [k, v] of Object.entries(ctx)) {
    // never log secrets
    if (/password|secret|token|key|auth/i.test(k)) continue;
    safe[k] = v;
  }
  return safe;
}
