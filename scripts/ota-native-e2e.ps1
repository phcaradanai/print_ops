$ErrorActionPreference = 'Stop'

if ($env:PRINTOPS_OTA_NATIVE_E2E -ne '1') {
  throw 'Set PRINTOPS_OTA_NATIVE_E2E=1 only on a disposable Windows runner with real signed NSIS artifacts.'
}

$required = @(
  'PRINTOPS_OTA_NATIVE_A_INSTALLER',
  'PRINTOPS_OTA_NATIVE_B_MANIFEST',
  'PRINTOPS_OTA_NATIVE_B_INSTALLER',
  'PRINTOPS_OTA_NATIVE_A_VERSION',
  'PRINTOPS_OTA_NATIVE_B_VERSION',
  'PRINTOPS_OTA_NATIVE_BROKEN_MANIFEST',
  'PRINTOPS_OTA_NATIVE_BROKEN_INSTALLER',
  'PRINTOPS_OTA_NATIVE_BROKEN_VERSION',
  'PRINTOPS_OTA_NATIVE_PUBLIC_KEY'
)
foreach ($name in $required) {
  if ([string]::IsNullOrWhiteSpace((Get-Item "Env:$name").Value)) {
    throw "$name is required for the native A -> B -> broken-B acceptance test"
  }
}

$repo = Split-Path -Parent $PSScriptRoot
$desktopExeRelative = if ($env:PRINTOPS_OTA_NATIVE_DESKTOP_RELATIVE_PATH) {
  $env:PRINTOPS_OTA_NATIVE_DESKTOP_RELATIVE_PATH
} else {
  'printerops-desktop.exe'
}
$installRoot = Join-Path ([System.IO.Path]::GetTempPath()) "printops-ota-native-$PID"
$appData = Join-Path $installRoot 'appdata'
$localAppData = Join-Path $installRoot 'localappdata'
$sourcePort = if ($env:PRINTOPS_OTA_NATIVE_SOURCE_PORT) { [int]$env:PRINTOPS_OTA_NATIVE_SOURCE_PORT } else { 18082 }
$desktopProcess = $null
$labProcess = $null

function Assert-File([string]$path, [string]$label) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$label is missing: $path" }
}

