#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const imagePrefix = process.env['PRINTOPS_IMAGE_PREFIX']?.trim().replace(/\/+$/, '');
const platforms = process.env['PRINTOPS_BUILD_PLATFORMS']?.trim() || 'linux/amd64';
const controlPlaneVersion = process.env['PRINTOPS_CONTROL_PLANE_VERSION']?.trim();

if (!imagePrefix) {
  console.error('PRINTOPS_IMAGE_PREFIX is required, e.g. ghcr.io/my-org/printops-control-plane');
  process.exit(2);
}
if (imagePrefix.includes('://') || /\s/.test(imagePrefix)) {
  console.error('PRINTOPS_IMAGE_PREFIX must be an image repository prefix without a URL scheme or whitespace');
  process.exit(2);
}
if (!controlPlaneVersion) {
  console.error('PRINTOPS_CONTROL_PLANE_VERSION is required, e.g. 1.0.0; it is independent of the PrintOps app version');
  process.exit(2);
}
if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(controlPlaneVersion)) {
  console.error('PRINTOPS_CONTROL_PLANE_VERSION must be a valid Docker tag (up to 128 characters)');
  process.exit(2);
}

function buildAndPush(image, dockerfile, buildArgs = []) {
  const args = [
    'buildx', 'build',
    '--platform', platforms,
    '--file', dockerfile,
    '--tag', image,
    '--push',
    ...buildArgs,
    '.',
  ];
  console.log(`\nBuilding and pushing ${image} (${platforms})`);
  const result = spawnSync('docker', args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`Failed to start Docker Buildx: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

buildAndPush(
  `${imagePrefix}-api:${controlPlaneVersion}`,
  'infra/docker/Dockerfile.api',
);
buildAndPush(
  `${imagePrefix}-web:${controlPlaneVersion}`,
  'infra/docker/Dockerfile.web',
  ['--build-arg', `VITE_CONTROL_PLANE_VERSION=${controlPlaneVersion}`],
);

console.log(`\nPublished ${imagePrefix}-api:${controlPlaneVersion} and ${imagePrefix}-web:${controlPlaneVersion}`);
