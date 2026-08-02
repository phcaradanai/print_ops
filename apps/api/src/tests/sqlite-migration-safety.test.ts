import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  closeDatabase,
  createPreMigrationBackup,
  databaseBackupDirectory,
  getDb,
  initDatabase,
} from '../infra/db/sqlite.js';
import {
  CURRENT_SCHEMA_VERSION,
  runSchemaMigration,
  schemaVersion,
} from '../infra/db/sqlite.schema.js';
import { SqliteUserRepository } from '../infra/repos/sqlite/sqlite-user.repo.js';
import { hashPassword, verifyPassword } from '../infra/auth/password.js';

const tempDirectories: string[] = [];
const originalDbPath = process.env['PRINTOPS_DB_PATH'];
const originalWasmPath = process.env['SQL_WASM_PATH'];
const SQL_WASM_PATH = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'printops-migration-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  closeDatabase({ save: false });
  if (originalDbPath === undefined) delete process.env['PRINTOPS_DB_PATH'];
  else process.env['PRINTOPS_DB_PATH'] = originalDbPath;
  if (originalWasmPath === undefined) delete process.env['SQL_WASM_PATH'];
  else process.env['SQL_WASM_PATH'] = originalWasmPath;
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('versioned SQLite migration', () => {
  it('migrates a legacy unversioned database transactionally and preserves data', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE legacy_marker (value TEXT NOT NULL)');
    db.run("INSERT INTO legacy_marker (value) VALUES ('preserve-me')");
    expect(schemaVersion(db)).toBe(0);

    runSchemaMigration(db);

    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    expect(db.exec('SELECT value FROM legacy_marker')[0]?.values[0]?.[0]).toBe('preserve-me');
    expect(db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'")[0]?.values).toHaveLength(1);
    runSchemaMigration(db);
    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    db.close();
  });

  it('adds per-user access storage to an existing version-1 database', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'VIEWER',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.run("INSERT INTO users VALUES ('owner', 'owner@example.test', 'Owner', 'existing-hash', 'OWNER', 1, '2026-01-01', '2026-01-01')");
    db.run('PRAGMA user_version=1');

    runSchemaMigration(db);

    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    const columns = db.exec('PRAGMA table_info(users)')[0]?.values.map((row) => row[1]);
    expect(columns).toContain('allowed_pages_json');
    expect(db.exec("SELECT password_hash FROM users WHERE id = 'owner'")[0]?.values[0]?.[0]).toBe('existing-hash');
    db.close();
  });

  it('refuses a database created by a newer application without changing it', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`PRAGMA user_version=${CURRENT_SCHEMA_VERSION + 1}`);
    const before = Buffer.from(db.export());
    expect(() => runSchemaMigration(db)).toThrow(/PRINTOPS_DB_NEWER_SCHEMA/);
    expect(Buffer.from(db.export())).toEqual(before);
    db.close();
  });

  it('creates a byte-for-byte pre-migration backup outside the primary path', () => {
    const directory = temporaryDirectory();
    const target = join(directory, 'printops.db');
    const original = Buffer.from('legacy-database-bytes');
    writeFileSync(target, original);
    const backup = createPreMigrationBackup(target, 0);
    expect(backup.startsWith(databaseBackupDirectory(target))).toBe(true);
    expect(readFileSync(backup)).toEqual(original);
    expect(readFileSync(target)).toEqual(original);
  });

  it('backs up and upgrades a real prior-version file during initialization', async () => {
    const SQL = await initSqlJs();
    const legacy = new SQL.Database();
    legacy.run('CREATE TABLE legacy_marker (value TEXT NOT NULL)');
    legacy.run("INSERT INTO legacy_marker VALUES ('still-here')");
    const legacyBytes = Buffer.from(legacy.export());
    legacy.close();

    const directory = temporaryDirectory();
    const target = join(directory, 'printops.db');
    writeFileSync(target, legacyBytes);
    process.env['PRINTOPS_DB_PATH'] = target;
    process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;
    await initDatabase();

    expect(schemaVersion(getDb())).toBe(CURRENT_SCHEMA_VERSION);
    expect(getDb().exec('SELECT value FROM legacy_marker')[0]?.values[0]?.[0]).toBe('still-here');
    const backups = readdirSync(databaseBackupDirectory(target));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(databaseBackupDirectory(target), backups[0]!))).toEqual(legacyBytes);
  });

  it('keeps password and page-access updates after an immediate database restart', async () => {
    const directory = temporaryDirectory();
    process.env['PRINTOPS_DB_PATH'] = join(directory, 'printops.db');
    process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;
    await initDatabase();
    const users = new SqliteUserRepository();
    const originalHash = await hashPassword('Original-password1!');
    const user = await users.create({
      email: 'operator@example.test',
      name: 'Operator',
      passwordHash: originalHash,
      role: 'OPERATOR',
      isActive: true,
    });
    const replacementHash = await hashPassword('Replacement-password2!');
    await users.update(user.id, { passwordHash: replacementHash, allowedPages: ['/', '/jobs'] });

    closeDatabase({ save: false });
    await initDatabase();

    const reopened = await new SqliteUserRepository().findById(user.id);
    expect(await verifyPassword('Replacement-password2!', reopened?.passwordHash)).toBe(true);
    expect(await verifyPassword('Original-password1!', reopened?.passwordHash)).toBe(false);
    expect(reopened?.allowedPages).toEqual(['/', '/jobs']);
  });

  it('preserves a corrupt database and returns an actionable startup error', async () => {
    const directory = temporaryDirectory();
    const target = join(directory, 'printops.db');
    const corrupt = Buffer.from('not-a-sqlite-database');
    writeFileSync(target, corrupt);
    process.env['PRINTOPS_DB_PATH'] = target;
    process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;

    await expect(initDatabase()).rejects.toThrow(/PRINTOPS_DB_CORRUPT/);
    expect(readFileSync(target)).toEqual(corrupt);
  });

  it('rejects a directory masquerading as the database path with a read-stage error', async () => {
    const directory = temporaryDirectory();
    process.env['PRINTOPS_DB_PATH'] = directory;
    process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;
    await expect(initDatabase()).rejects.toThrow(/PRINTOPS_DB_READ_FAILED/);
  });

  it('reports an actionable write-stage error when the database parent cannot be created', async () => {
    const directory = temporaryDirectory();
    const blockingFile = join(directory, 'not-a-directory');
    writeFileSync(blockingFile, 'blocking-file');
    process.env['PRINTOPS_DB_PATH'] = join(blockingFile, 'printops.db');
    process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;

    await expect(initDatabase()).rejects.toThrow(/PRINTOPS_DB_WRITE_FAILED/);
    expect(readFileSync(blockingFile, 'utf8')).toBe('blocking-file');
  });
});
