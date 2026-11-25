"""Private camera catalog and on-demand HLS gateway behind the Energético proxy."""

import contextlib
from datetime import date
import json
import math
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
MEDIA_FILE = re.compile(r"(?:index|h264|hevc)\.m3u8|init\.mp4|segment-[0-9]+\.(?:ts|m4s)")
MEDIA_ROUTE = re.compile(rf"{MEDIA}/([A-Za-z0-9_-]{{43}})/({MEDIA_FILE.pattern})")
CHANNEL_ID = re.compile(r"[a-z0-9-]{1,48}")
GRAPH_ME = "https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName,userType"
MAX_STREAMS = 8
MAX_STARTING_PREVIEWS = 2
MAX_STARTING_WITH_SLOW_PREVIEWS = 3
SLOW_PREVIEW_SECONDS = 12
START_TIMEOUT_SECONDS = 75
PREVIEW_STALL_SECONDS = 130
PREVIEW_REPLACEMENT_GRACE_SECONDS = 5
IDLE_SECONDS = 12
SINGLE_REOPEN_SECONDS = 45
PREVIEW_IDLE_SECONDS = 24


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
    def __init__(self, entry, ffmpeg, viewer, *, preview=False, direct=False):
        self.directory = None
        self.source = self.encoder = None
        self.entry = entry
        self.ffmpeg = ffmpeg
        self.preview = preview
        self.shared = False
        self.channel = entry["id"]
        self.viewer = viewer
        self.mode = entry.get("input", {}).get("operation", "live")
        self.direct = direct
        self.playlist = f'{entry["format"]}.m3u8' if direct else "index.m3u8"
        self.last_move = 0
        self.last_request = time.monotonic()
        self.capability = secrets.token_urlsafe(32)
        self.expires = self.last_request + 20 * 60
        self.started_at = None
        self.startup_deadline = None
        self.has_video = False
        self.last_video_at = None
        self.latest_segment = None
        if not preview:
            self.launch()

    @property
    def path(self):
        return f"{MEDIA}/{self.capability}/{self.playlist}"

    def launch(self):
        entry, ffmpeg, preview = self.entry, self.ffmpeg, self.preview
        self.directory = tempfile.TemporaryDirectory(prefix="energetico-camera-")
        now = time.monotonic()
        self.started_at = now
        self.startup_deadline = now + START_TIMEOUT_SECONDS
        self.expires = now + 20 * 60
        width, fps = (384, 6) if preview else (640, 10)
        segment_seconds = 1 if self.mode == "live" and not self.direct else 2
        probe_duration = ("500000" if self.mode == "live" and entry["format"] in {"h264", "hevc"}
                          else "1500000")
        bitrate = ["-crf", "28", "-maxrate", "320k", "-bufsize", "320k"] if preview else []
        playlist_size = str((24 if preview else 8) // segment_seconds)
        retained_segments = str((32 if preview else 2) // segment_seconds)
        if self.direct:
            # Preserve timing the demuxer knows and fill missing Annex B timestamps.
            video = ["-map", "0:v:0", "-c:v", "copy", "-bsf:v",
                     r"setts=pts=if(eq(PTS\,NOPTS)\,N*DURATION\,PTS):dts=if(eq(DTS\,NOPTS)\,N*DURATION\,DTS)"]
        else:
            video = ["-vf", f"scale={width}:-2,fps={fps}", "-c:v", "libx264",
                     "-preset", "ultrafast", "-threads", "1", "-pix_fmt", "yuv420p",
                     *bitrate, "-g", str(fps * segment_seconds), "-sc_threshold", "0"]
        fmp4 = self.direct and entry["format"] == "hevc"
        container = ["-tag:v", "hvc1", "-hls_segment_type", "fmp4",
                     "-hls_fmp4_init_filename", "init.mp4"] if fmp4 else []
        segment = "segment-%08d.m4s" if fmp4 else "segment-%08d.ts"
        try:
            # The executable is selected by server configuration. No request
            # data can alter the argument list or the input sent to the adapter.
            self.source = subprocess.Popen(
                entry["command"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, close_fds=True,
                env={**os.environ, "ENERGETICO_CAMERA_LIVE_PREVIEW": "1"} if preview else None,
            )
            self.source.stdin.write(json.dumps(entry.get("input", {})).encode() + b"\n")
            self.source.stdin.flush()
            self.encoder = subprocess.Popen(
                [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
                 "-threads", "1", "-filter_threads", "1",
                 "-fflags", "+genpts", "-analyzeduration", probe_duration, "-probesize", "65536",
                 "-f", entry["format"], "-i", "pipe:0",
                 "-an", *video, "-f", "hls", *container,
                 "-hls_time", str(segment_seconds), "-hls_list_size", playlist_size,
                 "-hls_delete_threshold", retained_segments,
                 "-hls_flags", "delete_segments+temp_file+independent_segments",
                 "-hls_segment_filename", segment, self.playlist],
                cwd=self.directory.name, stdin=self.source.stdout, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, close_fds=True,
            )
            self.source.stdout.close()
        except BaseException:
            self.close()
            raise

    def alive(self):
        if self.startup_deadline is None:
            return True
        source = self.source.poll()
        encoder = self.encoder.poll()
        return ((source is None and encoder is None) or
                (self.mode == "playback" and source in (None, 0) and encoder in (None, 0)))

    def control(self, direction):
        now = time.monotonic()
        if now - self.last_move < 0.8:
            raise PlaybackError(429)
        self.source.stdin.write(json.dumps({"move": direction}).encode() + b"\n")
        self.source.stdin.flush()
        self.last_move = now

    def read(self, filename):
        assert MEDIA_FILE.fullmatch(filename)
        if self.directory is None:
            raise FileNotFoundError(filename)
        return (Path(self.directory.name) / filename).read_bytes()

    def ready(self):
        if not self.has_video and self.startup_deadline is not None:
            try:
                self.has_video = b"#EXTINF" in self.read(self.playlist)
                if self.has_video:
                    self.last_video_at = time.monotonic()
            except FileNotFoundError:
                pass
        return self.has_video

    def stalled_preview(self, now):
        if not self.preview or self.mode != "live" or not self.has_video:
            return False
        try:
            lines = self.read(self.playlist).splitlines()
        except FileNotFoundError:
            lines = ()
        latest = next((line for line in reversed(lines) if line and not line.startswith(b"#")), None)
        if latest and latest != self.latest_segment:
            self.latest_segment = latest
            self.last_video_at = now
        return now - self.last_video_at >= PREVIEW_STALL_SECONDS

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
        if self.source and self.source.stdin:
            with contextlib.suppress(OSError):
                self.source.stdin.close()
        if self.directory is not None:
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
        self.streams = {}
        self.graph_slots = threading.BoundedSemaphore(2)
        self.query_slots = threading.BoundedSemaphore(1)
        self.query_active = False
        self.recording_tokens = {}

    def authorize(self, authorization):
        scheme, _, token = authorization.partition(" ")
        if scheme.casefold() != "bearer" or not token or len(token) > 10000:
            raise PlaybackError(401)
        if not self.graph_slots.acquire(timeout=8):
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

    def recordings(self, channel, viewer, day, hour=None):
        if not isinstance(channel, str) or channel not in self.entries:
            raise PlaybackError(404)
        try:
            if not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
                raise ValueError()
        except ValueError:
            raise PlaybackError(400) from None
        if hour is not None and (not isinstance(hour, str) or not re.fullmatch(r"0[0-9]|1[0-9]|2[0-3]", hour)):
            raise PlaybackError(400)
        if not self.query_slots.acquire(blocking=False):
            raise PlaybackError(429)
        entry = self.entries[channel]
        try:
            with self.lock:
                self.expire()
                if len(self.streams) == 2:
                    self._release_idle_single()
                if len(self.streams) > 1:
                    raise PlaybackError(429)
                self.query_active = True
            params = {**entry.get("input", {}), "operation": "recordings", "day": day}
            if hour is not None:
                params["hour"] = int(hour)
            result = subprocess.run(entry["command"], input=json.dumps(params).encode() + b"\n",
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=60)
            if result.returncode or len(result.stdout) > 262144:
                raise PlaybackError(503)
            rows = json.loads(result.stdout)
            if not isinstance(rows, list) or len(rows) > 512:
                raise PlaybackError(503)
            safe = []
            with self.lock:
                now = time.monotonic()
                self.recording_tokens = {k: v for k, v in self.recording_tokens.items() if v[0] > now}
                if len(self.recording_tokens) > 1536:
                    self.recording_tokens.clear()
                for row in rows:
                    if not isinstance(row, dict) or not all(isinstance(row.get(k), str) for k in ("start_time", "end_time", "file_name")):
                        continue
                    token = secrets.token_urlsafe(16)
                    self.recording_tokens[(viewer, channel, token)] = (now + 600, row)
                    safe.append({"id": token, "start": row["start_time"], "end": row["end_time"]})
            return safe
        except (OSError, ValueError, subprocess.TimeoutExpired):
            raise PlaybackError(503) from None
        finally:
            with self.lock:
                self.query_active = False
            self.query_slots.release()

    def recording_entry(self, channel, viewer, token):
        if not isinstance(channel, str) or not isinstance(token, str) or len(token) > 48:
            raise PlaybackError(404)
        with self.lock:
            item = self.recording_tokens.get((viewer, channel, token))
            if not item or item[0] < time.monotonic():
                raise PlaybackError(404)
            return dict(item[1])

    def move(self, channel, viewer, direction):
        if not isinstance(channel, str) or not isinstance(direction, str) or direction not in {"up", "down", "left", "right"}:
            raise PlaybackError(400)
        with self.lock:
            self.expire()
            stream = next((item for direct in (True, False)
                           if (item := self.streams.get((viewer, channel, direct)))
                           and item.mode == "live" and item.startup_deadline is not None and item.alive()), None)
            if stream is None:
                raise PlaybackError(404)
            try:
                stream.control(direction)
            except (OSError, BrokenPipeError):
                raise PlaybackError(503) from None

    def _stream_key(self, channel, viewer, codecs):
        return viewer, channel, self.entries[channel]["format"] in codecs

    def _open_stream(self, key, *, recording=None, preview=False):
        viewer, channel, direct = key
        entry = dict(self.entries[channel])
        if recording is not None:
            entry["input"] = {**entry.get("input", {}), "operation": "playback", "recording": recording}
        try:
            stream = Stream(entry, self.ffmpeg, viewer, preview=preview, direct=direct)
        except OSError:
            raise PlaybackError(503) from None
        self.streams[key] = stream
        return stream

    @staticmethod
    def _is_warm_single(stream, now):
        return (IDLE_SECONDS < now - stream.last_request <= SINGLE_REOPEN_SECONDS
                and not stream.preview and stream.mode == "live" and stream.has_video)

    def _release_idle_single(self, protected=()):
        now = time.monotonic()
        key = next((key for key, stream in self.streams.items()
                    if key not in protected and self._is_warm_single(stream, now)), None)
        if key is None:
            return False
        self.streams.pop(key).close()
        return True

    def _replace_idle_preview(self, key, path):
        viewer, channel, direct = key
        previous_key = viewer, channel, True
        previous = self.streams.get(previous_key)
        # A reused stream may be playing in another tab or device of this account.
        if (direct or not previous or previous.shared or not previous.preview
                or previous.mode != "live" or previous.path != path):
            return None
        remaining = PREVIEW_REPLACEMENT_GRACE_SECONDS - (time.monotonic() - previous.last_request)
        if remaining > 0:
            return math.ceil(remaining * 1000)
        self.streams.pop(previous_key).close()
        return 0

    def start_grid(self, channels, viewer, *, codecs=(), replace_path=None):
        if (not isinstance(channels, list) or not 1 <= len(channels) <= MAX_STREAMS
                or not all(isinstance(channel, str) and channel in self.entries for channel in channels)
                or len(set(channels)) != len(channels)):
            raise PlaybackError(400)
        with self.lock:
            self.expire()
            if self.query_active:
                raise PlaybackError(429)
            paths = {}
            prepared = []
            busy = []
            retry_after = None
            requested = {channel: self._stream_key(channel, viewer, codecs) for channel in channels}
            for channel, key in requested.items():
                stream = self.streams.get(key)
                if stream and stream.mode != "live":
                    del self.streams[key]
                    stream.close()
                    stream = None
                if stream is None:
                    if len(self.streams) >= MAX_STREAMS and not self._release_idle_single(requested.values()):
                        retry_after = (self._replace_idle_preview(key, replace_path)
                                       if len(channels) == 1 and isinstance(replace_path, str) else None)
                        if retry_after != 0:
                            busy.append(channel)
                            continue
                    try:
                        stream = self._open_stream(key, preview=True)
                    except PlaybackError:
                        continue
                else:
                    stream.shared = True
                prepared.append(stream)
                paths[channel] = stream.path
            if not prepared and busy and retry_after is None:
                raise PlaybackError(429)
            now = time.monotonic()
            for stream in prepared:
                stream.last_request = now
            result = {"paths": paths, "busy": busy}
            if retry_after:
                result["retryAfterMs"] = retry_after
            return result

    def start(self, channel, viewer, recording=None, *, codecs=()):
        if not isinstance(channel, str) or channel not in self.entries:
            raise PlaybackError(404)
        with self.lock:
            self.expire()
            key = self._stream_key(channel, viewer, codecs if recording is None else ())
            stream = self.streams.get(key)
            desired = "playback" if recording is not None else "live"
            replace = stream and (stream.mode != desired or desired == "playback")
            if self.query_active and (not stream or replace):
                raise PlaybackError(429)
            if replace:
                stream.close()
                del self.streams[key]
                stream = None
            if not stream:
                if len(self.streams) >= MAX_STREAMS and not self._release_idle_single():
                    raise PlaybackError(429)
                stream = self._open_stream(key, recording=recording)
            else:
                stream.shared = True
            if stream.startup_deadline is None:
                self._launch_preview(stream)
            stream.last_request = time.monotonic()
        deadline = time.monotonic() + START_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            with self.lock:
                if self.streams.get(key) is not stream or not stream.alive():
                    raise PlaybackError(503)
                stream.last_request = time.monotonic()
                if stream.ready():
                    return stream.path
            time.sleep(0.25)
        with self.lock:
            if self.streams.get(key) is stream:
                del self.streams[key]
                stream.close()
        raise PlaybackError(503)

    def _find_stream(self, capability):
        self.expire()
        stream = next((item for item in self.streams.values()
                       if secrets.compare_digest(item.capability, capability)), None)
        if not stream:
            raise PlaybackError(404)
        return stream

    def _launch_preview(self, stream):
        try:
            stream.launch()
        except OSError:
            del self.streams[(stream.viewer, stream.channel, stream.direct)]
            raise PlaybackError(503) from None

    def preview_ready(self, capability, playlist=None):
        with self.lock:
            stream = self._find_stream(capability)
            if playlist is not None and playlist != stream.playlist:
                raise PlaybackError(404)
            stream.last_request = time.monotonic()
            if stream.startup_deadline is None:
                now = stream.last_request
                pending = [item for item in self.streams.values()
                           if item.started_at is not None and not item.ready()]
                active = sum(now - item.started_at < SLOW_PREVIEW_SECONDS for item in pending)
                if active >= MAX_STARTING_PREVIEWS or len(pending) >= MAX_STARTING_WITH_SLOW_PREVIEWS:
                    return False
                self._launch_preview(stream)
            ready = stream.ready()
            now = time.monotonic()
            stream.last_request = now
            return ready

    def get(self, capability, filename):
        with self.lock:
            stream = self._find_stream(capability)
            stream.last_request = time.monotonic()
        # A slow segment read should not hold up readers of other streams.
        try:
            return stream.read(filename)
        except FileNotFoundError:
            raise PlaybackError(404) from None

    def expire(self, *, check_progress=False):
        now = time.monotonic()
        warm = max((stream for stream in self.streams.values()
                    if self._is_warm_single(stream, now) and now <= stream.expires and stream.alive()),
                   key=lambda stream: stream.last_request, default=None)
        for key, stream in list(self.streams.items()):
            idle_seconds = PREVIEW_IDLE_SECONDS if stream.preview else IDLE_SECONDS
            if ((stream is not warm and now - stream.last_request > idle_seconds)
                    or now > stream.expires or not stream.alive()
                    or (stream.preview and stream.startup_deadline is not None
                        and now >= stream.startup_deadline and not stream.ready())
                    or (check_progress and stream.stalled_preview(now))):
                del self.streams[key]
                stream.close()

    def reap(self):
        while True:
            time.sleep(2)
            with self.lock:
                self.expire(check_progress=True)


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
                offered = data.get("codecs")
                codecs = tuple(codec for codec in ("h264", "hevc")
                               if isinstance(offered, list) and codec in offered)
                if data.get("action") == "list":
                    result = {"channels": gateway.catalog()}
                elif data.get("action") == "play":
                    result = {"path": gateway.start(data.get("channelId"), viewer, codecs=codecs)}
                elif data.get("action") == "play-grid":
                    result = gateway.start_grid(data.get("channelIds"), viewer, codecs=codecs,
                                                replace_path=data.get("replacePath"))
                elif data.get("action") == "move":
                    gateway.move(data.get("channelId"), viewer, data.get("direction"))
                    result = {"accepted": True}
                elif data.get("action") == "recordings":
                    result = {"recordings": gateway.recordings(data.get("channelId"), viewer, data.get("day"), data.get("hour"))}
                elif data.get("action") == "play-recording":
                    channel = data.get("channelId")
                    record = gateway.recording_entry(channel, viewer, data.get("recordingId"))
                    result = {"path": gateway.start(channel, viewer, record)}
                else:
                    raise ValueError("invalid action")
                self.send(200, json.dumps(result).encode())
            except PlaybackError as error:
                self.send(error.status)
            except (ValueError, UnicodeError):
                self.send(400)

        def do_GET(self):
            path, separator, query = self.path.partition("?")
            route = MEDIA_ROUTE.fullmatch(path)
            if not route or (separator and (query != "ready=1" or not route[2].endswith(".m3u8"))):
                self.send(404)
                return
            try:
                token, filename = route.groups()
                if separator:
                    self.send(204 if gateway.preview_ready(token, filename) else 202)
                    return
                mime = ({".m3u8": "application/vnd.apple.mpegurl", ".ts": "video/mp2t",
                         ".mp4": "video/mp4", ".m4s": "video/mp4"})[Path(filename).suffix]
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
