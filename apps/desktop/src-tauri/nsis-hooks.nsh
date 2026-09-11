; PrintOps NSIS installer hooks.
;
; Hand-written. The pre-install shutdown logic lives in
; scripts/nsis-shutdown.ps1 and is embedded into the installer at COMPILE time
; (see the File command below). Edit the .ps1 directly - there is no generator
; and no base64 step anymore.
;
; Why this exists
; ---------------
; Upgrading over a running install fails because NSIS cannot overwrite
; resources/server.exe and resources/printops-runner.exe while they are locked.
; NSIS `File` silently skips a locked target and the install still reports
; success, so a missed shutdown shows up as a silent no-op upgrade (old bytes
; stay on disk, exit code 0). The pre-install hook closes the running install
; first so the `File` commands that follow can actually overwrite.
;
; Why the payload is a File-embedded .ps1 (and NOT inline / base64)
; ----------------------------------------------------------------
; Two earlier attempts failed:
;   1. Inline `powershell -Command "..."`: NSIS expands `$` in every string it
;      parses and re-splits nsExec command lines on quotes/spaces, mangling
;      `$_`, `$root`, pipes and braces before powershell.exe saw them.
;   2. Base64 payload written to $TEMP with `FileWrite`, decoded by a bootstrap:
;      this installer is compiled `Unicode true`, so `FileWrite` emits the file
;      as UTF-16LE. The bootstrap read it with `Get-Content -Raw` (ANSI under
;      Windows PowerShell 5.1), producing a null-interleaved string that
;      `FromBase64String` rejected. The decode threw, Invoke-Expression never
;      ran, and no log was ever written - looking exactly like a hook that
;      never fired.
; Embedding the .ps1 with `File` at compile time sidesteps both: NSIS copies
; the bytes verbatim (no `$` expansion, no encoding round-trip), and
; `powershell -File` runs the real script directly.
;
; Safety
; ------
; The payload NEVER terminates by image name alone - no global taskkill.
; A process is only touched when its name is in the allowlist
; (printerops-desktop.exe, server.exe, printops-runner.exe,
; printops-html-print.exe) AND its Win32_Process.ExecutablePath resolves under
; $env:LOCALAPPDATA\PrintOps\ (GetFullPath + TrimEnd + trailing separator,
; ordinal case-insensitive StartsWith). An unrelated server.exe elsewhere on the
; machine is left alone. The desktop app is asked to close gracefully first so
; it can stop its own sidecars; only survivors are force-killed, and the hook
; then waits for the image handles to be released.
;
; Failures are non-fatal - a failed shutdown must not abort the install. Two
; independent breadcrumbs prove the hook actually ran on a silent (/S) install:
;   - $TEMP\printerops-nsis-hook-entered.txt   (written by NSIS before nsExec;
;     judge by existence - proves the macro body executed)
;   - $TEMP\printerops-nsis-shutdown.log        (written by the .ps1 itself;
;     proves powershell.exe launched and located the script)

; Capture THIS file's directory (src-tauri) at include time, at file scope.
; ${__FILEDIR__} must be read here, not inside the macro: inside a macro it
; expands at the !insertmacro point (the generated installer.nsi's own dir),
; which is not where this hook or its scripts live.
!ifndef PRINTEROPS_HOOK_DIR
  !define PRINTEROPS_HOOK_DIR "${__FILEDIR__}"
!endif

!macro NSIS_HOOK_PREINSTALL
  Push $0
  Push $1

  DetailPrint "Closing PrintOps before upgrade (root: $LOCALAPPDATA\PrintOps)..."

  ; Breadcrumb #1 - NSIS proves the macro body ran even if powershell fails to
  ; launch. Judged by file existence, not content (this file's encoding is
  ; irrelevant here; a base64 payload is no longer written this way).
  ClearErrors
  FileOpen $0 "$TEMP\printerops-nsis-hook-entered.txt" w
  ${IfNot} ${Errors}
    FileWrite $0 "NSIS_HOOK_PREINSTALL entered$\r$\n"
    FileClose $0
  ${EndIf}

  ; Extract the real shutdown script next to the plugins temp dir.
  ; ${PRINTEROPS_HOOK_DIR} is this .nsh's directory (src-tauri), captured above,
  ; so the .ps1 is baked into the installer - no runtime path assumptions.
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\printerops-shutdown.ps1" "${PRINTEROPS_HOOK_DIR}\scripts\nsis-shutdown.ps1"
  IfErrors printerops_payload_failed

  ; Run it: graceful close -> wait -> path-scoped force kill -> wait for the
  ; image handles to drop. -File runs the script verbatim; no quoting games.
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\printerops-shutdown.ps1"`
  Pop $0
  Pop $1
  DetailPrint "PrintOps shutdown exit=$0"
  DetailPrint "$1"

  ; Windows can hold the image handle a moment longer than the process object.
  Sleep 1500
  Goto printerops_payload_done

  printerops_payload_failed:
  DetailPrint "PrintOps shutdown skipped: could not stage shutdown script"

  printerops_payload_done:
  Pop $1
  Pop $0
!macroend
