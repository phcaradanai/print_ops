import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import { ValidationError } from '@printerops/shared';

export function normalizeCupsServer(input: string): string {
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9][a-z0-9.-]*)(?::([0-9]{1,5}))?$/i.exec(input.trim());
  const hostname = match?.[1];
  const port = Number(match?.[2] ?? '631');
  if (!hostname || hostname.length > 253 || port < 1 || port > 65_535 ||
      (hostname.startsWith('[') && isIP(hostname.slice(1, -1)) !== 6)) {
    throw new ValidationError('Enter a CUPS hostname or IP address with an optional port, such as cups:631');
  }
  return `${hostname.toLowerCase()}:${port}`;
}

export function cupsServerSettings(dataDir = process.env['PRINTOPS_DATA_DIR'] || './data') {
  const dir = resolve(dataDir);
  const file = join(dir, 'cups-server.conf');
  return {
    async read(): Promise<string | undefined> {
      try {
        return normalizeCupsServer(await readFile(file, 'utf8'));
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async save(server: string): Promise<void> {
      await mkdir(dir, { recursive: true });
      const temporary = join(dir, `cups-server-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, `${server}\n`, { mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    },
  };
}

/** CUPS administrator identity used for queue management over IPP. */
export type CupsAdminCredentials = { user: string; password: string };

const CUPS_USER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/;

export function normalizeCupsAdminCredentials(input: unknown): CupsAdminCredentials {
  const body = (input ?? {}) as { user?: unknown; password?: unknown };
  const user = typeof body.user === 'string' ? body.user.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!CUPS_USER_PATTERN.test(user) || user.length === 0) {
    throw new ValidationError('Enter the CUPS administrator user name');
  }
  if (password.length === 0 || password.length > 256) {
    throw new ValidationError('Enter the CUPS administrator password');
  }
  return { user, password };
}

/**
 * CUPS is a station-local spooler, so PrintOps keeps its own administrator
 * credentials instead of asking an operator to run `lpadmin` on the host.
 * `CUPS_ADMIN_USER`/`CUPS_ADMIN_PASSWORD` stay supported for deployments that
 * must not keep the password on disk.
 */
export function cupsAdminSettings(dataDir = process.env['PRINTOPS_DATA_DIR'] || './data') {
  const dir = resolve(dataDir);
  const file = join(dir, 'cups-admin.json');
  const fromEnv = (): CupsAdminCredentials | undefined => {
    const user = process.env['CUPS_ADMIN_USER'];
    const password = process.env['CUPS_ADMIN_PASSWORD'];
    return user && password ? { user, password } : undefined;
  };
  return {
    async read(): Promise<CupsAdminCredentials | undefined> {
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<CupsAdminCredentials>;
        if (typeof parsed.user === 'string' && parsed.user && typeof parsed.password === 'string' && parsed.password) {
          return { user: parsed.user, password: parsed.password };
        }
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          // A corrupt file must not silently fall back to different credentials.
          throw error;
        }
      }
      return fromEnv();
    },
    /** Never returns the password; the UI only needs to know an account exists. */
    async status(): Promise<{ configured: boolean; user?: string; source: 'file' | 'env' | 'none' }> {
      const credentials = await this.read();
      if (!credentials) return { configured: false, source: 'none' };
      let source: 'file' | 'env' = 'env';
      try {
        await readFile(file, 'utf8');
        source = 'file';
      } catch {
        source = 'env';
      }
      return { configured: true, user: credentials.user, source };
    },
    async save(credentials: CupsAdminCredentials): Promise<void> {
      await mkdir(dir, { recursive: true });
      const temporary = join(dir, `cups-admin-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(credentials), { mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    },
    async clear(): Promise<void> {
      await rm(file, { force: true });
    },
  };
}
