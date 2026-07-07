import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  PrinterAdapterPort,
  PrinterAdapterResult,
  QueueEntry,
  PrinterCapability,
  PrinterStatus,
  PrintCommand,
} from '@printerops/domain';

const execFileAsync = promisify(execFile);
const isWindows = process.platform === 'win32';

/**
 * WindowsSpoolerAdapter — prints via the Windows print spooler.
 *
 * On Windows, uses PowerShell to send documents:
 *  - text/plain: piped through `Out-Printer` (handles text formatting)
 *  - text/html: temp file + shell `printto` verb (Edge/browser renders)
 *  - raw (ZPL/TSPL/etc.): temp file + .NET RawPrinterHelper (sends exact bytes)
 *
 * On non-Windows, all operations return a descriptive error.
 */
export class WindowsSpoolerAdapter implements PrinterAdapterPort {
  readonly protocol = 'windows_spooler';
  readonly adapterName = 'WindowsSpoolerAdapter';

  // ---- helpers ----

  /** Parse the local Windows printer name from `spooler://<runnerId>/<EncodedName>`. */
  private parsePrinterName(connectionUri: string): string | undefined {
    const match = connectionUri.match(/^spooler:\/\/[^/]+\/(.+)$/);
    if (match && match[1]) return decodeURIComponent(match[1]);
    try {
      const url = new URL(connectionUri);
      const seg = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      return seg || undefined;
    } catch {
      return undefined;
    }
  }

  private resolvePrinterName(command: PrintCommand): string | undefined {
    return (
      this.parsePrinterName(command.connectionUri ?? '') ??
      (typeof command.metadata?.['printerName'] === 'string'
        ? (command.metadata['printerName'] as string)
        : undefined) ??
      (typeof command.metadata?.['printerCode'] === 'string'
        ? (command.metadata['printerCode'] as string)
        : undefined)
    );
  }

  // ---- PrinterAdapterPort ----

