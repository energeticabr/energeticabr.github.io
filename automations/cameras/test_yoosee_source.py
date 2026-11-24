import json
import secrets
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from yoosee_source import load_credentials, parse_request, remember_video, sdk_input


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
