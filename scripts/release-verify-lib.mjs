import { existsSync, statSync } from 'node:fs';

export function versionConsistency(versions) {
  const values = Object.values(versions);
  const unique = new Set(values);
  return {
    ok: values.length > 0 && unique.size === 1 && !unique.has(undefined),
    detail: JSON.stringify(versions),
  };
}

export function forbiddenTrackedArtifacts(paths) {
  return paths.filter((path) =>
    /(^|\/)printops\.db$/i.test(path)
    || /\.tmp$/i.test(path)
    || /vitest\.config\.ts\.timestamp-.*\.mjs$/i.test(path)
    || /apps\/desktop\/src-tauri\/resources\//i.test(path)
    || /(^|\/)\.env(\.|$)/i.test(path) && !/\.env\.example$/i.test(path));
}

export function inspectRequiredFile(path) {
  if (!existsSync(path)) return { ok: false, detail: 'missing' };
  const size = statSync(path).size;
  if (size === 0) return { ok: false, detail: 'zero bytes' };
  return { ok: true, detail: `${size} bytes`, size };
}

export function freshness(outputTime, sourceTime, toleranceMs = 2_000) {
  return sourceTime > outputTime + toleranceMs
    ? { ok: false, detail: 'packaged resource is older than its source' }
    : { ok: true, detail: 'resource is current' };
}
