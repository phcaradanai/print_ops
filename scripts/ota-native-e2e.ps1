$ErrorActionPreference = 'Stop'

if ($env:PRINTOPS_OTA_NATIVE_E2E -ne '1') {
  throw 'Set PRINTOPS_OTA_NATIVE_E2E=1 only on a disposable Windows runner with real signed NSIS artifacts.'
}

$required = @(
  'PRINTOPS_OTA_NATIVE_A_INSTALLER',
  'PRINTOPS_OTA_NATIVE_A_MANIFEST',
  'PRINTOPS_OTA_NATIVE_B_MANIFEST',
  'PRINTOPS_OTA_NATIVE_B_INSTALLER',
  'PRINTOPS_OTA_NATIVE_A_VERSION',
  'PRINTOPS_OTA_NATIVE_B_VERSION',
  'PRINTOPS_OTA_NATIVE_A_SCHEMA_VERSION',
  'PRINTOPS_OTA_NATIVE_B_SCHEMA_VERSION',
  'PRINTOPS_OTA_NATIVE_BROKEN_MANIFEST',
  'PRINTOPS_OTA_NATIVE_BROKEN_INSTALLER',
  'PRINTOPS_OTA_NATIVE_BROKEN_VERSION'
)
foreach ($name in $required) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "$name is required for the native A -> B -> broken-B acceptance test"
  }
}

$repo = Split-Path -Parent $PSScriptRoot
$publicKeyPath = $env:PRINTOPS_OTA_NATIVE_PUBLIC_KEY_FILE
if ([string]::IsNullOrWhiteSpace($publicKeyPath)) {
  $publicKeyPath = Join-Path $repo 'artifacts/ota-native/public-key.txt'
}
if (Test-Path -LiteralPath $publicKeyPath -PathType Leaf) {
  $nativePublicKey = (Get-Content -LiteralPath $publicKeyPath -Raw).Trim()
} else {
  $nativePublicKey = $env:PRINTOPS_OTA_NATIVE_PUBLIC_KEY
}
if ([string]::IsNullOrWhiteSpace($nativePublicKey)) {
  throw 'PRINTOPS_OTA_NATIVE_PUBLIC_KEY_FILE or PRINTOPS_OTA_NATIVE_PUBLIC_KEY is required'
}

$desktopExeRelative = if ($env:PRINTOPS_OTA_NATIVE_DESKTOP_RELATIVE_PATH) {
  $env:PRINTOPS_OTA_NATIVE_DESKTOP_RELATIVE_PATH
} else {
  'printerops-desktop.exe'
}
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "printops-ota-native-$PID"
$installRoot = Join-Path $tempRoot 'installation\PrintOps'
$dataRoot = Join-Path $tempRoot 'data'
$appData = Join-Path $dataRoot 'appdata'
$localAppData = Join-Path $dataRoot 'localappdata'
$sourcePort = if ($env:PRINTOPS_OTA_NATIVE_SOURCE_PORT) { [int]$env:PRINTOPS_OTA_NATIVE_SOURCE_PORT } else { 18082 }
$evidenceRoot = if ($env:PRINTOPS_OTA_NATIVE_EVIDENCE_DIR) {
  $env:PRINTOPS_OTA_NATIVE_EVIDENCE_DIR
} else {
  Join-Path $repo 'artifacts/ota-native/evidence'
}
$transcriptPath = Join-Path $evidenceRoot 'native-e2e-transcript.txt'
$transcriptStarted = $false
$desktopProcess = $null
$labProcess = $null

# A terminated local run can leave its PID-derived temp root behind, and a
# later process may legitimately receive the same PID. Remove only that exact
# stale acceptance root before installing A so NSIS cannot preserve old files.
if (Test-Path -LiteralPath $tempRoot) {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force
}

function Assert-File([string]$path, [string]$label) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$label is missing: $path" }
}