function Start-Lab([string]$manifest, [string]$artifact) {
  $server = Join-Path $repo 'tests/ota-lab/server.mjs'
  Assert-File $server 'OTA lab server'
  Assert-File $manifest 'signed release manifest'
  Assert-File $artifact 'NSIS artifact'
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = (Get-Command node).Source
  $psi.Arguments = "`"$server`""
  $psi.WorkingDirectory = $repo
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.Environment['PORT'] = [string]$sourcePort
  $psi.Environment['ROLE'] = 'native-e2e'
  $psi.Environment['MANIFEST_PATH'] = (Resolve-Path -LiteralPath $manifest).Path
  $psi.Environment['ARTIFACT_PATH'] = (Resolve-Path -LiteralPath $artifact).Path
  $script:labProcess = [System.Diagnostics.Process]::Start($psi)
}

function Stop-Lab {
  if ($script:labProcess -and -not $script:labProcess.HasExited) {
    $script:labProcess.Kill($true)
    $script:labProcess.WaitForExit(5000)
  }
  $script:labProcess = $null
}

function Wait-Until([string]$label, [scriptblock]$check, [int]$timeoutSeconds = 180) {
  $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
  do {
    try {
      $value = & $check
      if ($value) { return $value }
    } catch { }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "$label did not become true within $timeoutSeconds seconds"
}

function Install-NSIS([string]$installer) {
  Assert-File $installer 'NSIS installer'
  $process = Start-Process -FilePath (Resolve-Path -LiteralPath $installer).Path -ArgumentList @('/S', "/D=$installRoot") -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "NSIS installer failed with exit code $($process.ExitCode)" }
}

function Start-Desktop {
  $path = Join-Path $installRoot $desktopExeRelative
  Assert-File $path 'installed PrintOps Desktop executable'
  $script:desktopProcess = Start-Process -FilePath $path -WorkingDirectory $installRoot -PassThru -WindowStyle Hidden
}

function Stop-Desktop {
  if ($script:desktopProcess -and -not $script:desktopProcess.HasExited) {
    Stop-Process -Id $script:desktopProcess.Id -Force -ErrorAction SilentlyContinue
    $script:desktopProcess.WaitForExit(10000)
  }
  $script:desktopProcess = $null
}

function Get-Health {
  try { return Invoke-RestMethod -Uri 'http://127.0.0.1:31415/health' -TimeoutSec 3 } catch { return $null }
}

function Get-UpdaterState {
  $roots = @($appData, $localAppData) | Where-Object { Test-Path -LiteralPath $_ }
  $file = Get-ChildItem -LiteralPath $roots -Filter 'updater-state.json' -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $file) { return $null }
  try { return Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json } catch { return $null }
}

function Get-HealthToken {
  $file = Get-ChildItem -LiteralPath @($appData, $localAppData) -Filter 'ota-health-token.txt' -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $file) { return $null }
  return (Get-Content -LiteralPath $file.FullName -Raw).Trim()
}

function Configure-OTAEnvironment {
  $env:APPDATA = $appData
  $env:LOCALAPPDATA = $localAppData
  $env:PRINTOPS_OTA_ENABLED = 'true'
  $env:PRINTOPS_OTA_AUTO_UPDATE_ENABLED = 'true'
  $env:PRINTOPS_OTA_LAN_RELAY_URL = "http://127.0.0.1:$sourcePort"
  $env:PRINTOPS_OTA_REQUIRE_SIGNATURE = 'true'
  $env:PRINTOPS_OTA_PUBLIC_KEY = $env:PRINTOPS_OTA_NATIVE_PUBLIC_KEY
  $env:PRINTOPS_OTA_AUTO_UPDATE_CHECK_INTERVAL_MS = '1000'
  $env:PRINTOPS_OTA_AUTO_UPDATE_JITTER_MS = '0'
  $env:PRINTOPS_OTA_AUTO_UPDATE_RETRY_BASE_MS = '1000'
  $env:PRINTOPS_OTA_AUTO_UPDATE_RETRY_MAX_MS = '5000'
  $env:PRINTOPS_OTA_AUTO_UPDATE_MAX_FAILURES = '2'
}

try {
  New-Item -ItemType Directory -Force -Path $installRoot, $appData, $localAppData | Out-Null
  Configure-OTAEnvironment

  # Successful real update: A is installed and launched, then the local lab
  # serves the signed B manifest and the actual B NSIS artifact.
  Install-NSIS $env:PRINTOPS_OTA_NATIVE_A_INSTALLER
  Start-Lab $env:PRINTOPS_OTA_NATIVE_B_MANIFEST $env:PRINTOPS_OTA_NATIVE_B_INSTALLER
  Start-Desktop
  Wait-Until 'version A health' { (Get-Health).status -eq 'ok' -and (Get-Health).version -eq $env:PRINTOPS_OTA_NATIVE_A_VERSION }
  Wait-Until 'version B health after automatic OTA' { (Get-Health).version -eq $env:PRINTOPS_OTA_NATIVE_B_VERSION }
  $completed = Wait-Until 'COMPLETED updater state' { (Get-UpdaterState).phase -eq 'COMPLETED' }
  if ([string]$completed.version -ne $env:PRINTOPS_OTA_NATIVE_B_VERSION) { throw 'COMPLETED state does not identify the expected B version' }
  if ((Get-Health).version -ne $env:PRINTOPS_OTA_NATIVE_B_VERSION) { throw 'reported version is not B' }
  $readiness = Invoke-RestMethod -Uri 'http://127.0.0.1:31415/api/v1/system/readiness' -Headers @{ 'x-printops-ota-token' = (Get-HealthToken) }
  if ($readiness.ota.status -ne 'READY') { throw 'B OTA readiness contract did not become READY' }
  Write-Host '[PASS] real signed NSIS A -> B update and OTA readiness'

  # Rollback run: reinstall A in a fresh disposable data directory, then
  # serve a deliberately unhealthy but signed B release. The real updater must
  # restore both the old install tree and DB before relaunching A.
  Stop-Desktop
  Stop-Lab
  if (Test-Path -LiteralPath $installRoot) { Remove-Item -LiteralPath $installRoot -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $installRoot, $appData, $localAppData | Out-Null
  Install-NSIS $env:PRINTOPS_OTA_NATIVE_A_INSTALLER
  Start-Lab $env:PRINTOPS_OTA_NATIVE_BROKEN_MANIFEST $env:PRINTOPS_OTA_NATIVE_BROKEN_INSTALLER
  Start-Desktop
  $rolledBack = Wait-Until 'broken B rollback to A' {
    $state = Get-UpdaterState
    $state.phase -eq 'ROLLED_BACK' -and [string]$state.version -eq $env:PRINTOPS_OTA_NATIVE_BROKEN_VERSION
  }
  Wait-Until 'version A health after rollback' { (Get-Health).version -eq $env:PRINTOPS_OTA_NATIVE_A_VERSION } | Out-Null
  if ([string]$rolledBack.version -ne $env:PRINTOPS_OTA_NATIVE_BROKEN_VERSION) { throw 'rollback state does not identify the broken candidate version' }
  Write-Host '[PASS] broken B rollback restored A and persisted ROLLED_BACK'
} finally {
  Stop-Desktop
  Stop-Lab
  if (Test-Path -LiteralPath $installRoot) { Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
