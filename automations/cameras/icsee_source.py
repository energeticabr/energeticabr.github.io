"""Adapt the separately installed iCSee client to the gateway's media pipe."""

import hashlib
import http.client
import ipaddress
import json
import os
import ssl
import sys
import threading
import urllib.request
from datetime import datetime, timedelta
from urllib.parse import urlsplit


def install_transport(api, pins):
    """Use normal PKI for discovery and require exact pins for legacy relays."""
    auth_host = "rs.xmeye.net"
    status_host = "pub-status.secu100.net"

    def connect(url, timeout):
        parsed = urlsplit(url)
        host, port = parsed.hostname, parsed.port or 443
        if os.environ.get("ENERGETICO_CAMERA_DIAGNOSTIC") == "1":
            print("TLS", host if host in {auth_host, status_host} else "relay", port, file=sys.stderr, flush=True)
        if parsed.scheme != "https" or parsed.username or parsed.password:
            raise ValueError("Unexpected camera endpoint")
        if (host, port) == (auth_host, 443):
            context = ssl.create_default_context()
            expected = None
        elif (host, port) == (status_host, 7605):
            expected = pins["status"]
        elif ipaddress.ip_address(host).is_global and port in {6510, 6610}:
            expected = pins["relay"]
        else:
            raise ValueError("Unexpected camera endpoint")
        if expected is not None:
            # The legacy certificates do not pass PKI validation. Match the
            # provisioned leaf on this very connection before sending any data.
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        connection = http.client.HTTPSConnection(host, port, timeout=timeout, context=context)
        try:
            connection.connect()
            if expected is not None:
                actual = hashlib.sha256(connection.sock.getpeercert(binary_form=True)).hexdigest()
                if actual != expected:
                    raise ssl.SSLError("Unexpected legacy relay certificate")
            return connection, parsed.path + ("?" + parsed.query if parsed.query else "")
        except BaseException:
            connection.close()
            raise

    def request(req, *, timeout, context=None):
        connection, path = connect(req.full_url, timeout)
        try:
            connection.request(req.get_method(), path or "/", req.data, dict(req.header_items()))
            response = connection.getresponse()
            if response.status != 200:
                raise OSError("Camera endpoint refused the request")
            return response
        except BaseException:
            connection.close()
            raise

    def minimal(url, method="POST", payload=None, headers=None, timeout=20, **_options):
        request_body = payload.encode() if isinstance(payload, str) else payload
        try:
            req = urllib.request.Request(url, data=request_body, headers=headers or {}, method=method)
            with request(req, timeout=timeout) as response:
                body = response.read(65536).decode("utf-8", errors="replace")
                return api.HttpResult(ok=True, url=url, status=response.status,
                                      json_data=None, text=body, request_payload=None)
        except (OSError, ValueError):
            return api.HttpResult(ok=False, url=url, status=None, json_data=None,
                                  text="", error="Invalid camera relay connection", request_payload=None)

    api._urlopen_direct = request
    api.http_minimal_text = minimal
    api._socks5_proxy_endpoint = lambda: None
    connect_tcp = api._create_tcp_connection
    parse_agent = api.parse_agent_protocol_response
    selected_relays = set()
    local_relays = set()

    def track_local_listener(proxy):
        start, close = proxy.start, proxy.close

        def start_local(self):
            if self.local_host != "127.0.0.1":
                raise OSError("Camera listener must use loopback")
            result = start(self)
            if self.local_port:
                local_relays.add((self.local_host, self.local_port))
            return result

        def close_local(self):
            local_relays.discard((self.local_host, self.local_port))
            return close(self)

        proxy.start, proxy.close = start_local, close_local

    track_local_listener(api.LocalAgentTcpBindProxy)
    track_local_listener(api.LocalAgentSdkBindProxy)

    def parse_selected_relay(payload):
        selection = parse_agent(payload)
        if str(selection.get("error_num")) == "200":
            try:
                host = ipaddress.ip_address(selection["agent_server_ip"])
                port = int(selection["agent_server_port"])
                if host.is_global and 1 <= port <= 65535:
                    selected_relays.add((str(host), port))
            except (KeyError, ValueError, TypeError):
                pass
        return selection
    api.parse_agent_protocol_response = parse_selected_relay

    def public_relay_only(address, timeout):
        host, port = address
        if os.environ.get("ENERGETICO_CAMERA_DIAGNOSTIC") == "1":
            print("TCP relay", port, "selected", (host, int(port)) in selected_relays,
                  "loopback", host in {"127.0.0.1", "::1"}, file=sys.stderr, flush=True)
        if (host, int(port)) not in selected_relays | local_relays:
            raise OSError("Unexpected camera relay address")
        return connect_tcp(address, timeout)
    api._create_tcp_connection = public_relay_only