  async detect(connectionUri: string): Promise<boolean> {
    if (!isWindows) return false;
    const name = this.parsePrinterName(connectionUri);
    if (!name) return false;
    try {
      await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Get-Printer -Name '${name.replace(/'/g, "''")}' -ErrorAction Stop | Out-Null`,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async getStatus(connectionUri: string): Promise<PrinterStatus> {
    if (!isWindows) {
      return { printerId: 'unknown', code: 'unknown', message: 'Not running on Windows', checkedAt: new Date() };
    }
    const name = this.parsePrinterName(connectionUri);
    if (!name) {
      return { printerId: 'unknown', code: 'unknown', message: 'Cannot parse printer name', checkedAt: new Date() };
    }
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `(Get-Printer -Name '${name.replace(/'/g, "''")}' -ErrorAction Stop).PrinterStatus`,
      ]);
      const raw = stdout.trim();
      // Map common Windows PrinterStatus values to our codes
      const code: PrinterStatus['code'] =
        raw === 'Normal' ? 'idle' :
        raw === 'Idle' ? 'idle' :
        raw === 'Printing' || raw === 'Processing' ? 'busy' :
        raw === 'Error' ? 'error' :
        raw === 'Offline' || raw === 'NotAvailable' ? 'offline' :
        'unknown';
      return { printerId: name, code, message: raw || undefined, checkedAt: new Date() };
    } catch {
      return { printerId: name, code: 'unknown', message: 'Failed to query printer status', checkedAt: new Date() };
    }
  }

  async getCapabilities(_connectionUri: string): Promise<PrinterCapability> {
    // Conservative defaults; real capability discovery would query the driver
    return {
      colorSupported: true,
      duplexSupported: true,
      maxPageWidth: 210,
      maxPageHeight: 297,
      supportedMediaTypes: ['plain', 'glossy', 'photo', 'label'],
      supportedResolutions: ['203dpi', '300dpi', '600dpi'],
      maxCopies: 999,
    };
  }

  async executeCommand(command: PrintCommand): Promise<PrinterAdapterResult> {
    if (!isWindows) {
      return {
        success: false,
        errorCode: 'NOT_WINDOWS',
        message: 'WindowsSpoolerAdapter can only execute on a Windows host',
      };
    }

    const printerName = this.resolvePrinterName(command);
    if (!printerName) {
      return {
        success: false,
        errorCode: 'PRINTER_NAME_NOT_RESOLVED',
        message: 'Could not resolve Windows printer name from connectionUri or metadata',
      };
    }

    // --- Resolve content ---
    let content: Buffer | undefined;
    if (command.documentBase64) {
      content = Buffer.from(command.documentBase64, 'base64');
    } else if (command.renderedPrintPayload) {
      content = Buffer.from(command.renderedPrintPayload, 'utf-8');
    }

    if (!content) {
      return {
        success: false,
        errorCode: 'NO_CONTENT',
        message: 'No print content available (renderedPrintPayload or documentBase64 required)',
      };
    }

    // --- Print copies ---
    for (let i = 0; i < Math.max(1, command.copies); i++) {
      if (command.mimeType === 'text/html') {
        await this.printHtml(printerName, content.toString('utf-8'));
      } else if (command.mimeType === 'text/plain' || command.mimeType === 'RAW_TEXT') {
        await this.printText(printerName, content.toString('utf-8'));
      } else {
        // ZPL, TSPL, or unknown binary — send raw bytes
        await this.printRaw(printerName, content);
      }
    }

    return {
      success: true,
      jobId: command.jobId,
      message: `WindowsSpoolerAdapter: job ${command.jobId} sent to "${printerName}" (${command.copies} cop${command.copies > 1 ? 'ies' : 'y'})`,
    };
  }

  async printTestPage(connectionUri: string, printerId: string): Promise<PrinterAdapterResult> {
    const name = this.parsePrinterName(connectionUri);
    if (!name || !isWindows) {
      return { success: false, errorCode: 'INVALID', message: 'Cannot resolve printer or not on Windows' };
    }
    await this.printText(name, `--- PrintOps Test Page ---\nPrinter: ${name}\nPrinter ID: ${printerId}\nTime: ${new Date().toISOString()}\n`);
    return { success: true, message: `Test page sent to "${name}"` };
  }

  async listQueue(connectionUri: string): Promise<QueueEntry[]> {
    if (!isWindows) return [];
    const name = this.parsePrinterName(connectionUri);
    if (!name) return [];
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Get-PrintJob -PrinterName '${name.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Select-Object Id,JobStatus,SubmittedTime | ConvertTo-Json -Compress`,
      ]);
      const raw = stdout.trim();
      if (!raw) return [];
      const arr = JSON.parse(raw);
      const items = Array.isArray(arr) ? arr : [arr];
      return items.map((j: { Id?: number; JobStatus?: string; SubmittedTime?: string }, idx: number) => ({
        jobId: String(j.Id ?? idx),
        status: j.JobStatus ?? 'unknown',
        position: idx,
        submittedAt: j.SubmittedTime ? new Date(j.SubmittedTime) : new Date(),
      }));
    } catch {
      return [];
    }
  }

  async cancelJob(connectionUri: string, jobId: string): Promise<PrinterAdapterResult> {
    const name = this.parsePrinterName(connectionUri);
    if (!name || !isWindows) {
      return { success: false, errorCode: 'INVALID', message: 'Cannot resolve printer or not on Windows' };
    }
    try {
      await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Remove-PrintJob -PrinterName '${name.replace(/'/g, "''")}' -ID ${Number(jobId) || 0} -ErrorAction SilentlyContinue`,
      ]);
      return { success: true, jobId, message: `Job ${jobId} cancelled on "${name}"` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, jobId, errorCode: 'CANCEL_FAILED', message: msg };
    }
  }

  // ---- printing strategies ----

  /** Print plain text via `Out-Printer` (handles formatting/page breaks). */
  private printText(printerName: string, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ps = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='Stop'; $input | Out-Printer -Name '${printerName.replace(/'/g, "''")}'`,
      ]);
      let stderr = '';
      ps.stderr.on('data', (d) => { stderr += d.toString(); });
      ps.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Out-Printer failed (exit ${code}): ${stderr.trim()}`));
      });
      ps.on('error', reject);
      ps.stdin.write(text);
      ps.stdin.end();
    });
  }

  /** Print HTML by writing a temp .html file and invoking the `printto` shell verb. */
  private async printHtml(printerName: string, html: string): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'printops-html-'));
    const file = join(dir, 'document.html');
    try {
      await writeFile(file, html, 'utf-8');
      const script =
        `$ErrorActionPreference='Stop';
         $p = Start-Process -FilePath '${file.replace(/'/g, "''")}' -Verb printto -ArgumentList '"${printerName.replace(/'/g, "''")}"' -PassThru -Wait;
         if ($p.ExitCode -ne 0) { exit 1 }`;
      await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command', script,
      ], { timeout: 30_000 });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Send raw bytes to the printer via .NET RawPrinterHelper (for ZPL/TSPL/etc.). */
  private async printRaw(printerName: string, data: Buffer): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'printops-raw-'));
    const file = join(dir, 'document.bin');
    try {
      await writeFile(file, data);
      const safeName = printerName.replace(/'/g, "''");
      const safePath = file.replace(/'/g, "''");
      const script = RAW_PRINT_PS_PREFIX + `$name='${safeName}'; $path='${safePath}'; ` + RAW_PRINT_PS_SUFFIX;
      await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        script,
      ], { timeout: 15_000 });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * PowerShell prefix: defines a .NET `RawPrinter` type via P/Invoke (winspool.drv).
 * Consumed in two parts so variables can be injected between them.
 */
const RAW_PRINT_PS_PREFIX = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
}
public class RawPrinter {
  public static bool SendBytes(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    var di = new RawPrinterHelper.DOCINFOA { pDocName = "PrintOps", pDataType = "RAW" };
    if (!RawPrinterHelper.OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
    try {
      if (!RawPrinterHelper.StartDocPrinter(hPrinter, 1, di)) return false;
      try {
        if (!RawPrinterHelper.StartPagePrinter(hPrinter)) return false;
        try {
          IntPtr p = Marshal.AllocHGlobal(bytes.Length);
          try {
            Marshal.Copy(bytes, 0, p, bytes.Length);
            int written;
            if (!RawPrinterHelper.WritePrinter(hPrinter, p, bytes.Length, out written)) return false;
            return written == bytes.Length;
          } finally { Marshal.FreeHGlobal(p); }
        } finally { RawPrinterHelper.EndPagePrinter(hPrinter); }
      } finally { RawPrinterHelper.EndDocPrinter(hPrinter); }
    } finally { RawPrinterHelper.ClosePrinter(hPrinter); }
  }
}
'@
$ErrorActionPreference = 'Stop'
`;

const RAW_PRINT_PS_SUFFIX = `
$bytes = [System.IO.File]::ReadAllBytes($path)
if (-not [RawPrinter]::SendBytes($name, $bytes)) { Write-Error 'RawPrinter.SendBytes returned false' }
`;
