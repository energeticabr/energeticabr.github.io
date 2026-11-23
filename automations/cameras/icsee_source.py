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


def main():
    # Keep any messages printed by the vendor runtime out of its media output.
    media = os.fdopen(os.dup(sys.stdout.fileno()), "wb", buffering=0)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    from xmplayer.config.loader import load_monitor_config
    from xmplayer.core import legacy_api, service
    from xmplayer.media.live_hevc import LiveXStreamHevcAssembler

    settings = json.loads(sys.stdin.buffer.readline(16384))
    install_transport(legacy_api, settings["tlsPins"])
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
    assembler = LiveXStreamHevcAssembler(track_timestamps=True)
    stop = threading.Event()

    def receive(data, key):
        assembler.set_random_str(key)
        video, _audio = assembler.push_media_payload(data)
        if video:
            media.write(video)
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
        result = service.run_monitor_live_stream(config, quality="sd", data_frame_callback=receive,
                                                 status_callback=status, stop_event=stop, attempts=1)
        if os.environ.get("ENERGETICO_CAMERA_DIAGNOSTIC") == "1":
            print("Source stage:", service._detect_failure_stage(result.result).get("stage"),
                  file=sys.stderr, flush=True)
    finally:
        media.close()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit(1) from None
