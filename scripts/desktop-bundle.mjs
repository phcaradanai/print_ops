import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadOtaBuildEnv, withoutOtaSigningSecret } from './ota-signing.cjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const otaEnv = loadOtaBuildEnv(root);
delete process.env.PRINTOPS_OTA_SECRET;
const buildEnvironment = withoutOtaSigningSecret();
const releaseEnvironment = { ...buildEnvironment };
if (otaEnv.PRINTOPS_OTA_SECRET) {
  releaseEnvironment.PRINTOPS_OTA_SECRET = otaEnv.PRINTOPS_OTA_SECRET;
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    console.error(`[desktop:bundle] command failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(process.execPath, ['scripts/release-verify.mjs'], releaseEnvironment);

if (process.platform === 'win32') {
  run(process.env.ComSpec || 'cmd.exe', [
    '/d',
    '/c',
    'npm run tauri:build -w @printerops/desktop',
  ], buildEnvironment);
} else {
  run('npm', ['run', 'tauri:build', '-w', '@printerops/desktop'], buildEnvironment);
}

run(process.execPath, ['scripts/release-verify.mjs', '--post-bundle'], releaseEnvironment);
