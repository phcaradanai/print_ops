$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = Split-Path -Parent $PSScriptRoot
$runId = if ($env:GITHUB_RUN_ID) { $env:GITHUB_RUN_ID } else { [guid]::NewGuid().ToString('N') }
$runAttempt = if ($env:GITHUB_RUN_ATTEMPT) { $env:GITHUB_RUN_ATTEMPT } else { '1' }
$evidenceRoot = if ($env:PRINTOPS_CONTROL_NATIVE_EVIDENCE_DIR) { $env:PRINTOPS_CONTROL_NATIVE_EVIDENCE_DIR } else { Join-Path $env:TEMP "web-control-ota-native-evidence-$runId-$runAttempt" }
$workRoot = if ($env:RUNNER_TEMP) { Join-Path $env:RUNNER_TEMP "web-control-ota-native-$runId-$runAttempt-$PID" } else { Join-Path $env:TEMP "web-control-ota-native-$runId-$runAttempt-$PID" }
$script:controlApiPort = 31416
$script:controlApiBase = "http://127.0.0.1:$script:controlApiPort"
$script:controlApiProcess = $null
$script:controlApiRoot = $null
$script:desktopProcess = $null
$script:artifactServer = $null
$script:sourcePort = 0
$script:originalEnvironment = @{}
$script:workRootCreated = $false
$script:currentInstallRoot = $null
$script:currentDataRoot = $null
$script:apiToken = $null
$script:printApiKey = $null
$script:deviceApiToken = $null
$script:deviceOwnerPassword = $null
$script:device = $null
$script:ownerEmail = $null
$script:ownerPassword = $null
$script:printQueuePaused = $false
$script:activeScenario = $null
$script:exitCode = 0

New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
$script:summary = [ordered]@{
  schemaVersion = 1
  generatedAt = [DateTime]::UtcNow.ToString('o')
  overallStatus = 'BLOCKED'
  gitCommit = $null
  runner = [ordered]@{ os = [Environment]::OSVersion.VersionString; architecture = $env:PROCESSOR_ARCHITECTURE; isolatedAttestation = $false }
  artifacts = [ordered]@{ A = $null; B = $null; brokenB = $null }
  device = $null
  jetStream = [ordered]@{ url = $null; stream = $null; command = $null; reconnect = $null }
  process = [ordered]@{ baseline = $null; candidate = $null; controlPlane = $null; controlPlaneRuns = @(); deviceRuns = @(); restartObserved = $false; health = $null }
  printer = [ordered]@{ configuredQueue = $env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER; queueStatus = 'NOT RUN'; physicalQueueVerified = $false; driverName = $null; portName = $null; devicePortConfigured = $false; activeJob = $null; waitProof = $null }
  webControlTerminal = $null
  rollback = [ordered]@{ status = 'NOT RUN'; reason = 'No genuine signed broken-B evidence has been evaluated.'; evidence = $null }
  scenarios = [ordered]@{
    commandEnrollmentTransport = [ordered]@{ status = 'BLOCKED'; reason = 'Prerequisites have not been proven.' }
    signedAToBUpdate = [ordered]@{ status = 'BLOCKED'; reason = 'Prerequisites have not been proven.' }
    restartReconnectAndTerminalCompletion = [ordered]@{ status = 'BLOCKED'; reason = 'Prerequisites have not been proven.' }
    activePrintWait = [ordered]@{ status = 'BLOCKED'; reason = 'Prerequisites have not been proven.' }
    rollbackRecovery = [ordered]@{ status = 'BLOCKED'; reason = 'Prerequisites have not been proven.' }
    webUiAction = [ordered]@{ status = 'NOT RUN'; reason = 'The native driver currently uses the Control API directly; browser UI acceptance is required.' }
    transportResilience = [ordered]@{ status = 'NOT RUN'; reason = 'NATS/Web outage and reconnect scenarios have not been exercised.' }
    commandSafety = [ordered]@{ status = 'NOT RUN'; reason = 'Duplicate, replay, expiry, stale, and wrong-device scenarios have not been exercised.' }
    trustBoundary = [ordered]@{ status = 'NOT RUN'; reason = 'Invalid signature, digest, compatibility, and platform scenarios have not been exercised.' }
    recoveryHardStop = [ordered]@{ status = 'NOT RUN'; reason = 'ROLLBACK_FAILED persistence and remote install rejection have not been exercised.' }
  }
  evidenceExcludes = @('SQLite database', 'device identity/token file', 'JWT/API keys', 'OTA health token', 'private signing key')
}

function Write-Summary {
  $script:summary.generatedAt = [DateTime]::UtcNow.ToString('o')
  $script:summary | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath (Join-Path $evidenceRoot 'native-acceptance-summary.json') -Encoding utf8
}

function Set-Scenario([string]$name, [string]$status, [string]$reason, $evidence = $null) {
  $value = [ordered]@{ status = $status; reason = $reason }
  if ($null -ne $evidence) { $value.evidence = $evidence }
  $script:summary.scenarios[$name] = $value
  Write-Summary
}

function Set-Blocked([string[]]$reasons) {
  $script:summary.overallStatus = 'BLOCKED'
  $script:summary.blockers = @($reasons)
  foreach ($name in @($script:summary.scenarios.Keys)) {
    Set-Scenario $name 'BLOCKED' ($reasons -join ' ')
  }
  $script:summary.rollback.status = 'BLOCKED'
  $script:summary.rollback.reason = 'Native prerequisites did not pass; rollback/recovery was not started.'
  Write-Summary
}

function Save-Text([string]$name, [string]$text) {
  $path = Join-Path $evidenceRoot $name
  $text | Set-Content -LiteralPath $path -Encoding utf8
  return $path
}

function Get-ManifestPayload([string]$path) {
  $root = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  if ($root.envelope_version -ne 1 -or -not $root.manifest) { throw "Signed release manifest has an unsupported envelope: $path" }
  return $root
}

function Get-ArtifactEvidence([string]$label, [string]$installer, [string]$manifestPath, [string]$version, [int]$schema, [string]$publicKeyPath, [string]$provenancePath) {
  foreach ($entry in @(@($installer, 'NSIS installer'), @($manifestPath, 'signed manifest'), @($publicKeyPath, 'OTA public key'), @($provenancePath, 'build provenance'))) {
    if ([string]::IsNullOrWhiteSpace([string]$entry[0]) -or -not (Test-Path -LiteralPath ([string]$entry[0]) -PathType Leaf)) { throw "$label $($entry[1]) is missing: $($entry[0])" }
  }
  $verifier = Join-Path $repo 'scripts/ota-native-provenance.mjs'
  $node = (Get-Command node -ErrorAction Stop).Source
  $verification = & $node $verifier '--manifest' $manifestPath '--artifact' $installer '--public-key' $publicKeyPath '--expected-version' $version '--expected-schema' ([string]$schema) 2>&1
  $code = $LASTEXITCODE
  Save-Text "$($label.ToLowerInvariant())-provenance-verification.log" ($verification -join [Environment]::NewLine) | Out-Null
  if ($code -ne 0) { throw "$label signed manifest/artifact verification failed: $($verification -join ' ')" }

  $envelope = Get-ManifestPayload $manifestPath
  $payload = $envelope.manifest
  $release = $payload.release
  $schemaVersion = [int]$payload.compatibility.schema_version
  $artifact = $payload.artifacts.desktop.'windows-x64'
  $hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
  $authenticode = Get-AuthenticodeSignature -LiteralPath $installer
  $provenance = Get-Content -LiteralPath $provenancePath -Raw | ConvertFrom-Json
  $phase = if ($label -eq 'A') { $provenance.acceptanceProfile.A } elseif ($label -eq 'B') { $provenance.acceptanceProfile.B } else { $provenance.acceptanceProfile.brokenB }
  $commit = [string]$provenance.source.commit
  $provenanceArtifactName = if ($label -eq 'brokenB') { 'broken-B' } else { $label }
  $provenanceArtifactProperty = $provenance.artifacts.PSObject.Properties[$provenanceArtifactName]
  if (-not $provenanceArtifactProperty -or [string]$provenanceArtifactProperty.Value.sha256 -cne $hash) {
    throw "$label provenance does not bind the installer SHA-256 to its artifact evidence."
  }
  return [ordered]@{
    version = [string]$release.version
    schemaVersion = $schemaVersion
    sourceCommit = $commit
    sourceDescription = [string]$phase.source
    installerPath = [IO.Path]::GetFullPath($installer)
    manifestPath = [IO.Path]::GetFullPath($manifestPath)
    sha256 = $hash
    bytes = (Get-Item -LiteralPath $installer).Length
    manifestSignature = [string]$envelope.signature
    artifactSignature = [string]$artifact.signature
    authenticodeStatus = [string]$authenticode.Status
    authenticodeSigner = if ($authenticode.SignerCertificate) { [string]$authenticode.SignerCertificate.Subject } else { $null }
    channel = [string]$release.channel
    manifestNotes = [string]$release.notes
    signedArtifactUrl = [string]$artifact.url
    provenance = $provenance
  }
}

function Test-IsolatedRunnerAndPrinter {
  $issues = [System.Collections.Generic.List[string]]::new()
  if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -notin @('AMD64', 'x86_64')) { $issues.Add('Runner must be Windows x64.') }
  if ($env:RUNNER_NAME -match 'Hosted Agent') { $issues.Add('GitHub-hosted runners are forbidden; use the isolated self-hosted Windows runner.') }
  if ($env:PRINTOPS_CONTROL_NATIVE_RUNNER_CONFIRMATION -cne 'I_CONFIRM_THIS_ISOLATED_WINDOWS_X64_RUNNER') { $issues.Add('The protected isolated-runner attestation secret is missing or does not match the required exact value.') }
  if ($env:PRINTOPS_CONTROL_NATIVE_BASELINE_COMMIT -ceq '4ea6cdd76f19f2f4babdc2a7de0311dd0a6fec51') { $issues.Add('Production A v0.1.28 predates the Web Control device command agent and cannot receive an OTA command; deploy a control-capable bootstrap release locally before native Web Control acceptance.') }
  $natsUrl = [string]$env:PRINTOPS_CONTROL_NATS_URL
  if ($natsUrl -notmatch '^nats://(127\.0\.0\.1|localhost):4222$') { $issues.Add('PRINTOPS_CONTROL_NATS_URL must explicitly target the workflow-owned local NATS listener nats://127.0.0.1:4222; production and Core NATS fallback are forbidden.') }
  if ($env:PRINTOPS_CONTROL_NATS_STREAM -cne 'PRINTOPS_CONTROL') { $issues.Add('PRINTOPS_CONTROL_NATS_STREAM must be the isolated JetStream stream PRINTOPS_CONTROL.') }
  $selectedPrinter = $null
  if (-not (Get-Command Get-Printer -ErrorAction SilentlyContinue)) { $issues.Add('Windows PrintManagement Get-Printer is required to validate the approved physical queue.') }
  elseif ([string]::IsNullOrWhiteSpace($env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER)) { $issues.Add('PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER must name the explicitly approved physical test queue.') }
  else {
    $selectedPrinter = Get-Printer -Name $env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER -ErrorAction SilentlyContinue
    if (-not $selectedPrinter) { $issues.Add('The explicitly configured safe printer is not installed in the Windows spooler.') }
    elseif ($selectedPrinter.Name -cne $env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER) { $issues.Add('The Windows spooler queue name does not exactly match the explicitly approved physical test queue.') }
    elseif ([string]::IsNullOrWhiteSpace([string]$selectedPrinter.DriverName) -or [string]::IsNullOrWhiteSpace([string]$selectedPrinter.PortName)) { $issues.Add('The configured test queue lacks an identifiable spooler driver or physical device port.') }
    elseif ((@($selectedPrinter.Name, $selectedPrinter.DriverName, $selectedPrinter.PortName) -join ' ') -match '(?i)(Microsoft Print to PDF|Microsoft XPS Document Writer|OneNote|Fax|CutePDF|doPDF|PDFCreator|PORTPROMPT:|FILE:|NUL:)') { $issues.Add('The configured queue is a virtual or file-backed printer, not an approved physical test printer.') }
  }
  if ($selectedPrinter) {
    if ([string]::IsNullOrWhiteSpace($env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER_DRIVER) -or $selectedPrinter.DriverName -cne $env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER_DRIVER) { $issues.Add('The installed printer driver does not exactly match the protected physical-device allowlist.') }
    if ([string]::IsNullOrWhiteSpace($env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER_PORT) -or $selectedPrinter.PortName -cne $env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER_PORT) { $issues.Add('The installed printer port does not exactly match the protected physical-device allowlist.') }
  }

  if ([string]::IsNullOrWhiteSpace($env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER_CODE) -or $env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER_CODE -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$') { $issues.Add('PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER_CODE must be an explicit valid local printer code.') }
  if ($env:PRINTOPS_CONTROL_NATIVE_PRINTER_CONFIRMATION -cne $env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER) { $issues.Add('The protected printer confirmation must exactly match the configured physical test queue name.') }
  if ($env:PRINTOPS_CONTROL_NATIVE_PHYSICAL_PRINT_ACK -cne 'I_ACKNOWLEDGE_ONE_PHYSICAL_ACCEPTANCE_PRINT') { $issues.Add('The protected physical-print acknowledgement is missing; the driver will not submit a marked print.') }
  foreach ($command in @('Get-Printer', 'Get-PrintJob', 'Pause-Printer', 'Resume-Printer')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { $issues.Add("Required Windows print-spooler command is unavailable: $command") }
  }
  if ((Get-Command Get-Printer -ErrorAction SilentlyContinue) -and $env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER) {
    try {
      $jobs = @(Get-PrintJob -PrinterName $env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER -ErrorAction Stop)
      if ($jobs.Count -gt 0) { $issues.Add('The configured safe printer already has queued jobs; the driver will not interfere with existing work.') }
    } catch { $issues.Add("Could not inspect the configured print queue safely: $($_.Exception.Message)") }
  }
  foreach ($portNumber in @(31415, $script:controlApiPort, 31417)) {
    try {
      $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $portNumber)
      $listener.Start()
      $listener.Stop()
    } catch { $issues.Add("Loopback port $portNumber is occupied; only the isolated installed device API and control-plane API may bind their designated ports.") }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $repo 'node_modules/nats') -PathType Container)) { $issues.Add('The locked workspace dependencies are unavailable; the real NATS JetStream probe cannot run.') }
  return @($issues)
}