def run_live_source(attempt, stop, *, can_reconnect, capture_error):
    try:
        result = attempt()
    except capture_error:
        if not can_reconnect() or stop.is_set():
            raise
        result = None
    if can_reconnect() and not stop.wait(2):
        return attempt()
    return result


def run_guarded_live_attempt(run, forward):
    stopped = threading.Event()
    lock = threading.Lock()

    def receive(data, key):
        with lock:
            if stopped.is_set():
                return False
            return forward(data, key)

    try:
        return run(receive, stopped)
    finally:
        with lock:
            stopped.set()


def discover_device_status(cloud_id, status_client):
    codes = status_client.auth_codes(cloud_id)
    status = status_client.discover_status(codes)
    if status.status not in {"Online", "Offline"}:
        raise ValueError("Invalid iCSee status")
    return status.status


def read_motion_command(stream, ptz):
    """Read and dispatch one PTZ command from the buffered settings stream."""
    raw = stream.readline(16385)
    if not raw or len(raw) > 16384:
        return False
    try:
        command = json.loads(raw)
        direction = command.get("move") if isinstance(command, dict) else None
        if direction in {"up", "down", "left", "right"}:
            ptz.enqueue_pulse(direction, speed=4, hold=0.35)
    except (ValueError, TypeError):
        pass
    return True


