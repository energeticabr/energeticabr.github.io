"""Read V380 native video into the gateway pipe; credentials arrive on stdin.

Protocol reference (not a vendor SDK): PyanSofyan/V380Decoder, V380Client.cs
and DispatchRelayServer.cs. Only live video is requested; no device settings
are changed. Camera firmware compatibility must be verified on a real device.
"""

import hashlib
import ipaddress
import json
import secrets
import socket
import struct
import sys
import time
import urllib.request
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


DISPATCH_HOST = "dispa1.av380.net"
DISPATCH_PATH = "/api/v1/get_stream_server"
MAX_CONFIG = 16384
MAX_FRAME = 4 * 1024 * 1024
MAX_FRAGMENT = 20000
MAX_FRAGMENTS = 4096
VIDEO_TYPES = {0, 1, 0x28, 0x29}


class CameraError(Exception):
    """Messages are fixed diagnostics, never vendor responses or credentials."""


@dataclass(frozen=True, repr=False)
class Settings:
    device_id: int
    username: str
    password: str
    mode: str
    host: str
    port: int
    quality: int
    legacy_discovery: bool

    @classmethod
    def parse(cls, data):
        if not isinstance(data, dict) or "shareCode" in data:
            raise CameraError("V380 configuration requires device credentials, not a sharing code")
        try:
            def integer(value):
                if type(value) is int:
                    return value
                if isinstance(value, str) and value.isascii() and value.isdecimal():
                    return int(value)
                raise ValueError
            device_id = integer(data["deviceId"])
            port = integer(data.get("port", 8800))
            if not 0 < device_id <= 0xFFFFFFFF or not 1 <= port <= 65535:
                raise ValueError
            username = data.get("username", "admin")
            password = data["password"]
            if not isinstance(username, str) or not isinstance(password, str):
                raise ValueError
            if not 1 <= len(username.encode("ascii")) <= 32:
                raise ValueError
            if not 1 <= len(password.encode("ascii")) <= 48:
                raise ValueError
            if "\0" in username or "\0" in password:
                raise ValueError
            mode = data.get("mode", "lan")
            host = data.get("host", "")
            if mode not in {"lan", "cloud"} or not isinstance(host, str):
                raise ValueError
            if host:
                address = ipaddress.ip_address(host)
                if address.is_unspecified or address.is_multicast:
                    raise ValueError
                if mode == "cloud" and not address.is_global:
                    raise ValueError
                host = str(address)
            if mode == "lan" and not host:
                raise ValueError
            quality = data.get("quality", "sd")
            legacy = data.get("allowLegacyDiscovery", False)
            if quality not in {"sd", "hd"}:
                raise ValueError
            if not isinstance(legacy, bool):
                raise ValueError
        except (KeyError, TypeError, ValueError, UnicodeError):
            raise CameraError("Invalid V380 device configuration") from None
        return cls(device_id, username, password, mode, host, port,
                   int(quality == "hd"), legacy)


def aes_blocks(key, data, *, decrypt=False):
    cipher = Cipher(algorithms.AES(key), modes.ECB())
    operation = cipher.decryptor() if decrypt else cipher.encryptor()
    return operation.update(data) + operation.finalize()


def password_payload(password):
    # The firmware expects two AES-ECB passes and the second key prepended.
    alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    nonce = bytes(secrets.choice(alphabet) for _ in range(16))
    padded = password.encode("ascii").ljust(48, b"\0")
    return nonce + aes_blocks(nonce, aes_blocks(b"macrovideo+*#!^@", padded))


def media_key(ticket):
    return struct.pack("<IQI", ticket, 0x618123462C14795C, 0x82800DF0)