function Get-CurrentCommit {
  $value = & git -C $repo rev-parse HEAD 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Cannot determine checked-out Git commit: $value" }
  return ([string]$value).Trim()
}

function Get-ManifestSourceCommit([string]$notes) {
  if ($notes -match '(?i)\bsource\s+([0-9a-f]{40})\b') { return $Matches[1].ToLowerInvariant() }
  return $null
}

function Test-ArtifactLineage {
  $reasons = [System.Collections.Generic.List[string]]::new()
  $currentCommit = Get-CurrentCommit
  $script:summary.gitCommit = $currentCommit
  $script:summary.runner.isolatedAttestation = $env:PRINTOPS_CONTROL_NATIVE_RUNNER_CONFIRMATION -ceq 'I_CONFIRM_THIS_ISOLATED_WINDOWS_X64_RUNNER'

  $aInstaller = $env:PRINTOPS_CONTROL_NATIVE_A_INSTALLER
  $aManifest = $env:PRINTOPS_CONTROL_NATIVE_A_MANIFEST
  $bInstaller = $env:PRINTOPS_CONTROL_NATIVE_B_INSTALLER
  $bManifest = $env:PRINTOPS_CONTROL_NATIVE_B_MANIFEST
  $publicKey = $env:PRINTOPS_CONTROL_NATIVE_PUBLIC_KEY_FILE
  $provenance = $env:PRINTOPS_CONTROL_NATIVE_PROVENANCE
  $aVersion = $env:PRINTOPS_CONTROL_NATIVE_A_VERSION
  $bVersion = $env:PRINTOPS_CONTROL_NATIVE_B_VERSION
  $aSchemaRaw = $env:PRINTOPS_CONTROL_NATIVE_A_SCHEMA_VERSION
  $bSchemaRaw = $env:PRINTOPS_CONTROL_NATIVE_B_SCHEMA_VERSION
  $baselineArtifactHash = [string]$env:PRINTOPS_CONTROL_NATIVE_BASELINE_ARTIFACT_SHA256
  if ([string]::IsNullOrWhiteSpace($provenance) -and $env:PRINTOPS_OTA_NATIVE_OUTPUT_DIR) { $provenance = Join-Path $env:PRINTOPS_OTA_NATIVE_OUTPUT_DIR 'provenance.json' }
  $aProvenance = if ($env:PRINTOPS_CONTROL_NATIVE_A_PROVENANCE) { [string]$env:PRINTOPS_CONTROL_NATIVE_A_PROVENANCE } else { $provenance }
  if ([string]::IsNullOrWhiteSpace($aInstaller) -or [string]::IsNullOrWhiteSpace($aManifest) -or [string]::IsNullOrWhiteSpace($aVersion) -or [string]::IsNullOrWhiteSpace($aSchemaRaw) -or [string]::IsNullOrWhiteSpace($bInstaller) -or [string]::IsNullOrWhiteSpace($bManifest) -or [string]::IsNullOrWhiteSpace($bVersion) -or [string]::IsNullOrWhiteSpace($bSchemaRaw) -or [string]::IsNullOrWhiteSpace($publicKey) -or [string]::IsNullOrWhiteSpace($provenance) -or [string]::IsNullOrWhiteSpace($aProvenance) -or [string]::IsNullOrWhiteSpace($baselineArtifactHash)) {
    $reasons.Add('A signed archived production installer/manifest, pinned baseline digest, B artifacts, public key, and provenance are required before native acceptance can start.')
    return @($reasons)
  }
  if (-not (Test-Path -LiteralPath $provenance -PathType Leaf)) {
    $reasons.Add("Artifact provenance is missing: $provenance")
    return @($reasons)
  }
  if ($aSchemaRaw -notmatch '^\d+$' -or $bSchemaRaw -notmatch '^\d+$') {
    $reasons.Add('A and B schema versions must be explicit non-negative integers.')
    return @($reasons)
  }
  try {
    $aSchema = [int]$aSchemaRaw
    $bSchema = [int]$bSchemaRaw
    $script:summary.artifacts.A = Get-ArtifactEvidence 'A' $aInstaller $aManifest $aVersion $aSchema $publicKey $aProvenance
    $script:summary.artifacts.B = Get-ArtifactEvidence 'B' $bInstaller $bManifest $bVersion $bSchema $publicKey $provenance
  } catch {
    $reasons.Add("A/B artifact signature or provenance verification failed: $($_.Exception.Message)")
    return @($reasons)
  }

  if ($script:summary.artifacts.B.sourceCommit -ne $currentCommit) { $reasons.Add('Candidate B provenance does not identify the checked-out Git commit; it is not the candidate built by this run.') }
  if ($script:summary.artifacts.B.sourceDescription -ne 'current production commit and unmodified production API bundle') { $reasons.Add('Candidate B provenance does not identify an unmodified production API bundle from the checked-out source.') }
  $bManifestRoot = Get-ManifestPayload $bManifest
  if ((Get-ManifestSourceCommit ([string]$bManifestRoot.manifest.release.notes)) -ne $currentCommit) { $reasons.Add('Candidate B signed manifest notes do not bind the artifact to the checked-out Git commit.') }
  if ($aSchema -ge $bSchema) { $reasons.Add("Candidate schema must be newer than the archived A schema; observed $aSchema -> $bSchema.") }

  $aManifestRoot = Get-ManifestPayload $aManifest
  $signedBaselineCommit = Get-ManifestSourceCommit ([string]$aManifestRoot.manifest.release.notes)
  $pinnedASourceCommit = [string]$env:PRINTOPS_CONTROL_NATIVE_BASELINE_COMMIT
  if ($pinnedASourceCommit -notmatch '^[0-9a-fA-F]{40}$') {
    $reasons.Add('Archived A requires a policy-pinned 40-character source commit.')
  } elseif ($pinnedASourceCommit -ieq '4ea6cdd76f19f2f4babdc2a7de0311dd0a6fec51') {
    $reasons.Add('Production A v0.1.28 predates the Web Control device command agent and cannot receive an OTA command; deploy a control-capable bootstrap release locally before native Web Control acceptance.')
  }
  if ($signedBaselineCommit -ine $pinnedASourceCommit -or [string]$script:summary.artifacts.A.sourceCommit -ine $pinnedASourceCommit) {
    $reasons.Add('Archived A signed manifest and provenance must both match the policy-pinned control-capable source commit.')
  }
  $archivedAVersion = [string]$script:summary.artifacts.A.version
  if ($archivedAVersion -notmatch '^\d+\.\d+\.\d+$') {
    $reasons.Add('Archived A version must be a stable x.y.z release.')
  } elseif ([version]$archivedAVersion -le [version]'0.1.28') {
    $reasons.Add('Archived A must be newer than v0.1.28 and contain the locally bootstrapped Web Control command agent.')
  }
  if ($script:summary.artifacts.A.sha256 -ne $baselineArtifactHash.ToLowerInvariant() -or $baselineArtifactHash -notmatch '^[0-9a-fA-F]{64}$') {
    $reasons.Add('Archived A does not match the policy-pinned installer SHA-256.')
  }
  if (-not $signedBaselineCommit) {
    $reasons.Add('Archived A must have a signed manifest whose release notes bind it to its source Git commit.')
  } elseif ($signedBaselineCommit -ine [string]$script:summary.artifacts.A.sourceCommit) {
    $reasons.Add('A provenance source commit does not match the source commit bound by the signed A manifest.')
  }
  if ([string]$script:summary.artifacts.A.sourceCommit -eq $currentCommit -or [string]$script:summary.artifacts.A.sourceDescription -match '(?i)current production commit|acceptance overlay') {
    $reasons.Add('Current-source acceptance output is not an archived production A artifact.')
  }
  if ([string]$script:summary.artifacts.A.sourceCommit -eq [string]$script:summary.artifacts.B.sourceCommit) {
    $reasons.Add('A and B resolve to the same source commit; A must be the separately archived control-capable bootstrap release.')
  }

  $brokenInstaller = $env:PRINTOPS_CONTROL_NATIVE_BROKEN_INSTALLER
  $brokenManifest = $env:PRINTOPS_CONTROL_NATIVE_BROKEN_MANIFEST
  if (-not $brokenInstaller -or -not $brokenManifest) {
    $script:summary.rollback.status = 'BLOCKED'
    $script:summary.rollback.reason = 'Signed broken-B installer and manifest are mandatory; rollback may not be skipped.'
    Set-Scenario 'rollbackRecovery' 'BLOCKED' $script:summary.rollback.reason
    $reasons.Add($script:summary.rollback.reason)
  } else {
    try {
      $brokenVersion = if ($env:PRINTOPS_CONTROL_NATIVE_BROKEN_VERSION) { $env:PRINTOPS_CONTROL_NATIVE_BROKEN_VERSION } else { $bVersion }
      $brokenSchema = if ($env:PRINTOPS_CONTROL_NATIVE_BROKEN_SCHEMA_VERSION) { [int]$env:PRINTOPS_CONTROL_NATIVE_BROKEN_SCHEMA_VERSION } else { $bSchema }
      $script:summary.artifacts.brokenB = Get-ArtifactEvidence 'brokenB' $brokenInstaller $brokenManifest $brokenVersion $brokenSchema $publicKey $provenance
      $brokenProfile = 'current production B resources plus scripts/ota-native-broken-server-proxy.go'
      $brokenFailure = 'proxy forwards normal traffic and returns HTTP 503 for OTA readiness after upstream health is live'
      $brokenManifestRoot = Get-ManifestPayload $brokenManifest
      $expectedBrokenNotes = "PrintOps native acceptance broken-B; source $currentCommit; profile=$brokenProfile; failure=$brokenFailure"
      if ($script:summary.artifacts.brokenB.sourceCommit -ne $currentCommit) { throw 'broken-B provenance is not bound to the current candidate commit' }
      if ($script:summary.artifacts.brokenB.sourceDescription -cne $brokenProfile) { throw 'broken-B provenance does not identify the readiness-failure proxy profile' }
      if ([string]$brokenManifestRoot.manifest.release.notes -cne $expectedBrokenNotes) { throw 'signed broken-B manifest does not bind the exact intentional readiness failure and source commit' }
      if ($script:summary.artifacts.brokenB.sha256 -eq $script:summary.artifacts.B.sha256) { throw 'broken-B installer digest is identical to ordinary B' }
      if ($script:summary.artifacts.brokenB.version -ne $script:summary.artifacts.B.version -or $script:summary.artifacts.brokenB.schemaVersion -ne $script:summary.artifacts.B.schemaVersion) { throw 'broken-B version/schema differs from B' }
      $script:summary.rollback.status = 'BLOCKED'
      $script:summary.rollback.reason = 'Signed broken-B provenance is verified; native migrated-B/readiness-failure/rollback evidence is still required.'
      Set-Scenario 'rollbackRecovery' 'BLOCKED' $script:summary.rollback.reason
    } catch {
      $script:summary.rollback.status = 'BLOCKED'
      $script:summary.rollback.reason = "Broken-B signature/provenance is not genuine: $($_.Exception.Message)"
      Set-Scenario 'rollbackRecovery' 'BLOCKED' $script:summary.rollback.reason
      $reasons.Add($script:summary.rollback.reason)
    }
  }
  return @($reasons)
}

function Assert-File([string]$path, [string]$label) {
  if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$label is missing: $path" }
}

