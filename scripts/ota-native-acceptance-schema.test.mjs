import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  createAcceptanceSchemaOverlay,
  deriveAcceptanceSchemaVersions,
  readCurrentSchemaVersion,
} from './ota-native-acceptance-schema.mjs';

const initSqlJs = createRequire(new URL('../apps/api/package.json', import.meta.url))('sql.js');

const migrationNumberWords = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
];
const SQL = await initSqlJs();

function schemaFixture(version) {
  const migrations = Array.from({ length: version }, (_, index) => {
    const migrationVersion = index + 1;
    const functionName = `migrateVersion${migrationNumberWords[index]}To${migrationNumberWords[migrationVersion]}`;
    const extraTable = migrationVersion === 7
      ? "db.run(`CREATE TABLE IF NOT EXISTS ota_update_state (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL DEFAULT 'IDLE', target_version TEXT, started_at TEXT, updated_at TEXT NOT NULL, error_message TEXT, retry_count INTEGER NOT NULL DEFAULT 0)`);\n  db.run(`INSERT OR IGNORE INTO ota_update_state (id, state, updated_at) VALUES (1, 'IDLE', datetime('now'))`);\n  db.run('CREATE TABLE IF NOT EXISTS content_history (id INTEGER PRIMARY KEY)');"
      : migrationVersion === 8
        ? "db.run('CREATE TABLE IF NOT EXISTS control_devices (id INTEGER PRIMARY KEY)');"
        : '';
    return `function ${functionName}(db) {
  ${extraTable}
}
`;
  }).join('\n');
  const guards = Array.from({ length: version }, (_, index) => {
    const migrationVersion = index + 1;
    const functionName = `migrateVersion${migrationNumberWords[index]}To${migrationNumberWords[migrationVersion]}`;
    return `    if (fromVersion < ${migrationVersion}) ${functionName}(db);`;
  }).join('\n');

  return `export const CURRENT_SCHEMA_VERSION = ${version};

export function schemaVersion(db) {
  const result = db.exec('PRAGMA user_version');
  return Number(result[0]?.values[0]?.[0] ?? 0);
}

${migrations}
export function runSchemaMigration(db) {
  const fromVersion = schemaVersion(db);
  if (fromVersion > CURRENT_SCHEMA_VERSION) throw new Error('database schema is newer');
  if (fromVersion === CURRENT_SCHEMA_VERSION)
    return;

  db.run('BEGIN IMMEDIATE TRANSACTION');
  try {
${guards}
        db.run(\`PRAGMA user_version=\${CURRENT_SCHEMA_VERSION}\`);
        db.run('COMMIT');
  } catch (error) {
    try { db.run('ROLLBACK'); } catch { /* retain migration error */ }
    throw error;
  }
}
`;
}

async function loadSchemaModule(source) {
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function hasTable(db, name) {
  return db.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${name}'`).length > 0;
}

function userVersion(db) {
  return Number(db.exec('PRAGMA user_version')[0]?.values[0]?.[0] ?? 0);
}

test('acceptance A remains at B-1 and withholds only the newest migration for schema 7 and 8', async () => {
  for (const bSchema of [7, 8]) {
    const sourceSchema = schemaFixture(bSchema);
    const compiledSchema = sourceSchema;
    const versions = deriveAcceptanceSchemaVersions({
      sourceSchemaVersion: readCurrentSchemaVersion(sourceSchema),
    });

    const { source: aSchemaSource } = createAcceptanceSchemaOverlay({
      sourceSchema: compiledSchema,
      compiledSchema,
      aSchema: versions.aSchema,
    });
    const aModule = await loadSchemaModule(aSchemaSource);
    const aDatabase = new SQL.Database();
    try {
      aDatabase.run(`PRAGMA user_version=${versions.aSchema - 1}`);
      aModule.runSchemaMigration(aDatabase);
      assert.equal(userVersion(aDatabase), versions.aSchema);
      if (bSchema === 7) {
        assert.equal(hasTable(aDatabase, 'content_history'), false);
      } else {
        assert.equal(hasTable(aDatabase, 'content_history'), true);
        assert.equal(hasTable(aDatabase, 'control_devices'), false);
      }
      assert.equal(hasTable(aDatabase, 'ota_update_state'), true);
    } finally {
      aDatabase.close();
    }

    const bModule = await loadSchemaModule(compiledSchema);
    const bDatabase = new SQL.Database();
    try {
      bDatabase.run(`PRAGMA user_version=${bSchema - 1}`);
      bModule.runSchemaMigration(bDatabase);
      assert.equal(userVersion(bDatabase), bSchema);
      if (bSchema === 7) assert.equal(hasTable(bDatabase, 'content_history'), true);
      else assert.equal(hasTable(bDatabase, 'control_devices'), true);
    } finally {
      bDatabase.close();
    }
  }
});

test('schema overrides and source/compiled mismatches cannot mislabel acceptance artifacts', () => {
  assert.deepEqual(
    deriveAcceptanceSchemaVersions({ sourceSchemaVersion: 8, aOverride: '7', bOverride: '8' }),
    { aSchema: 7, bSchema: 8 },
  );
  assert.throws(
    () => deriveAcceptanceSchemaVersions({ sourceSchemaVersion: 8, bOverride: '7' }),
    /does not match checked-out API schema/,
  );
  assert.throws(
    () => deriveAcceptanceSchemaVersions({ sourceSchemaVersion: 8, aOverride: '6' }),
    /must be exactly one less than B schema/,
  );

  const schema7 = schemaFixture(7);
  const schema8 = schemaFixture(8);
  assert.throws(
    () => createAcceptanceSchemaOverlay({ sourceSchema: schema8, compiledSchema: schema7, aSchema: 7 }),
    /does not match checked-out API schema/,
  );
  const changedMigrationGuard = schema8.replace(
    'if (fromVersion < 8) migrateVersionSevenToEight(db);',
    'if (fromVersion < 8) migrateVersionSixToSeven(db);',
  );
  assert.throws(
    () => createAcceptanceSchemaOverlay({ sourceSchema: schema8, compiledSchema: changedMigrationGuard, aSchema: 7 }),
    /migration guard 8 must call migrateVersionSevenToEight/,
  );
});
