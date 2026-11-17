import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  forbiddenTrackedArtifacts,
  freshness,
  inspectRequiredFile,
  readCurrentSchemaVersion,
  versionConsistency,
} from './release-verify-lib.mjs';

test('version consistency rejects one drifting package', () => {
  assert.equal(versionConsistency({ root: '0.1.15', api: '0.1.14', cargo: '0.1.15' }).ok, false);
  assert.equal(versionConsistency({ root: '0.1.15', api: '0.1.15', cargo: '0.1.15' }).ok, true);
});

test('forbidden artifact scan catches credentials, runtime DBs, temp files, and bundled output', () => {
  assert.deepEqual(forbiddenTrackedArtifacts([
    '.env',
    '.env.example',
    'data/printops.db',
    'cache/item.tmp',
    'apps/desktop/src-tauri/resources/server.exe',
    'src/app.ts',
  ]), [
    '.env',
    'data/printops.db',
    'cache/item.tmp',
    'apps/desktop/src-tauri/resources/server.exe',
  ]);
});

test('required resource inspection rejects missing and empty files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'printops-release-verify-'));
  try {
    const empty = join(dir, 'empty.exe');
    const present = join(dir, 'present.exe');
    writeFileSync(empty, '');
    writeFileSync(present, 'binary');
    assert.deepEqual(inspectRequiredFile(join(dir, 'missing.exe')), { ok: false, detail: 'missing' });
    assert.deepEqual(inspectRequiredFile(empty), { ok: false, detail: 'zero bytes' });
    assert.equal(inspectRequiredFile(present).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('freshness rejects output older than source outside tolerance', () => {
  assert.equal(freshness(10_000, 12_001).ok, false);
  assert.equal(freshness(10_000, 12_000).ok, true);
  assert.equal(freshness(15_000, 12_000).ok, true);
});

test('readCurrentSchemaVersion parses positive CURRENT_SCHEMA_VERSION and rejects invalid forms', () => {
  assert.equal(readCurrentSchemaVersion('export const CURRENT_SCHEMA_VERSION = 11;\n'), 11);
  assert.throws(() => readCurrentSchemaVersion('const OTHER = 1;'));
  assert.throws(() => readCurrentSchemaVersion('export const CURRENT_SCHEMA_VERSION = 0;'));
  assert.throws(() => readCurrentSchemaVersion(
    'export const CURRENT_SCHEMA_VERSION = 10;\nexport const CURRENT_SCHEMA_VERSION = 11;',
  ));
});
