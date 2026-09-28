const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseStableVersion(value, label) {
  const version = String(value ?? '').trim();
  const match = stableVersionPattern.exec(version);
  if (!match) throw new Error(`${label} must be a stable semantic X.Y.Z version`);

  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error(`${label} components must be safe integers`);
  return { version, parts };
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function deriveAcceptanceVersions({ baselineVersion, aOverride, bOverride }) {
  const baseline = parseStableVersion(baselineVersion, 'Baseline version');
  const defaultCandidatePatch = baseline.parts[2] + 1;
  if (!Number.isSafeInteger(defaultCandidatePatch)) {
    throw new Error('Baseline patch version cannot be incremented safely');
  }

  const a = parseStableVersion(aOverride ?? baseline.version, 'A version');
  const b = parseStableVersion(
    bOverride ?? `${baseline.parts[0]}.${baseline.parts[1]}.${defaultCandidatePatch}`,
    'B version',
  );
  if (compareVersions(a.parts, b.parts) >= 0) {
    throw new Error(`A version ${a.version} must be older than B version ${b.version}`);
  }

  return { aVersion: a.version, bVersion: b.version };
}
