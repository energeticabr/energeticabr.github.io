"""Private camera catalog and on-demand HLS gateway behind the Energético proxy."""

import contextlib
import json
import os
import re
import secrets
import subprocess
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


CATALOG = "/api/portal-cameras"
MEDIA = "/api/portal-camera-media"
MEDIA_FILE = re.compile(r"index\.m3u8|segment-[0-9]+\.ts")
MEDIA_ROUTE = re.compile(rf"{MEDIA}/([A-Za-z0-9_-]{{43}})/(index\.m3u8|segment-[0-9]+\.ts)")
CHANNEL_ID = re.compile(r"[a-z0-9-]{1,48}")
GRAPH_ME = "https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName,userType"


class PlaybackError(Exception):
    def __init__(self, status):
        self.status = status


def graph_identity(token):
    request = urllib.request.Request(GRAPH_ME, headers={"Authorization": "Bearer " + token})
    # Do not follow redirects to an unrelated authentication endpoint.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_args, **_kwargs):
            return None
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=8) as response:
        return json.loads(response.read(16384))


class Stream:
    def __init__(self, entry, ffmpeg, viewer):
        self.directory = tempfile.TemporaryDirectory(prefix="energetico-camera-")
        self.source = self.encoder = None
        self.channel = entry["id"]
        self.viewer = viewer
        self.last_request = time.monotonic()
        self.capability = secrets.token_urlsafe(32)
        self.expires = self.last_request + 20 * 60
        try:
            # The executable is selected by server configuration. No request
            # data can alter the argument list or the input sent to the adapter.
            self.source = subprocess.Popen(
                entry["command"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, close_fds=True,
            )
            with self.source.stdin:
                self.source.stdin.write(json.dumps(entry.get("input", {})).encode() + b"\n")
            self.encoder = subprocess.Popen(
                [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
                 "-threads", "1", "-filter_threads", "1",
                 "-fflags", "+genpts", "-analyzeduration", "1500000", "-probesize", "65536",
                 "-f", entry["format"], "-i", "pipe:0",
                 "-an", "-vf", "scale=640:-2,fps=10", "-c:v", "libx264",
                 "-preset", "ultrafast", "-threads", "1", "-pix_fmt", "yuv420p",
                 "-g", "20", "-sc_threshold", "0", "-f", "hls",
                 "-hls_time", "2", "-hls_list_size", "4",
                 "-hls_flags", "delete_segments+temp_file+independent_segments",
                 "-hls_segment_filename", "segment-%08d.ts", "index.m3u8"],
                cwd=self.directory.name, stdin=self.source.stdout, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, close_fds=True,
            )
            self.source.stdout.close()
        except BaseException:
            self.close()
            raise

    def alive(self):
        return self.source.poll() is None and self.encoder.poll() is None

    def read(self, filename):
        assert MEDIA_FILE.fullmatch(filename)
        return (Path(self.directory.name) / filename).read_bytes()

    def close(self):
        for process in (self.encoder, self.source):
            if process is None:
                continue
            with contextlib.suppress(ProcessLookupError):
                process.terminate()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        self.directory.cleanup()


class Gateway:
    def __init__(self, config, identity=graph_identity):
        self.users = {uid.casefold() for uid in config["viewers"]}
        self.origins = set(config["origins"])
        self.entries = {}
        for entry in config.get("channels", []):
            channel_id = entry["id"]
            if (not CHANNEL_ID.fullmatch(channel_id) or channel_id in self.entries
                    or entry["format"] not in {"hevc", "h264", "mpegts"}
                    or not isinstance(entry["command"], list) or not entry["command"]
                    or not os.path.isabs(entry["command"][0])):
                raise ValueError("Invalid camera configuration")
            self.entries[channel_id] = entry
        self.ffmpeg = config["ffmpeg"]
        self.identity = identity
        self.lock = threading.Lock()
        self.stream = None
        self.graph_slots = threading.BoundedSemaphore(2)

    def authorize(self, authorization):
        scheme, _, token = authorization.partition(" ")
        if scheme.casefold() != "bearer" or not token or len(token) > 10000:
            raise PlaybackError(401)
        if not self.graph_slots.acquire(blocking=False):
            raise PlaybackError(429)
        try:
            identity = self.identity(token)
        except (OSError, ValueError):
            raise PlaybackError(401) from None
        finally:
            self.graph_slots.release()
        viewer = str(identity.get("id", "")).casefold()
        if identity.get("userType") != "Member" or viewer not in self.users:
            raise PlaybackError(403)
        return viewer

    def catalog(self):
        return [{"id": entry["id"], "label": entry["label"]} for entry in self.entries.values()]

    def start(self, channel, viewer):
        if not isinstance(channel, str) or channel not in self.entries:
            raise PlaybackError(404)
        with self.lock:
            self.expire()
            if self.stream:
                if self.stream.viewer != viewer:
                    raise PlaybackError(429)
                if self.stream.channel != channel:
                    self.stream.close()
                    self.stream = None
            if not self.stream:
                try:
                    self.stream = Stream(self.entries[channel], self.ffmpeg, viewer)
                except (BrokenPipeError, OSError):
                    raise PlaybackError(503) from None
            stream = self.stream
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            with self.lock:
                if self.stream is not stream or not stream.alive():
                    raise PlaybackError(503)
                stream.last_request = time.monotonic()
                try:
                    playlist = stream.read("index.m3u8")
                except FileNotFoundError:
                    playlist = b""
                if b"#EXTINF" in playlist:
                    return f"{MEDIA}/{stream.capability}/index.m3u8"
            time.sleep(0.25)
        raise PlaybackError(503)

    def get(self, capability, filename):
        with self.lock:
            self.expire()
            stream = self.stream
            if not stream or not secrets.compare_digest(stream.capability, capability):
                raise PlaybackError(404)
            try:
                payload = stream.read(filename)
            except FileNotFoundError:
                raise PlaybackError(404) from None
            stream.last_request = time.monotonic()
            return payload

    def expire(self):
        now = time.monotonic()
        if self.stream and (now - self.stream.last_request > 12
                            or now > self.stream.expires or not self.stream.alive()):
            self.stream.close()
            self.stream = None

    def reap(self):
        while True:
            time.sleep(2)
            with self.lock:
                self.expire()


def handler_for(gateway):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, *_args):
            # The media path carries a temporary playback capability.
            return

        def send(self, status, payload=b"", mime="application/json"):
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "private, no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            origin = self.headers.get("Origin")
            if origin in gateway.origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                if self.command == "OPTIONS":
                    self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
                    self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.end_headers()
            with contextlib.suppress(BrokenPipeError, ConnectionResetError):
                self.wfile.write(payload)

        def do_OPTIONS(self):
            allowed_path = self.path == CATALOG or MEDIA_ROUTE.fullmatch(self.path)
            self.send(204 if allowed_path and self.headers.get("Origin") in gateway.origins else 403)

        def do_POST(self):
            if self.path != CATALOG:
                self.send(404)
                return
            if self.headers.get("Origin") and self.headers["Origin"] not in gateway.origins:
                self.send(403)
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 1024:
                    raise ValueError("request size")
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError("request type")
                viewer = gateway.authorize(self.headers.get("Authorization", ""))
                if data.get("action") == "list":
                    result = {"channels": gateway.catalog()}
                elif data.get("action") == "play":
                    result = {"path": gateway.start(data.get("channelId"), viewer)}
                else:
                    raise ValueError("invalid action")
                self.send(200, json.dumps(result).encode())
            except PlaybackError as error:
                self.send(error.status)
            except (ValueError, UnicodeError):
                self.send(400)

        def do_GET(self):
            route = MEDIA_ROUTE.fullmatch(self.path)
            if not route:
                self.send(404)
                return
            try:
                token, filename = route.groups()
                mime = "application/vnd.apple.mpegurl" if filename.endswith(".m3u8") else "video/mp2t"
                self.send(200, gateway.get(token, filename), mime)
            except PlaybackError as error:
                self.send(error.status)
    return Handler


if __name__ == "__main__":
    config = json.loads(Path(os.environ["ENERGETICO_CAMERA_CONFIG"]).read_text(encoding="utf-8"))
    gateway = Gateway(config)
    threading.Thread(target=gateway.reap, daemon=True).start()
    with ThreadingHTTPServer(("127.0.0.1", int(config.get("port", 8872))), handler_for(gateway)) as server:
        server.serve_forever()
