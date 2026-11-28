import contextlib
import io
import json
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

import v380_source as v380
from gateway import Gateway


def settings(**extra):
    return v380.Settings.parse({"deviceId": 12345678, "username": "admin",
                                "password": "test-password", "host": "127.0.0.1", **extra})


def fragment(payload, total=1, index=0, kind=0):
    header = bytearray(12)
    header[0:2] = bytes([0x7F, kind])
    struct.pack_into("<HHH", header, 3, total, index, len(payload))
    return bytes(header), payload


def transform(key, data, decrypt=False):
    cipher = Cipher(algorithms.AES(key), modes.ECB())
    op = cipher.decryptor() if decrypt else cipher.encryptor()
    return op.update(data) + op.finalize()


class FakeCamera:
    """Loopback peer validates the wire protocol, never contacts a vendor."""
    def __init__(self, video, *, cloud=False, encrypted=False, result=1001):
        self.video, self.cloud, self.encrypted, self.result = video, cloud, encrypted, result
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(2)
        self.listener.settimeout(5)
        self.port = self.listener.getsockname()[1]
        self.stop = threading.Event()
        self.errors = []
        self.connections = []
        self.thread = threading.Thread(target=self.run, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_args):
        self.stop.set()
        self.listener.close()
        for connection in self.connections:
            with contextlib.suppress(OSError):
                connection.shutdown(socket.SHUT_RDWR)
            connection.close()
        self.thread.join(3)
        if self.errors:
            raise self.errors[0]

    def accept(self):
        connection, _ = self.listener.accept()
        connection.settimeout(5)
        self.connections.append(connection)
        return connection

    def run(self):
        try:
            self._run()
        except OSError as error:
            if not self.stop.is_set():
                self.errors.append(error)
        except Exception as error:
            self.errors.append(error)

    def _run(self):
        with self.accept() as auth:
            packet = v380.receive_exact(auth, 520)
            assert struct.unpack_from("<I", packet)[0] == 1167
            assert struct.unpack_from("<I", packet, 4)[0] == (1022 if self.cloud else 120)
            assert struct.unpack_from("<I", packet, 13)[0] == 12345678
            offset = 71 if self.cloud else 49
            assert packet[offset:offset + 32].rstrip(b"\0") == b"admin"
            secret = packet[offset + 32:offset + 96]
            clear = transform(b"macrovideo+*#!^@", transform(secret[:16], secret[16:], True), True)
            assert clear.rstrip(b"\0") == b"test-password"
            response = bytearray(256)
            struct.pack_into("<II", response, 0, 1168, self.result)
            response[12] = 31 if self.encrypted else 30
            struct.pack_into("<II", response, 13, 0x01234567, 9876)
            # Deliberately split TCP writes across protocol boundaries.
            for start in range(0, len(response), 7):
                auth.sendall(response[start:start + 7])
        if self.result != 1001:
            return
        with self.accept() as stream:
            packet = v380.receive_exact(stream, 256)
            assert struct.unpack_from("<I", packet)[0] == 301
            ticket_offset = 66 if self.cloud else 14
            assert struct.unpack_from("<I", packet, ticket_offset)[0] == 0x01234567
            response = bytearray(412)
            struct.pack_into("<IIH", response, 0, 401, 1001, 20)
            stream.sendall(response)
            start = v380.receive_exact(stream, 256)
            assert start[:6] == struct.pack("<IH", 303, 0x3001)
            data = bytearray(self.video)
            if self.encrypted:
                key = struct.pack("<IQI", 0x01234567, 0x618123462C14795C, 0x82800DF0)
                for offset in range(0, len(data) - 63, 80):
                    data[offset:offset + 64] = transform(key, bytes(data[offset:offset + 64]))
            full = bytes(16) + data
            pieces = [full[start:start + 15000] for start in range(0, len(full), 15000)]
            for index, piece in enumerate(pieces):
                header, _ = fragment(piece, len(pieces), index)
                stream.sendall(header + piece)
            while not self.stop.wait(0.05):
                header, payload = fragment(b"\0", kind=0x5B)
                stream.sendall(header + payload)