def main():
    # Keep any messages printed by the vendor runtime out of its media output.
    media = os.fdopen(os.dup(sys.stdout.fileno()), "wb", buffering=0)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    from xmplayer.core import legacy_api
    settings = json.loads(sys.stdin.buffer.readline(16384))
    install_transport(legacy_api, settings["tlsPins"])
    operation = settings.get("operation", "live")
    if operation == "status":
        from xmplayer.core.cloud_id import CloudIdClient
        status = discover_device_status(settings["cloudId"], CloudIdClient())
        media.write(json.dumps({"status": status}).encode("utf-8"))
        media.close()
        return

    from xmplayer.config.loader import load_monitor_config
    from xmplayer.core import service
    from xmplayer.core.ptz import PtzCommandQueue
    from xmplayer.media.live_hevc import LiveXStreamHevcAssembler

    config = load_monitor_config()
    config.connection_mode = "cloud_id"
    config.device_id = settings["cloudId"]
    config.device_username = settings["username"]
    config.device_password = settings["password"]
    config.attempts = 1
    service._save_relay_cache_server = lambda *_args, **_kwargs: None
    run = legacy_api.RpsLiveChain.run

    def run_channel(self, **kwargs):
        kwargs["channel"] = int(settings["channel"])
        kwargs["wakeup_probe_enabled"] = False
        return run(self, **kwargs)
    legacy_api.RpsLiveChain.run = run_channel
    if operation == "recordings":
        build_query = service._build_opfilequery_followup
        def build_channel_query(begin, end):
            frame = build_query(begin, end)
            payload = json.loads(frame["plain_payload_text"])
            payload["OPFileQuery"]["Channel"] = int(settings["channel"])
            frame["plain_payload_text"] = json.dumps(payload, separators=(",", ":"))
            return frame
        service._build_opfilequery_followup = build_channel_query
        day = datetime.strptime(settings["day"], "%Y-%m-%d")
        if "hour" in settings:
            begin = day.replace(hour=int(settings["hour"]))
            end = begin + timedelta(hours=1) - timedelta(seconds=1)
            query_page = service._query_device_recordings_page
            def query_hour(**kwargs):
                requested = datetime.strptime(kwargs["begin_time"], "%Y-%m-%d %H:%M:%S")
                if requested > end:
                    return {"Ret": 100, "OPFileQuery": []}, {}, None
                kwargs["begin_time"] = max(begin, requested).strftime("%Y-%m-%d %H:%M:%S")
                kwargs["end_time"] = end.strftime("%Y-%m-%d %H:%M:%S")
                return query_page(**kwargs)
            service._query_device_recordings_page = query_hour
        records, meta = service.fetch_device_recordings(config, day=day, timeout=20, max_pages=8)
        if meta.get("partial_error") or any(page.get("error") for page in meta.get("pages", [])):
            raise RuntimeError("recording query incomplete")
        items = [{"start_time": r.start_time, "end_time": r.end_time,
                  "duration_seconds": r.duration_seconds, "file_name": r.file_name,
                  "file_length": r.file_length, "channel": r.channel}
                 for r in records if r.channel == int(settings["channel"])]
        media.write(json.dumps(items).encode())
        media.close()
        return
    sent_video = False
    stop = threading.Event()
    ptz = PtzCommandQueue()

    def commands():
        # Keep using the buffered reader used for the initial settings line.
        # readline() may prefetch a PTZ command that arrived during startup;
        # reading the same descriptor with os.read() would skip that buffer.
        while not stop.is_set() and read_motion_command(sys.stdin.buffer, ptz):
            pass

    command_thread = None
    if operation == "live":
        command_thread = threading.Thread(target=commands, daemon=True)
        command_thread.start()

    def forward_video(assembler, data, key):
        nonlocal sent_video
        assembler.set_random_str(key)
        video, _audio = assembler.push_media_payload(data)
        if video:
            media.write(video)
            sent_video = True
        return bool(video)

    def status(state, _details):
        if state == "Live":
            print(state, file=sys.stderr, flush=True)
        if os.environ.get("ENERGETICO_CAMERA_DIAGNOSTIC") == "1":
            safe_detail = _details.split(" %", 1)[0]
            for prefix in ("AgentProtocol response", "TCP 6611 handshake response",
                           "Live media response", "Encrypted data login", "Controller"):
                if prefix in safe_detail:
                    print(prefix, file=sys.stderr, flush=True)
                    break

    try:
        if operation == "playback":
            assembler = LiveXStreamHevcAssembler(track_timestamps=True)
            record = service.RecordingItem(title="", **settings["recording"])
            def receive_recording(data, key):
                return forward_video(assembler, data, key)
            result = service.run_recording_playback_stream(config, record, data_frame_callback=receive_recording,
                                                           status_callback=status, stop_event=stop, attempts=1)
        else:
            def play(receive, stopped):
                return service.run_monitor_live_stream(config, quality="sd", data_frame_callback=receive,
                                                       status_callback=status, stop_event=stopped, attempts=1,
                                                       ptz_queue=ptz)

            def attempt_live():
                assembler = LiveXStreamHevcAssembler(track_timestamps=True)
                return run_guarded_live_attempt(play, lambda data, key: forward_video(assembler, data, key))

            result = run_live_source(attempt_live, stop,
                                     can_reconnect=lambda: sent_video,
                                     capture_error=service.MonitorCaptureError)
        if result is not None and os.environ.get("ENERGETICO_CAMERA_DIAGNOSTIC") == "1":
            print("Source stage:", service._detect_failure_stage(result.result).get("stage"),
                  file=sys.stderr, flush=True)
    finally:
        stop.set()
        if command_thread:
            command_thread.join(timeout=1)
        media.close()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit(1) from None
