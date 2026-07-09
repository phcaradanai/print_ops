/**
 * SQLite database singleton using sql.js (pure WASM — zero native deps).
 *
 * On first access, initialises the WASM runtime, opens/creates `printops.db`,
 * runs the schema migration, and auto-saves on process exit.
 */
import initSqlJs, { type Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runSchemaMigration } from './sqlite.schema.js';

let _db: Database | undefined;
let _initialised = false;

/** DB file path — override via PRINTOPS_DB_PATH env var. */
export function dbPath(): string {
  const envPath = process.env['PRINTOPS_DB_PATH'];
  if (envPath) return resolve(envPath);
  return resolve(process.cwd(), 'printops.db');
}

/** Return the shared Database handle (sync). Auto-initialises on first call. */
export function getDb(): Database {
  if (!_db) throw new Error('SQLite not initialised — call initDatabase() first');
  return _db;
}

/** Persist the in-memory DB buffer to disk. */
export function saveDb(): void {
  const db = _db;
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const target = dbPath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  // eslint-disable-next-line no-console
  console.log(`[sqlite] saved ${buffer.length.toLocaleString()} bytes → ${target}`);
}

/** Start the WASM runtime, create/open the DB, run migrations. */
export async function initDatabase(): Promise<void> {
  if (_initialised) return;

  const SQL = await initSqlJs({
    // When bundled, locate the WASM file relative to the bundle.
    // Falls back to default behaviour (node_modules) for dev.
    locateFile: (file: string) => {
      const envPath = process.env['SQL_WASM_PATH'];
      if (envPath) return envPath;
      return file;
    },
  });

  const target = dbPath();
  if (existsSync(target)) {
    const buffer = readFileSync(target);
    _db = new SQL.Database(new Uint8Array(buffer));
    // eslint-disable-next-line no-console
    console.log(`[sqlite] opened ${target} (${buffer.length.toLocaleString()} bytes)`);
  } else {
    _db = new SQL.Database();
    // eslint-disable-next-line no-console
    console.log(`[sqlite] created new database (will save to ${target})`);
  }

  runSchemaMigration(_db);
  saveDb(); // persist initial schema

  // Auto-save on graceful shutdown
  const cleanup = () => { saveDb(); _db?.close(); };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  process.once('beforeExit', cleanup);

  _initialised = true;
}

/** Close and save (explicit call for tests). */
export function closeDatabase(): void {
  saveDb();
  _db?.close();
  _db = undefined;
  _initialised = false;
}