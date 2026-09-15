const f = require('fs');
const path = require('path');
const d = 'src-tauri/resources';

// Ensure resources directory exists
f.mkdirSync(d, { recursive: true });

// ── Copy web static files into API static dir ──────────────────────────
const webDist = '../web/dist';
const apiStatic = '../api/dist/static';
if (f.existsSync(webDist)) {
  f.cpSync(webDist, apiStatic, { recursive: true });
  console.log('[bundle] Copied web/dist → api/dist/static');
} else {
  console.warn('[bundle] WARNING: web/dist not found — skipping web static copy');
}

// ── Copy API server binary ─────────────────────────────────────────────
const serverExe = '../api/dist/server.exe';
if (f.existsSync(serverExe)) {
  f.cpSync(serverExe, path.join(d, 'server.exe'));
  console.log('[bundle] Copied server.exe');
} else {
  console.error('[bundle] ERROR: server.exe not found — run "npm run bundle -w @printerops/api" first');
}

// ── Copy static files for API to serve ─────────────────────────────────
if (f.existsSync(apiStatic)) {
  f.cpSync(apiStatic, path.join(d, 'static'), { recursive: true });
  console.log('[bundle] Copied static files');
} else {
  console.warn('[bundle] WARNING: api/dist/static not found');
}

// ── Copy SQLite WASM binary (needed by pkg-bundled server.exe) ─────────
const wasmPath = '../api/dist/sql-wasm.wasm';
if (f.existsSync(wasmPath)) {
  f.cpSync(wasmPath, path.join(d, 'sql-wasm.wasm'));
  console.log('[bundle] Copied sql-wasm.wasm');
} else {
  console.warn('[bundle] WARNING: sql-wasm.wasm not found — database may not work');
}

// ── Copy Go Runner binary (optional: app works without it) ─────────────
const runnerExe = '../runner-go/printops-runner.exe';
if (f.existsSync(runnerExe)) {
  f.cpSync(runnerExe, path.join(d, 'printops-runner.exe'));
  console.log('[bundle] Copied printops-runner.exe');
} else {
  console.warn('[bundle] WARNING: printops-runner.exe not found — run "cd ../runner-go && go build -o printops-runner.exe ./cmd/printops-runner/"');
  console.warn('[bundle] The desktop app will start without printer discovery support.');
}

// ── External OTA updater (must survive the Desktop process it replaces) ────
const updaterExe = '../updater-go/printops-updater.exe';
if (f.existsSync(updaterExe)) {
  f.cpSync(updaterExe, path.join(d, 'printops-updater.exe'));
  console.log('[bundle] Copied printops-updater.exe');
} else {
  console.warn('[bundle] WARNING: printops-updater.exe not found — run the desktop build first');
}

const publicKeyFile = process.env.PRINTOPS_OTA_PUBLIC_KEY_FILE;
const publicKeyPath = path.join(d, 'ota-public-key.txt');
if (publicKeyFile && f.existsSync(publicKeyFile)) {
  f.cpSync(publicKeyFile, publicKeyPath);
} else if (process.env.PRINTOPS_OTA_PUBLIC_KEY?.trim()) {
  f.writeFileSync(publicKeyPath, `${process.env.PRINTOPS_OTA_PUBLIC_KEY.trim()}\n`);
} else if (!f.existsSync(publicKeyPath)) {
  f.writeFileSync(publicKeyPath, 'unconfigured\n');
}

console.log('[bundle] Resources prepared successfully');
