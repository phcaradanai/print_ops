/**
 * SQLite database singleton using sql.js (pure WASM — zero native deps).
 *
 * On first access, initialises the WASM runtime, opens/creates `printops.db`,
 * runs the schema migration, and auto-saves on process exit.
 */
import initSqlJs, { type Database } from 'sql.js';
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { CURRENT_SCHEMA_VERSION, runSchemaMigration, schemaVersion } from './sqlite.schema.js';

let _db: Database | undefined;
let _persistentDb: Database | undefined;
let _initialised = false;
let _initialising: { generation: number; promise: Promise<void> } | undefined;
let _lifecycleGeneration = 0;
let _activeGeneration: number | undefined;
let _saveQueued = false;
let _activeDbPath: string | undefined;
let _dbLockServer: Server | undefined;
let _dbLockEndpoint: string | undefined;
let _dbLockRelease: Promise<void> = Promise.resolve();
let _cleanupHandlersInstalled = false;

export function databaseBackupDirectory(target = dbPath()): string {
  return `${resolve(target)}.backups`;
}

function backupTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Create a byte-for-byte copy before any migration mutates the in-memory DB. */
export function createPreMigrationBackup(target: string, fromVersion: number): string {
  const directory = databaseBackupDirectory(target);
  mkdirSync(directory, { recursive: true });
  const backup = join(
    directory,
    `printops-before-v${fromVersion}-to-v${CURRENT_SCHEMA_VERSION}-${backupTimestamp()}.db`,
  );
  copyFileSync(target, backup);
  return backup;
}

function queueSave(): void {
  if (_saveQueued) return;
  _saveQueued = true;
  queueMicrotask(() => {
    _saveQueued = false;
    saveDb();
  });
}

/** DB file path — override via PRINTOPS_DB_PATH env var. */
export function dbPath(): string {
  const envPath = process.env['PRINTOPS_DB_PATH'];
  if (envPath) return resolve(envPath);
  return resolve(process.cwd(), 'printops.db');
}

/**
 * OS-owned endpoint used as an exclusive lock for one sql.js database file.
 *
 * A Windows named pipe disappears automatically when its owning process exits,
 * including crashes and forced termination. This avoids the stale-file problem
 * of conventional `.lock` files while still preventing two packaged API
 * processes from loading and later overwriting the same database snapshot.
 */