function Wait-Until([string]$label, [scriptblock]$check, [int]$timeoutSeconds = 180, [int]$pollMilliseconds = 500) {
  $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
  do {
    try {
      $value = & $check
      if ($value) { return $value }
    } catch { }
    Start-Sleep -Milliseconds $pollMilliseconds
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "$label did not become true within $timeoutSeconds seconds"
}

function Invoke-Api([string]$method, [string]$path, $body = $null, [string]$token = $null, [string]$apiKey = $null) {
  $headers = @{}
  if ($token) { $headers.Authorization = "Bearer $token" }
  if ($apiKey) { $headers['x-api-key'] = $apiKey }
  $params = @{ Method = $method; Uri = "$script:controlApiBase$path"; Headers = $headers; TimeoutSec = 15; ErrorAction = 'Stop' }
  if ($null -ne $body) { $params.ContentType = 'application/json'; $params.Body = ConvertTo-Json -InputObject $body -Depth 16 -Compress }
  return Invoke-RestMethod @params
}
function Invoke-DeviceApi([string]$method, [string]$path, $body = $null, [string]$token = $null, [string]$apiKey = $null) {
  $headers = @{}
  if ($token) { $headers.Authorization = "Bearer $token" }
  if ($apiKey) { $headers['x-api-key'] = $apiKey }
  $params = @{ Method = $method; Uri = "http://127.0.0.1:31415$path"; Headers = $headers; TimeoutSec = 15; ErrorAction = 'Stop' }
  if ($null -ne $body) { $params.ContentType = 'application/json'; $params.Body = ConvertTo-Json -InputObject $body -Depth 16 -Compress }
  return Invoke-RestMethod @params
}


function Start-ControlApiServer([string]$name = 'control-plane') {
  $serverJs = Join-Path $repo 'apps/api/dist/server.js'
  Assert-File $serverJs 'compiled actual API server entry point'
  $script:controlApiRoot = Join-Path $workRoot $name
  $appData = Join-Path $script:controlApiRoot 'appdata'
  $localAppData = Join-Path $script:controlApiRoot 'localappdata'
  New-Item -ItemType Directory -Force -Path $script:controlApiRoot, $appData, $localAppData | Out-Null
  $stdout = Join-Path $script:controlApiRoot 'control-api.log'
  $stderr = Join-Path $script:controlApiRoot 'control-api-error.log'
  $environment = @{
    PRINTOPS_DEVICE_IDENTITY_PATH = Join-Path $script:controlApiRoot 'device-identity.json'
    APPDATA = $appData
    LOCALAPPDATA = $localAppData
    DB_MODE = 'sqlite'
    PRINTOPS_DB_PATH = Join-Path $script:controlApiRoot 'printops.db'
    PRINTOPS_DEV_SEED = 'false'
    JWT_SECRET = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
    PRINTOPS_CONTROL_ROLE = 'control-plane'
    PRINTOPS_CONTROL_NATS_URL = [string]$env:PRINTOPS_CONTROL_NATS_URL
    PRINTOPS_CONTROL_NATS_STREAM = 'PRINTOPS_CONTROL'
    PRINTOPS_CONTROL_EVENTS_DURABLE = 'printops-control-events'
    PRINTOPS_CONTROL_HEARTBEATS_DURABLE = 'printops-control-heartbeats'
    PORT = [string]$script:controlApiPort
    HOST = '127.0.0.1'
    PRINTOPS_OTA_ENABLED = 'false'
  }
  $saved = @{}
  foreach ($name in @($environment.Keys) + @('PRINTOPS_NATS_URL', 'NATS_URL', 'PRINTOPS_NATS_CLIENT_ID', 'PRINTOPS_NATS_STREAM')) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
  try {
    foreach ($name in $environment.Keys) { [Environment]::SetEnvironmentVariable($name, [string]$environment[$name], 'Process') }
    foreach ($name in @('PRINTOPS_NATS_URL', 'NATS_URL', 'PRINTOPS_NATS_CLIENT_ID', 'PRINTOPS_NATS_STREAM')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
    $node = (Get-Command node -ErrorAction Stop).Source
    $quotedServer = '"' + $serverJs + '"'
    $script:controlApiProcess = Start-Process -FilePath $node -ArgumentList $quotedServer -WorkingDirectory $repo -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  } finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
  }
  $controlHealth = Wait-Until 'isolated HTTP control-plane API health' {
    try { $health = Invoke-RestMethod -Uri "$script:controlApiBase/health" -TimeoutSec 2; if ($health.status -eq 'ok') { return $health } } catch { }
    return $false
  } 180 500
  $probePath = Write-NatsProbeScript $script:controlApiRoot
  $transport = Wait-Until 'control-plane JetStream event and heartbeat durables' {
    try {
      $probe = Invoke-NatsProbe $probePath $script:controlApiRoot
      if ($probe.consumers.'printops-control-events'.exists -and $probe.consumers.'printops-control-heartbeats'.exists) { return $probe }
    } catch { }
    return $false
  } 180 1000
  $controlPlaneEvidence = [ordered]@{ pid = $script:controlApiProcess.Id; port = $script:controlApiPort; dbPathIsolated = $true; dataRoot = $script:controlApiRoot; role = 'control-plane'; health = $controlHealth.status; eventDurable = $transport.consumers.'printops-control-events'; heartbeatDurable = $transport.consumers.'printops-control-heartbeats'; stopObserved = $false }
  $script:summary.process.controlPlane = $controlPlaneEvidence
  $script:summary.process.controlPlaneRuns = @($script:summary.process.controlPlaneRuns) + @($controlPlaneEvidence)
}

function Stop-ControlApiServer {
  if ($script:controlApiProcess) {
    if (-not $script:controlApiProcess.HasExited) {
      Stop-Process -Id $script:controlApiProcess.Id -Force -ErrorAction SilentlyContinue
      $script:controlApiProcess.WaitForExit(10000)
    }
    if ($script:summary.process.controlPlane) { $script:summary.process.controlPlane.stopObserved = $script:controlApiProcess.HasExited }
  }
  $script:controlApiProcess = $null
}

function Get-Health {
  try { return Invoke-RestMethod -Uri 'http://127.0.0.1:31415/health' -TimeoutSec 3 -ErrorAction Stop } catch { return $null }
}

function Get-LocalOtaState([string]$dataRoot) {
  $stateFile = Join-Path $dataRoot 'ota/updater-state.json'
  if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) { return $null }
  try { return Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json } catch { return $null }
}

function Get-OtaHealthToken([string]$dataRoot) {
  $tokenFile = Get-ChildItem -LiteralPath $dataRoot -Filter 'ota-health-token.txt' -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $tokenFile) { return $null }
  return (Get-Content -LiteralPath $tokenFile.FullName -Raw).Trim()
}

function Get-Readiness([string]$dataRoot) {
  $token = Get-OtaHealthToken $dataRoot
  if (-not $token) { throw 'Installed runtime did not create its internal OTA health token in the isolated data directory.' }
  return Invoke-RestMethod -Uri 'http://127.0.0.1:31415/api/v1/system/readiness' -Headers @{ 'x-printops-ota-token' = $token } -TimeoutSec 10 -ErrorAction Stop
}

function Get-InstalledApiProcess([string]$installRoot) {
  $prefix = [IO.Path]::GetFullPath($installRoot).TrimEnd('\') + '\'
  foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
    try {
      $path = [IO.Path]::GetFullPath($process.Path)
      if ($path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($path) -ieq 'server.exe') {
        return [ordered]@{ pid = $process.Id; path = $path; startedAt = $process.StartTime.ToUniversalTime().ToString('o') }
      }
    } catch { }
  }
  return $null
}

function Set-ChildRuntimeEnvironment([string]$dataRoot, [string]$appVersion, [string]$schemaVersion) {
  foreach ($name in @('APPDATA', 'LOCALAPPDATA', 'DB_MODE', 'PRINTOPS_DB_PATH', 'PRINTOPS_OTA_DATA_DIR', 'PRINTOPS_DEVICE_IDENTITY_PATH', 'PRINTOPS_DEVICE_IDENTITY_STORAGE_PATH', 'PRINTOPS_SITE_ID', 'PRINTOPS_APP_VERSION', 'PRINTOPS_RUNNER_VERSION', 'PRINTOPS_DEV_SEED', 'JWT_SECRET', 'PRINTOPS_OTA_NATIVE_DATA_ROOT', 'PRINTOPS_OTA_ENABLED', 'PRINTOPS_OTA_AUTO_UPDATE_ENABLED', 'PRINTOPS_OTA_REQUIRE_SIGNATURE', 'PRINTOPS_OTA_PUBLIC_KEY', 'PRINTOPS_OTA_PUBLIC_KEY_FILE', 'PRINTOPS_OTA_LAN_RELAY_URL', 'PRINTOPS_OTA_WAN_MANIFEST_URL', 'PRINTOPS_OTA_HEALTH_CHECK_TIMEOUT_MS', 'PRINTOPS_OTA_AUTO_UPDATE_CHECK_INTERVAL_MS', 'PRINTOPS_OTA_AUTO_UPDATE_JITTER_MS', 'PRINTOPS_OTA_AUTO_UPDATE_RETRY_BASE_MS', 'PRINTOPS_OTA_AUTO_UPDATE_RETRY_MAX_MS', 'PRINTOPS_OTA_AUTO_UPDATE_MAX_FAILURES', 'PRINTOPS_CONTROL_NATS_URL', 'PRINTOPS_CONTROL_NATS_STREAM', 'PRINTOPS_CONTROL_COMMAND_DURABLE', 'PRINTOPS_CONTROL_EVENTS_DURABLE', 'PRINTOPS_CONTROL_HEARTBEATS_DURABLE', 'PRINTOPS_NATS_URL', 'NATS_URL', 'PRINTOPS_NATS_CLIENT_ID', 'PRINTOPS_NATS_STREAM', 'PORT', 'HOST')) {
    if (-not $script:originalEnvironment.ContainsKey($name)) { $script:originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  }
  if (-not $script:originalEnvironment.ContainsKey('PRINTOPS_CONTROL_ROLE')) { $script:originalEnvironment['PRINTOPS_CONTROL_ROLE'] = [Environment]::GetEnvironmentVariable('PRINTOPS_CONTROL_ROLE', 'Process') }
  foreach ($name in @('PRINTOPS_OTA_NATIVE_BROKEN_EVIDENCE_FILE', 'PRINTOPS_OTA_NATIVE_EXPECTED_SCHEMA', 'PRINTOPS_OTA_NATIVE_BROKEN_UPSTREAM_PORT')) {
    if (-not $script:originalEnvironment.ContainsKey($name)) { $script:originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  }
  $env:PRINTOPS_CONTROL_ROLE = 'device'
  $env:PORT = '31415'
  $env:HOST = '127.0.0.1'
  $appData = Join-Path $dataRoot 'appdata'
  $localAppData = Join-Path $dataRoot 'localappdata'
  New-Item -ItemType Directory -Force -Path $dataRoot, $appData, $localAppData, (Join-Path $dataRoot 'ota') | Out-Null
  $env:APPDATA = $appData
  $env:LOCALAPPDATA = $localAppData
  $env:DB_MODE = 'sqlite'
  $env:PRINTOPS_DB_PATH = Join-Path $dataRoot 'printops.db'
  $env:PRINTOPS_OTA_DATA_DIR = Join-Path $dataRoot 'ota'
  $env:PRINTOPS_DEVICE_IDENTITY_PATH = Join-Path $dataRoot 'device-identity.json'
  $env:PRINTOPS_SITE_ID = "native-$runId-$runAttempt"
  $env:PRINTOPS_APP_VERSION = $appVersion
  $env:PRINTOPS_RUNNER_VERSION = $appVersion
  $env:PRINTOPS_DEV_SEED = 'false'
  $env:JWT_SECRET = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
  $env:PRINTOPS_OTA_NATIVE_DATA_ROOT = $dataRoot
  $env:PRINTOPS_OTA_ENABLED = 'true'
  $env:PRINTOPS_OTA_AUTO_UPDATE_ENABLED = 'false'
  $env:PRINTOPS_OTA_REQUIRE_SIGNATURE = 'true'
  $env:PRINTOPS_OTA_PUBLIC_KEY = (Get-Content -LiteralPath $env:PRINTOPS_CONTROL_NATIVE_PUBLIC_KEY_FILE -Raw).Trim()
  $env:PRINTOPS_OTA_PUBLIC_KEY_FILE = $env:PRINTOPS_CONTROL_NATIVE_PUBLIC_KEY_FILE
  $env:PRINTOPS_OTA_LAN_RELAY_URL = "http://127.0.0.1:$script:sourcePort/manifest.json"
  $env:PRINTOPS_OTA_WAN_MANIFEST_URL = "http://127.0.0.1:$script:sourcePort/manifest.json"
  $env:PRINTOPS_OTA_HEALTH_CHECK_TIMEOUT_MS = '60000'
  $env:PRINTOPS_OTA_AUTO_UPDATE_CHECK_INTERVAL_MS = '60000'
  $env:PRINTOPS_OTA_AUTO_UPDATE_JITTER_MS = '0'
  $env:PRINTOPS_OTA_AUTO_UPDATE_RETRY_BASE_MS = '1000'
  $env:PRINTOPS_OTA_AUTO_UPDATE_RETRY_MAX_MS = '5000'
  $env:PRINTOPS_OTA_AUTO_UPDATE_MAX_FAILURES = '2'
  $env:PRINTOPS_CONTROL_NATS_URL = [string]$env:PRINTOPS_CONTROL_NATS_URL
  $env:PRINTOPS_CONTROL_NATS_STREAM = 'PRINTOPS_CONTROL'
  $env:PRINTOPS_CONTROL_COMMAND_DURABLE = ''
  $env:PRINTOPS_CONTROL_EVENTS_DURABLE = 'printops-control-events'
  $env:PRINTOPS_CONTROL_HEARTBEATS_DURABLE = 'printops-control-heartbeats'
  if ($script:activeScenario -eq 'rollbackRecovery') {
    $env:PRINTOPS_OTA_NATIVE_BROKEN_EVIDENCE_FILE = Join-Path $dataRoot 'ota/broken-b-readiness-evidence.json'
    $env:PRINTOPS_OTA_NATIVE_EXPECTED_SCHEMA = [string]$script:summary.artifacts.brokenB.schemaVersion
    $env:PRINTOPS_OTA_NATIVE_BROKEN_UPSTREAM_PORT = '31417'
  } else {
    Remove-Item Env:PRINTOPS_OTA_NATIVE_BROKEN_EVIDENCE_FILE -ErrorAction SilentlyContinue
    Remove-Item Env:PRINTOPS_OTA_NATIVE_EXPECTED_SCHEMA -ErrorAction SilentlyContinue
    Remove-Item Env:PRINTOPS_OTA_NATIVE_BROKEN_UPSTREAM_PORT -ErrorAction SilentlyContinue
  }
  Remove-Item Env:PRINTOPS_NATS_URL -ErrorAction SilentlyContinue
  Remove-Item Env:NATS_URL -ErrorAction SilentlyContinue
  Remove-Item Env:PRINTOPS_NATS_CLIENT_ID -ErrorAction SilentlyContinue
  Remove-Item Env:PRINTOPS_NATS_STREAM -ErrorAction SilentlyContinue
  $null = $schemaVersion
}

function Start-Desktop([string]$installRoot) {
  $desktopRelative = if ($env:PRINTOPS_OTA_NATIVE_DESKTOP_RELATIVE_PATH) { $env:PRINTOPS_OTA_NATIVE_DESKTOP_RELATIVE_PATH } else { 'printerops-desktop.exe' }
  $desktopPath = Join-Path $installRoot $desktopRelative
  Assert-File $desktopPath 'installed PrintOps desktop executable'
  $script:desktopProcess = Start-Process -FilePath $desktopPath -WorkingDirectory $installRoot -PassThru -WindowStyle Hidden
}

function Stop-InstalledRuntime([string]$installRoot) {
  if ($script:desktopProcess -and -not $script:desktopProcess.HasExited) {
    Stop-Process -Id $script:desktopProcess.Id -Force -ErrorAction SilentlyContinue
    $script:desktopProcess.WaitForExit(10000)
  }
  $prefix = [IO.Path]::GetFullPath($installRoot).TrimEnd('\') + '\'
  foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
    try {
      $path = [IO.Path]::GetFullPath($process.Path)
      if ($path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      }
    } catch { }
  }
  $script:desktopProcess = $null
}

function Install-NSIS([string]$installer, [string]$installRoot, [string]$phase) {
  Assert-File $installer 'verified NSIS installer'
  if (Test-Path -LiteralPath $installRoot) { throw "Refusing to overwrite a pre-existing isolated install path: $installRoot" }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $installRoot) | Out-Null
  $logPath = Join-Path $evidenceRoot "nsis-$phase-$runId.log"
  $process = Start-Process -FilePath (Resolve-Path -LiteralPath $installer).Path -ArgumentList @('/S', "/LOG=$logPath", "/D=$installRoot") -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "NSIS installer returned exit code $($process.ExitCode); see $logPath" }
  if (-not (Test-Path -LiteralPath $logPath -PathType Leaf) -or (Get-Item -LiteralPath $logPath).Length -eq 0) { throw "NSIS installer log is missing or empty: $logPath" }
}

