Fix the NSIS installer hook based on failed real verification. Current hook is apps/desktop/src-tauri/nsis-hooks.nsh.

Evidence:
- Fresh installer built successfully but a silent upgrade returned exit 0 while these exact existing installed processes remained alive:
  - printerops-desktop.exe PID 19224 at C:\Users\phcar\AppData\Local\PrinterOps\printerops-desktop.exe
  - server.exe PID 24444 at C:\Users\phcar\AppData\Local\PrinterOps\resources\server.exe
- Standalone PowerShell using this predicate DOES find those processes:
  $root = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'PrinterOps')).TrimEnd('\') + '\'
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) }

Root problem: the current inline nsExec PowerShell -Command quoting/macro expansion is not reliably running/matching.

Implement a reliable fix:
1. Replace fragile inline `-Command` PowerShell in the NSIS hook with `powershell.exe -EncodedCommand` using UTF-16LE base64. This avoids NSIS interpreting PowerShell `$`, quotes, pipes, and braces.
2. Script must normalize root with the exact standalone pattern above and only operate on executable paths whose normalized ExecutablePath starts with normalized $env:LOCALAPPDATA\PrinterOps\ root.
3. Restrict names to printerops-desktop.exe, server.exe, printops-runner.exe, printops-html-print.exe. Never use global image-name taskkill.
4. First gracefully close the main PrinterOps process, wait few seconds, then force kill matching remaining processes and wait for release.
5. Update comments explaining safety.

Then build NSIS and prove the fix, not just compilation:
- launch currently installed PrinterOps
- prove main + server processes are running via a path-scoped query
- run new NSIS installer with /S
- prove those process IDs or equivalent path-scoped processes no longer run
- verify installed server.exe SHA equals src-tauri/resources/server.exe SHA (proves actual overwrite happened)

Do not touch staged NATS files. Do not commit. Report exact changed files and verification evidence.