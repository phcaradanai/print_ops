using System;
using System.Drawing;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PrintOps.HtmlPrint
{
    [DataContract]
    internal sealed class PrintRequest
    {
        [DataMember(Name = "filePath", IsRequired = true)] public string FilePath { get; set; }
        [DataMember(Name = "printerName", IsRequired = true)] public string PrinterName { get; set; }
        [DataMember(Name = "resultPath", IsRequired = true)] public string ResultPath { get; set; }
        [DataMember(Name = "userDataFolder", IsRequired = true)] public string UserDataFolder { get; set; }
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

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            PrintRequest request = null;
            PrintResult result;

            try
            {
                if (args.Length != 2 || !string.Equals(args[0], "--request", StringComparison.OrdinalIgnoreCase))
                {
                    throw new ArgumentException("Usage: printops-html-print.exe --request <request.json>");
                }

                request = ReadJson<PrintRequest>(args[1]);
                Validate(request);

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
            }
            catch (Exception ex)
            {
                result = new PrintResult
                {
                    Success = false,
                    Status = "HelperError",
                    Message = ex.GetBaseException().Message,
                    Phase = "Startup"
                };
            }

            if (request != null && !string.IsNullOrWhiteSpace(request.ResultPath))
            {
                try { WriteJson(request.ResultPath, result); }
                catch { /* The process exit code still communicates failure. */ }
            }

            return result.Success ? 0 : 2;
        }

        private static void Validate(PrintRequest request)
        {
            if (request == null) throw new ArgumentException("Request is empty");
            if (string.IsNullOrWhiteSpace(request.FilePath) || !File.Exists(request.FilePath))
                throw new FileNotFoundException("HTML document was not found", request.FilePath);
            if (string.IsNullOrWhiteSpace(request.PrinterName))
                throw new ArgumentException("printerName is required");
            if (string.IsNullOrWhiteSpace(request.ResultPath))
                throw new ArgumentException("resultPath is required");
            if (string.IsNullOrWhiteSpace(request.UserDataFolder))
                throw new ArgumentException("userDataFolder is required");
            if (request.Copies < 1 || request.Copies > 999)
                throw new ArgumentOutOfRangeException("copies", "copies must be between 1 and 999");
            PrintGeometry.FromRequest(request);
            var orientation = (request.Orientation ?? string.Empty).Trim().ToLowerInvariant();
            if (orientation != "portrait" && orientation != "landscape")
                throw new ArgumentException("orientation must be either 'portrait' or 'landscape'");
        }

        private static T ReadJson<T>(string path)
        {
            using (var stream = File.OpenRead(path))
            {
                return (T)new DataContractJsonSerializer(typeof(T)).ReadObject(stream);
            }
        }

        private static void WriteJson<T>(string path, T value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path)));
            using (var stream = File.Create(path))
            {
                new DataContractJsonSerializer(typeof(T)).WriteObject(stream, value);
            }
        }
    }

    internal sealed class PrintForm : Form
    {
        private readonly PrintRequest request;
        private readonly WebView2 webView;
        private string currentPhase = "Initializing";

        public PrintResult Result { get; private set; }

        public PrintForm(PrintRequest request)
        {
            this.request = request;
            webView = new WebView2 { Dock = DockStyle.Fill };

            Text = "PrintOps HTML Print";
            ShowInTaskbar = false;
            FormBorderStyle = FormBorderStyle.FixedToolWindow;
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-32000, -32000);
            ClientSize = new Size(1200, 1200);
            Controls.Add(webView);
            Shown += OnShown;
        }

        private async void OnShown(object sender, EventArgs args)
        {
            try
            {
                Directory.CreateDirectory(request.UserDataFolder);
                var environment = await WithTimeout(
                    CoreWebView2Environment.CreateAsync(null, request.UserDataFolder),
                    TimeSpan.FromSeconds(20),
                    "Timed out while starting Microsoft WebView2");

                await WithTimeout(
                    webView.EnsureCoreWebView2Async(environment),
                    TimeSpan.FromSeconds(20),
                    "Timed out while initializing Microsoft WebView2");

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
                    "return true;})()";
                await WithTimeout(
                    webView.CoreWebView2.ExecuteScriptAsync(script),
                    TimeSpan.FromSeconds(20),
                    "Timed out while preparing HTML for print");

                var settings = webView.CoreWebView2.Environment.CreatePrintSettings();
                settings.PrinterName = request.PrinterName;
                settings.Copies = request.Copies;
                settings.ShouldPrintBackgrounds = true;
                settings.ShouldPrintHeaderAndFooter = false;
                settings.PageWidth = MmToInches(request.PaperWidthMm);
                settings.PageHeight = MmToInches(request.PaperHeightMm);
                // Never inherit a driver/browser "fit to printable area"
                // shrink factor. CSS mm is already the final physical unit and
                // the printable box has already been calculated above.
                settings.ScaleFactor = 1.0;
                settings.MarginTop = MmToInches(request.MarginTopMm);
                settings.MarginRight = MmToInches(request.MarginRightMm);
                settings.MarginBottom = MmToInches(request.MarginBottomMm);
                settings.MarginLeft = MmToInches(request.MarginLeftMm);
                settings.Orientation = ParseOrientation(request.Orientation);
                settings.Duplex = ParseDuplex(request.Duplex);
                settings.ColorMode = ParseColorMode(request.ColorMode);

                currentPhase = "Submitting";
                var status = await WithTimeout(
                    webView.CoreWebView2.PrintAsync(settings),
                    TimeSpan.FromSeconds(30),
                    "Timed out while submitting the document to Windows");

                currentPhase = "Completed";
                Result = new PrintResult
                {
                    Success = status == CoreWebView2PrintStatus.Succeeded,
                    Status = status.ToString(),
                    Message = status == CoreWebView2PrintStatus.Succeeded
                        ? "WebView2 submitted the document to the selected printer"
                        : "WebView2 rejected the print request: " + status,
                    Phase = currentPhase
                };
            }
            catch (Exception ex)
            {
                Result = new PrintResult
                {
                    Success = false,
                    Status = "HelperError",
                    Message = ex.GetBaseException().Message,
                    Phase = currentPhase
                };
            }
            finally
            {
                BeginInvoke(new Action(Close));
            }
        }

        private static string BuildPageCss(PrintGeometry geometry)
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
                "break-inside:avoid!important;page-break-inside:avoid!important;}}",
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

        private static double MmToInches(double mm) => mm / 25.4d;

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
}
