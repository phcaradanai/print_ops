using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Exposes internal geometry/settings logic to the unit-test project.
[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("PrintOps.HtmlPrint.Tests")]

namespace PrintOps.HtmlPrint
{
    [DataContract]
    internal sealed class PrintRequest
    {
        [DataMember(Name = "filePath", IsRequired = true)] public string FilePath { get; set; }
        [DataMember(Name = "printerName", IsRequired = true)] public string PrinterName { get; set; }
        [DataMember(Name = "resultPath")] public string ResultPath { get; set; }
        [DataMember(Name = "userDataFolder")] public string UserDataFolder { get; set; }
        [DataMember(Name = "jobName")] public string JobName { get; set; }
        [DataMember(Name = "copies")] public int Copies { get; set; } = 1;
        [DataMember(Name = "paperWidthMm")] public double PaperWidthMm { get; set; }
        [DataMember(Name = "paperHeightMm")] public double PaperHeightMm { get; set; }
        [DataMember(Name = "marginTopMm")] public double MarginTopMm { get; set; }
        [DataMember(Name = "marginRightMm")] public double MarginRightMm { get; set; }
        [DataMember(Name = "marginBottomMm")] public double MarginBottomMm { get; set; }
        [DataMember(Name = "marginLeftMm")] public double MarginLeftMm { get; set; }
        [DataMember(Name = "orientation")] public string Orientation { get; set; }
        [DataMember(Name = "duplex")] public string Duplex { get; set; }
        [DataMember(Name = "colorMode")] public string ColorMode { get; set; }
    }

    [DataContract]
    internal sealed class PrintResult
    {
        [DataMember(Name = "success")] public bool Success { get; set; }
        [DataMember(Name = "status")] public string Status { get; set; }
        [DataMember(Name = "message")] public string Message { get; set; }
        [DataMember(Name = "phase")] public string Phase { get; set; }
    }

    internal sealed class PrintGeometry
    {
        public double PageWidthMm { get; private set; }
        public double PageHeightMm { get; private set; }
        public double PrintableWidthMm { get; private set; }
        public double PrintableHeightMm { get; private set; }
        public static PrintGeometry FromRequest(PrintRequest request)
        {
            if (!IsPositiveFinite(request.PaperWidthMm) || !IsPositiveFinite(request.PaperHeightMm))
                throw new ArgumentException("paperWidthMm and paperHeightMm must be finite and greater than zero");

            if (!IsNonNegativeFinite(request.MarginTopMm) ||
                !IsNonNegativeFinite(request.MarginRightMm) ||
                !IsNonNegativeFinite(request.MarginBottomMm) ||
                !IsNonNegativeFinite(request.MarginLeftMm))
            {
                throw new ArgumentException("All margins must be finite and greater than or equal to zero");
            }

            var printableWidthMm = request.PaperWidthMm - request.MarginLeftMm - request.MarginRightMm;
            var printableHeightMm = request.PaperHeightMm - request.MarginTopMm - request.MarginBottomMm;
            if (!IsPositiveFinite(printableWidthMm))
                throw new ArgumentException("marginLeftMm + marginRightMm must be less than paperWidthMm");
            if (!IsPositiveFinite(printableHeightMm))
                throw new ArgumentException("marginTopMm + marginBottomMm must be less than paperHeightMm");

            return new PrintGeometry
            {
                PageWidthMm = request.PaperWidthMm,
                PageHeightMm = request.PaperHeightMm,
                PrintableWidthMm = printableWidthMm,
                PrintableHeightMm = printableHeightMm
            };
        }

        private static bool IsPositiveFinite(double value)
        {
            return value > 0 && !double.IsNaN(value) && !double.IsInfinity(value);
        }

        private static bool IsNonNegativeFinite(double value)
        {
            return value >= 0 && !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }

