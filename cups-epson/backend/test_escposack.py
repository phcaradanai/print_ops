"""Tests for the escposack CUPS backend against a fake ESC/POS printer.

Run: python3 -I cups-epson/backend/test_escposack.py
"""

import importlib.machinery
import importlib.util
import io
import os
import socket
import sys
import threading
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
_loader = importlib.machinery.SourceFileLoader("escposack", os.path.join(HERE, "escposack"))
_spec = importlib.util.spec_from_loader("escposack", _loader)
backend = importlib.util.module_from_spec(_spec)
_loader.exec_module(backend)

REQUEST_PREFIX = b"\x1d\x28\x48\x06\x00\x30\x30"


class FakePrinter:
    """Accepts one connection and answers process-ID requests per `reply`."""

    def __init__(self, reply):
        self.reply = reply
        self.received = b""
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(1)
        self.port = self.server.getsockname()[1]
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        conn, _ = self.server.accept()
        with conn:
            conn.settimeout(3)
            try:
                while True:
                    data = conn.recv(4096)
                    if not data:
                        return
                    self.received += data
                    at = self.received.find(REQUEST_PREFIX)
                    if at >= 0 and len(self.received) >= at + len(REQUEST_PREFIX) + 4:
                        pid = self.received[at + len(REQUEST_PREFIX):at + len(REQUEST_PREFIX) + 4]
                        for part in self.reply(pid):
                            conn.sendall(part)
                        if self.reply is not None:
                            # Keep the connection open until the backend closes it.
                            while conn.recv(4096):
                                pass
                            return
            except OSError:
                return

    def close(self):
        self.server.close()
        self.thread.join(timeout=3)


def run_backend(port, job_id="17", copies="1", data=b"label", file=None, query="ack-timeout=1"):
    os.environ["DEVICE_URI"] = f"escposack://127.0.0.1:{port}/?{query}"
    argv = ["escposack", job_id, "printops", "PrintOps:job", copies, ""]
    if file:
        argv.append(file)
    stdin, stderr = sys.stdin, sys.stderr
    sys.stdin = io.TextIOWrapper(io.BytesIO(data))
    sys.stderr = io.StringIO()
    try:
        code = backend.main(argv)
        return code, sys.stderr.getvalue()
    finally:
        sys.stdin, sys.stderr = stdin, stderr


class EscposAckBackendTest(unittest.TestCase):
    def test_succeeds_only_after_the_printer_echoes_this_job_process_id(self):
        printer = FakePrinter(lambda pid: [b"\x14\x00\x00\x0f", b"\x37\x22" + pid + b"\x00"])
        code, log = run_backend(printer.port, job_id="10017")
        printer.close()
        self.assertEqual(code, backend.CUPS_BACKEND_OK)
        self.assertEqual(printer.received, b"label" + REQUEST_PREFIX + b"0017")
        self.assertIn("acknowledged process ID 0017", log)

    def test_accepts_a_response_split_across_packets(self):
        printer = FakePrinter(lambda pid: [b"\x37", b"\x22" + pid[:2], pid[2:] + b"\x00"])
        code, _ = run_backend(printer.port)
        printer.close()
        self.assertEqual(code, backend.CUPS_BACKEND_OK)

    def test_another_jobs_acknowledgement_does_not_confirm_this_job(self):
        printer = FakePrinter(lambda pid: [b"\x37\x22" + b"9999" + b"\x00"])
        code, log = run_backend(printer.port, job_id="17")
        printer.close()
        self.assertEqual(code, backend.CUPS_BACKEND_CANCEL)
        self.assertIn("unverified", log)

    def test_silence_after_sending_cancels_without_retry(self):
        printer = FakePrinter(lambda pid: [])
        code, log = run_backend(printer.port)
        printer.close()
        self.assertEqual(code, backend.CUPS_BACKEND_CANCEL)
        self.assertIn("No printer acknowledgement", log)

    def test_unreachable_printer_sends_nothing_and_cancels(self):
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()
        code, log = run_backend(port, query="connect-timeout=0.5")
        self.assertEqual(code, backend.CUPS_BACKEND_CANCEL)
        self.assertIn("nothing was sent", log)

    def test_file_argument_is_sent_once_per_copy_before_one_acknowledgement(self):
        path = os.path.join(HERE, "test-escposack-doc.bin")
        with open(path, "wb") as handle:
            handle.write(b"AB")
        try:
            printer = FakePrinter(lambda pid: [b"\x37\x22" + pid + b"\x00"])
            code, _ = run_backend(printer.port, copies="3", file=path)
            printer.close()
        finally:
            os.remove(path)
        self.assertEqual(code, backend.CUPS_BACKEND_OK)
        self.assertEqual(printer.received, b"ABABAB" + REQUEST_PREFIX + b"0017")

    def test_discovery_lists_the_scheme(self):
        stdout = sys.stdout
        sys.stdout = io.StringIO()
        try:
            self.assertEqual(backend.main(["escposack"]), backend.CUPS_BACKEND_OK)
            self.assertIn("network escposack", sys.stdout.getvalue())
        finally:
            sys.stdout = stdout


if __name__ == "__main__":
    unittest.main()
