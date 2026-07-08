// Package winpool implements a PrintExecutor that sends raw bytes to a Windows
// printer via the spooler API. It uses PowerShell + .NET RawPrinterHelper to
// bypass the print driver and send the payload directly (needed for ZPL/TSPL
// label printers that don't understand GDI/Page Description Language).
//
// STATUS: production for Windows label printers. No-op on non-Windows.
package winpool

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/printer"
)

// Executor sends raw payload bytes to a Windows printer share via the spooler.
type Executor struct {
	// PrinterName overrides the printer name resolved from job.Options. When
	// empty, the executor uses job.Options["windows_printer_name"] or
	// job.PrinterCode.
	PrinterName string
	// CommandTimeout bounds the PowerShell subprocess. Defaults to 30s.
	CommandTimeout time.Duration
}

// New returns a Windows spooler executor with default settings.
func New() *Executor {
	return &Executor{
		CommandTimeout: 30 * time.Second,
	}
}

// Name implements PrintExecutor.
func (e *Executor) Name() string { return "windows-spooler" }

// Execute sends the raw payload to the printer via PowerShell.
//
// It constructs a small C# snippet embedded in PowerShell that P/Invokes
// WritePrinter against the spooler, sending the bytes directly to the printer.
// This is the standard approach for raw ZPL/TSPL on Windows.
func (e *Executor) Execute(ctx context.Context, job printer.PrintJob) (*printer.PrintResult, error) {
	start := time.Now()

	if runtime.GOOS != "windows" {
		return e.fail(start, job, "windows-spooler executor requires Windows", fmt.Errorf("not windows: %s", runtime.GOOS)), nil
	}

	printerName := e.resolvePrinterName(job)
	if printerName == "" {
		return e.fail(start, job, "no printer name resolved (set windows_printer_name or printer_code)", fmt.Errorf("missing printer name")), nil
	}

	if len(job.RenderedPayload) == 0 {
		return e.fail(start, job, "empty payload", fmt.Errorf("payload is empty")), nil
	}

	cmdCtx, cancel := context.WithTimeout(ctx, e.CommandTimeout)
	defer cancel()

	// Build PowerShell script that uses RawPrinterHelper to send raw bytes.
	// This is the canonical method for sending ZPL/TSPL to label printers on
	// Windows without going through the GDI driver.
	script := buildRawPrintScript(printerName, job.RenderedPayload)

	cmd := exec.CommandContext(cmdCtx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	output, err := cmd.CombinedOutput()
	finished := time.Now()

	if err != nil {
		return &printer.PrintResult{
			Status:      printer.StatusFailed,
			Executor:    e.Name(),
			SafeMessage: fmt.Sprintf("spooler error: %v (output: %s)", err, truncate(string(output), 200)),
			DurationMs:  finished.Sub(start).Milliseconds(),
			StartedAt:   start,
			FinishedAt:  finished,
			Evidence: map[string]any{
				"printer_name":  printerName,
				"payload_size":  len(job.RenderedPayload),
				"copies":        job.Copies,
				"powershell_ok": false,
			},
			Err: err,
		}, nil
	}

	return &printer.PrintResult{
		Status:      printer.StatusSuccess,
		Executor:    e.Name(),
		SafeMessage: fmt.Sprintf("sent %d bytes to %s via spooler", len(job.RenderedPayload), printerName),
		DurationMs:  finished.Sub(start).Milliseconds(),
		StartedAt:   start,
		FinishedAt:  finished,
		Evidence: map[string]any{
			"printer_name":  printerName,
			"payload_size":  len(job.RenderedPayload),
			"copies":        job.Copies,
			"powershell_ok": true,
		},
	}, nil
}

// resolvePrinterName picks the Windows printer name from executor config,
// then job options, then falls back to the printer code.
func (e *Executor) resolvePrinterName(job printer.PrintJob) string {
	if e.PrinterName != "" {
		return e.PrinterName
	}
	if v := job.Options["windows_printer_name"]; v != "" {
		return v
	}
	if job.PrinterCode != "" {
		return job.PrinterCode
	}
	return ""
}

func (e *Executor) fail(start time.Time, job printer.PrintJob, msg string, err error) *printer.PrintResult {
	finished := time.Now()
	return &printer.PrintResult{
		Status:      printer.StatusFailed,
		Executor:    e.Name(),
		SafeMessage: msg,
		DurationMs:  finished.Sub(start).Milliseconds(),
		StartedAt:   start,
		FinishedAt:  finished,
		Evidence: map[string]any{
			"payload_size": len(job.RenderedPayload),
		},
		Err: err,
	}
}

// buildRawPrintScript generates a PowerShell script that sends raw bytes to a
// Windows printer using the RawPrinterHelper class (P/Invoke winspool.drv).
// The payload is base64-encoded to safely pass through the command line.
func buildRawPrintScript(printerName string, payload []byte) string {
	// Encode payload as base64 to avoid escaping issues.
	b64 := base64Encode(payload)

	// The script defines RawPrinterHelper, creates a temp file from base64,
	// reads it as bytes, and sends those bytes directly to the spooler.
	return fmt.Sprintf(`$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
  public static bool SendBytesToPrinter(string szPrinterName, IntPtr pBytes, Int32 dwCount) {
    IntPtr hPrinter;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "PrintOps Runner Job";
    di.pDataType = "RAW";
    bool bSuccess = false;
    if (OpenPrinter(szPrinterName.Normalize(), out hPrinter, IntPtr.Zero)) {
      if (StartDocPrinter(hPrinter, 1, di)) {
        if (StartPagePrinter(hPrinter)) {
          Int32 dwWritten;
          bSuccess = WritePrinter(hPrinter, pBytes, dwCount, out dwWritten);
          EndPagePrinter(hPrinter);
        }
        EndDocPrinter(hPrinter);
      }
      ClosePrinter(hPrinter);
    }
    return bSuccess;
  }
  public static bool SendStringToPrinter(string szPrinterName, string s) {
    IntPtr pBytes = Marshal.StringToCoTaskMemAnsi(s);
    Int32 dwCount = s.Length;
    bool ok = SendBytesToPrinter(szPrinterName, pBytes, dwCount);
    Marshal.FreeCoTaskMem(pBytes);
    return ok;
  }
}
'@
$bytes = [System.Convert]::FromBase64String('%s')
$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
try {
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
  $ok = [RawPrinterHelper]::SendBytesToPrinter('%s', $ptr, $bytes.Length)
  if (-not $ok) { throw "WritePrinter returned false" }
} finally {
  [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
}
`, b64, escapePrinterName(printerName))
}

func base64Encode(data []byte) string {
	const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	var sb strings.Builder
	sb.Grow(((len(data) + 2) / 3) * 4)
	for i := 0; i < len(data); i += 3 {
		var n uint32
		var count int
		for j := 0; j < 3 && i+j < len(data); j++ {
			n |= uint32(data[i+j]) << (16 - uint(j*8))
			count++
		}
		sb.WriteByte(table[(n>>18)&0x3F])
		sb.WriteByte(table[(n>>12)&0x3F])
		if count > 1 {
			sb.WriteByte(table[(n>>6)&0x3F])
		} else {
			sb.WriteByte('=')
		}
		if count > 2 {
			sb.WriteByte(table[n&0x3F])
		} else {
			sb.WriteByte('=')
		}
	}
	return sb.String()
}

func escapePrinterName(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