def decrypt_video(payload, key, communication_version):
    data = bytearray(payload)
    if communication_version == 21:
        end = len(data) // 16 * 16
        data[:end] = aes_blocks(key, bytes(data[:end]), decrypt=True)
    else:
        # v31+ encrypts 64 bytes of each 80-byte group. The trailing bytes
        # remain plain when fewer than 64 bytes are available.
        for start in range(0, len(data) - 63, 80):
            data[start:start + 64] = aes_blocks(key, bytes(data[start:start + 64]), decrypt=True)
    return bytes(data)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def discover_relay(settings):
    """Opt-in cloud discovery. Never include username, password or share code."""
    timestamp = int(time.time())
    text = f"dev_id={settings.device_id}&platform=10001&timestamp={timestamp}hsdata2022"
    data = {"dev_id": settings.device_id, "platform": 10001,
            "timestamp": timestamp, "sign": hashlib.sha1(text.encode()).hexdigest()}
    # No automatic HTTP downgrade. Older discovery deployments need explicit
    # operator configuration; a configured relay IP avoids discovery entirely.
    scheme = "http" if settings.legacy_discovery else "https"
    request = urllib.request.Request(f"{scheme}://{DISPATCH_HOST}:8001{DISPATCH_PATH}",
                                     data=json.dumps(data).encode(),
                                     headers={"Content-Type": "application/json"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=8) as response:
            raw = response.read(32769)
        if len(raw) > 32768:
            raise ValueError
        result = json.loads(raw)
        if result.get("code") != 2000 or not isinstance(result.get("data"), list):
            raise ValueError
        hosts = []
        for entry in result["data"][:16]:
            address = ipaddress.ip_address(entry["ip"])
            if address.is_global and not address.is_multicast:
                hosts.append(str(address))
        if hosts:
            return list(dict.fromkeys(hosts))
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        pass
    raise CameraError("V380 cloud discovery failed; check the approved relay configuration")


def receive_exact(connection, size):
    result = bytearray()
    deadline = time.monotonic() + 8
    while len(result) < size:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise CameraError("V380 connection timed out")
        connection.settimeout(remaining)
        chunk = connection.recv(size - len(result))
        if not chunk:
            raise CameraError("V380 connection closed")
        result.extend(chunk)
    return bytes(result)


def auth_packet(settings):
    packet = bytearray(520)
    struct.pack_into("<II", packet, 0, 1167, 120 if settings.mode == "lan" else 1022)
    packet[8] = 31
    struct.pack_into("<II", packet, 9, 1, settings.device_id)
    offset = 49
    if settings.mode == "cloud":
        domain = f"{settings.device_id}.nvdvr.net".encode()
        packet[17:17 + len(domain)] = domain
        struct.pack_into("<I", packet, 67, settings.port)
        offset = 71
    name = settings.username.encode("ascii")
    packet[offset:offset + len(name)] = name
    packet[offset + 32:offset + 96] = password_payload(settings.password)
    return packet


def stream_packet(settings, ticket, session):
    packet = bytearray(256)
    struct.pack_into("<I", packet, 0, 301)
    if settings.mode == "lan":
        struct.pack_into("<IIHI", packet, 4, settings.device_id, 0, 20, ticket)
        struct.pack_into("<II", packet, 22, 4096, settings.quality)
    else:
        struct.pack_into("<I", packet, 4, 1022)
        domain = f"{settings.device_id}.nvdvr.net".encode()
        packet[8:8 + len(domain)] = domain
        struct.pack_into("<IIIII", packet, 58, settings.port, settings.device_id,
                         ticket, session, settings.quality)
        packet[78] = 20
        struct.pack_into("<I", packet, 79, 1)
    return packet


def authenticate(settings, host):
    with socket.create_connection((host, settings.port), timeout=5) as connection:
        connection.sendall(auth_packet(settings))
        response = receive_exact(connection, 256)
    command, result = struct.unpack_from("<II", response)
    if command != 1168:
        raise CameraError("Unsupported V380 authentication response")
    if result != 1001:
        raise CameraError("V380 device authentication refused; verify the device username and password")
    return response[12], *struct.unpack_from("<II", response, 13)


class Frames:
    """Assemble only consecutive fragments, with bounded memory."""
    def __init__(self, *, encrypted, key, communication_version):
        self.encrypted = encrypted
        self.key = key
        self.communication_version = communication_version
        self.buffer = bytearray()
        self.expected = self.total = self.kind = None

    def push(self, header, payload):
        if len(header) != 12 or header[0] != 0x7F:
            raise CameraError("Unsupported V380 media header")
        kind = header[1]
        total, index, size = struct.unpack_from("<HHH", header, 3)
        if kind == 0x5B and size == 0 and not payload:
            return None
        if (not 0 < size <= MAX_FRAGMENT or size != len(payload)
                or not 0 < total <= MAX_FRAGMENTS or index >= total):
            raise CameraError("Invalid V380 fragment")
        if kind not in VIDEO_TYPES:
            return None
        if index == 0:
            self.buffer.clear()
            self.total, self.expected, self.kind = total, 0, kind
        if (index, total, kind) != (self.expected, self.total, self.kind):
            self.buffer.clear()
            self.expected = None
            return None
        if len(self.buffer) + size > MAX_FRAME:
            raise CameraError("V380 video frame exceeds the size limit")
        self.buffer.extend(payload)
        self.expected += 1
        if index + 1 != total:
            return None
        data = bytes(self.buffer)
        self.buffer.clear()
        self.expected = None
        if len(data) <= 16:
            raise CameraError("Invalid V380 video frame")
        data = data[16:]
        if self.encrypted:
            data = decrypt_video(data, self.key, self.communication_version)
        start = data.find(b"\0\0\1", 0, 19)
        if start < 0:
            raise CameraError("V380 video could not be decoded with this firmware")
        if start > 0 and data[start - 1] == 0:
            start -= 1
        return data[start:]


def pump(settings, host, output):
    version, ticket, session = authenticate(settings, host)
    with socket.create_connection((host, settings.port), timeout=5) as connection:
        connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        connection.sendall(stream_packet(settings, ticket, session))
        response = receive_exact(connection, 412)
        command, result = struct.unpack_from("<Ii", response)
        if command != 401 or result not in {1001, 402}:
            raise CameraError("V380 live video login refused or unsupported")
        communication_version = struct.unpack_from("<H", response, 8)[0] if settings.mode == "lan" else 0
        frames = Frames(encrypted=version > 30, key=media_key(ticket),
                        communication_version=communication_version)
        start = bytearray(256)
        struct.pack_into("<IH", start, 0, 303, 0x3001)
        connection.sendall(start)
        while True:
            header = receive_exact(connection, 12)
            size = struct.unpack_from("<H", header, 7)[0]
            if header[:2] == b"\x7f\x5b" and size == 0:
                continue
            if header[0] != 0x7F or not 0 < size <= MAX_FRAGMENT:
                raise CameraError("Unsupported V380 media header")
            frame = frames.push(header, receive_exact(connection, size))
            if frame:
                output.write(frame)
                output.flush()


def main():
    raw = sys.stdin.buffer.readline(MAX_CONFIG + 1)
    if len(raw) > MAX_CONFIG:
        raise CameraError("V380 configuration exceeds the size limit")
    try:
        settings = Settings.parse(json.loads(raw))
    except (ValueError, UnicodeError):
        raise CameraError("Invalid V380 device configuration") from None
    hosts = [settings.host] if settings.host else discover_relay(settings)
    # Try a reachable relay once; never retry a rejected login on other servers.
    for host in hosts:
        try:
            pump(settings, host, sys.stdout.buffer)
            return
        except (ConnectionRefusedError, TimeoutError, socket.gaierror):
            continue
    raise CameraError("V380 camera connection is unavailable")


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        raise SystemExit(0) from None
    except CameraError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None
    except (OSError, ValueError, TypeError, KeyError):
        print("V380 camera connection failed", file=sys.stderr)
        raise SystemExit(1) from None