class V380ProtocolTest(unittest.TestCase):
    def test_invalid_credentials_and_sharing_codes_fail_before_network(self):
        for extra in ({"shareCode": "1234"}, {"password": ""}, {"password": "a" * 49},
                      {"username": "a" * 33}, {"password": "a\0b"}, {"deviceId": 0},
                      {"host": "example.com"}, {"mode": "cloud", "host": "127.0.0.1"},
                      {"deviceId": True}, {"deviceId": 1.2}, {"allowLegacyDiscovery": "true"}):
            with self.subTest(extra=extra), self.assertRaises(v380.CameraError):
                settings(**extra)
        self.assertNotIn("test-password", repr(settings()))

    def test_fragment_order_types_and_size_limits(self):
        frames = v380.Frames(encrypted=False, key=b"", communication_version=20)
        video = b"\0\0\0\1\x67video"
        full = bytes(16) + video
        self.assertIsNone(frames.push(*fragment(full[:18], 2, 0)))
        self.assertIsNone(frames.push(*fragment(b"audio", kind=0x1A)))
        self.assertIsNone(frames.push(*fragment(b"", total=0, kind=0x5B)))
        self.assertEqual(frames.push(*fragment(full[18:], 2, 1)), video)
        self.assertIsNone(frames.push(*fragment(full[:18], 3, 0)))
        self.assertIsNone(frames.push(*fragment(full[18:], 3, 2)))
        with self.assertRaises(v380.CameraError):
            frames.push(*fragment(full, total=5000))
        with patch.object(v380, "MAX_FRAME", 8), self.assertRaises(v380.CameraError):
            frames.push(*fragment(full))
        with self.assertRaises(v380.CameraError):
            frames.push(*fragment(bytes(40)))

    def test_encrypted_frames_preserve_the_unencrypted_tail(self):
        key = bytes(range(16))
        clear = b"\0\0\0\1\x67" + bytes(range(200))
        encrypted = bytearray(clear)
        for start in (0, 80):
            encrypted[start:start + 64] = transform(key, clear[start:start + 64])
        self.assertEqual(v380.decrypt_video(encrypted, key, 20), clear)
        aligned = len(clear) // 16 * 16
        legacy = transform(key, clear[:aligned]) + clear[aligned:]
        self.assertEqual(v380.decrypt_video(legacy, key, 21), clear)

    def test_tcp_peer_accepts_both_login_layouts_and_encrypted_video(self):
        video = b"\0\0\0\1\x67" + bytes(range(200))
        for cloud in (False, True):
            for encrypted in (False, True):
                with self.subTest(cloud=cloud, encrypted=encrypted):
                    with FakeCamera(video, cloud=cloud, encrypted=encrypted) as peer:
                        config = settings(port=peer.port)
                        if cloud:
                            # The public relay restriction is a configuration
                            # boundary; the simulated relay stays on loopback.
                            from dataclasses import replace
                            config = replace(config, mode="cloud")
                        output = io.BytesIO()
                        class Complete(Exception):
                            pass
                        def flush():
                            raise Complete
                        output.flush = flush
                        with self.assertRaises(Complete):
                            v380.pump(config, "127.0.0.1", output)
                        self.assertEqual(output.getvalue(), video)

    def test_authentication_failure_does_not_request_video(self):
        with FakeCamera(b"", result=1012) as peer:
            with self.assertRaisesRegex(v380.CameraError, "authentication refused"):
                v380.pump(settings(port=peer.port), "127.0.0.1", io.BytesIO())
            self.assertEqual(len(peer.connections), 1)

    def test_discovery_is_https_bounded_and_never_contains_credentials(self):
        from dataclasses import replace
        config = replace(settings(), mode="cloud", host="")
        class Response(io.BytesIO):
            pass
        class Opener:
            def open(self, request, timeout):
                self.request = request
                return Response(b'{"code":2000,"data":[{"ip":"127.0.0.1"},{"ip":"8.8.8.8"}]}')
        opener = Opener()
        with patch.object(v380.urllib.request, "build_opener", return_value=opener):
            self.assertEqual(v380.discover_relay(config), ["8.8.8.8"])
        self.assertEqual(opener.request.full_url,
                         "https://dispa1.av380.net:8001/api/v1/get_stream_server")
        body = json.loads(opener.request.data)
        self.assertEqual(set(body), {"dev_id", "platform", "timestamp", "sign"})
        self.assertNotIn(config.password.encode(), opener.request.data)
        self.assertIsNone(v380.NoRedirect().redirect_request(None, None, None, None, None, None))
        with patch.object(v380.urllib.request, "build_opener", return_value=opener):
            v380.discover_relay(replace(config, legacy_discovery=True))
        self.assertTrue(opener.request.full_url.startswith("http://"))

    def test_cli_rejects_bad_input_without_echoing_secrets(self):
        result = subprocess.run([sys.executable, str(Path(v380.__file__))],
                                input=b'{"password":"do-not-log-this"}\n', capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b"")
        self.assertNotIn(b"do-not-log-this", result.stderr)
        self.assertNotIn(b"Traceback", result.stderr)

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg is required for the HLS playback test")
    def test_real_adapter_process_reaches_the_existing_hls_gateway(self):
        clip = subprocess.run([shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error",
                               "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=10",
                               "-frames:v", "150", "-c:v", "libx264", "-preset", "ultrafast",
                               "-threads", "1", "-g", "10", "-f", "h264", "pipe:1"],
                              check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
        with FakeCamera(clip) as peer:
            entry = {"id": "v380-test", "label": "Local V380 fixture", "format": "h264",
                     "command": [sys.executable, str(Path(v380.__file__).resolve())],
                     "input": {"deviceId": 12345678, "password": "test-password",
                               "host": "127.0.0.1", "port": peer.port}}
            gateway = Gateway({"viewers": ["owner"], "origins": [],
                               "ffmpeg": shutil.which("ffmpeg"), "channels": [entry]})
            try:
                path = gateway.start("v380-test", "owner")
                capability = path.split("/")[-2]
                playlist = gateway.get(capability, "index.m3u8")
                self.assertIn(b"#EXTINF:", playlist)
                segment = next(line.decode() for line in playlist.splitlines() if line.endswith(b".ts"))
                media = gateway.get(capability, segment)
                decoded = subprocess.run([shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error",
                                          "-i", "pipe:0", "-frames:v", "1", "-f", "null", "-"],
                                         input=media, capture_output=True)
                self.assertEqual(decoded.returncode, 0, decoded.stderr.decode())
                self.assertEqual(gateway.catalog(), [{"id": "v380-test", "label": "Local V380 fixture"}])
            finally:
                for stream in gateway.streams.values():
                    stream.close()


if __name__ == "__main__":
    unittest.main()
