const schemaVersionPattern = /\bexport\s+const\s+CURRENT_SCHEMA_VERSION\s*=\s*(\d+)\s*;/g;
const migrationNumberWords = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen', 'Twenty',
];

function requireInvariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseSchemaOverride(value, name) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  requireInvariant(/^\d+$/.test(text), `${name} must be a non-negative integer`);
  const version = Number(text);
  requireInvariant(Number.isSafeInteger(version), `${name} must be a non-negative integer`);
  return version;
}

function inspectSchemaSource(source, label) {
  const constants = [...source.matchAll(schemaVersionPattern)];
  requireInvariant(constants.length === 1, `${label} must contain exactly one CURRENT_SCHEMA_VERSION constant`);
  const version = Number(constants[0][1]);
  requireInvariant(Number.isSafeInteger(version) && version > 0, `${label} CURRENT_SCHEMA_VERSION must be a positive safe integer`);
  requireInvariant(version < migrationNumberWords.length, `${label} schema ${version} has no supported migration name mapping`);

  const migrationPattern = /\bif\s*\(\s*fromVersion\s*<\s*(\d+)\s*\)\s*([A-Za-z_$][\w$]*)\s*\(\s*db\s*\)\s*;/g;
  const migrations = [...source.matchAll(migrationPattern)].map((match) => ({
    version: Number(match[1]),
    functionName: match[2],
    text: match[0],
  }));
  requireInvariant(migrations.length === version, `${label} must have one migration guard for each schema version 1..${version}`);
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    const expectedFunction = `migrateVersion${migrationNumberWords[expectedVersion - 1]}To${migrationNumberWords[expectedVersion]}`;
    requireInvariant(
      migration.version === expectedVersion && migration.functionName === expectedFunction,
      `${label} migration guard ${index + 1} must call ${expectedFunction}`,
    );
  });
  return { version, constantText: constants[0][0], migrations };
}

export function readCurrentSchemaVersion(source, label = 'checked-out API schema') {
  return inspectSchemaSource(source, label).version;
}

export function deriveAcceptanceSchemaVersions({ sourceSchemaVersion, aOverride, bOverride }) {
  requireInvariant(
    Number.isSafeInteger(sourceSchemaVersion) && sourceSchemaVersion > 0,
    'checked-out API schema version must be a positive safe integer',
  );
  const requestedB = parseSchemaOverride(bOverride, 'PRINTOPS_OTA_NATIVE_B_SCHEMA_VERSION');
  const bSchema = requestedB ?? sourceSchemaVersion;
  requireInvariant(
    bSchema === sourceSchemaVersion,
    `B schema ${bSchema} does not match checked-out API schema ${sourceSchemaVersion}`,
  );

  const requestedA = parseSchemaOverride(aOverride, 'PRINTOPS_OTA_NATIVE_A_SCHEMA_VERSION');
  const aSchema = bSchema - 1;
  requireInvariant(
    requestedA === undefined || requestedA === aSchema,
    `A schema ${requestedA} must be exactly one less than B schema ${bSchema}`,
  );
  return { aSchema, bSchema };
}

function replaceExactlyOnce(source, patternOrText, replacement, label) {
  if (typeof patternOrText === 'string') {
    const first = source.indexOf(patternOrText);
    requireInvariant(first !== -1 && source.indexOf(patternOrText, first + patternOrText.length) === -1, `${label} shape changed; refusing an unsafe A build`);
    return source.slice(0, first) + replacement + source.slice(first + patternOrText.length);
  }

  const matches = [...source.matchAll(patternOrText)];
  requireInvariant(matches.length === 1, `${label} shape changed; refusing an unsafe A build`);
  return source.replace(patternOrText, replacement);
}

function validateSchemaPair(sourceSchema, compiledSchema) {
  const source = inspectSchemaSource(sourceSchema, 'checked-out API schema source');
  const compiled = inspectSchemaSource(compiledSchema, 'compiled API schema');
  requireInvariant(
    source.version === compiled.version,
    `compiled API schema ${compiled.version} does not match checked-out API schema ${source.version}`,
  );
  const sourceMigrationShape = source.migrations.map(({ version, functionName }) => `${version}:${functionName}`);
  const compiledMigrationShape = compiled.migrations.map(({ version, functionName }) => `${version}:${functionName}`);
  requireInvariant(
    JSON.stringify(sourceMigrationShape) === JSON.stringify(compiledMigrationShape),
    'compiled API migration guards do not match checked-out API migration guards',
  );
  return { source, compiled };
}

export function createAcceptanceSchemaOverlay({ sourceSchema, compiledSchema, aSchema }) {
  const { source, compiled } = validateSchemaPair(sourceSchema, compiledSchema);
  requireInvariant(
    aSchema === source.version - 1,
    `A schema ${aSchema} must be exactly one less than source schema ${source.version}`,
  );

  const newestMigration = compiled.migrations.at(-1);
  let overlay = compiledSchema;
  overlay = replaceExactlyOnce(
    overlay,
    compiled.constantText,
    `export const CURRENT_SCHEMA_VERSION = ${aSchema};`,
    'compiled schema constant',
  );
  overlay = replaceExactlyOnce(
    overlay,
    newestMigration.text,
    `if (CURRENT_SCHEMA_VERSION >= ${source.version} && fromVersion < ${source.version}) ${newestMigration.functionName}(db);`,
    `newest schema migration guard for version ${source.version}`,
  );

  const migrationEntry = 'export function runSchemaMigration(db) {';
  const acceptanceOtaStateShim = `function ensureAcceptanceOtaState(db) {
    // Acceptance-only baseline: current OTA services need their state table
    // even while A deliberately remains at physical schema ${aSchema}.
    db.run(\`
    CREATE TABLE IF NOT EXISTS ota_update_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state TEXT NOT NULL DEFAULT 'IDLE',
      target_version TEXT,
      started_at TEXT,
      updated_at TEXT NOT NULL,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0
    )
  \`);
    db.run(\`
    INSERT OR IGNORE INTO ota_update_state (id, state, updated_at)
    VALUES (1, 'IDLE', datetime('now'))
  \`);
}

`;
  overlay = replaceExactlyOnce(overlay, migrationEntry, `${acceptanceOtaStateShim}${migrationEntry}`, 'compiled migration entry');
  overlay = replaceExactlyOnce(
    overlay,
    /if \(fromVersion === CURRENT_SCHEMA_VERSION\)\s*return;/g,
    `if (fromVersion === CURRENT_SCHEMA_VERSION) {
        ensureAcceptanceOtaState(db);
        return;
    }`,
    'compiled same-version return',
  );
  overlay = replaceExactlyOnce(
    overlay,
    /([ \t]*)db\.run\(`PRAGMA user_version=\$\{CURRENT_SCHEMA_VERSION\}`\);\r?\n\1db\.run\('COMMIT'\);/g,
    (match, indent) => `${match}\n${indent}ensureAcceptanceOtaState(db);`,
    'compiled migration commit',
  );

  return {
    source: overlay,
    description: `compiled sqlite schema target ${aSchema}; acceptance-only ota_update_state baseline shim; newest migration ${newestMigration.functionName} withheld from A and retained for B schema ${source.version}`,
  };
}