export function databaseLockEndpoint(target = dbPath()): string {
  const absolute = resolve(target);
  const canonical = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 32);

  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\printerops-sqljs-${digest}`;
  }
  if (process.platform === 'linux') {
    // Linux abstract sockets are kernel-owned and, like Windows named pipes,
    // cannot leave a stale filesystem entry after a crash.
    return `\0printerops-sqljs-${digest}`;
  }
  return join(tmpdir(), `printerops-sqljs-${digest}.sock`);
}

async function acquireDatabaseLock(target: string): Promise<void> {
  await _dbLockRelease;

  const endpoint = databaseLockEndpoint(target);
  const server = createServer((socket) => socket.destroy());

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      if (error.code === 'EADDRINUSE') {
        rejectListen(new Error(
          `PRINTOPS_DB_LOCKED: another PrinterOps API instance is already using ${target}. `
          + 'Close the duplicate application before starting it again.',
        ));
        return;
      }
      rejectListen(new Error(`Unable to lock PrinterOps database ${target}: ${error.message}`));
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolveListen();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(endpoint);
  });

  // The API listener, not this guard, owns process lifetime. The server object
  // remains live and therefore retains the exclusive OS lock until close/crash.
  server.unref();
  _dbLockServer = server;
  _dbLockEndpoint = endpoint;
}

function beginReleaseDatabaseLock(): Promise<void> {
  const server = _dbLockServer;
  const endpoint = _dbLockEndpoint;
  _dbLockServer = undefined;
  _dbLockEndpoint = undefined;
  const previousRelease = _dbLockRelease;
  const currentRelease = server
    ? new Promise<void>((resolveClose) => {
        try {
          server.close(() => {
            // Node normally removes Unix socket files itself. This is a defensive
            // cleanup for macOS; never applies to Windows named pipes.
            if (process.platform !== 'win32' && process.platform !== 'linux'
              && endpoint && existsSync(endpoint)) {
              try { unlinkSync(endpoint); } catch { /* best effort */ }
            }
            resolveClose();
          });
        } catch {
          resolveClose();
        }
      })
    : Promise.resolve();

  // A close may race an earlier close whose callback has not fired yet. Keep
  // both in the barrier so a replacement init never binds while cleanup from
  // an older lifecycle is still pending.
  _dbLockRelease = Promise.all([previousRelease, currentRelease]).then(() => undefined);
  return _dbLockRelease;
}

function assertCurrentGeneration(generation: number): void {
  if (_lifecycleGeneration !== generation) {
    throw new Error('PRINTOPS_DB_INIT_CANCELLED: database was closed while initialisation was in progress');
  }
}

/**
 * Return the shared database through a small persistence facade.
 *
 * sql.js keeps its database in memory, so its file is only updated when
 * `export()` is called. Persisting after every direct `run()` makes writes
 * durable even when the desktop shell terminates its sidecar on close.
 */
export function getDb(): Database {
  if (!_db) throw new Error('SQLite not initialised — call initDatabase() first');
  if (!_persistentDb) {
    _persistentDb = new Proxy(_db, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (property === 'run') {
          return (...args: unknown[]) => {
            const result = (value as (...runArgs: unknown[]) => unknown).apply(target, args);
            // sql.js resets getRowsModified() when exporting. Deferring the
            // export by one microtask preserves the result for callers that
            // inspect it immediately after an UPDATE/claim.
            queueSave();
            return result;
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as Database;
  }
  return _persistentDb;
}

/** Persist the in-memory DB buffer to disk. */
export function saveDb(): void {
  const db = _db;
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const target = _activeDbPath ?? dbPath();
  // Never overwrite the durable copy in-place. A crash during a direct write
  // can truncate the database and erase saved profiles; rename keeps either
  // the previous or the complete new snapshot at the canonical path.
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(temporary, buffer);
    renameSync(temporary, target);
  } catch (error) {
    throw new Error(
      `PRINTOPS_DB_WRITE_FAILED: cannot persist ${target}. Check disk space, folder permissions, and file locks. `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (existsSync(temporary)) {
      try { unlinkSync(temporary); } catch { /* preserve the primary DB */ }
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[sqlite] saved ${buffer.length.toLocaleString()} bytes → ${target}`);
}

/** Start the WASM runtime, create/open the DB, run migrations. */
export async function initDatabase(): Promise<void> {
  const requestedGeneration = _lifecycleGeneration;
  if (_initialised && _activeGeneration === requestedGeneration) return;

  // Concurrent buildApp()/test callers in one process share the same startup
  // operation; cross-process exclusion is provided by the OS lock below.
  const running = _initialising;
  if (running) {
    if (running.generation === requestedGeneration) return running.promise;

    // This request began after closeDatabase() cancelled an older init. Wait
    // for that task to release any lock it acquired, then start the requested
    // generation. Errors from the cancelled generation are intentionally not
    // inherited by the new lifecycle.
    try { await running.promise; } catch { /* cancelled/failed older lifecycle */ }
    assertCurrentGeneration(requestedGeneration);
    if (_initialised && _activeGeneration === requestedGeneration) return;

    // Multiple callers can wait on the same cancelled generation. The first
    // continuation starts the replacement; all later continuations must join
    // it instead of creating two lock acquisitions for the new generation.
    const replacement = _initialising;
    if (replacement?.generation === requestedGeneration) return replacement.promise;
  }

  return startDatabaseInitialisation(requestedGeneration);
}

function startDatabaseInitialisation(generation: number): Promise<void> {
  const promise = runDatabaseInitialisation(generation);
  _initialising = { generation, promise };
  return promise;
}

async function runDatabaseInitialisation(generation: number): Promise<void> {
  try {
    await initialiseDatabase(generation);
  } finally {
    if (_initialising?.generation === generation) _initialising = undefined;
  }
}