function Start-ArtifactServer([string]$manifestPath, [string]$artifactPath, [string]$dataRoot) {
  $manifest = Get-ManifestPayload $manifestPath
  $artifactName = [string]$manifest.manifest.artifacts.desktop.'windows-x64'.url
  if ([IO.Path]::GetFileName($artifactName) -cne $artifactName -or [IO.Path]::GetFileName($artifactPath) -cne $artifactName) { throw 'Signed OTA artifact URL must resolve to the exact local NSIS installer basename.' }
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
  $script:sourcePort = $port
  $serverScript = Join-Path $dataRoot 'signed-ota-http-source.mjs'
  @'
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const port = Number(process.env.NATIVE_OTA_SOURCE_PORT);
const manifestPath = process.env.NATIVE_OTA_MANIFEST;
const artifactPath = process.env.NATIVE_OTA_ARTIFACT;
const artifactName = process.env.NATIVE_OTA_ARTIFACT_NAME;
const manifestBytes = readFileSync(manifestPath);
const artifactBytes = readFileSync(artifactPath);
const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname === '/manifest.json') { res.writeHead(200, { 'content-type': 'application/json', 'content-length': manifestBytes.length, 'cache-control': 'no-store' }); res.end(manifestBytes); return; }
  if (pathname === `/${artifactName}`) { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': artifactBytes.length, 'cache-control': 'no-store' }); res.end(artifactBytes); return; }
  res.writeHead(404); res.end('not found');
});
server.listen(port, '127.0.0.1', () => console.log(`signed local OTA source listening on ${port}`));
'@ | Set-Content -LiteralPath $serverScript -Encoding utf8
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = (Get-Command node -ErrorAction Stop).Source
  $psi.WorkingDirectory = $repo
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.ArgumentList.Add($serverScript)
  $psi.Environment['NATIVE_OTA_SOURCE_PORT'] = [string]$port
  $psi.Environment['NATIVE_OTA_MANIFEST'] = (Resolve-Path -LiteralPath $manifestPath).Path
  $psi.Environment['NATIVE_OTA_ARTIFACT'] = (Resolve-Path -LiteralPath $artifactPath).Path
  $psi.Environment['NATIVE_OTA_ARTIFACT_NAME'] = $artifactName
  $script:artifactServer = [System.Diagnostics.Process]::Start($psi)
  $base = "http://127.0.0.1:$port"
  Wait-Until 'local signed OTA manifest HTTP source' { (Invoke-RestMethod -Uri "$base/manifest.json" -TimeoutSec 2).manifest.release.version -eq [string]$manifest.manifest.release.version } 30 | Out-Null
  return $base
}

function Stop-ArtifactServer {
  if ($script:artifactServer -and -not $script:artifactServer.HasExited) {
    $script:artifactServer.Kill()
    $script:artifactServer.WaitForExit(5000)
  }
  $script:artifactServer = $null
}

function Get-OwnerSession([string]$dataRoot) {
  if ($script:apiToken) { return $script:apiToken }
  $state = Invoke-Api 'GET' '/api/v1/auth/bootstrap'
  if ($state.state -ne 'REQUIRED_NEW') { throw "Isolated API bootstrap state must be REQUIRED_NEW, got $($state.state); refusing to reuse API credentials or existing data." }
  $suffix = [guid]::NewGuid().ToString('N')
  $script:ownerEmail = "native-$runId-$suffix@example.invalid"
  $script:ownerPassword = "NAtive-$([guid]::NewGuid().ToString('N'))!9a"
  $null = Invoke-Api 'POST' '/api/v1/auth/bootstrap' @{
    name = 'Web Control Native Acceptance'
    email = $script:ownerEmail
    password = $script:ownerPassword
    passwordConfirmation = $script:ownerPassword
  }
  $login = Invoke-Api 'POST' '/api/v1/auth/login' @{ email = $script:ownerEmail; password = $script:ownerPassword }
  if ([string]::IsNullOrWhiteSpace([string]$login.token)) { throw 'HTTP /api/v1/auth/login did not return an OWNER access token.' }
  $me = Invoke-Api 'GET' '/api/v1/me' $null ([string]$login.token)
  if ($me.role -ne 'OWNER') { throw 'Freshly bootstrapped acceptance identity is not an OWNER.' }
  $script:apiToken = [string]$login.token
  $null = $dataRoot
  return $script:apiToken
}
function Get-DeviceOwnerSession {
  if ($script:deviceApiToken) { return $script:deviceApiToken }
  $state = Invoke-DeviceApi 'GET' '/api/v1/auth/bootstrap'
  if ($state.state -ne 'REQUIRED_NEW') { throw "Installed device API bootstrap state must be REQUIRED_NEW, got $($state.state)." }
  $suffix = [guid]::NewGuid().ToString('N')
  $email = "device-native-$runId-$suffix@example.invalid"
  $password = "DNative-$([guid]::NewGuid().ToString('N'))!9a"
  $null = Invoke-DeviceApi 'POST' '/api/v1/auth/bootstrap' @{
    name = 'Web Control Native Device Acceptance'
    email = $email
    password = $password
    passwordConfirmation = $password
  }
  $login = Invoke-DeviceApi 'POST' '/api/v1/auth/login' @{ email = $email; password = $password }
  if ([string]::IsNullOrWhiteSpace([string]$login.token)) { throw 'Installed device API HTTP /api/v1/auth/login did not return an OWNER access token.' }
  $me = Invoke-DeviceApi 'GET' '/api/v1/me' $null ([string]$login.token)
  if ($me.role -ne 'OWNER') { throw 'Freshly bootstrapped installed device API identity is not an OWNER.' }
  $script:deviceApiToken = [string]$login.token
  $script:deviceOwnerPassword = $password
  return $script:deviceApiToken
}


function Create-SafePrintPath([string]$printerCode, [string]$printerName, [string]$apiToken) {
  $profileCode = "NATIVE_OTA_$([guid]::NewGuid().ToString('N').Substring(0, 8).ToUpperInvariant())"
  $testMarker = "PRINTOPS WEB CONTROL OTA ACCEPTANCE $runId"
  $profile = Invoke-DeviceApi 'POST' '/api/v1/paper-profiles' @{
    code = $profileCode
    name = 'Isolated Web Control OTA physical acceptance label'
    widthMm = 60
    heightMm = 40
    marginTopMm = 1
    marginRightMm = 1
    marginBottomMm = 1
    marginLeftMm = 1
    dpi = 203
    orientation = 'portrait'
    unit = 'mm'
    rotation = 0
    flipHorizontal = $false
    flipVertical = $false
    fields = @(@{ id = 'acceptance-marker'; key = 'label'; label = 'Native acceptance marker'; defaultValue = $testMarker; type = 'text'; xMm = 2; yMm = 2; fontSize = 8; bold = $true; color = '#000000'; align = 'left' })
  } $apiToken
  $templates = @(Invoke-DeviceApi 'GET' '/api/v1/templates' $null $apiToken)
  $template = $templates | Where-Object { $_.paperProfileId -eq $profile.id -and $_.engine -eq 'HTML' } | Select-Object -First 1
  if (-not $template) { throw 'The isolated real-print profile did not create its companion HTML template through the HTTP API.' }
  $null = Invoke-DeviceApi 'POST' "/api/v1/templates/$($template.id)/publish" $null $apiToken

  $printer = Invoke-DeviceApi 'POST' '/printers' @{
    code = $printerCode
    name = $printerName
    location = 'Dedicated isolated Web Control native acceptance queue'
    protocol = 'windows_spooler'
    connectionUri = "spooler://native-acceptance/$([Uri]::EscapeDataString($printerName))"
    allowedTemplates = @([string]$template.templateCode)
    maxCopiesPerJob = 1
    metadata = @{ acceptanceRun = $runId; physicalTestQueue = $true }
    isActive = $true
  } $apiToken
  if ($printer.protocol -ne 'windows_spooler' -or $printer.connectionUri -notmatch '^spooler://native-acceptance/') { throw 'API printer record does not target the confirmed Windows spooler test queue.' }
  $serviceAccount = Invoke-DeviceApi 'POST' '/api/v1/service-accounts' @{
    name = "Web Control native acceptance $runId"
    sourceSystem = "web-control-native-$runId"
    allowedPrinterCodes = @($printerCode)
    allowedTemplateCodes = @([string]$template.templateCode)
    maxCopiesPerJob = 1
    maxPayloadBytes = 4096
  } $apiToken
  if ([string]::IsNullOrWhiteSpace([string]$serviceAccount.apiKey)) { throw 'HTTP service-account API did not issue a run-scoped print API key.' }
  $script:printApiKey = [string]$serviceAccount.apiKey
  return [ordered]@{ printer = $printer; profile = $profile; template = $template; testMarker = $testMarker; serviceAccountId = $serviceAccount.account.id }
}

function Enroll-Device([string]$version, [int]$schema, [string]$apiToken, [string]$identityPath) {
  $siteId = "native-$runId-$runAttempt"
  $token = Invoke-Api 'POST' '/api/v1/control/enrollment-tokens' @{ siteId = $siteId; expiresInSeconds = 3600 } $apiToken
  if ([string]::IsNullOrWhiteSpace([string]$token.token)) { throw 'HTTP Web Control enrollment token endpoint returned no one-time token.' }
  $installationId = "inst_native_$runId_$runAttempt_$([guid]::NewGuid().ToString('N').Substring(0, 8))"
  $enrolled = Invoke-Api 'POST' '/api/v1/control/enroll' @{
    enrollmentToken = [string]$token.token
    installationId = $installationId
    siteId = $siteId
    hostname = [Environment]::MachineName
    platform = 'windows'
    architecture = 'x64'
    appVersion = $version
    schemaVersion = $schema
    runnerVersion = $version
    displayName = "Isolated Web Control acceptance $runId"
  }
  if (-not $enrolled.deviceId -or -not $enrolled.deviceToken -or $enrolled.installationId -ne $installationId) { throw 'HTTP Web Control enrollment did not return the expected device identity and token.' }
  $identity = [ordered]@{
    installationId = $installationId
    siteId = $siteId
    deviceId = [string]$enrolled.deviceId
    deviceToken = [string]$enrolled.deviceToken
    enrolledAt = [DateTime]::UtcNow.ToString('o')
    hostname = [Environment]::MachineName
    platform = 'win32'
    architecture = 'x64'
    createdAt = [DateTime]::UtcNow.ToString('o')
  }
  $identity | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $identityPath -Encoding utf8
  $script:device = [ordered]@{ deviceId = [string]$enrolled.deviceId; installationId = $installationId; siteId = $siteId; controlPlane = $enrolled.controlPlane }
  return $script:device
}