    /// <summary>
    /// The exact WebView2 print settings derived from a PrintRequest, as a
    /// plain data object so the mapping is unit-testable without WebView2.
    ///
    /// DEFECT-01 (printed QR ~0.5mm smaller than configured): the helper
    /// previously left CoreWebView2PrintSettings.MediaSize at its default
    /// (Default), which makes WebView2/Chromium use the printer driver's
    /// DEFAULT form rather than the paper profile's dimensions. When the
    /// driver's default form differs from the requested 100x50mm page, the
    /// Windows print pipeline scales the page to fit the form's printable
    /// area — a ~2.5% shrink that makes a configured 20mm QR print at
    /// ~19.5mm. MediaSize=Custom forces the driver to use PageWidth/PageHeight
    /// exactly, so CSS mm maps 1:1 to physical mm and no fit-to-page scaling
    /// is applied. (ScaleFactor=1.0 alone only disables Chromium's own
    /// scaling; it cannot stop the driver substituting its default form.)
    /// </summary>
    internal sealed class PrintSettingsSpec
    {
        public double PageWidthInches { get; private set; }
        public double PageHeightInches { get; private set; }
        public double MarginTopInches { get; private set; }
        public double MarginRightInches { get; private set; }
        public double MarginBottomInches { get; private set; }
        public double MarginLeftInches { get; private set; }
        public string MediaSize { get; private set; }

        public static PrintSettingsSpec FromRequest(PrintRequest request)
        {
            var geometry = PrintGeometry.FromRequest(request);
            return new PrintSettingsSpec
            {
                PageWidthInches = MmToInches(geometry.PageWidthMm),
                PageHeightInches = MmToInches(geometry.PageHeightMm),
                MarginTopInches = MmToInches(request.MarginTopMm),
                MarginRightInches = MmToInches(request.MarginRightMm),
                MarginBottomInches = MmToInches(request.MarginBottomMm),
                MarginLeftInches = MmToInches(request.MarginLeftMm),
                // The single line that fixes DEFECT-01: never let the driver
                // substitute its default media size for the profile's exact
                // page dimensions (see the class comment).
                MediaSize = "Custom",
            };
        }

        private static double MmToInches(double mm) => mm / 25.4d;
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            PrintRequest request = null;
            PrintResult result = null;

            try
            {
                if (args.Length >= 2 && string.Equals(args[0], "--request", StringComparison.OrdinalIgnoreCase))
                {
                    request = ReadJson<PrintRequest>(args[1]);
                    Validate(request, requireResultPaths: true);

                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);

                    using (var form = new PrintForm(request))
                    {
                        Application.Run(form);
                        result = form.Result ?? new PrintResult
                        {
                            Success = false,
                            Status = "OtherError",
                            Message = "WebView2 print window closed without a result",
                            Phase = "Unknown"
                        };
                    }

                    if (request != null && !string.IsNullOrWhiteSpace(request.ResultPath))
                    {
                        try { WriteJson(request.ResultPath, result); }
                        catch { /* The process exit code still communicates failure. */ }
                    }

                    return result.Success ? 0 : 2;
                }

                if (args.Length >= 2 && string.Equals(args[0], "--serve", StringComparison.OrdinalIgnoreCase))
                {
                    // Persistent mode: one process, ONE WebView2 environment,
                    // many sequential print requests. The adapter keeps a
                    // serve-mode helper alive per printer so the WebView2 cold
                    // start (~1-2s per job) is paid once instead of per job —
                    // this is the DEFECT-05 dispatch-performance fix for HTML.
                    var serveDir = Path.GetFullPath(args[1]);
                    var idleMs = 120_000;
                    for (int i = 2; i + 1 < args.Length; i += 2)
                    {
                        if (string.Equals(args[i], "--idle-ms", StringComparison.OrdinalIgnoreCase))
                        {
                            int parsed;
                            if (int.TryParse(args[i + 1], out parsed) && parsed > 0)
                            {
                                idleMs = parsed;
                            }
                        }
                    }
                    if (!Directory.Exists(serveDir))
                    {
                        throw new ArgumentException("serve directory does not exist: " + serveDir);
                    }

                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);

                    using (var form = new ServeForm(serveDir, TimeSpan.FromMilliseconds(idleMs)))
                    {
                        Application.Run(form);
                    }
                    return 0;
                }

                throw new ArgumentException("Usage: printops-html-print.exe --request <request.json> | --serve <dir> [--idle-ms <ms>]");
            }
            catch (Exception ex)
            {
                // One-shot mode reports failures through the result file AND
                // the exit code. Serve mode reports per-request through the
                // result files it writes; a startup failure here still must
                // not vanish silently, so it is written to stderr.
                Console.Error.WriteLine("PrintOps.HtmlPrint: " + ex.GetBaseException().Message);
                if (result == null)
                {
                    result = new PrintResult
                    {
                        Success = false,
                        Status = "HelperError",
                        Message = ex.GetBaseException().Message,
                        Phase = "Startup"
                    };
                }
            }

