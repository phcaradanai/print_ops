[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ownerEmail = 'ota-owner@localhost.invalid'
$containerId = ''
$image = ''
$helperPath = ''
$dataHelperPath = ''
$backupPath = ''
$shouldRestartApi = $false
$recoveryCode = $null

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  $composeArgs = @('--env-file', '.env', '-f', 'infra/docker/control-ota-compose.yml')
  $containerId = (& docker compose @composeArgs ps -q api).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($containerId)) {
    throw 'Could not find the Web Control API container. Start the Docker stack first.'
  }

  $running = (& docker inspect --format '{{.State.Running}}' $containerId).Trim()
  if ($LASTEXITCODE -ne 0 -or $running -ne 'true') {
    throw 'The Web Control API container must be running before recovery.'
  }
  $shouldRestartApi = $true

  $image = (& docker inspect --format '{{.Config.Image}}' $containerId).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($image)) {
    throw 'Could not identify the API image used for the recovery helper.'
  }

  Write-Host "This will issue a one-time recovery code only for the active OWNER account: $ownerEmail"
  Write-Host 'The previous recovery code, if any, will stop working.'
  Write-Host 'Do not share the code in chat or email. Enter it directly on the Web Control forgot-password screen.'

  Write-Host 'The API will pause briefly. A database backup will be saved in your temporary folder.'
  $confirmation = Read-Host 'Type ISSUE to continue'
  if ($confirmation -cne 'ISSUE') {
    throw 'Recovery-code issue cancelled; no data was changed.'
  }

  $backupDirectory = Join-Path ([IO.Path]::GetTempPath()) (
    'printops-control-owner-recovery-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
  )
  New-Item -ItemType Directory -Path $backupDirectory | Out-Null
  $backupPath = Join-Path $backupDirectory 'printops.db'
  $helperPath = Join-Path $backupDirectory 'recover-owner.mjs'
  $dataHelperPath = '/data/recover-owner-' + [Guid]::NewGuid().ToString('N') + '.mjs'

  $helperSource = @'
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire('/app/package.json');
const initSqlJs = require('sql.js');
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

let db;
try {
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const email = String(input.email || '').trim().toLowerCase();
  const dbPath = '/data/printops.db';
  const SQL = await initSqlJs({ locateFile: (file) => `/app/node_modules/sql.js/dist/${file}` });
  db = new SQL.Database(fs.readFileSync(dbPath));

  const query = db.prepare('SELECT id, email, role, is_active FROM users WHERE lower(email) = lower(?)');
  query.bind([email]);
  const rows = [];
  while (query.step()) rows.push(query.getAsObject());
  query.free();

  if (rows.length !== 1 || rows[0].role !== 'OWNER' || Number(rows[0].is_active) !== 1) {
    throw new Error('The expected active OWNER account was not found exactly once; no change was made.');
  }

  const recoveryCode = randomBytes(24).toString('base64url');
  const recoveryCodeHash = createHash('sha256').update(recoveryCode).digest('hex');
  db.run('UPDATE users SET recovery_code_hash = ? WHERE id = ? AND is_active = 1', [recoveryCodeHash, rows[0].id]);
  if (db.getRowsModified() !== 1) throw new Error('The OWNER recovery-code update did not affect exactly one row.');

  const temporaryPath = `${dbPath}.recovery.tmp`;
  fs.rmSync(temporaryPath, { force: true });
  fs.writeFileSync(temporaryPath, Buffer.from(db.export()));
  db.close();
  db = undefined;
  fs.renameSync(temporaryPath, dbPath);
  process.stdout.write(`${recoveryCode}\n`);
} catch (error) {
  process.stderr.write(`Recovery failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (db) db.close();
  fs.rmSync(process.argv[1], { force: true });
}
'@
  [IO.File]::WriteAllText($helperPath, $helperSource, [System.Text.UTF8Encoding]::new($false))

  & docker stop $containerId | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not stop the API cleanly; no database change was attempted.' }

  & docker cp "${containerId}:/data/printops.db" $backupPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the database backup; no password change was attempted.' }

  & docker cp $helperPath "${containerId}:$dataHelperPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not stage the recovery helper; no password change was attempted.' }

  $payload = @{ email = $ownerEmail } | ConvertTo-Json -Compress
  $recoveryOutput = $payload | & docker run --rm -i --volumes-from $containerId --entrypoint node $image $dataHelperPath
  $helperExitCode = $LASTEXITCODE
  if ($helperExitCode -ne 0) {
    throw "Recovery-code issue did not complete. The backup is available at $backupPath."
  }
  $recoveryCode = ($recoveryOutput -join '').Trim()
  if (-not [regex]::IsMatch($recoveryCode, '^[A-Za-z0-9_-]{32}$')) {
    throw "The database was updated, but a recovery code was not returned. The backup is available at $backupPath."
  }

  Write-Host "Recovery code for $ownerEmail`: $recoveryCode"
  Write-Host 'Enter the code on the Web Control forgot-password screen, set a new password, and save the replacement code shown after reset.'
  Write-Host "Database backup: $backupPath"
}
finally {
  $payload = $null
  $recoveryOutput = $null
  $recoveryCode = $null

  if ($shouldRestartApi -and $containerId) {
    $running = (& docker inspect --format '{{.State.Running}}' $containerId 2>$null).Trim()
    if ($running -ne 'true') {
      & docker start $containerId | Out-Null
      if ($LASTEXITCODE -ne 0) { Write-Warning 'The API container did not restart; start it with docker compose before logging in.' }
    }
    if ($dataHelperPath) { & docker exec $containerId rm -f $dataHelperPath 2>$null | Out-Null }
  }
  if ($helperPath -and (Test-Path -LiteralPath $helperPath)) {
    Remove-Item -LiteralPath $helperPath -Force
  }
  Pop-Location
}