function Get-Device([string]$deviceId, [string]$token) {
  return Invoke-Api 'GET' "/api/v1/control/devices/$deviceId" $null $token
}

function Get-WebControlCommand([string]$deviceId, [string]$commandId, [string]$token) {
  $items = @(Invoke-Api 'GET' "/api/v1/control/devices/$deviceId/commands?limit=100" $null $token)
  return $items | Where-Object { $_.commandId -eq $commandId } | Select-Object -First 1
}

function Get-ApiPrintJob([string]$requestId, [string]$sourceSystem) {
  $escapedId = [Uri]::EscapeDataString($requestId)
  $escapedSource = [Uri]::EscapeDataString($sourceSystem)
  return Invoke-DeviceApi 'GET' "/api/v1/print-jobs/by-request-id/$escapedId?source_system=$escapedSource" $null $null $script:printApiKey
}

function Write-NatsProbeScript([string]$dataRoot) {
  $path = Join-Path $dataRoot 'native-jetstream-probe.mjs'
  @'
import { connect, StringCodec } from 'nats';
const sc = StringCodec();
const request = JSON.parse(await new Promise((resolve, reject) => {
  let raw = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (part) => raw += part);
  process.stdin.on('end', () => { try { resolve(raw); } catch (e) { reject(e); } });
}));
const url = process.env.PRINTOPS_CONTROL_NATS_URL;
const stream = process.env.PRINTOPS_CONTROL_NATS_STREAM;
const nc = await connect({ servers: url, timeout: 4000, name: 'web-control-native-acceptance-probe' });
try {
  const jsm = await nc.jetstreamManager();
  const info = await jsm.streams.info(stream);
  const last = Number(info.state.last_seq ?? info.state.lastSeq ?? 0);
  const first = Number(info.state.first_seq ?? info.state.firstSeq ?? 1);
  const messages = [];
  const start = Math.max(first, last - 500);
  for (let seq = start; seq <= last; seq++) {
    try {
      const stored = await jsm.streams.getMessage(stream, { seq });
      let parsed;
      try { parsed = JSON.parse(sc.decode(stored.data)); } catch { continue; }
      const payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : parsed;
      messages.push({ seq: Number(stored.seq ?? seq), subject: String(stored.subject ?? ''), signaturePresent: typeof parsed?.signature === 'string' && parsed.signature.length > 0, payload });
    } catch { }
  }
  const consumers = {};
  for (const durable of request.durables ?? []) {
    try {
      const c = await jsm.consumers.info(stream, durable);
      consumers[durable] = {
        exists: true,
        deliveredConsumerSeq: Number(c.delivered?.consumer_seq ?? c.delivered?.consumerSeq ?? 0),
        ackFloorConsumerSeq: Number(c.ack_floor?.consumer_seq ?? c.ack_floor?.consumerSeq ?? 0),
        ackPending: Number(c.num_ack_pending ?? c.numAckPending ?? 0),
        pending: Number(c.num_pending ?? c.numPending ?? 0),
        filterSubject: String(c.config?.filter_subject ?? c.config?.filterSubject ?? '')
      };
    } catch { consumers[durable] = { exists: false }; }
  }
  const result = {
    stream: info.config.name,
    subjects: info.config.subjects ?? [],
    storage: info.config.storage,
    firstSequence: first,
    lastSequence: last,
    messagesScanned: messages.length,
    consumers,
    messages: messages.filter((m) => {
      const p = m.payload;
      return (request.deviceId && p?.deviceId === request.deviceId) || (request.commandId && p?.command_id === request.commandId) || (request.eventCommandId && p?.commandId === request.eventCommandId);
    }).map((m) => ({ seq: m.seq, subject: m.subject, signaturePresent: m.signaturePresent, payload: m.payload }))
  };
  process.stdout.write(JSON.stringify(result));
} finally { await nc.drain(); }
'@ | Set-Content -LiteralPath $path -Encoding utf8
  return $path
}

function Invoke-NatsProbe([string]$probePath, [string]$dataRoot, [string]$deviceId = $null, [string]$commandId = $null, [string]$eventCommandId = $null) {
  $request = [ordered]@{
    deviceId = $deviceId
    commandId = $commandId
    eventCommandId = $eventCommandId
    durables = @('printops-control-events', 'printops-control-heartbeats')
  }
  if ($deviceId) { $request.durables += "printops-control-command-$deviceId" }
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = (Get-Command node -ErrorAction Stop).Source
  $psi.WorkingDirectory = $repo
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.ArgumentList.Add($probePath)
  $psi.Environment['PRINTOPS_CONTROL_NATS_URL'] = [string]$env:PRINTOPS_CONTROL_NATS_URL
  $psi.Environment['PRINTOPS_CONTROL_NATS_STREAM'] = 'PRINTOPS_CONTROL'
  $process = [System.Diagnostics.Process]::Start($psi)
  $process.StandardInput.Write((ConvertTo-Json -InputObject $request -Compress -Depth 6))
  $process.StandardInput.Close()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  if (-not $process.WaitForExit(15000)) { $process.Kill(); throw 'JetStream probe did not finish within 15 seconds.' }
  if ($process.ExitCode -ne 0) { throw "Real JetStream inspection failed: $stderr" }
  try { return $stdout | ConvertFrom-Json } catch { throw "JetStream probe returned invalid evidence: $stderr $stdout" }
}

function Register-Release([string]$version, [int]$schema, [string]$manifestPath, [string]$artifactPath, [string]$baseUrl, [string]$token) {
  $manifest = Get-ManifestPayload $manifestPath
  $entry = $manifest.manifest.artifacts.desktop.'windows-x64'
  $body = @{
    version = $version
    channel = 'stable'
    platform = 'windows-x64'
    architecture = 'x64'
    schemaVersion = $schema
    manifestRef = "$baseUrl/manifest.json"
    artifactRef = "$baseUrl/$([IO.Path]::GetFileName($artifactPath))"
    sha256 = [string]$entry.sha256
    signature = [string]$entry.signature
    minSupportedVersion = [string]$manifest.manifest.compatibility.min_supported_version
    releaseNotes = [string]$manifest.manifest.release.notes
  }
  return Invoke-Api 'POST' '/api/v1/control/releases' $body $token
}

function New-ControlCommand([string]$deviceId, [string]$version, [string]$token) {
  $idempotency = "native-$runId-$([guid]::NewGuid().ToString('N'))"
  $script:lastCommandIdempotencyKey = $idempotency
  $response = Invoke-Api 'POST' "/api/v1/control/devices/$deviceId/commands" @{ type = 'OTA_INSTALL'; targetVersion = $version; idempotencyKey = $idempotency; expiresInSeconds = 5400 } $token
  if (-not $response.commandId) { throw 'HTTP Web Control command API did not return a command identifier.' }
  return $response
}

function Assert-ControlTransitionSequence($messages, [string]$deviceId, [string]$commandId, [string[]]$requiredStates) {
  $events = @($messages |
    Where-Object { $_.subject -eq "printops.control.event.$deviceId" -and $_.payload.commandId -eq $commandId } |
    Sort-Object { [int]$_.seq })
  $states = @($events | ForEach-Object { [string]$_.payload.state })
  $cursor = 0
  foreach ($requiredState in $requiredStates) {
    while ($cursor -lt $states.Count -and $states[$cursor] -cne $requiredState) { $cursor++ }
    if ($cursor -ge $states.Count) {
      throw "JetStream command $commandId is missing ordered state $requiredState; observed: $($states -join ', ')."
    }
    $cursor++
  }
  return $events
}

function Wait-CommandState([string]$deviceId, [string]$commandId, [string[]]$states, [string]$token, [int]$timeoutSeconds = 5400) {
  return Wait-Until "Web Control command $commandId state $($states -join '/')" {
    $current = Get-WebControlCommand $deviceId $commandId $token
    if ($current -and $current.terminalState -in $states) { return $current }
    return $false
  } $timeoutSeconds 1000
}

function Wait-Heartbeat([string]$deviceId, [string]$version, [int]$schema, [string]$token, [int]$timeoutSeconds = 300) {
  return Wait-Until "Web Control device heartbeat for $version/$schema" {
    $device = Get-Device $deviceId $token
    if ($device.appVersion -eq $version -and [int]$device.schemaVersion -eq $schema -and $device.connectionState -eq 'ONLINE' -and $device.lastSeenAt) {
      return $device
    }
    return $false
  } $timeoutSeconds 1000
}

function Wait-ProcessRestart([string]$installRoot, [int]$previousPid, [string]$version, [int]$timeoutSeconds = 900) {
  return Wait-Until "installed API process restart and $version health" {
    $current = Get-InstalledApiProcess $installRoot
    $health = Get-Health
    if ($current -and $current.pid -ne $previousPid -and $health -and $health.status -eq 'ok' -and $health.version -eq $version) {
      return [ordered]@{ process = $current; health = $health }
    }
    return $false
  } $timeoutSeconds 1000
}

