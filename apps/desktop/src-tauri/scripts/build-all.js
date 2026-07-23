/**
 * build-all.js — Builds EVERYTHING needed for the PrintOps desktop installer:
 *   1. packages/* (domain, shared, adapters)
 *   2. apps/web (React frontend)
 *   3. apps/api → server.exe (pkg-bundled Node.js binary)
 *   4. apps/runner-go → printops-runner.exe (Go binary)
 *   5. Copy all resources into src-tauri/resources/
 *
 * Run:  node src-tauri/scripts/build-all.js
 * Or via Tauri:  npm run tauri:build
 */
const { execSync } = require('child_process');
const f = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const RUNNER_DIR = path.join(ROOT, 'apps', 'runner-go');
const PRINT_HELPER_DIR = path.join(ROOT, 'apps', 'windows-print-helper');

function run(cmd, opts = {}) {
  console.log(`\n  > ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function step(title, fn) {
  console.log(`\n[BUILD] ${title}`);
  console.log('='.repeat(50));
  fn();
}

// ──── Packages ────────────────────────────────────────────────────────
step('Building packages (domain, shared, adapters)', () => {
  run('npm run build -w packages/domain', { cwd: ROOT });
  run('npm run build -w packages/shared', { cwd: ROOT });
  run('npm run build -w packages/adapters', { cwd: ROOT });
});

// ──── Web frontend ────────────────────────────────────────────────────
step('Building web frontend (React → dist/)', () => {
  run('npm run build -w @printerops/web', { cwd: ROOT });
});

// ──── API server.exe ──────────────────────────────────────────────────
step('Building API server.exe (pkg bundle)', () => {
  try {
    run('npm run bundle -w @printerops/api', { cwd: ROOT });
  } catch (e) {
    console.error('[BUILD] ERROR: API bundle failed. Make sure "pkg" is installed:');
    console.error('[BUILD]   cd apps/api && npm install');
    console.error('[BUILD]   (pkg packages Node.js into a standalone .exe)');
    throw e;
  }
});

// ──── Go runner ───────────────────────────────────────────────────────
step('Building Go runner (printops-runner.exe)', () => {
  const goVer = (() => {
    try {
      return execSync('go version', { encoding: 'utf8' }).trim();
    } catch { return null; }
  })();

  if (!goVer) {
    console.warn('[BUILD] WARNING: Go not found — skipping runner build.');
    console.warn('[BUILD] The installer will work but printer discovery/printing will be disabled.');
    console.warn('[BUILD] Install Go from https://go.dev/dl/ and re-run this script.');
    return;
  }
  console.log(`[BUILD] ${goVer}`);

  try {
    execSync('go build -o printops-runner.exe ./cmd/printops-runner/', {
      stdio: 'inherit',
      cwd: RUNNER_DIR,
    });
    console.log('[BUILD] OK: printops-runner.exe built');
  } catch (e) {
    console.warn('[BUILD] WARNING: go build failed — runner will not be included.');
    console.warn(e.message);
  }
});

// ──── Windows HTML print helper ─────────────────────────────────────
step('Building WebView2 HTML print helper', () => {
  try {
    execSync(
      'dotnet publish PrintOps.HtmlPrint.csproj -c Release -r win-x64 --self-contained false -o publish',
      { stdio: 'inherit', cwd: PRINT_HELPER_DIR },
    );
    console.log('[BUILD] OK: WebView2 print helper built');
  } catch (e) {
    console.error('[BUILD] ERROR: WebView2 print helper build failed.');
    throw e;
  }
});

// ──── Copy resources ──────────────────────────────────────────────────
step('Copying resources into src-tauri/resources/', () => {
  const d = path.resolve(__dirname, '..', 'resources');
  f.mkdirSync(d, { recursive: true });

  const webDist = path.join(ROOT, 'apps', 'web', 'dist');
  const apiStatic = path.join(ROOT, 'apps', 'api', 'dist', 'static');

  // Copy web → api/static
  if (f.existsSync(webDist)) {
    f.cpSync(webDist, apiStatic, { recursive: true });
    console.log('[BUILD] Copied web/dist → api/dist/static');
  } else {
    console.warn('[BUILD] WARNING: web/dist not found');
  }

  // Copy server.exe
  const serverExe = path.join(ROOT, 'apps', 'api', 'dist', 'server.exe');
  if (f.existsSync(serverExe)) {
    f.cpSync(serverExe, path.join(d, 'server.exe'));
    console.log('[BUILD] Copied server.exe');
  } else {
    console.error('[BUILD] ERROR: server.exe not found!');
    process.exit(1);
  }

  // Copy static files
  if (f.existsSync(apiStatic)) {
    f.cpSync(apiStatic, path.join(d, 'static'), { recursive: true });
    console.log('[BUILD] Copied static files');
  }

  // Copy sql-wasm.wasm
  const wasmPath = path.join(ROOT, 'apps', 'api', 'dist', 'sql-wasm.wasm');
  if (f.existsSync(wasmPath)) {
    f.cpSync(wasmPath, path.join(d, 'sql-wasm.wasm'));
    console.log('[BUILD] Copied sql-wasm.wasm');
  }

  // Copy runner
  const runnerExe = path.join(RUNNER_DIR, 'printops-runner.exe');
  const runnerExeAlt = path.join(RUNNER_DIR, 'printops-runner.exe');
  const runnerDst = path.join(d, 'printops-runner.exe');
  if (f.existsSync(runnerExe)) {
    f.cpSync(runnerExe, runnerDst);
    console.log('[BUILD] Copied printops-runner.exe');
  } else if (f.existsSync(runnerExeAlt)) {
    f.cpSync(runnerExeAlt, runnerDst);
    console.log('[BUILD] Copied printops-runner.exe');
  } else {
    console.warn('[BUILD] WARNING: printops-runner.exe not found — printer discovery disabled');
    console.warn('[BUILD]   cd apps/runner-go && go build -o printops-runner.exe ./cmd/printops-runner/');
  }

  // Copy WebView2 HTML print helper and its managed/native dependencies.
  const printHelperPublish = path.join(PRINT_HELPER_DIR, 'publish');
  const printHelperDst = path.join(d, 'print-helper');
  if (f.existsSync(printHelperPublish)) {
    f.cpSync(printHelperPublish, printHelperDst, { recursive: true });
    console.log('[BUILD] Copied WebView2 HTML print helper');
  } else {
    console.error('[BUILD] ERROR: WebView2 HTML print helper not found!');
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(50));
console.log('[BUILD] All resources prepared — ready for Tauri bundle (msi/nsis)');
console.log('[BUILD] Run: cd apps/desktop && npm run tauri:build');
