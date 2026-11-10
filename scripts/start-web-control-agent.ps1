$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$agent = Join-Path $repoRoot 'apps\api\dist\standalone-control-agent.js'
$dataRoot = Join-Path $env:APPDATA 'com.printerops.desktop'
$env:PRINTOPS_CONTROL_IDENTITY_PATH = Join-Path $dataRoot 'device-identity.json'
$env:PRINTOPS_CONTROL_TARGET_TOKEN_PATH = Join-Path $dataRoot 'ota-health-token.txt'
$env:PRINTOPS_CONTROL_TARGET_URL = 'http://127.0.0.1:31415'
$env:PRINTOPS_CONTROL_NATS_URL = 'nats://127.0.0.1:4222'
$env:PRINTOPS_CONTROL_NATS_STREAM = 'PRINTOPS_CONTROL'

if (-not (Test-Path -LiteralPath $agent)) { throw "Control agent build is missing: $agent" }
if (-not (Test-Path -LiteralPath $env:PRINTOPS_CONTROL_IDENTITY_PATH)) { throw 'Control agent identity is missing' }
if (-not (Test-Path -LiteralPath $env:PRINTOPS_CONTROL_TARGET_TOKEN_PATH)) { throw 'PrintOps local OTA token is missing' }

Set-Location -LiteralPath $repoRoot
& node $agent
exit $LASTEXITCODE
