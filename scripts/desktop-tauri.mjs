import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertNoLocalOtaSigningSecret,
  withoutOtaSigningSecret,
} from './ota-signing.cjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'build') {
  throw new Error('desktop Tauri mode must be "dev" or "build"');
}
assertNoLocalOtaSigningSecret(root);
delete process.env.PRINTOPS_OTA_SECRET;

const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'tauri';
const args = process.platform === 'win32' ? ['/d', '/c', `tauri ${mode}`] : [mode];
const result = spawnSync(command, args, {
  cwd: join(root, 'apps', 'desktop'),
  env: withoutOtaSigningSecret(),
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) {
  console.error(`[desktop:tauri] command failed to start: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
