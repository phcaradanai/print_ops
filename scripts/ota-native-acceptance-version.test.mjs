import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveAcceptanceVersions } from './ota-native-acceptance-version.mjs';

test('defaults A to the checked-out baseline and B to its next patch', () => {
  assert.deepEqual(
    deriveAcceptanceVersions({ baselineVersion: '0.1.28' }),
    { aVersion: '0.1.28', bVersion: '0.1.29' },
  );
});

test('accepts explicit stable A/B versions in ascending order', () => {
  assert.deepEqual(
    deriveAcceptanceVersions({
      baselineVersion: '0.1.28',
      aOverride: '0.1.26',
      bOverride: '0.2.0',
    }),
    { aVersion: '0.1.26', bVersion: '0.2.0' },
  );
});

test('rejects invalid, unsafe, equal, and descending version pairs', () => {
  assert.throws(() => deriveAcceptanceVersions({ baselineVersion: '0.1' }), /stable semantic X\.Y\.Z/);
  assert.throws(() => deriveAcceptanceVersions({ baselineVersion: '0.1.28', aOverride: '1.9007199254740992.0' }), /safe integers/);
  assert.throws(() => deriveAcceptanceVersions({ baselineVersion: '0.1.28', aOverride: '0.1.29', bOverride: '0.1.29' }), /must be older/);
  assert.throws(() => deriveAcceptanceVersions({ baselineVersion: '0.1.28', bOverride: '0.1.27' }), /must be older/);
});
