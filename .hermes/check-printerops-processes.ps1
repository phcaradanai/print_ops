$root = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'PrinterOps')).TrimEnd('\') + '\'
Get-CimInstance Win32_Process -ErrorAction Stop |
  Where-Object {
    $_.ExecutablePath -and
    $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)
  } |
  Select-Object Name, ProcessId, ExecutablePath |
  Format-List