function Assert-IsolatedRuntime([string]$installRoot, [string]$dataRoot) {
  $install = [IO.Path]::GetFullPath($installRoot).TrimEnd('\')
  $data = [IO.Path]::GetFullPath($dataRoot).TrimEnd('\')
  if ($data.StartsWith("$install\", [StringComparison]::OrdinalIgnoreCase)) { throw 'Isolated database and identity data must be outside the NSIS install root.' }
  foreach ($relative in @('printops.db', 'device-identity.json', 'ota/updater-state.json', 'ota-health-token.txt')) {
    if (Test-Path -LiteralPath (Join-Path $install $relative)) { throw "Mutable PrintOps data leaked into the NSIS install tree: $relative" }
  }
}

function New-Phase([string]$name, [string]$aInstaller, [string]$aVersion, [int]$aSchema) {
  $installRoot = Join-Path $workRoot "$name\installation\PrintOps"
  $dataRoot = Join-Path $workRoot "$name\data"
  $script:currentInstallRoot = $installRoot
  $script:currentDataRoot = $dataRoot
  $script:summary.process.deviceRuns = @($script:summary.process.deviceRuns) + @([ordered]@{ phase = $name; dataRoot = $dataRoot })
  $script:deviceApiToken = $null
  $script:deviceOwnerPassword = $null
  $script:printApiKey = $null
  Set-ChildRuntimeEnvironment $dataRoot $aVersion ([string]$aSchema)
  Install-NSIS $aInstaller $installRoot $name
  Assert-IsolatedRuntime $installRoot $dataRoot
  $apiToken = Get-OwnerSession $dataRoot
  return [ordered]@{ installRoot = $installRoot; dataRoot = $dataRoot; apiToken = $apiToken }
}

function Start-EnrolledRuntime([string]$installRoot, [string]$dataRoot, [string]$aVersion) {
  Stop-InstalledRuntime $installRoot
  Set-ChildRuntimeEnvironment $dataRoot $aVersion ([string]$script:summary.artifacts.A.schemaVersion)
  Start-Desktop $installRoot
  Wait-Until 'enrolled PrintOps sidecar health' { $health = Get-Health; $health -and $health.status -eq 'ok' -and $health.version -eq $aVersion } 300 1000 | Out-Null
  $readiness = Get-Readiness $dataRoot
  if ($readiness.ota.status -ne 'READY' -or [int]$readiness.ota.requiredComponents.database.details.schemaVersion -ne [int]$script:summary.artifacts.A.schemaVersion) { throw "Installed A readiness/schema does not match expected $aVersion/$($script:summary.artifacts.A.schemaVersion)." }
  $process = Wait-Until 'installed API child process' { Get-InstalledApiProcess $installRoot } 90 500
  return $process
}

function Run-PrimaryAcceptance {
  $a = $script:summary.artifacts.A
  $b = $script:summary.artifacts.B
  $aVersion = [string]$a.version
  $bVersion = [string]$b.version
  $aSchema = [int]$a.schemaVersion
  $bSchema = [int]$b.schemaVersion
  $sourceRoot = Join-Path $workRoot 'a-to-b\ota-source'
  New-Item -ItemType Directory -Force -Path $sourceRoot | Out-Null
  $baseUrl = Start-ArtifactServer $b.manifestPath $b.installerPath $sourceRoot
  $phase = New-Phase 'a-to-b' $a.installerPath $aVersion $aSchema
  $apiToken = [string]$phase.apiToken
  $safePrinterName = [string]$env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER
  $safePrinterCode = [string]$env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER_CODE
  $queueInfo = Get-Printer -Name $safePrinterName -ErrorAction Stop
  if ($queueInfo.Name -cne $safePrinterName) { throw 'Windows spooler printer name did not exactly match the explicitly approved queue.' }
  if ([string]::IsNullOrWhiteSpace($env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER_DRIVER) -or [string]$queueInfo.DriverName -cne $env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER_DRIVER) { throw 'Windows printer driver changed or does not exactly match the protected physical-device allowlist.' }
  if ([string]::IsNullOrWhiteSpace($env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER_PORT) -or [string]$queueInfo.PortName -cne $env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER_PORT) { throw 'Windows printer port changed or does not exactly match the protected physical-device allowlist.' }
  if ((@($queueInfo.Name, $queueInfo.DriverName, $queueInfo.PortName) -join ' ') -match '(?i)(Microsoft Print to PDF|Microsoft XPS Document Writer|OneNote|Fax|CutePDF|doPDF|PDFCreator|PORTPROMPT:|FILE:|NUL:)') { throw 'The configured queue changed to a virtual or file-backed printer; refusing a physical acceptance print.' }
  $script:summary.printer.configuredQueue = $safePrinterName
  $script:summary.printer.physicalQueueVerified = $false
  $script:summary.printer.driverName = [string]$queueInfo.DriverName
  $script:summary.printer.portName = [string]$queueInfo.PortName
  $script:summary.printer.devicePortConfigured = -not [string]::IsNullOrWhiteSpace([string]$queueInfo.PortName)
  $script:summary.printer.queueStatus = [string]$queueInfo.PrinterStatus
  $script:summary.device = Enroll-Device $aVersion $aSchema $apiToken $env:PRINTOPS_DEVICE_IDENTITY_PATH
  $identityBefore = Get-Content -LiteralPath $env:PRINTOPS_DEVICE_IDENTITY_PATH -Raw | ConvertFrom-Json
  $enrolledProcess = Start-EnrolledRuntime $phase.installRoot $phase.dataRoot $aVersion
  $script:summary.process.baseline = $enrolledProcess
  $localApiToken = Get-DeviceOwnerSession
  $printPath = Create-SafePrintPath $safePrinterCode $safePrinterName $localApiToken

  $deviceId = [string]$script:device.deviceId
  $commandDurable = "printops-control-command-$deviceId"
  $probePath = Write-NatsProbeScript $phase.dataRoot
  $initialTransport = Wait-Until 'initial JetStream device heartbeat and durable setup' {
    $probe = Invoke-NatsProbe $probePath $phase.dataRoot $deviceId
    $heartbeat = @($probe.messages | Where-Object { $_.subject -eq "printops.control.heartbeat.$deviceId" })
    $deviceConsumer = $probe.consumers.$commandDurable
    if ($heartbeat.Count -gt 0 -and $deviceConsumer.exists) { return $probe }
    return $false
  } 180 1000
  $listedDevice = Wait-Heartbeat $deviceId $aVersion $aSchema $apiToken 180
  if ($listedDevice.installationId -ne $identityBefore.installationId) { throw 'Web Control API heartbeat installation identity differs from the local persisted identity.' }

  $null = Register-Release $bVersion $bSchema $b.manifestPath $b.installerPath $baseUrl $apiToken
  $script:activeScenario = 'activePrintWait'
  $printRequestId = "native-print-$runId-$([guid]::NewGuid().ToString('N'))"
  $sourceSystem = "web-control-native-$runId"
  $queueBefore = @(Get-PrintJob -PrinterName $safePrinterName -ErrorAction Stop)
  if ($queueBefore.Count -ne 0) { throw 'Safe printer queue became non-empty before acceptance print; refusing to interfere with existing jobs.' }
  Pause-Printer -Name $safePrinterName -ErrorAction Stop
  $script:printQueuePaused = $true
  $pausedQueue = Get-Printer -Name $safePrinterName -ErrorAction Stop
  if ([string]$pausedQueue.PrinterStatus -notmatch '(?i)Paused') { throw "Windows spooler did not confirm that the exact approved test queue is paused (status=$($pausedQueue.PrinterStatus)); no test print will be submitted." }
  $script:summary.printer.queueStatus = [string]$pausedQueue.PrinterStatus
  $printResult = Invoke-DeviceApi 'POST' '/api/v1/print-jobs' @{
    request_id = $printRequestId
    source_system = $sourceSystem
    printer_code = $safePrinterCode
    template_code = [string]$printPath.template.templateCode
    payload = @{ label = [string]$printPath.testMarker }
    copies = 1
    priority = 'normal'
  } $null $script:printApiKey
  if (-not $printResult.print_job_id) { throw 'Real HTTP print intake did not return a PrintOps print_job_id.' }
  $activeApiJob = Wait-Until 'active PrintOps print job before Web Control command publication' {
    $job = Get-ApiPrintJob $printRequestId $sourceSystem
    if ($job.status -in @('QUEUED', 'DISPATCHED', 'PRINTING')) { return $job }
    return $false
  } 20 250
  $preCommandProcess = Get-InstalledApiProcess $phase.installRoot
  if (-not $preCommandProcess) { throw 'Cannot identify the installed API child process before the controlled update.' }
  $script:activeScenario = 'commandEnrollmentTransport'
  $commandAck = New-ControlCommand $deviceId $bVersion $apiToken
  if ($commandAck.status -ne 'DELIVERED') { throw "HTTP control command was not confirmed DELIVERED by JetStream PubAck (status=$($commandAck.status))." }
  $duplicateAck = Invoke-Api 'POST' "/api/v1/control/devices/$deviceId/commands" @{ type = 'OTA_INSTALL'; targetVersion = $bVersion; idempotencyKey = $script:lastCommandIdempotencyKey; expiresInSeconds = 5400 } $apiToken
  if ($duplicateAck.commandId -ne $commandAck.commandId) { throw 'Same-key Web Control command retry created a second command ID.' }
  $script:summary.jetStream.command = [ordered]@{ commandId = $commandAck.commandId; subject = "printops.control.command.$deviceId"; httpStatus = 'DELIVERED'; pubAckObserved = $true; sameIdempotencyKeyReturnedSameCommand = $true }
  $waitingCommand = Wait-CommandState $deviceId $commandAck.commandId @('WAITING_FOR_IDLE') $apiToken 20
  if ($waitingCommand.terminalState -cne 'WAITING_FOR_IDLE') { throw "Updater did not expose exact WAITING_FOR_IDLE while the real print was active (state=$($waitingCommand.terminalState))." }
  $correlatedSpoolJob = Wait-Until 'the exact PrintOps job in the approved Windows spooler queue' {
    $jobs = @(Get-PrintJob -PrinterName $safePrinterName -ErrorAction Stop)
    if ($jobs.Count -ne 1) { return $false }
    $candidate = $jobs[0]
    $candidateApiJob = Get-ApiPrintJob $printRequestId $sourceSystem
    $spoolerIds = @($candidateApiJob.metadata.printEvidence.spoolerJobIds | ForEach-Object { [string]$_ })
    if ($spoolerIds -contains [string]$candidate.ID) { return [ordered]@{ spooler = $candidate; apiJob = $candidateApiJob } }
    return $false
  } 60 250
  $spoolJob = $correlatedSpoolJob.spooler
  $activeApiJob = $correlatedSpoolJob.apiJob
  if ([string]$spoolJob.JobStatus -notmatch '(?i)Paused') { throw "The real test job is not held as a paused Windows spooler job (status=$($spoolJob.JobStatus)); active-print wait cannot PASS." }
  $activeHeartbeat = Wait-Until 'Web Control reports PRINTING with queued real printer work' {
    $detail = Get-Device $deviceId $apiToken
    if ($detail.printState -eq 'PRINTING' -and [int]$detail.queueDepth -gt 0) { return $detail }
    return $false
  } 20 250
  $whilePrintingProcess = Get-InstalledApiProcess $phase.installRoot
  $whilePrintingHealth = Get-Health
  $heldQueueJobs = @(Get-PrintJob -PrinterName $safePrinterName -ErrorAction Stop)
  if (-not $whilePrintingProcess -or $whilePrintingProcess.pid -ne $preCommandProcess.pid -or -not $whilePrintingHealth -or $whilePrintingHealth.version -ne $aVersion -or $heldQueueJobs.Count -ne 1 -or $activeApiJob.status -notin @('QUEUED', 'DISPATCHED', 'PRINTING') -or $activeHeartbeat.printState -ne 'PRINTING') {
    throw 'Active-print OTA wait proof is incomplete: exact correlated spooler job, PrintOps active state, heartbeat, A health, and stable API process must all remain observable.'
  }
  $script:summary.printer.activeJob = [ordered]@{ requestId = $printRequestId; printJobId = $printResult.print_job_id; status = $activeApiJob.status; spoolerJobId = $spoolJob.ID; documentName = $spoolJob.DocumentName; jobStatus = [string]$spoolJob.JobStatus; queueLength = $heldQueueJobs.Count; printState = $activeHeartbeat.printState; queueDepth = $activeHeartbeat.queueDepth; correlatedToPrintOpsJob = $true }
  $script:summary.printer.waitProof = [ordered]@{ commandId = $commandAck.commandId; controlState = $waitingCommand.terminalState; apiPidUnchanged = $whilePrintingProcess.pid -eq $preCommandProcess.pid; healthVersionWhilePaused = $whilePrintingHealth.version; actualSpoolerJobHeld = $true; exactPrintOpsJobCorrelation = $true }
  $natsBeforeCommand = Invoke-NatsProbe $probePath $phase.dataRoot $deviceId $commandAck.commandId $commandAck.commandId
  $storedCommands = @($natsBeforeCommand.messages | Where-Object { $_.subject -eq "printops.control.command.$deviceId" -and $_.payload.command_id -eq $commandAck.commandId })
  if ($storedCommands.Count -ne 1) { throw "Expected exactly one JetStream command record after same-key retry; observed $($storedCommands.Count)." }
  $storedCommand = $storedCommands[0]
  $deviceConsumer = $natsBeforeCommand.consumers.$commandDurable
  $eventConsumer = $natsBeforeCommand.consumers.'printops-control-events'
  $heartbeatConsumer = $natsBeforeCommand.consumers.'printops-control-heartbeats'
  if (-not $storedCommand -or -not $storedCommand.signaturePresent -or -not $deviceConsumer.exists -or $deviceConsumer.ackFloorConsumerSeq -lt $deviceConsumer.deliveredConsumerSeq -or $deviceConsumer.ackPending -ne 0 -or -not $eventConsumer.exists -or $eventConsumer.ackFloorConsumerSeq -lt $eventConsumer.deliveredConsumerSeq -or $eventConsumer.ackPending -ne 0 -or -not $heartbeatConsumer.exists -or $heartbeatConsumer.ackFloorConsumerSeq -lt $heartbeatConsumer.deliveredConsumerSeq -or $heartbeatConsumer.ackPending -ne 0) {
    throw 'JetStream command, event, heartbeat, signed-envelope, or durable ACK evidence is incomplete.'
  }
  $transitionEvents = @(Assert-ControlTransitionSequence $natsBeforeCommand.messages $deviceId $commandAck.commandId @('ACCEPTED', 'CHECKING', 'DOWNLOADING', 'VERIFIED', 'WAITING_FOR_IDLE'))
  $script:summary.jetStream.command.sequence = $storedCommand.seq
  $script:summary.jetStream.command.signaturePresent = $storedCommand.signaturePresent
  $script:summary.jetStream.command.consumerDeliveredSequence = $deviceConsumer.deliveredConsumerSeq
  $script:summary.jetStream.command.consumerAckFloorSequence = $deviceConsumer.ackFloorConsumerSeq
  $script:summary.jetStream.command.transitionStatesBeforeIdle = @($transitionEvents | ForEach-Object { $_.payload.state })

  Set-Scenario 'commandEnrollmentTransport' 'PASS' 'HTTP enrollment, device-token identity persistence, signed JetStream heartbeat, and a signed OTA command were acknowledged by the real device durable.' @{
    deviceId = $deviceId
    installationId = $identityBefore.installationId
    commandSubject = "printops.control.command.$deviceId"
    heartbeatSubject = "printops.control.heartbeat.$deviceId"
    commandDurable = $commandDurable
    heartbeatObserved = $true
    jetStreamStream = $initialTransport.stream
    commandId = $commandAck.commandId
    commandSequence = $storedCommand.seq
    signaturePresent = $storedCommand.signaturePresent
    pubAckObserved = $true
    consumerAckFloorSequence = $deviceConsumer.ackFloorConsumerSeq
  }
  $script:activeScenario = 'activePrintWait'

  Resume-Printer -Name $safePrinterName -ErrorAction Stop
  $script:printQueuePaused = $false
  $script:summary.printer.queueStatus = 'RESUMED'
  Wait-Until 'physical printer job left the approved Windows spooler queue' { @(Get-PrintJob -PrinterName $safePrinterName -ErrorAction Stop).Count -eq 0 } 900 1000 | Out-Null
  $printTerminal = Wait-Until 'real PrintOps print job successful terminal state' {
    $job = Get-ApiPrintJob $printRequestId $sourceSystem
    if ($job.status -in @('SUCCESS', 'FAILED', 'UNVERIFIED', 'CANCELLED')) { return $job }
    return $false
  } 900 1000
  if ($printTerminal.status -ne 'SUCCESS') { throw "Physical acceptance print did not reach verified SUCCESS (observed $($printTerminal.status)); no print-safety PASS is allowed." }
  $printEvidence = $printTerminal.metadata.printEvidence
  $terminalSpoolerIds = @($printEvidence.spoolerJobIds | ForEach-Object { [string]$_ })
  if ($printEvidence.deviceConfirmed -ne $true -or $printEvidence.ippJobConfirmed -ne $true -or $printEvidence.deviceConfirmation -cne 'ipp-job') {
    throw 'Printer-side IPP job-specific confirmation is required; local spooler delivery alone cannot prove physical output.'
  }
  if ($terminalSpoolerIds.Count -ne 1 -or $terminalSpoolerIds[0] -cne [string]$spoolJob.ID) { throw 'Terminal printer evidence does not identify exactly the correlated Windows spooler job.' }
  $script:summary.printer.physicalQueueVerified = $true
  $completedPrintQueue = [ordered]@{ printerName = $safePrinterName; driverName = [string]$queueInfo.DriverName; portName = [string]$queueInfo.PortName; remainingJobs = 0; printJobStatus = $printTerminal.status; spoolerJobId = $spoolJob.ID; ippJobConfirmed = $true; deviceConfirmation = [string]$printEvidence.deviceConfirmation }
  $script:summary.printer.queueStatus = 'EMPTY_AFTER_SUCCESS'
  Set-Scenario 'activePrintWait' 'PASS' 'The real marked PrintOps job remained correlated in the explicitly allowlisted Windows queue; OTA remained in exact WAITING_FOR_IDLE on A, and the printer reported completion through job-specific IPP confirmation.' $script:summary.printer.waitProof
  $script:activeScenario = 'signedAToBUpdate'
  $script:summary.printer.activeJob = $completedPrintQueue

  $restart = Wait-ProcessRestart $phase.installRoot $preCommandProcess.pid $bVersion 1200
  $script:summary.process.candidate = $restart.process
  $script:summary.process.restartObserved = $true
  $script:summary.process.health = $restart.health
  $readinessB = Wait-Until 'B OTA readiness and migrated database schema' {
    try {
      $snapshot = Get-Readiness $phase.dataRoot
      if ($snapshot.ota.status -eq 'READY' -and [int]$snapshot.ota.requiredComponents.database.details.schemaVersion -eq $bSchema) { return $snapshot }
    } catch { }
    return $false
  } 300 1000
  $localState = Wait-Until 'real external updater reports completed signed B installation' {
    $state = Get-LocalOtaState $phase.dataRoot
    if ($state -and $state.phase -eq 'COMPLETED' -and [string]$state.version -eq $bVersion) { return $state }
    return $false
  } 600 1000
  $terminal = Wait-CommandState $deviceId $commandAck.commandId @('COMPLETED') $apiToken 600
  $heartbeatB = Wait-Heartbeat $deviceId $bVersion $bSchema $apiToken 300
  $identityAfter = Get-Content -LiteralPath $env:PRINTOPS_DEVICE_IDENTITY_PATH -Raw | ConvertFrom-Json
  if ($identityAfter.deviceId -ne $identityBefore.deviceId -or $identityAfter.installationId -ne $identityBefore.installationId) { throw 'Device ID or installation ID changed across the real NSIS restart.' }
  if ($terminal.status -ne 'COMPLETED' -or $terminal.terminalState -ne 'COMPLETED') { throw 'Web Control API did not persist terminal COMPLETED for the signed B OTA command.' }
  $natsAfter = Wait-Until 'JetStream heartbeat/event reconnect after B restart' {
    $snapshot = Invoke-NatsProbe $probePath $phase.dataRoot $deviceId $commandAck.commandId $commandAck.commandId
    $heartbeats = @($snapshot.messages | Where-Object { $_.subject -eq "printops.control.heartbeat.$deviceId" -and $_.payload.appVersion -eq $bVersion -and [int]$_.payload.schemaVersion -eq $bSchema })
    $events = @($snapshot.messages | Where-Object { $_.subject -eq "printops.control.event.$deviceId" -and $_.payload.commandId -eq $commandAck.commandId -and $_.payload.state -eq 'COMPLETED' })
    $eventConsumer = $snapshot.consumers.'printops-control-events'
    $heartbeatConsumer = $snapshot.consumers.'printops-control-heartbeats'
    if ($heartbeats.Count -gt 0 -and $events.Count -gt 0 -and $eventConsumer.exists -and $eventConsumer.ackFloorConsumerSeq -gt 0 -and $heartbeatConsumer.exists -and $heartbeatConsumer.ackFloorConsumerSeq -gt 0) {
      return [ordered]@{ probe = $snapshot; heartbeat = $heartbeats[-1]; terminalEvent = $events[-1]; eventConsumer = $eventConsumer; heartbeatConsumer = $heartbeatConsumer }
    }
    return $false
  } 300 1000
  $script:summary.device = [ordered]@{ deviceId = $identityAfter.deviceId; installationIdBefore = $identityBefore.installationId; installationIdAfter = $identityAfter.installationId; identityContinuous = $true; apiVersion = $heartbeatB.appVersion; apiSchema = $heartbeatB.schemaVersion; lastSeenAt = $heartbeatB.lastSeenAt }
  $script:summary.jetStream.reconnect = [ordered]@{ heartbeatSubject = "printops.control.heartbeat.$deviceId"; heartbeatSequence = $natsAfter.heartbeat.seq; heartbeatVersion = $natsAfter.heartbeat.payload.appVersion; heartbeatSchema = $natsAfter.heartbeat.payload.schemaVersion; terminalEventSequence = $natsAfter.terminalEvent.seq; terminalState = $natsAfter.terminalEvent.payload.state; eventConsumer = $natsAfter.eventConsumer; heartbeatConsumer = $natsAfter.heartbeatConsumer }
  $script:summary.webControlTerminal = [ordered]@{ commandId = $terminal.commandId; status = $terminal.status; terminalState = $terminal.terminalState; completedAt = $terminal.completedAt; targetVersion = $terminal.targetVersion; localUpdaterState = $localState.phase; apiVersion = $restart.health.version; schemaVersion = [int]$readinessB.ota.requiredComponents.database.details.schemaVersion }
  $script:summary.activeScenario = $null
  Set-Scenario 'signedAToBUpdate' 'PASS' 'The installed, signature-verified NSIS A process accepted the Web Control command and installed signed B through the real updater after print idle.' @{
    A = @{ version = $aVersion; schema = $aSchema; sha256 = $a.sha256 }
    B = @{ version = $bVersion; schema = $bSchema; sha256 = $b.sha256; updaterPhase = $localState.phase }
    processRestart = @{ oldPid = $preCommandProcess.pid; newPid = $restart.process.pid }
    migratedSchema = [int]$readinessB.ota.requiredComponents.database.details.schemaVersion
  }
  Set-Scenario 'restartReconnectAndTerminalCompletion' 'PASS' 'The installed API process restarted to B, retained the same enrolled identity, published a post-restart JetStream heartbeat/event, reconnected, and the control API reached terminal COMPLETED.' $script:summary.jetStream.reconnect

  $script:summary.jetStream.url = 'nats://127.0.0.1:4222'
  $script:summary.jetStream.stream = 'PRINTOPS_CONTROL'
  $script:exitCode = 0
}

function Run-RollbackAcceptance {
  $broken = $script:summary.artifacts.brokenB
  if (-not $broken) { throw 'Signed broken-B is mandatory; native rollback acceptance cannot be skipped.' }
  $script:activeScenario = 'rollbackRecovery'
  if ($script:currentInstallRoot -and (Test-Path -LiteralPath $script:currentInstallRoot -PathType Container)) { Stop-InstalledRuntime $script:currentInstallRoot }
  Stop-ArtifactServer
  Stop-ControlApiServer
  $script:apiToken = $null
  $script:ownerEmail = $null
  $script:ownerPassword = $null
  Start-ControlApiServer 'control-plane-rollback'
  $a = $script:summary.artifacts.A
  $aVersion = [string]$a.version
  $aSchema = [int]$a.schemaVersion
  $sourceRoot = Join-Path $workRoot 'rollback-recovery\ota-source'
  New-Item -ItemType Directory -Force -Path $sourceRoot | Out-Null
  $sourceUrl = Start-ArtifactServer $broken.manifestPath $broken.installerPath $sourceRoot
  $phase = New-Phase 'rollback-recovery' $a.installerPath $aVersion $aSchema
  $apiToken = [string]$phase.apiToken
  $script:device = Enroll-Device $aVersion $aSchema $apiToken $env:PRINTOPS_DEVICE_IDENTITY_PATH
  $beforeIdentity = Get-Content -LiteralPath $env:PRINTOPS_DEVICE_IDENTITY_PATH -Raw | ConvertFrom-Json
  $null = Start-EnrolledRuntime $phase.installRoot $phase.dataRoot $aVersion
  $originalServer = Get-InstalledApiProcess $phase.installRoot
  if (-not $originalServer) { throw 'Cannot capture installed A server process for rollback evidence.' }
  $originalServerHash = (Get-FileHash -LiteralPath $originalServer.path -Algorithm SHA256).Hash.ToLowerInvariant()
  $null = Register-Release $broken.version $broken.schemaVersion $broken.manifestPath $broken.installerPath $sourceUrl $apiToken
  $command = New-ControlCommand $script:device.deviceId $broken.version $apiToken
  if ($command.status -ne 'DELIVERED') { throw 'Broken-B OTA command did not receive a JetStream PubAck.' }
  $brokenCandidate = Wait-Until 'real broken-B process and health after NSIS replacement' {
    $current = Get-InstalledApiProcess $phase.installRoot
    $health = Get-Health
    if ($current -and $current.pid -ne $originalServer.pid -and $health -and $health.status -eq 'ok' -and $health.version -eq [string]$broken.version) {
      return [ordered]@{ process = $current; health = $health }
    }
    return $false
  } 600 250
  $brokenEvidencePath = Join-Path $phase.dataRoot 'ota/broken-b-readiness-evidence.json'
  $brokenEvidence = Wait-Until 'real migrated broken-B readiness failure evidence' {
    if (-not (Test-Path -LiteralPath $brokenEvidencePath -PathType Leaf)) { return $false }
    try { return Get-Content -LiteralPath $brokenEvidencePath -Raw | ConvertFrom-Json } catch { return $false }
  } 600 250
  if ($brokenEvidence.candidateWasReadyBeforeFault -ne $true -or [string]$brokenEvidence.healthVersion -ne [string]$broken.version -or [int]$brokenEvidence.healthStatusCode -ne 200 -or [int]$brokenEvidence.upstreamReadinessStatusCode -ne 200 -or [string]$brokenEvidence.upstreamReadinessStatus -cne 'READY' -or [int]$brokenEvidence.upstreamSchemaVersion -ne [int]$broken.schemaVersion -or [int]$brokenEvidence.expectedSchemaVersion -ne [int]$broken.schemaVersion -or [int]$brokenEvidence.forcedReadinessStatusCode -ne 503) {
    throw 'Broken-B did not prove a live N+1 process, READY upstream schema, and deliberate HTTP 503 readiness fault.'
  }
  $state = Wait-Until 'persisted real updater ROLLED_BACK state caused by readiness HTTP 503' {
    $value = Get-LocalOtaState $phase.dataRoot
    if ($value -and $value.phase -eq 'ROLLED_BACK' -and [string]$value.version -eq [string]$broken.version -and [string]$value.error -match '(?i)system/readiness returned HTTP 503') { return $value }
    return $false
  } 1200 500
  $rolledBack = Wait-CommandState $script:device.deviceId $command.commandId @('ROLLED_BACK') $apiToken 1200
  $restoredProcess = Wait-Until 'A API process after broken-B recovery' {
    $current = Get-InstalledApiProcess $phase.installRoot
    if ($current -and $current.pid -ne $brokenCandidate.process.pid) { return $current }
    return $false
  } 1200 500
  $healthAfter = Wait-Until 'A health after genuine signed broken-B rollback' {
    $health = Get-Health
    if ($health -and $health.status -eq 'ok' -and $health.version -eq $aVersion) { return $health }
    return $false
  } 1200 500
  $readiness = Get-Readiness $phase.dataRoot
  $restoredServerHash = (Get-FileHash -LiteralPath $restoredProcess.path -Algorithm SHA256).Hash.ToLowerInvariant()
  $afterIdentity = Get-Content -LiteralPath $env:PRINTOPS_DEVICE_IDENTITY_PATH -Raw | ConvertFrom-Json
  $restoredHeartbeat = Wait-Heartbeat $script:device.deviceId $aVersion $aSchema $apiToken 600
  $rollbackProbePath = Write-NatsProbeScript $phase.dataRoot
  $rollbackNats = Wait-Until 'JetStream ROLLED_BACK event, A heartbeat, and acknowledged durable evidence' {
    $snapshot = Invoke-NatsProbe $rollbackProbePath $phase.dataRoot $script:device.deviceId $command.commandId $command.commandId
    $heartbeats = @($snapshot.messages | Where-Object { $_.subject -eq "printops.control.heartbeat.$($script:device.deviceId)" -and $_.payload.appVersion -eq $aVersion -and [int]$_.payload.schemaVersion -eq $aSchema })
    $events = @($snapshot.messages | Where-Object { $_.subject -eq "printops.control.event.$($script:device.deviceId)" -and $_.payload.commandId -eq $command.commandId -and $_.payload.state -eq 'ROLLED_BACK' })
    $commandConsumer = $snapshot.consumers."printops-control-command-$($script:device.deviceId)"
    $eventConsumer = $snapshot.consumers.'printops-control-events'
    $heartbeatConsumer = $snapshot.consumers.'printops-control-heartbeats'
    if ($heartbeats.Count -gt 0 -and $events.Count -gt 0 -and $commandConsumer.exists -and $commandConsumer.ackFloorConsumerSeq -ge $commandConsumer.deliveredConsumerSeq -and $commandConsumer.ackPending -eq 0 -and $eventConsumer.exists -and $eventConsumer.ackFloorConsumerSeq -ge $eventConsumer.deliveredConsumerSeq -and $eventConsumer.ackPending -eq 0 -and $heartbeatConsumer.exists -and $heartbeatConsumer.ackFloorConsumerSeq -ge $heartbeatConsumer.deliveredConsumerSeq -and $heartbeatConsumer.ackPending -eq 0) {
      return [ordered]@{ snapshot = $snapshot; heartbeat = $heartbeats[-1]; terminalEvent = $events[-1]; commandConsumer = $commandConsumer; eventConsumer = $eventConsumer; heartbeatConsumer = $heartbeatConsumer }
    }
    return $false
  } 600 500
  $rollbackEvents = @(Assert-ControlTransitionSequence $rollbackNats.snapshot.messages $script:device.deviceId $command.commandId @('ACCEPTED', 'CHECKING', 'DOWNLOADING', 'VERIFIED', 'INSTALLING', 'RESTARTING', 'ROLLED_BACK'))
  if ($rolledBack.status -ne 'FAILED' -or $rolledBack.terminalState -ne 'ROLLED_BACK') { throw 'Web Control API did not persist terminal ROLLED_BACK for the broken-B OTA command.' }
  if ($readiness.ota.status -ne 'READY' -or [int]$readiness.ota.requiredComponents.database.details.schemaVersion -ne $aSchema) { throw 'Rollback did not restore A database schema readiness.' }
  if ($originalServerHash -ne $restoredServerHash) { throw 'Rollback did not restore the exact archived A server executable hash.' }
  if ($beforeIdentity.deviceId -ne $afterIdentity.deviceId -or $beforeIdentity.installationId -ne $afterIdentity.installationId) { throw 'Device identity did not survive genuine broken-B recovery.' }
  $script:summary.rollback = [ordered]@{
    status = 'PASS'
    reason = 'The signed broken-B installer started a live N+1 process and database, intentionally failed OTA readiness, and the updater restored archived A, schema N, and the enrolled identity.'
    evidence = [ordered]@{
      brokenBVersion = $broken.version
      updaterPhase = $state.phase
      readinessFailure = $state.error
      candidatePid = $brokenCandidate.process.pid
      candidateHealthVersion = $brokenEvidence.healthVersion
      candidateSchema = $brokenEvidence.upstreamSchemaVersion
      forcedReadinessStatus = $brokenEvidence.forcedReadinessStatusCode
      oldServerPid = $originalServer.pid
      restoredServerPid = $restoredProcess.pid
      originalAServerSha256 = $originalServerHash
      restoredAServerSha256 = $restoredServerHash
      AVersion = $healthAfter.version
      restoredSchema = [int]$readiness.ota.requiredComponents.database.details.schemaVersion
      commandStatus = $rolledBack.status
      terminalState = $rolledBack.terminalState
      identityContinuous = $true
      heartbeatSequence = $rollbackNats.heartbeat.seq
      terminalEventSequence = $rollbackNats.terminalEvent.seq
      transitionStates = @($rollbackEvents | ForEach-Object { $_.payload.state })
      commandConsumer = $rollbackNats.commandConsumer
      eventConsumer = $rollbackNats.eventConsumer
      heartbeatConsumer = $rollbackNats.heartbeatConsumer
      restoredHeartbeatVersion = $restoredHeartbeat.appVersion
    }
  }
  Set-Scenario 'rollbackRecovery' 'PASS' $script:summary.rollback.reason $script:summary.rollback.evidence
}

function Save-RedactedRuntimeEvidence {
  try {
    $script:summary.evidenceCaptureStatus = 'CAPTURING'
    $logsRoot = Join-Path $evidenceRoot 'runtime-logs'
    New-Item -ItemType Directory -Force -Path $logsRoot | Out-Null
    $controlPlaneRoots = @($script:summary.process.controlPlaneRuns | ForEach-Object { [string]$_.dataRoot })
    $deviceRoots = @($script:summary.process.deviceRuns | ForEach-Object { [string]$_.dataRoot })
    foreach ($root in @($deviceRoots + $controlPlaneRoots | Select-Object -Unique)) {
      if (-not $root -or -not (Test-Path -LiteralPath $root -PathType Container)) { continue }
      Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction Stop |
        Where-Object { $_.Extension -in @('.log', '.txt', '.json') -and $_.Name -notin @('device-identity.json', 'printops.db', 'native-acceptance-summary.json', 'ota-health-token.txt') -and $_.Length -lt 20MB } |
        ForEach-Object {
          $destination = Join-Path $logsRoot ("$([guid]::NewGuid().ToString('N'))-$($_.Name)")
          $content = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction Stop
          foreach ($secret in @($script:apiToken, $script:deviceApiToken, $script:printApiKey, $script:ownerPassword, $script:deviceOwnerPassword)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$secret)) { $content = $content.Replace([string]$secret, '[redacted]') }
          }
          $content = [regex]::Replace($content, '(?i)(deviceToken|token|password|apiKey|secret|privateKey)(\s*["\x27]?\s*[:=]\s*["\x27]?)[^"\x27,\s}]+', '$1$2[redacted]')
          $content | Set-Content -LiteralPath $destination -Encoding utf8
        }
    }
    if ($env:PRINTOPS_CONTROL_NATIVE_PROVENANCE -and (Test-Path -LiteralPath $env:PRINTOPS_CONTROL_NATIVE_PROVENANCE -PathType Leaf)) { Copy-Item -LiteralPath $env:PRINTOPS_CONTROL_NATIVE_PROVENANCE -Destination (Join-Path $evidenceRoot 'artifact-provenance.json') -Force }
    if ($env:PRINTOPS_CONTROL_NATIVE_A_PROVENANCE -and (Test-Path -LiteralPath $env:PRINTOPS_CONTROL_NATIVE_A_PROVENANCE -PathType Leaf)) { Copy-Item -LiteralPath $env:PRINTOPS_CONTROL_NATIVE_A_PROVENANCE -Destination (Join-Path $evidenceRoot 'archived-a-artifact-provenance.json') -Force }
    foreach ($label in @('A', 'B', 'brokenB')) {
      $artifact = $script:summary.artifacts[$label]
      if ($artifact) {
        if (-not (Test-Path -LiteralPath $artifact.manifestPath -PathType Leaf)) { throw "Required $label signed manifest disappeared before evidence capture." }
        Copy-Item -LiteralPath $artifact.manifestPath -Destination (Join-Path $evidenceRoot "$($label.ToLowerInvariant())-ota-manifest.json") -Force
      }
    }
    $script:summary.evidenceCaptureStatus = 'PASS'
  } catch {
    $captureIssue = "Required native evidence capture failed: $($_.Exception.Message)"
    $script:summary.evidenceCaptureStatus = 'FAIL'
    $script:summary.blockers = @($script:summary.blockers) + @($captureIssue)
    if ($script:summary.overallStatus -eq 'PASS') { $script:summary.overallStatus = 'FAIL' }
    $script:exitCode = 1
    Write-Warning $captureIssue
  }
}

function Restore-Environment {
  foreach ($name in $script:originalEnvironment.Keys) {
    $value = $script:originalEnvironment[$name]
    if ($null -eq $value) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    else { [Environment]::SetEnvironmentVariable($name, [string]$value, 'Process') }
  }
}

try {
  Write-Summary
  $runnerIssues = @(Test-IsolatedRunnerAndPrinter)
  $artifactIssues = @(Test-ArtifactLineage)
  $allIssues = @($runnerIssues + $artifactIssues)
  if ($allIssues.Count -gt 0) {
    Set-Blocked $allIssues
    $script:exitCode = 2
  } else {
    if (Test-Path -LiteralPath $workRoot) { throw "Refusing to reuse pre-existing run directory: $workRoot" }
    New-Item -ItemType Directory -Force -Path $workRoot | Out-Null
    $script:workRootCreated = $true
    $script:summary.jetStream.url = 'nats://127.0.0.1:4222'
    $script:summary.jetStream.stream = 'PRINTOPS_CONTROL'
    $streamProbeDir = Join-Path $workRoot 'preflight'
    New-Item -ItemType Directory -Force -Path $streamProbeDir | Out-Null
    $probePath = Write-NatsProbeScript $streamProbeDir
    $streamProbe = Invoke-NatsProbe $probePath $streamProbeDir
    if ($streamProbe.stream -ne 'PRINTOPS_CONTROL' -or $streamProbe.storage -ne 'file' -or -not ($streamProbe.subjects -contains 'printops.control.>')) { throw 'Local JetStream does not expose the isolated PRINTOPS_CONTROL file-backed control subject stream.' }
    Start-ControlApiServer
    $script:summary.activeScenario = 'signedAToBUpdate'
    Run-PrimaryAcceptance
    if ($script:summary.artifacts.brokenB) { Run-RollbackAcceptance }
    $mandatory = @('commandEnrollmentTransport', 'signedAToBUpdate', 'restartReconnectAndTerminalCompletion', 'activePrintWait', 'rollbackRecovery', 'webUiAction', 'transportResilience', 'commandSafety', 'trustBoundary', 'recoveryHardStop')
    $failed = @($mandatory | Where-Object { $script:summary.scenarios[$_].status -ne 'PASS' })
    if ($failed.Count -gt 0) {
      $script:summary.overallStatus = 'BLOCKED'
      $script:summary.blockers = @("Required native acceptance evidence is absent for: $($failed -join ', ')")
      $script:exitCode = 2
    } elseif ($script:summary.rollback.status -ne 'PASS' -or $script:summary.evidenceCaptureStatus -eq 'FAIL') {
      $script:summary.overallStatus = 'BLOCKED'
      $script:summary.blockers = @('Mandatory rollback or evidence-capture proof is incomplete.')
      $script:exitCode = 2
    } else {
      $script:summary.overallStatus = 'PASS'
      $script:exitCode = 0
    }
  }
} catch {
  $message = $_.Exception.Message
  foreach ($secret in @($script:apiToken, $script:deviceApiToken, $script:printApiKey, $script:ownerPassword, $script:deviceOwnerPassword)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$secret)) { $message = $message.Replace([string]$secret, '[redacted]') }
  }
  $message = [regex]::Replace($message, '(?i)(deviceToken|token|password|apiKey|secret|privateKey)(\s*["\x27]?\s*[:=]\s*["\x27]?)[^"\x27,\s}]+', '$1$2[redacted]')
  $script:summary.overallStatus = 'FAIL'
  $script:summary.blockers = @($message)
  if ($script:activeScenario -and $script:summary.scenarios.Contains($script:activeScenario)) {
    Set-Scenario $script:activeScenario 'FAIL' $message
  }
  if ($script:activeScenario -eq 'rollbackRecovery') {
    $script:summary.rollback.status = 'FAIL'
    $script:summary.rollback.reason = $message
  }
  foreach ($name in @('commandEnrollmentTransport', 'signedAToBUpdate', 'restartReconnectAndTerminalCompletion', 'activePrintWait')) {
    if ($script:summary.scenarios[$name].status -eq 'BLOCKED' -and $script:activeScenario -ne $name) {
      Set-Scenario $name 'NOT RUN' "Earlier native acceptance stage failed: $message"
    }
  }
  Write-Error "[FAIL] Web Control native OTA acceptance: $message"
  $script:exitCode = 1
} finally {
  if ($script:printQueuePaused -and $env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER) {
    try { Resume-Printer -Name $env:PRINTOPS_CONTROL_NATIVE_SAFE_PRINTER -ErrorAction Stop; $script:summary.printer.queueStatus = 'RESUMED_AFTER_FAILURE' } catch { Write-Warning "Could not resume explicitly approved queue: $($_.Exception.Message)" }
  }
  if ($script:currentInstallRoot -and (Test-Path -LiteralPath $script:currentInstallRoot -PathType Container)) { Stop-InstalledRuntime $script:currentInstallRoot }
  Stop-ArtifactServer
  Stop-ControlApiServer
  Save-RedactedRuntimeEvidence
  if ($script:workRootCreated -and (Test-Path -LiteralPath $workRoot -PathType Container)) {
    try {
      Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction Stop
      $script:workRootCreated = $false
    } catch {
      $cleanupIssue = "Could not remove isolated acceptance data containing device/API credentials: $($_.Exception.Message)"
      $script:summary.blockers = @($script:summary.blockers) + @($cleanupIssue)
      if ($script:summary.overallStatus -eq 'PASS') { $script:summary.overallStatus = 'FAIL' }
      $script:exitCode = 1
    }
  }
  if ($script:summary.overallStatus -eq 'BLOCKED' -and $script:exitCode -eq 0) { $script:exitCode = 2 }
  Write-Summary
  Restore-Environment
}

if ($script:summary.overallStatus -eq 'PASS') { Write-Host '[PASS] Web Control native OTA acceptance completed with real process, HTTP, JetStream, and physical queue evidence.' }
elseif ($script:summary.overallStatus -eq 'BLOCKED') { Write-Host "[BLOCKED] $($script:summary.blockers -join ' ')" }
exit $script:exitCode