function Assert-NativeProvenance([string]$manifest, [string]$artifact, [string]$version, [int]$schema) {
  $verifier = Join-Path $repo 'scripts/ota-native-provenance.mjs'
  Assert-File $verifier 'native provenance verifier'
  $node = (Get-Command node).Source
  & $node $verifier '--manifest' $manifest '--artifact' $artifact '--public-key' $publicKeyPath '--expected-version' $version '--expected-schema' ([string]$schema)
  if ($LASTEXITCODE -ne 0) { throw "native provenance verification failed for $version schema $schema" }
}

function Get-ManifestPayload([string]$path) {
  $value = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  if ($value.envelope_version -eq 1) { return $value.manifest }
  return $value
}

function Assert-SchemaChangingRelease {
  $aPayload = Get-ManifestPayload $env:PRINTOPS_OTA_NATIVE_A_MANIFEST
  $bPayload = Get-ManifestPayload $env:PRINTOPS_OTA_NATIVE_B_MANIFEST
  $brokenPayload = Get-ManifestPayload $env:PRINTOPS_OTA_NATIVE_BROKEN_MANIFEST
  $expectedA = [int]$env:PRINTOPS_OTA_NATIVE_A_SCHEMA_VERSION
  $expectedB = [int]$env:PRINTOPS_OTA_NATIVE_B_SCHEMA_VERSION
  $manifestA = [int]$aPayload.compatibility.schema_version
  $manifestB = [int]$bPayload.compatibility.schema_version
  $manifestBroken = [int]$brokenPayload.compatibility.schema_version
  if ($expectedB -le $expectedA) { throw "native acceptance requires a schema-changing B release ($expectedA -> $expectedB)" }
  if ($manifestA -ne $expectedA) { throw "A manifest must declare schema version $expectedA" }
  if ($manifestB -ne $expectedB -or $manifestBroken -ne $expectedB) {
    throw "B and broken-B manifests must declare schema version $expectedB"
  }
}

function Redact-NativeEvidenceValue($value) {
  if ($null -eq $value) { return $null }
  if ($value -is [System.Management.Automation.PSCustomObject]) {
    $redacted = [ordered]@{}
    foreach ($property in $value.psobject.Properties) {
      if ($property.Name -match '(?i)(token|secret|password|credential|private)') {
        $redacted[$property.Name] = '[redacted]'
      } else {
        $redacted[$property.Name] = Redact-NativeEvidenceValue $property.Value
      }
    }
    return $redacted
  }
  if ($value -is [System.Collections.IEnumerable] -and $value -isnot [string]) {
    $redactedItems = @()
    foreach ($item in $value) { $redactedItems += ,(Redact-NativeEvidenceValue $item) }
    return $redactedItems
  }
  return $value
}

function Save-SafeNativeJson([string]$source, [string]$destination) {
  $document = Get-Content -LiteralPath $source -Raw | ConvertFrom-Json
  $safeDocument = Redact-NativeEvidenceValue $document
  $safeDocument | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $destination
}

function Save-NativeEvidence {
  try {
    New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
    $logDestination = Join-Path $evidenceRoot 'logs'
    $stateDestination = Join-Path $evidenceRoot 'state'
    New-Item -ItemType Directory -Force -Path $logDestination, $stateDestination | Out-Null

    foreach ($root in @($dataRoot, $appData, $localAppData)) {
      if (-not (Test-Path -LiteralPath $root)) { continue }
      Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @('desktop.log', 'desktop-server.log', 'desktop-runner.log') } |
        ForEach-Object {
          Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $logDestination "$($_.Directory.Name)-$($_.Name)") -Force
        }
      Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @('updater-state.json', 'staged-artifact.json') } |
        ForEach-Object {
          $destination = Join-Path $stateDestination "$($_.Directory.Name)-$($_.Name)"
          Save-SafeNativeJson $_.FullName $destination
        }
    }

    $summary = [ordered]@{
      generatedAt = [DateTime]::UtcNow.ToString('o')
      aVersion = $env:PRINTOPS_OTA_NATIVE_A_VERSION
      bVersion = $env:PRINTOPS_OTA_NATIVE_B_VERSION
      aSchema = [int]$env:PRINTOPS_OTA_NATIVE_A_SCHEMA_VERSION
      bSchema = [int]$env:PRINTOPS_OTA_NATIVE_B_SCHEMA_VERSION
      evidenceExcludes = @('database files', 'JWT secrets', 'OTA health token', 'private signing key')
    }
    $summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $evidenceRoot 'native-e2e-summary.json')
  } catch {
    Write-Warning "Could not preserve native OTA evidence: $($_.Exception.Message)"
  }
}

