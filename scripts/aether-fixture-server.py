"""Small HTTP byte-range origin for a generated CI media fixture."""
import http.server
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
port = int(sys.argv[2])


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    def serve(self, send_body):
        if self.path not in {"/fixture.mkv", "/fixture-hdr.mkv", "/fixture-vp9.mkv", "/fixture-long.mkv"}:
            self.send_error(404)
            return
        path = root / self.path.removeprefix("/")
        size = path.stat().st_size
        start, end = 0, size - 1
        status = 200
        if header := self.headers.get("Range"):
            match = re.fullmatch(r"bytes=(\d+)-(\d*)", header)
            if not match:
                self.send_error(416)
                return
            start = int(match[1])
            end = min(end, int(match[2])) if match[2] else end
            if start > end:
                self.send_error(416)
                return
            status = 206
        self.send_response(status)
        self.send_header("Content-Type", "video/x-matroska")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if send_body:
            with path.open("rb") as source:
                source.seek(start)
                remaining = end - start + 1
                while remaining:
                    chunk = source.read(min(65536, remaining))
                    try:
                        self.wfile.write(chunk)
                    except (BrokenPipeError, ConnectionResetError):
                        break
                    remaining -= len(chunk)

    def do_HEAD(self):
        self.serve(False)

    def do_GET(self):
        self.serve(True)


http.server.ThreadingHTTPServer(("127.0.0.1", port), FixtureHandler).serve_forever()
