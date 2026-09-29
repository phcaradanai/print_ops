[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Email
)

$ErrorActionPreference = 'Stop'
$recoveryCode = $null
$recoveryOutput = $null

$repoRoot = Split-Path -Parent $PSScriptRoot
$installRoot = Join-Path $env:LOCALAPPDATA 'PrintOps'
$dataRoot = Join-Path $env:APPDATA 'com.printerops.desktop'
$dbPath = Join-Path $dataRoot 'printops.db'
$sqlPackageJson = Join-Path $repoRoot 'package.json'

if (!(Test-Path -LiteralPath $dbPath -PathType Leaf)) {
  throw "PrintOps database not found: $dbPath"
}
if (!(Test-Path -LiteralPath $sqlPackageJson -PathType Leaf)) {
  throw "Repository package.json not found: $sqlPackageJson"
}
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required to issue a recovery code.'
}

$activeProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase)
}
if ($activeProcesses) {
  $activeProcesses | Select-Object ProcessId, Name, ExecutablePath | Format-Table -AutoSize
  throw 'Close PrintOps before issuing a recovery code so the database cannot change concurrently.'
}

Write-Host "This will issue a one-time recovery code for the active PrintOps account: $Email"
Write-Host 'It replaces the previous recovery code for that account, if one exists.'
Write-Host 'The code is printed only in this PowerShell window. Do not share it in chat or email.'
Write-Host 'Open PrintOps once after updating it, then close it before running this script.'
$confirmation = Read-Host 'Type ISSUE to continue'
if ($confirmation -cne 'ISSUE') {
  throw 'Recovery-code issue cancelled; no data was changed.'
}

$backupDirectory = Join-Path $dataRoot (
  'backups\recovery-code-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
)
New-Item -ItemType Directory -Path $backupDirectory | Out-Null
$backupPath = Join-Path $backupDirectory 'printops.db'
Copy-Item -LiteralPath $dbPath -Destination $backupPath
if ((Get-FileHash -LiteralPath $dbPath -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash) {
  throw "PrintOps database backup verification failed: $backupPath"
}

$helperPath = Join-Path $PSScriptRoot 'issue-printops-app-recovery-code.mjs'
if (!(Test-Path -LiteralPath $helperPath -PathType Leaf)) {
  throw "Recovery helper not found: $helperPath"
}

try {
  $payload = @{
    dbPath = $dbPath
    email = $Email
    packageJsonPath = $sqlPackageJson
  } | ConvertTo-Json -Compress
  $recoveryOutput = $payload | & node $helperPath
  $helperExitCode = $LASTEXITCODE
  if ($helperExitCode -ne 0) {
    throw "Recovery-code issue failed. The database backup is available at $backupPath."
  }

  $recoveryCode = ($recoveryOutput -join '').Trim()
  if (-not [regex]::IsMatch($recoveryCode, '^[A-Za-z0-9_-]{32}$')) {
    throw "The database was updated, but a recovery code was not returned. The backup is available at $backupPath."
  }

  Write-Host "Recovery code for ${Email}: $recoveryCode"
  Write-Host 'Enter it on the PrintOps forgot-password screen, set a new password, and save the replacement code shown after reset.'
  Write-Host "Database backup: $backupPath"
}
finally {
  $payload = $null
  $recoveryOutput = $null
  $recoveryCode = $null
}
