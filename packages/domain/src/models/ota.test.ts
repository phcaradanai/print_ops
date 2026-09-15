import { describe, expect, it } from 'vitest';
import { compareVersions, isValidVersion, parseVersion } from './ota.js';

describe('PrintOps SemVer policy', () => {
  it('orders numeric prerelease identifiers instead of comparing them lexicographically', () => {
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0);
    expect(compareVersions('1.0.0-rc.10', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.2')).toBe(0);
  });

  it('applies SemVer identifier precedence and ignores build metadata', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-beta')).toBeLessThan(0);
    expect(compareVersions('1.0.0+build.1', '1.0.0+build.2')).toBe(0);
    expect(parseVersion('1.0.0+build.1')?.build).toBe('build.1');
  });

  it('rejects invalid leading-zero SemVer identifiers', () => {
    expect(isValidVersion('01.0.0')).toBe(false);
    expect(isValidVersion('1.0.0-rc.02')).toBe(false);
    expect(isValidVersion('1.0.0-')).toBe(false);
  });
});