            if (request != null && !string.IsNullOrWhiteSpace(request.ResultPath))
            {
                try { WriteJson(request.ResultPath, result); }
                catch { /* The process exit code still communicates failure. */ }
            }

            return result != null && result.Success ? 0 : 2;
        }

        internal static void Validate(PrintRequest request, bool requireResultPaths)
        {
            if (request == null) throw new ArgumentException("Request is empty");
            if (string.IsNullOrWhiteSpace(request.FilePath) || !File.Exists(request.FilePath))
                throw new FileNotFoundException("HTML document was not found", request.FilePath);
            if (string.IsNullOrWhiteSpace(request.PrinterName))
                throw new ArgumentException("printerName is required");
            if (requireResultPaths)
            {
                if (string.IsNullOrWhiteSpace(request.ResultPath))
                    throw new ArgumentException("resultPath is required");
                if (string.IsNullOrWhiteSpace(request.UserDataFolder))
                    throw new ArgumentException("userDataFolder is required");
            }
            if (request.Copies < 1 || request.Copies > 999)
                throw new ArgumentOutOfRangeException("copies", "copies must be between 1 and 999");
            PrintGeometry.FromRequest(request);
            var orientation = (request.Orientation ?? string.Empty).Trim().ToLowerInvariant();
            if (orientation != "portrait" && orientation != "landscape")
                throw new ArgumentException("orientation must be either 'portrait' or 'landscape'");
        }

        internal static T ReadJson<T>(string path)
        {
            using (var stream = File.OpenRead(path))
            {
                return (T)new DataContractJsonSerializer(typeof(T)).ReadObject(stream);
            }
        }

        internal static void WriteJson<T>(string path, T value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path)));
            using (var stream = File.Create(path))
            {
                new DataContractJsonSerializer(typeof(T)).WriteObject(stream, value);
            }
        }
    }

    /// <summary>
    /// Owns the hidden form + WebView2 control and runs the document through
    /// navigation -> preparation -> PrintAsync. A single instance is reused
    /// for every request in serve mode, so WebView2 initialises exactly once
    /// per helper process instead of once per print job.
    /// </summary>
    internal sealed class WebView2PrintSession
    {
        private readonly WebView2 webView;
        private string currentPhase = "Initializing";

        public string Phase { get { return currentPhase; } }

        public WebView2PrintSession()
        {
            webView = new WebView2 { Dock = DockStyle.Fill };
        }

        // The host form owns the top-level window; this is just the WebView2
        // control so the host can Dock it directly. Hosting a nested Form
        // throws "Top-level control cannot be added to a control".
        public Control Control { get { return webView; } }

        public async Task InitializeAsync(string userDataFolder)
        {
            Directory.CreateDirectory(userDataFolder);
            var environment = await WithTimeout(
                CoreWebView2Environment.CreateAsync(null, userDataFolder),
                TimeSpan.FromSeconds(20),
                "Timed out while starting Microsoft WebView2");

            await WithTimeout(
                webView.EnsureCoreWebView2Async(environment),
                TimeSpan.FromSeconds(20),
                "Timed out while initializing Microsoft WebView2");
        }

        public async Task<PrintResult> RunAsync(PrintRequest request)
        {
            currentPhase = "Navigating";
            var navigation = new TaskCompletionSource<bool>();
            webView.CoreWebView2.NavigationCompleted += (s, e) =>
            {
                if (e.IsSuccess) navigation.TrySetResult(true);
                else navigation.TrySetException(new InvalidOperationException("HTML navigation failed: " + e.WebErrorStatus));
            };

            webView.CoreWebView2.Navigate(new Uri(Path.GetFullPath(request.FilePath)).AbsoluteUri);
            await WithTimeout(navigation.Task, TimeSpan.FromSeconds(20), "Timed out while loading HTML");

            currentPhase = "Preparing";
            var geometry = PrintGeometry.FromRequest(request);
            var css = BuildPageCss(geometry);
            var script = "(async()=>{" +
                "document.title=" + JsString(string.IsNullOrWhiteSpace(request.JobName) ? "PrintOps" : request.JobName) + ";" +
                "const s=document.createElement('style');s.textContent=" + JsString(css) + ";document.head.appendChild(s);" +
                "const root=document.createElement('div');root.id='printops-print-root';" +
                "while(document.body.firstChild){root.appendChild(document.body.firstChild);}" +
                "document.body.appendChild(root);" +
                "if(document.fonts&&document.fonts.ready){await document.fonts.ready;}" +
                "const imgs=Array.from(document.images||[]);await Promise.all(imgs.filter(i=>!i.complete).map(i=>new Promise(r=>{i.onload=r;i.onerror=r;})));" +
                "if(root.querySelectorAll('[data-printops-page]').length>1){document.documentElement.classList.add('printops-multipage');}" +
                "return true;})()";
            await WithTimeout(
                webView.CoreWebView2.ExecuteScriptAsync(script),
                TimeSpan.FromSeconds(20),
                "Timed out while preparing HTML for print");

            currentPhase = "Submitting";
            var settings = webView.CoreWebView2.Environment.CreatePrintSettings();
            var spec = PrintSettingsSpec.FromRequest(request);
            settings.PrinterName = request.PrinterName;
            settings.Copies = request.Copies;
            settings.ShouldPrintBackgrounds = true;
            settings.ShouldPrintHeaderAndFooter = false;
            settings.PageWidth = spec.PageWidthInches;
            settings.PageHeight = spec.PageHeightInches;
            // DEFECT-01: MediaSize must be Custom so the driver uses the
            // profile's exact PageWidth/PageHeight instead of its default
            // form. With the default media size, a driver whose default
            // form differs from the requested page scales the content to
            // fit (a ~2.5% shrink measured as a 20mm QR printing ~19.5mm).
            settings.MediaSize = spec.MediaSize == "Custom"
                ? CoreWebView2PrintMediaSize.Custom
                : CoreWebView2PrintMediaSize.Default;
            // Never inherit a driver/browser "fit to printable area"
            // shrink factor. CSS mm is already the final physical unit and
            // the printable box has already been calculated above.
            settings.ScaleFactor = 1.0;
            settings.MarginTop = spec.MarginTopInches;
            settings.MarginRight = spec.MarginRightInches;
            settings.MarginBottom = spec.MarginBottomInches;
            settings.MarginLeft = spec.MarginLeftInches;
            settings.Orientation = ParseOrientation(request.Orientation);
            settings.Duplex = ParseDuplex(request.Duplex);
            settings.ColorMode = ParseColorMode(request.ColorMode);

            var status = await WithTimeout(
                webView.CoreWebView2.PrintAsync(settings),
                TimeSpan.FromSeconds(30),
                "Timed out while submitting the document to Windows");

            currentPhase = "Completed";
            return new PrintResult
            {
                Success = status == CoreWebView2PrintStatus.Succeeded,
                Status = status.ToString(),
                Message = status == CoreWebView2PrintStatus.Succeeded
                    ? "WebView2 submitted the document to the selected printer"
                    : "WebView2 rejected the print request: " + status,
                Phase = currentPhase
            };
        }

        internal static string BuildPageCss(PrintGeometry geometry)
        {
            // WebView2 PrintSettings owns the physical margins. Keeping @page at
            // zero prevents CSS from applying the same margins a second time.
            // The fixed, clipped root is the one-page printable content box; it
            // also contains legacy templates whose outer element is paper-sized.
            return string.Format(
                System.Globalization.CultureInfo.InvariantCulture,
                "@page{{size:{0}mm {1}mm;margin:0;}}" +
                "html,body{{margin:0!important;padding:0!important;width:{2}mm!important;height:{3}mm!important;" +
                "min-width:0!important;min-height:0!important;max-width:{2}mm!important;max-height:{3}mm!important;" +
                "overflow:hidden!important;background:white;box-sizing:border-box!important;}}" +
                "#printops-print-root{{position:relative!important;display:block!important;margin:0!important;padding:0!important;" +
                "width:{2}mm!important;height:{3}mm!important;min-width:0!important;min-height:0!important;" +
                "max-width:{2}mm!important;max-height:{3}mm!important;overflow:hidden!important;box-sizing:border-box!important;" +
                "break-inside:avoid!important;page-break-inside:avoid!important;}}" +
                "html.printops-multipage,html.printops-multipage body{{height:auto!important;max-height:none!important;overflow:visible!important;}}" +
                "html.printops-multipage #printops-print-root{{height:auto!important;max-height:none!important;overflow:visible!important;" +
                "break-inside:auto!important;page-break-inside:auto!important;}}" +
                "html.printops-multipage [data-printops-page]{{width:{2}mm!important;height:{3}mm!important;margin:0!important;padding:0!important;" +
                "overflow:hidden!important;box-sizing:border-box!important;break-inside:avoid!important;page-break-inside:avoid!important;}}" +
                "html.printops-multipage [data-printops-page]:not(:last-child){{break-after:page!important;page-break-after:always!important;}}",
                geometry.PageWidthMm,
                geometry.PageHeightMm,
                geometry.PrintableWidthMm,
                geometry.PrintableHeightMm);
        }

        private static string JsString(string value)
        {
            if (value == null) return "null";
            var sb = new StringBuilder(value.Length + 2).Append('"');
            foreach (var ch in value)
            {
                switch (ch)
                {
                    case '\\': sb.Append("\\\\"); break;
                    case '"': sb.Append("\\\""); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (ch < 32) sb.Append("\\u").Append(((int)ch).ToString("x4"));
                        else sb.Append(ch);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }

        private static CoreWebView2PrintOrientation ParseOrientation(string raw)
        {
            switch ((raw ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "portrait": return CoreWebView2PrintOrientation.Portrait;
                case "landscape": return CoreWebView2PrintOrientation.Landscape;
                default: throw new ArgumentException("orientation must be either 'portrait' or 'landscape'");
            }
        }

        private static CoreWebView2PrintDuplex ParseDuplex(string raw)
        {
            switch ((raw ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "long-edge": return CoreWebView2PrintDuplex.TwoSidedLongEdge;
                case "short-edge": return CoreWebView2PrintDuplex.TwoSidedShortEdge;
                case "one-sided": return CoreWebView2PrintDuplex.OneSided;
                default: return CoreWebView2PrintDuplex.Default;
            }
        }

        private static CoreWebView2PrintColorMode ParseColorMode(string raw)
        {
            switch ((raw ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "color": return CoreWebView2PrintColorMode.Color;
                case "monochrome": return CoreWebView2PrintColorMode.Grayscale;
                default: return CoreWebView2PrintColorMode.Default;
            }
        }

        private static async Task<T> WithTimeout<T>(Task<T> task, TimeSpan timeout, string message)
        {
            var completed = await Task.WhenAny(task, Task.Delay(timeout));
            if (completed != task) throw new TimeoutException(message);
            return await task;
        }

        private static async Task WithTimeout(Task task, TimeSpan timeout, string message)
        {
            var completed = await Task.WhenAny(task, Task.Delay(timeout));
            if (completed != task) throw new TimeoutException(message);
            await task;
        }
    }

    /// <summary>One-shot mode: print a single request and close.</summary>
    internal sealed class PrintForm : Form
    {
        private readonly PrintRequest request;
        private readonly WebView2PrintSession session;

        public PrintResult Result { get; private set; }

        public PrintForm(PrintRequest request)
        {
            this.request = request;
            session = new WebView2PrintSession();
            Text = "PrintOps HTML Print";
            ShowInTaskbar = false;
            FormBorderStyle = FormBorderStyle.FixedToolWindow;
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-32000, -32000);
            ClientSize = new Size(1200, 1200);
            Controls.Add(session.Control);
            Shown += OnShown;
        }

        private async void OnShown(object sender, EventArgs args)
        {
            try
            {
                await session.InitializeAsync(request.UserDataFolder);
                Result = await session.RunAsync(request);
            }
            catch (Exception ex)
            {
                Result = new PrintResult
                {
                    Success = false,
                    Status = "HelperError",
                    Message = ex.GetBaseException().Message,
                    Phase = session.Phase
                };
            }
            finally
            {
                BeginInvoke(new Action(Close));
            }
        }
    }

    /// <summary>
    /// Pure file-protocol helpers for serve mode, unit-testable without a
    /// message pump or WebView2.
    ///
    /// Contract with the adapter:
    ///   <dir>/request-<id>.json  ->  <dir>/result-<id>.json
    /// Requests are consumed oldest-first (ordinal filename order) so the
    /// adapter can submit several without waiting, and results stay 1:1 with
    /// their requests by id.
    /// </summary>
    internal static class ServeProtocol
    {
        public const string RequestPrefix = "request-";
        public const string ResultPrefix = "result-";

        public static string RequestIdFromPath(string path)
        {
            var name = Path.GetFileName(path);
            if (name.StartsWith(RequestPrefix, StringComparison.OrdinalIgnoreCase))
            {
                name = name.Substring(RequestPrefix.Length);
            }
            if (name.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            {
                name = name.Substring(0, name.Length - ".json".Length);
            }
            return name;
        }

        public static string ResultPathFor(string dir, string id)
        {
            return Path.Combine(dir, ResultPrefix + id + ".json");
        }

        public static string FindNextRequest(string dir)
        {
            try
            {
                return Directory.GetFiles(dir, RequestPrefix + "*.json")
                    .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
                    .FirstOrDefault();
            }
            catch
            {
                return null;
            }
        }
    }

    /// <summary>
    /// Serve mode: one WebView2 environment, many sequential requests.
    ///
    /// Protocol (file-based, so the adapter needs nothing but the filesystem):
    ///   <dir>/request-<id>.json   written by the adapter for each job
    ///   <dir>/result-<id>.json    written by this helper when the job finishes
    ///                             (success or failure — the caller must never
    ///                             wait forever because a job failed)
    ///   <dir>/webview2-data/      persistent WebView2 user data folder
    ///
    /// Requests are processed strictly one at a time, oldest first. This
    /// preserves per-printer FIFO ordering: the adapter keeps one serve-mode
    /// helper per printer, and the adapter's own per-printer lock already
    /// serialises submissions, so at most one request is ever outstanding.
    ///
    /// The helper exits on its own after `idleTimeout` without a request, so a
    /// crashed parent never leaves an orphan behind for long.
    /// </summary>
    internal sealed class ServeForm : Form
    {
        private readonly string dir;
        private readonly TimeSpan idleTimeout;
        private readonly WebView2PrintSession session;
        private readonly Timer poll;
        private DateTime lastActivity;
        private bool processing;
        private bool initialized;

        public ServeForm(string dir, TimeSpan idleTimeout)
        {
            this.dir = dir;
            this.idleTimeout = idleTimeout;
            session = new WebView2PrintSession();

            Text = "PrintOps HTML Print (serve)";
            ShowInTaskbar = false;
            FormBorderStyle = FormBorderStyle.FixedToolWindow;
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-32000, -32000);
            ClientSize = new Size(1200, 1200);
            Controls.Add(session.Control);

            poll = new Timer { Interval = 100 };
            poll.Tick += OnPoll;
            Shown += OnShown;
        }

        private async void OnShown(object sender, EventArgs args)
        {
            try
            {
                await session.InitializeAsync(Path.Combine(dir, "webview2-data"));
                initialized = true;
                lastActivity = DateTime.UtcNow;
                poll.Start();
            }
            catch (Exception ex)
            {
                // Cannot serve at all — fail loudly so the adapter notices the
                // missing results instead of silently queueing work.
                Console.Error.WriteLine("PrintOps.HtmlPrint serve startup failed: " + ex.GetBaseException().Message);
                Application.Exit();
            }
        }

        private void OnPoll(object sender, EventArgs e)
        {
            if (!initialized || processing) return;

            if (DateTime.UtcNow - lastActivity > idleTimeout)
            {
                Application.Exit();
                return;
            }

            var next = ServeProtocol.FindNextRequest(dir);
            if (next == null) return;

            processing = true;
            lastActivity = DateTime.UtcNow;
            _ = ProcessAsync(next);
        }

        private async Task ProcessAsync(string requestPath)
        {
            var id = ServeProtocol.RequestIdFromPath(requestPath);
            var resultPath = ServeProtocol.ResultPathFor(dir, id);
            try
            {
                var request = Program.ReadJson<PrintRequest>(requestPath);
                ValidateServe(request);
                var result = await session.RunAsync(request);
                Program.WriteJson(resultPath, result);
            }
            catch (Exception ex)
            {
                // A failed print must still produce a result file or the
                // adapter's PowerShell wrapper waits out its full timeout.
                try
                {
                    Program.WriteJson(resultPath, new PrintResult
                    {
                        Success = false,
                        Status = "HelperError",
                        Message = ex.GetBaseException().Message,
                        Phase = session.Phase
                    });
                }
                catch { /* nothing else to do — caller will time out */ }
            }
            finally
            {
                try { File.Delete(requestPath); } catch { }
                processing = false;
                lastActivity = DateTime.UtcNow;
            }
        }

        private static void ValidateServe(PrintRequest request)
        {
            Program.Validate(request, requireResultPaths: false);
        }
    }
}