async function initialiseDatabase(generation: number): Promise<void> {
  const target = dbPath();
  await acquireDatabaseLock(target);

  try {
    assertCurrentGeneration(generation);
    _activeDbPath = target;

    const SQL = await initSqlJs({
      // When bundled, locate the WASM file relative to the bundle.
      // Falls back to default behaviour (node_modules) for dev.
      locateFile: (file: string) => {
        const envPath = process.env['SQL_WASM_PATH'];
        if (envPath && existsSync(envPath)) return envPath;
        // Fallback: look alongside the executable
        const local = join(dirname(process.execPath), file);
        if (existsSync(local)) return local;
        return file;
      },
    });

    // closeDatabase() may have run while WASM was loading. Do not read or
    // recreate the DB after that close, and do not retain the acquired lock.
    assertCurrentGeneration(generation);

    let openedExisting = false;
    if (existsSync(target)) {
      let buffer: Buffer;
      try {
        buffer = readFileSync(target);
      } catch (error) {
        throw new Error(
          `PRINTOPS_DB_READ_FAILED: cannot read ${target}. Check permissions and ensure the path is a database file. `
          + `${error instanceof Error ? error.message : String(error)}`,
        );
      }
      try {
        _db = new SQL.Database(new Uint8Array(buffer));
        const integrity = _db.exec('PRAGMA integrity_check');
        if (integrity[0]?.values[0]?.[0] !== 'ok') {
          throw new Error(`integrity_check returned ${String(integrity[0]?.values[0]?.[0] ?? 'no result')}`);
        }
      } catch (error) {
        throw new Error(
          `PRINTOPS_DB_CORRUPT: unable to open ${target}. Preserve the file and restore a verified backup. `
          + `${error instanceof Error ? error.message : String(error)}`,
        );
      }
      openedExisting = true;
      // eslint-disable-next-line no-console
      console.log(`[sqlite] opened ${target} (${buffer.length.toLocaleString()} bytes)`);
    } else {
      _db = new SQL.Database();
      // eslint-disable-next-line no-console
      console.log(`[sqlite] created new database (will save to ${target})`);
    }

    const fromVersion = schemaVersion(_db);
    let backupPath: string | undefined;
    if (openedExisting && fromVersion < CURRENT_SCHEMA_VERSION) {
      backupPath = createPreMigrationBackup(target, fromVersion);
      // eslint-disable-next-line no-console
      console.log(`[sqlite] pre-migration backup → ${backupPath}`);
    }
    try {
      runSchemaMigration(_db);
    } catch (error) {
      throw new Error(
        `PRINTOPS_DB_MIGRATION_FAILED: schema ${fromVersion} → ${CURRENT_SCHEMA_VERSION} failed. `
        + `Original database preserved${backupPath ? `; backup: ${backupPath}` : ''}. `
        + `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    saveDb(); // persist initial schema

    if (!_cleanupHandlersInstalled) {
      const cleanup = () => closeDatabase();
      process.once('SIGINT', cleanup);
      process.once('SIGTERM', cleanup);
      process.once('beforeExit', cleanup);
      _cleanupHandlersInstalled = true;
    }

    _activeGeneration = generation;
    _initialised = true;
  } catch (error) {
    _db?.close();
    _db = undefined;
    _persistentDb = undefined;
    _activeGeneration = undefined;
    _activeDbPath = undefined;
    await beginReleaseDatabaseLock();
    throw error;
  }
}

/** Close and save (explicit call for tests). */
export function closeDatabase(opts: { save?: boolean } = {}): void {
  // Invalidate an init that is currently awaiting its OS lock or WASM load.
  // The task observes this token before opening the file and cleans up its
  // eventual lock. A post-close init waits for that cleanup before replacing it.
  _lifecycleGeneration += 1;
  if (opts.save !== false) saveDb();
  _db?.close();
  _db = undefined;
  _persistentDb = undefined;
  _initialised = false;
  _activeGeneration = undefined;
  _saveQueued = false;
  _activeDbPath = undefined;
  void beginReleaseDatabaseLock();
}
