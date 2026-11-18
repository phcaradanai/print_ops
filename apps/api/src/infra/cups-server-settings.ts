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
