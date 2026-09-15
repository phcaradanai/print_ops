using System;
using System.IO;
using Xunit;
using PrintOps.HtmlPrint;

namespace PrintOps.HtmlPrint.Tests
{
    /// <summary>
    /// Tests for the serve-mode file protocol (DEFECT-05 performance fix):
    /// the persistent helper consumes request-&lt;id&gt;.json and writes
    /// result-&lt;id&gt;.json, oldest first, so the adapter can reuse one
    /// WebView2 process across many jobs without races or reordering.
    /// </summary>
    public class ServeProtocolTests : IDisposable
    {
        private readonly string dir;

        public ServeProtocolTests()
        {
            dir = Path.Combine(Path.GetTempPath(), "printops-serve-test-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
        }

        public void Dispose()
        {
            try { Directory.Delete(dir, recursive: true); } catch { }
        }

        [Fact]
        public void RequestIdFromPath_StripsPrefixAndExtension()
        {
            Assert.Equal("job-123", ServeProtocol.RequestIdFromPath(Path.Combine(dir, "request-job-123.json")));
            Assert.Equal("JOB_42", ServeProtocol.RequestIdFromPath("request-JOB_42.json"));
        }

        [Fact]
        public void ResultPathFor_KeepsTheRequestId()
        {
            Assert.Equal(Path.Combine(dir, "result-job-123.json"), ServeProtocol.ResultPathFor(dir, "job-123"));
        }

        [Fact]
        public void FindNextRequest_PicksTheOldestInOrdinalOrder()
        {
            File.WriteAllText(Path.Combine(dir, "request-b.json"), "{}");
            File.WriteAllText(Path.Combine(dir, "request-a.json"), "{}");
            File.WriteAllText(Path.Combine(dir, "request-c.json"), "{}");

            var next = ServeProtocol.FindNextRequest(dir);
            Assert.Equal(Path.Combine(dir, "request-a.json"), next);
        }

        [Fact]
        public void FindNextRequest_IgnoresResultFiles()
        {
            File.WriteAllText(Path.Combine(dir, "result-a.json"), "{}");
            Assert.Null(ServeProtocol.FindNextRequest(dir));

            File.WriteAllText(Path.Combine(dir, "request-a.json"), "{}");
            Assert.Equal(Path.Combine(dir, "request-a.json"), ServeProtocol.FindNextRequest(dir));
        }

        [Fact]
        public void FindNextRequest_ReturnsNullForMissingDirectory()
        {
            Assert.Null(ServeProtocol.FindNextRequest(Path.Combine(dir, "does-not-exist")));
        }
    }
}
