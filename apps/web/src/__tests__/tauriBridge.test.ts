// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isTauriAvailable } from '../tauri.js';

describe('isTauriAvailable', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  // `@tauri-apps/api` imports fine in a plain browser; only the desktop shell
  // injects __TAURI_INTERNALS__. Treating the import as proof broke exports
  // there with "Cannot read properties of undefined (reading 'invoke')".
  it('is false in a plain browser', async () => {
    expect(await isTauriAvailable()).toBe(false);
  });

  it('is true when the desktop shell injected its internals', async () => {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    expect(await isTauriAvailable()).toBe(true);
  });
});
