using System;
using Xunit;
using PrintOps.HtmlPrint;

namespace PrintOps.HtmlPrint.Tests
{
    /// <summary>
    /// Regression tests for DEFECT-01: the printed QR was ~0.5mm smaller than
    /// configured because the helper left CoreWebView2PrintSettings.MediaSize
    /// at its default, so the driver substituted its default form for the
    /// paper profile's exact page size and scaled the content to fit.
    ///
    /// These tests pin the request -> settings mapping (pure data, no WebView2
    /// required): the driver MUST be told the media size is Custom and the
    /// page MUST be the profile's exact millimetre dimensions.
    /// </summary>
    public class PrintSettingsSpecTests
    {
        private static PrintRequest MakeRequest(double widthMm = 100, double heightMm = 50)
        {
            return new PrintRequest
            {
                FilePath = @"C:\tmp\document.html",
                PrinterName = "EPSON4F6A3C (L15160 Series)",
                ResultPath = @"C:\tmp\result.json",
                UserDataFolder = @"C:\tmp\webview2-data",
                JobName = "PrintOps:job-1",
                Copies = 1,
                PaperWidthMm = widthMm,
                PaperHeightMm = heightMm,
                MarginTopMm = 2,
                MarginRightMm = 2,
                MarginBottomMm = 2,
                MarginLeftMm = 2,
                Orientation = "portrait",
                Duplex = "one-sided",
                ColorMode = "auto",
            };
        }

        [Fact]
        public void MediaSizeIsCustom_NeverLetsDriverSubstituteItsDefaultForm()
        {
            // The whole point of DEFECT-01: MediaSize must be Custom so
            // PageWidth/PageHeight reach the driver unchanged.
            var spec = PrintSettingsSpec.FromRequest(MakeRequest());
            Assert.Equal("Custom", spec.MediaSize);
        }

        [Fact]
        public void PageSizeIsTheExactProfileMillimetres_ConvertedToInches()
        {
            var spec = PrintSettingsSpec.FromRequest(MakeRequest(widthMm: 100, heightMm: 50));
            Assert.Equal(100d / 25.4d, spec.PageWidthInches, 6);
            Assert.Equal(50d / 25.4d, spec.PageHeightInches, 6);
        }

        [Fact]
        public void MarginsConvertToInches_AndPrintableBoxIsPaperMinusMargins()
        {
            var spec = PrintSettingsSpec.FromRequest(MakeRequest());
            Assert.Equal(2d / 25.4d, spec.MarginTopInches, 6);
            Assert.Equal(2d / 25.4d, spec.MarginLeftInches, 6);

            var geometry = PrintGeometry.FromRequest(MakeRequest());
            Assert.Equal(96, geometry.PrintableWidthMm, 6);
            Assert.Equal(46, geometry.PrintableHeightMm, 6);
        }

        [Fact]
        public void TwentyMillimetreQrAtOneToOne_IsNotScaled()
        {
            // 20mm at 203 DPI is 160 dots. A driver-side fit-to-printable
            // scale of ~0.975 (the measured symptom) prints it at ~19.5mm.
            // With MediaSize=Custom + ScaleFactor=1.0 the pipeline must not
            // apply any scale; this test documents the invariant the CSS
            // layout already satisfies (img box in exact mm).
            var geometry = PrintGeometry.FromRequest(MakeRequest());
            var css = WebView2PrintSession.BuildPageCss(geometry);
            // The print root is exactly the printable box; content inside it
            // is laid out in CSS mm which map 1:1 once the driver uses the
            // requested page size.
            Assert.Contains("@page{size:100mm 50mm;margin:0;}", css);
            Assert.Contains("width:96mm!important;height:46mm!important;", css);
        }

        [Fact]
        public void MultipageLabels_ReleaseTheSinglePageClipAndBreakAtEveryLabel()
        {
            var geometry = PrintGeometry.FromRequest(MakeRequest());
            var css = WebView2PrintSession.BuildPageCss(geometry);

            Assert.Contains("html.printops-multipage #printops-print-root", css);
            Assert.Contains("height:auto!important;max-height:none!important;overflow:visible!important;", css);
            Assert.Contains("[data-printops-page]:not(:last-child)", css);
            Assert.Contains("break-after:page!important;page-break-after:always!important;", css);
        }
    }
}
