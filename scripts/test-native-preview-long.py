"""Serve a long synthetic AVC/E-AC-3 MKV with concurrent, throttled range reads."""
import http.server
import os
import pathlib
import subprocess
import sys
import threading
import time

directory = pathlib.Path(sys.argv[1]).resolve()
source = directory / "avc-stereo.mkv"
path = directory / "avc-long-webdl.mkv"
listing = directory / "concat.txt"
# Remux the same encoded segment without changing the codec or GOP structure.
# 21 minutes exercises distant seeks without encoding an entire episode.
listing.write_text("file 'avc-stereo.mkv'\n" * 42, encoding="utf-8")
subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "concat",
                "-safe", "1", "-i", str(listing), "-map", "0", "-c", "copy", str(path)], check=True)
size = path.stat().st_size
assert size > 64 * 1024 * 1024
print(f"Long fixture: {size} bytes", flush=True)
requests = []
lock = threading.Lock()


class Origin(http.server.BaseHTTPRequestHandler):
    def serve(self, body):
        if self.path != "/avc-long-webdl.mkv":
            self.send_error(404)
            return
        first, last = 0, size - 1
        header = self.headers.get("Range")
        if header:
            try:
                start, end = header.removeprefix("bytes=").split("-", 1)
                if not start:
                    first = max(0, size - int(end))
                else:
                    first = int(start)
                    last = min(last, int(end)) if end else last
                assert 0 <= first <= last < size
            except (ValueError, AssertionError):
                self.send_error(416)
                return
        self.send_response(206 if header else 200)
        self.send_header("Content-Type", "video/x-matroska")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("ETag", '"synthetic-webdl"')
        self.send_header("Content-Length", str(last - first + 1))
        if header:
            self.send_header("Content-Range", f"bytes {first}-{last}/{size}")
        self.end_headers()
        with lock:
            requests.append((first, last))
        if not body:
            return
        sent = 0
        started = time.monotonic()
        try:
            with path.open("rb") as file:
                file.seek(first)
                remaining = last - first + 1
                while remaining:
                    chunk = file.read(min(64 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    sent += len(chunk)
                    remaining -= len(chunk)
                    # Independent connections, roughly 32 Mbps each.
                    delay = sent / (4 * 1024 * 1024) - (time.monotonic() - started)
                    if delay > 0:
                        time.sleep(delay)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def do_HEAD(self):
        self.serve(False)

    def do_GET(self):
        self.serve(True)

    def log_message(self, *_args):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Origin)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
env = {**os.environ, "NAVIGATOR_TEST_PREVIEW_FILE": path.name,
       "NAVIGATOR_TEST_LONG_PREVIEW_URL": f"http://127.0.0.1:{server.server_port}/{path.name}"}
try:
    subprocess.run(["cargo", "test", "--manifest-path", "desktop/Cargo.toml", "--locked",
                    "headless_webdl_preview_formats", "--", "--ignored", "--nocapture"], env=env, check=True)
    with lock:
        assert any(start > size // 2 for start, _ in requests), "A distant preview must exercise an uncached HTTP range"
        print(f"Long fixture HTTP requests: {len(requests)}; distant ranges: "
              f"{sum(start > size // 2 for start, _ in requests)}", flush=True)
finally:
    server.shutdown()
    server.server_close()