function Save-NativePhaseEvidence([string]$phase) {
  try {
    $phaseRoot = Join-Path (Join-Path $evidenceRoot 'phases') $phase
    $logDestination = Join-Path $phaseRoot 'logs'
    $stateDestination = Join-Path $phaseRoot 'state'
    New-Item -ItemType Directory -Force -Path $logDestination, $stateDestination | Out-Null

    foreach ($root in @($dataRoot, $appData, $localAppData)) {
      if (-not (Test-Path -LiteralPath $root)) { continue }
      Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @('desktop.log', 'desktop-server.log', 'desktop-runner.log') } |
        ForEach-Object {
          Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $logDestination "$($_.Directory.Name)-$($_.Name)") -Force
        }
      Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @('updater-state.json', 'staged-artifact.json') } |
        ForEach-Object {
          Save-SafeNativeJson $_.FullName (Join-Path $stateDestination "$($_.Directory.Name)-$($_.Name)")
        }
    }
  } catch {
    Write-Warning "Could not preserve native OTA $phase evidence: $($_.Exception.Message)"
  }
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
    # Windows PowerShell/.NET Framework exposes only Kill(), while newer
    # .NET versions also expose Kill(bool). The lab server has no child
    # process that needs recursive cleanup.
    $script:labProcess.Kill()
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
  $desktopPath = [System.IO.Path]::GetFullPath((Join-Path $installRoot $desktopExeRelative))
  $desktopName = [System.IO.Path]::GetFileNameWithoutExtension($desktopExeRelative)
  $candidates = @()
  if ($script:desktopProcess) { $candidates += $script:desktopProcess }
  $candidates += @(Get-Process -Name $desktopName -ErrorAction SilentlyContinue)
  $seen = @{}
  foreach ($process in $candidates) {
    if (-not $process -or $seen.ContainsKey($process.Id)) { continue }
    $seen[$process.Id] = $true
    try { $path = [System.IO.Path]::GetFullPath($process.Path) } catch { $path = $null }
    if ($path -and $path.Equals($desktopPath, [System.StringComparison]::OrdinalIgnoreCase) -and -not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $process.WaitForExit(10000)
    }
  }
  $script:desktopProcess = $null
}

function Get-Health {
  try { return Invoke-RestMethod -Uri 'http://127.0.0.1:31415/health' -TimeoutSec 3 } catch { return $null }
}

function Get-UpdaterState {
  $roots = @($dataRoot, $appData, $localAppData) | Where-Object { Test-Path -LiteralPath $_ }
  $file = Get-ChildItem -LiteralPath $roots -Filter 'updater-state.json' -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $file) { return $null }
  try { return Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json } catch { return $null }
}

function Get-HealthToken {
  $file = Get-ChildItem -LiteralPath @($dataRoot, $appData, $localAppData) -Filter 'ota-health-token.txt' -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $file) { return $null }
  return (Get-Content -LiteralPath $file.FullName -Raw).Trim()
}

function Get-ApiToken {
  $bootstrap = Invoke-RestMethod -Uri 'http://127.0.0.1:31415/auth/bootstrap' -TimeoutSec 3
  if ($bootstrap.state -eq 'REQUIRED_NEW') {
    $email = "ota-native-$PID@example.invalid"
    $password = "Native-OTA-$PID-Password!"
    $body = @{
      name = 'OTA Native E2E'
      email = $email
      password = $password
      passwordConfirmation = $password
    } | ConvertTo-Json
    $created = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:31415/auth/bootstrap' -ContentType 'application/json' -Body $body -TimeoutSec 3
    return [string]$created.token
  }
  if ($bootstrap.state -eq 'MIGRATION_REQUIRED') { throw 'native e2e data directory requires an unsupported owner migration' }
  $loginBody = @{
    email = "ota-native-$PID@example.invalid"
    password = "Native-OTA-$PID-Password!"
  } | ConvertTo-Json
  $login = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:31415/auth/login' -ContentType 'application/json' -Body $loginBody -TimeoutSec 3
  return [string]$login.token
}

