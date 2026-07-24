# PrinterOps installer pre-install shutdown payload.
#
# This file is the SOURCE OF TRUTH and is embedded into the installer verbatim
# at COMPILE time by nsis-hooks.nsh (a `File "/oname=$PLUGINSDIR\..."` command)
# and run with `powershell -File`. Just edit here and rebuild the installer -
# there is no generator step. (The retired scripts/gen-nsis-hooks.mjs used to
# base64 this into the .nsh; that broke because the Unicode installer wrote the
# payload as UTF-16LE and the decoder misread it. Compile-time File embedding
# avoids both the `$`-expansion and the encoding round-trip.)
#
# SAFETY: this script must never terminate a process by image name alone.
# `server.exe` is a common name. Every candidate is matched on BOTH:
#   1. an explicit name allowlist, and
#   2. Win32_Process.ExecutablePath resolving under the current user's install
#      root ($env:LOCALAPPDATA\PrinterOps\), normalized via GetFullPath +
#      TrimEnd + trailing separator, compared with an ordinal case-insensitive
#      StartsWith (not -like, which treats [] as wildcards).
# A server.exe from any other product, or a PrinterOps copy installed elsewhere,
# is left running.
#
# Failures are non-fatal by design: a failed shutdown must not abort the
# install. Everything is appended to $env:TEMP\printerops-nsis-shutdown.log so a
# silent (/S) install can still be audited afterwards.

$ErrorActionPreference = 'SilentlyContinue'

$logPath = Join-Path $env:TEMP 'printerops-nsis-shutdown.log'

# Breadcrumb #2: written before any real work so its mere presence proves
# powershell.exe launched and located this script (the piece that silently
# failed in the earlier base64 delivery). See nsis-hooks.nsh.
try { Set-Content -LiteralPath $logPath -Value ('{0} launched' -f (Get-Date).ToString('o')) -Encoding UTF8 } catch { }

function Write-HookLog {
    param([string]$Line)
    $stamped = '{0} {1}' -f (Get-Date).ToString('o'), $Line
    try { Add-Content -LiteralPath $logPath -Value $stamped -Encoding UTF8 } catch { }
    Write-Output $Line
}

# Exact normalization used to verify the predicate by hand outside the installer.
$root = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'PrinterOps')).TrimEnd('\') + '\'

# Name allowlist. Combined with the $root check below - never used on its own.
$names = @(
    'printerops-desktop.exe',
    'server.exe',
    'printops-runner.exe',
    'printops-html-print.exe'
)

function Get-PrinterOpsProcess {
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and
        $names -contains $_.Name -and
        $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)
    })
}

Write-HookLog ('start root=' + $root)

$initial = Get-PrinterOpsProcess
Write-HookLog ('found=' + $initial.Count)
foreach ($p in $initial) {
    Write-HookLog ('proc=' + $p.ProcessId + ' ' + $p.Name + ' ' + $p.ExecutablePath)
}

# Step 1 - graceful. Ask the desktop app to close its main window so it runs its
# own shutdown path, which is what stops the sidecars it spawned (server.exe,
# printops-runner.exe). Killing the parent outright orphans them.
foreach ($p in $initial) {
    if ($p.Name -ne 'printerops-desktop.exe') { continue }
    try {
        $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
        if ($proc) {
            [void]$proc.CloseMainWindow()
            Write-HookLog ('graceful=' + $p.ProcessId)
        }
    } catch {
        Write-HookLog ('graceful-error=' + $p.ProcessId + ' ' + $_.Exception.Message)
    }
}

# Give the app time to run its normal cleanup before escalating.
Start-Sleep -Seconds 4

# Step 2 - force. Anything still under the install root is either a hung main
# process or a sidecar orphaned by an unclean exit. Re-query rather than reusing
# $initial so processes that already exited are not touched.
foreach ($p in Get-PrinterOpsProcess) {
    try {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Write-HookLog ('kill=' + $p.ProcessId + ' ' + $p.ExecutablePath)
    } catch {
        Write-HookLog ('kill-error=' + $p.ProcessId + ' ' + $_.Exception.Message)
    }
}

# Step 3 - wait for release. Stop-Process returns before Windows has torn the
# process down, and the image file stays locked until it has. Poll up to 15s;
# NSIS `File` silently skips a locked target, so this wait is what makes the
# difference between a real upgrade and a success-reporting no-op.
for ($i = 0; $i -lt 60; $i++) {
    if ((Get-PrinterOpsProcess).Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
}

$remaining = Get-PrinterOpsProcess
Write-HookLog ('remaining=' + $remaining.Count)
foreach ($p in $remaining) {
    Write-HookLog ('stuck=' + $p.ProcessId + ' ' + $p.ExecutablePath)
}
Write-HookLog 'done'
