import asyncio
import json
import secrets
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from yoosee_source import Hub, load_credentials, parse_request, remember_video, sdk_input


class YooseeReconnectTest(unittest.IsolatedAsyncioTestCase):
    async def test_sends_initial_video_and_keeps_subscribers_when_the_sdk_disconnects(self):
        device = 7312456789
        hub = Hub(Path("."), [device])
        hub.access = AsyncMock(return_value=SimpleNamespace(access_id="10", access_token="a" * 128))
        writer = Mock()
        writer.transport.get_write_buffer_size.return_value = 0
        hub.clients[device].add(writer)
        frame = b"\x00\x00\x01\x40first packet"
        process = SimpleNamespace(
            stdin=Mock(drain=AsyncMock()),
            stdout=Mock(read=AsyncMock(side_effect=[frame, b""]), readexactly=AsyncMock(side_effect=EOFError)),
            stderr=Mock(readline=AsyncMock(return_value=b"")),
            communicate=AsyncMock(),
        )
        with (patch("yoosee_source.asyncio.create_subprocess_exec", return_value=process),
              patch("yoosee_source.asyncio.sleep", side_effect=asyncio.CancelledError)):
            with self.assertRaises(asyncio.CancelledError):
                await hub.pump(device, hub.clients[device])
        writer.write.assert_called_once_with(frame)
        writer.close.assert_not_called()
        self.assertIn(writer, hub.clients[device])


class YooseeSourceTest(unittest.TestCase):
    def test_requires_numeric_camera_id_and_only_accepts_supported_operations(self):
        self.assertEqual(parse_request(b'{"deviceId":7312456789}'), ("live", 7312456789))
        self.assertEqual(parse_request(b'{"operation":"recordings","deviceId":6234567891}'),
                         ("recordings", 6234567891))
        for invalid in (b'{"deviceId":true}', b'{"deviceId":0}',
                        b'{"deviceId":7312456789,"operation":"playback"}'):
            with self.assertRaises(ValueError):
                parse_request(invalid)

    def test_sends_complete_camera_id_and_signed_access_id_to_sdk(self):
        session = SimpleNamespace(access_id="18446744073709551615", access_token="a" * 128)
        self.assertEqual(sdk_input(session, 7312456789),
                         b"-1\n7312456789\n" + b"a" * 128 + b"\n")
        with self.assertRaises(ValueError):
            sdk_input(SimpleNamespace(access_id="10", access_token="one\ntwo"), 7312456789)

    def test_loads_only_service_credential_file(self):
        with tempfile.TemporaryDirectory() as directory:
            location = Path(directory) / "yoosee.json"
            secret = secrets.token_urlsafe(16)
            location.write_text(json.dumps({"account": "camera@example.test", "password": secret}),
                                encoding="utf-8")
            self.assertEqual(load_credentials(Path(directory)), ("camera@example.test", secret))
            location.write_text(json.dumps({"password": secret}), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_credentials(Path(directory))

    def test_keeps_latest_hevc_configuration_across_pipe_reads(self):
        cached = bytearray(b"preceding video\x00\x00")
        remember_video(cached, b"\x01\x40fresh parameter set")
        self.assertEqual(cached, b"\x00\x00\x01\x40fresh parameter set")
        remember_video(cached, b"a" * (1024 * 1024))
        self.assertLessEqual(len(cached), 512 * 1024)

if __name__ == "__main__":
    unittest.main()