function Get-OtaStatus([string]$token) {
  if ([string]::IsNullOrWhiteSpace($token)) { throw 'API JWT was not created' }
  return Invoke-RestMethod -Uri 'http://127.0.0.1:31415/api/v1/ota/status' -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 3
}

function Assert-DataSeparated {
  $installFull = [System.IO.Path]::GetFullPath($installRoot).TrimEnd('\')
  $dataFull = [System.IO.Path]::GetFullPath($dataRoot).TrimEnd('\')
  if ($dataFull.StartsWith("$installFull\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "test data directory is nested under the installation root: $dataFull"
  }
  $forbidden = @(
    (Join-Path $installRoot 'appdata'),
    (Join-Path $installRoot 'localappdata'),
    (Join-Path $installRoot 'logs'),
    (Join-Path $installRoot 'printops.db'),
    (Join-Path $installRoot 'ota\updater-state.json'),
    (Join-Path $installRoot 'ota\backups'),
    (Join-Path $installRoot 'ota-health-token.txt')
  )
  foreach ($path in $forbidden) {
    if (Test-Path -LiteralPath $path) { throw "installation root contains forbidden mutable data: $path" }
  }
  $forbiddenFiles = Get-ChildItem -LiteralPath $installRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in @('updater-state.json', 'ota-health-token.txt', 'printops.db', 'desktop.log') }
  if ($forbiddenFiles) { throw "installation root contains mutable OTA/application data: $($forbiddenFiles[0].FullName)" }
}

function Configure-OTAEnvironment {
  $env:APPDATA = $appData
  $env:LOCALAPPDATA = $localAppData
  $env:PRINTOPS_OTA_NATIVE_DATA_ROOT = $dataRoot
  $env:PRINTOPS_DEV_SEED = 'false'
  $env:PRINTOPS_OTA_ENABLED = 'true'
  $env:PRINTOPS_OTA_AUTO_UPDATE_ENABLED = 'true'
  $env:PRINTOPS_OTA_LAN_RELAY_URL = "http://127.0.0.1:$sourcePort"
  $env:PRINTOPS_OTA_REQUIRE_SIGNATURE = 'true'
  $env:PRINTOPS_OTA_PUBLIC_KEY = $nativePublicKey
  # The lab is started only after A reaches readiness, so the updater can keep
  # its normal fast retry cadence while the baseline remains observable.
  $env:PRINTOPS_OTA_AUTO_UPDATE_CHECK_INTERVAL_MS = '1000'
  # Cold Windows sidecars can take longer than the normal development probe;
  # retain the real health/readiness contract while giving them room to start.
  $env:PRINTOPS_OTA_HEALTH_CHECK_TIMEOUT_MS = '60000'
  $env:PRINTOPS_OTA_AUTO_UPDATE_JITTER_MS = '0'
  $env:PRINTOPS_OTA_AUTO_UPDATE_RETRY_BASE_MS = '1000'
  $env:PRINTOPS_OTA_AUTO_UPDATE_RETRY_MAX_MS = '5000'
  $env:PRINTOPS_OTA_AUTO_UPDATE_MAX_FAILURES = '2'
}

try {
  Assert-SchemaChangingRelease
  Assert-NativeProvenance $env:PRINTOPS_OTA_NATIVE_A_MANIFEST $env:PRINTOPS_OTA_NATIVE_A_INSTALLER $env:PRINTOPS_OTA_NATIVE_A_VERSION ([int]$env:PRINTOPS_OTA_NATIVE_A_SCHEMA_VERSION)
  Assert-NativeProvenance $env:PRINTOPS_OTA_NATIVE_B_MANIFEST $env:PRINTOPS_OTA_NATIVE_B_INSTALLER $env:PRINTOPS_OTA_NATIVE_B_VERSION ([int]$env:PRINTOPS_OTA_NATIVE_B_SCHEMA_VERSION)
  Assert-NativeProvenance $env:PRINTOPS_OTA_NATIVE_BROKEN_MANIFEST $env:PRINTOPS_OTA_NATIVE_BROKEN_INSTALLER $env:PRINTOPS_OTA_NATIVE_BROKEN_VERSION ([int]$env:PRINTOPS_OTA_NATIVE_B_SCHEMA_VERSION)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $installRoot), $dataRoot, $appData, $localAppData | Out-Null
  Configure-OTAEnvironment
  New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
  Start-Transcript -LiteralPath $transcriptPath -Force | Out-Null
  $transcriptStarted = $true

  # Successful real update: A is installed and launched, then the local lab
  # serves the signed B manifest and the actual B NSIS artifact.
  Install-NSIS $env:PRINTOPS_OTA_NATIVE_A_INSTALLER
  Assert-DataSeparated
  Start-Desktop
  Wait-Until 'version A health' { (Get-Health).status -eq 'ok' -and (Get-Health).version -eq $env:PRINTOPS_OTA_NATIVE_A_VERSION }
  Wait-Until 'version A OTA readiness and schema' {
    try {
      $snapshot = Invoke-RestMethod -Uri 'http://127.0.0.1:31415/api/v1/system/readiness' -Headers @{ 'x-printops-ota-token' = (Get-HealthToken) }
      $snapshot.ota.status -eq 'READY' -and [int]$snapshot.ota.requiredComponents.database.details.schemaVersion -eq [int]$env:PRINTOPS_OTA_NATIVE_A_SCHEMA_VERSION
    } catch { $false }
  } | Out-Null
  Start-Lab $env:PRINTOPS_OTA_NATIVE_B_MANIFEST $env:PRINTOPS_OTA_NATIVE_B_INSTALLER
  Wait-Until 'version B health after automatic OTA' { (Get-Health).version -eq $env:PRINTOPS_OTA_NATIVE_B_VERSION }
  Wait-Until 'COMPLETED updater state' { (Get-UpdaterState).phase -eq 'COMPLETED' } | Out-Null
  $completed = Get-UpdaterState
  if ([string]$completed.version -ne $env:PRINTOPS_OTA_NATIVE_B_VERSION) { throw 'COMPLETED state does not identify the expected B version' }
  if ((Get-Health).version -ne $env:PRINTOPS_OTA_NATIVE_B_VERSION) { throw 'reported version is not B' }
  $readiness = Invoke-RestMethod -Uri 'http://127.0.0.1:31415/api/v1/system/readiness' -Headers @{ 'x-printops-ota-token' = (Get-HealthToken) }
  if ($readiness.ota.status -ne 'READY') { throw 'B OTA readiness contract did not become READY' }
  if ([int]$readiness.ota.requiredComponents.database.details.schemaVersion -ne [int]$env:PRINTOPS_OTA_NATIVE_B_SCHEMA_VERSION) {
    throw "B database schema is $($readiness.ota.requiredComponents.database.details.schemaVersion), expected $($env:PRINTOPS_OTA_NATIVE_B_SCHEMA_VERSION)"
  }
  $apiToken = Get-ApiToken
  Wait-Until 'API COMPLETED OTA state' { (Get-OtaStatus $apiToken).state.state -eq 'COMPLETED' } | Out-Null
  $completedApi = Get-OtaStatus $apiToken
  if ([string]$completedApi.currentVersion -ne $env:PRINTOPS_OTA_NATIVE_B_VERSION) { throw 'API COMPLETED state does not report B as current' }
  if ([string]$completedApi.state.targetVersion -ne $env:PRINTOPS_OTA_NATIVE_B_VERSION) { throw 'API COMPLETED state does not identify B as target' }
  Assert-DataSeparated
  Save-NativePhaseEvidence 'a-to-b'
  Write-Host '[PASS] real signed NSIS A -> B update and OTA readiness'

  # Rollback run: reinstall A in a fresh disposable data directory, then
  # serve a deliberately unhealthy but signed B release. The real updater must
  # restore both the old install tree and DB before relaunching A.
  Stop-Desktop
  Stop-Lab
  if (Test-Path -LiteralPath $installRoot) { Remove-Item -LiteralPath $installRoot -Recurse -Force }
  if (Test-Path -LiteralPath $dataRoot) { Remove-Item -LiteralPath $dataRoot -Recurse -Force }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $installRoot), $dataRoot, $appData, $localAppData | Out-Null
  Install-NSIS $env:PRINTOPS_OTA_NATIVE_A_INSTALLER
  Assert-DataSeparated
  Start-Desktop
  Wait-Until 'rollback baseline A health' { (Get-Health).status -eq 'ok' -and (Get-Health).version -eq $env:PRINTOPS_OTA_NATIVE_A_VERSION }
  Wait-Until 'rollback baseline A OTA readiness and schema' {
    try {
      $snapshot = Invoke-RestMethod -Uri 'http://127.0.0.1:31415/api/v1/system/readiness' -Headers @{ 'x-printops-ota-token' = (Get-HealthToken) }
      $snapshot.ota.status -eq 'READY' -and [int]$snapshot.ota.requiredComponents.database.details.schemaVersion -eq [int]$env:PRINTOPS_OTA_NATIVE_A_SCHEMA_VERSION
    } catch { $false }
  } | Out-Null
  Start-Lab $env:PRINTOPS_OTA_NATIVE_BROKEN_MANIFEST $env:PRINTOPS_OTA_NATIVE_BROKEN_INSTALLER
  Wait-Until 'broken B rollback to A' {
    $state = Get-UpdaterState
    $state.phase -eq 'ROLLED_BACK' -and [string]$state.version -eq $env:PRINTOPS_OTA_NATIVE_BROKEN_VERSION
  } | Out-Null
  $rolledBack = Get-UpdaterState
  Wait-Until 'version A health after rollback' { (Get-Health).version -eq $env:PRINTOPS_OTA_NATIVE_A_VERSION } | Out-Null
  if ([string]$rolledBack.version -ne $env:PRINTOPS_OTA_NATIVE_BROKEN_VERSION) { throw 'rollback state does not identify the broken candidate version' }
  $rollbackReadiness = Invoke-RestMethod -Uri 'http://127.0.0.1:31415/api/v1/system/readiness' -Headers @{ 'x-printops-ota-token' = (Get-HealthToken) }
  if ([int]$rollbackReadiness.ota.requiredComponents.database.details.schemaVersion -ne [int]$env:PRINTOPS_OTA_NATIVE_A_SCHEMA_VERSION) {
    throw "rollback database schema is $($rollbackReadiness.ota.requiredComponents.database.details.schemaVersion), expected $($env:PRINTOPS_OTA_NATIVE_A_SCHEMA_VERSION)"
  }
  $rollbackToken = Get-ApiToken
  Wait-Until 'API ROLLED_BACK OTA state' { (Get-OtaStatus $rollbackToken).state.state -eq 'ROLLED_BACK' } | Out-Null
  $rolledBackApi = Get-OtaStatus $rollbackToken
  if ([string]$rolledBackApi.state.targetVersion -ne $env:PRINTOPS_OTA_NATIVE_BROKEN_VERSION) { throw 'API ROLLED_BACK state does not identify the broken candidate' }
  if ([int]$rolledBackApi.currentSchemaVersion -ne [int]$env:PRINTOPS_OTA_NATIVE_A_SCHEMA_VERSION) {
    throw "API rollback state reports schema $($rolledBackApi.currentSchemaVersion), expected $($env:PRINTOPS_OTA_NATIVE_A_SCHEMA_VERSION)"
  }
  Assert-DataSeparated
  Save-NativePhaseEvidence 'rollback'
  Write-Host '[PASS] broken B rollback restored A and persisted ROLLED_BACK'
} finally {
  Stop-Desktop
  Stop-Lab
  if ($transcriptStarted) { Stop-Transcript | Out-Null }
  Save-NativeEvidence
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
