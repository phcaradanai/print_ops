import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../infra/db/sqlite.schema.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));

function readRepoFile(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), 'utf8');
}

describe('Database schema version single-source-of-truth invariants', () => {
  it('derives desktop schema version from sqlite.schema.ts without a hardcoded fallback', () => {
    const buildRs = readRepoFile('apps/desktop/src-tauri/build.rs');
    const libRs = readRepoFile('apps/desktop/src-tauri/src/lib.rs');

    expect(buildRs).toContain('sqlite.schema.ts');
    expect(buildRs).toContain('PRINTOPS_SOURCE_DB_SCHEMA_VERSION');
    expect(libRs).toContain('env!("PRINTOPS_SOURCE_DB_SCHEMA_VERSION")');
    expect(libRs).not.toMatch(/DESKTOP_DB_SCHEMA_VERSION[\s\S]{0,160}None\s*=>\s*"\d+"/);
  });

  it('derives release-verify schema version from sqlite.schema.ts without a hardcoded fallback', () => {
    const releaseVerify = readRepoFile('scripts/release-verify.mjs');
    const releaseVerifyLib = readRepoFile('scripts/release-verify-lib.mjs');

    expect(releaseVerifyLib).toContain('CURRENT_SCHEMA_VERSION');
    expect(releaseVerify).toContain('readCurrentSchemaVersion');
    expect(releaseVerify).not.toContain("otaEnv.PRINTOPS_DB_SCHEMA_VERSION ?? '");
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(11);
  });

  it('uses CURRENT_SCHEMA_VERSION instead of hardcoded 8 in control release import and registration', () => {
    const controlRoutes = readRepoFile('apps/api/src/routes/v1/control.routes.ts');
    const registryService = readRepoFile('apps/api/src/services/web-control-registry.service.ts');

    expect(controlRoutes).not.toMatch(/schemaVersion:\s*body\.schemaVersion\s*\?\?\s*\d+/);
    expect(registryService).not.toMatch(/schemaVersion:\s*input\.schemaVersion\s*\?\?\s*\d+/);
  });
});
