import json
import subprocess
import sys
import unittest
from io import BufferedReader, BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from icsee_source import discover_device_status, read_motion_command, run_guarded_live_attempt, run_live_source


class CaptureError(Exception):
    pass


class CameraSourceTest(unittest.TestCase):
    def test_adapter_exits_after_the_source_ends_while_its_control_pipe_is_still_open(self):
        fixture = """
import sys
import threading
import time
from types import ModuleType, SimpleNamespace

import icsee_source

def module(name):
    result = ModuleType(name)
    sys.modules[name] = result
    return result

module("xmplayer")
core = module("xmplayer.core")
core.legacy_api = module("xmplayer.core.legacy_api")
core.legacy_api.RpsLiveChain = SimpleNamespace(run=lambda *args, **kwargs: None)
core.service = module("xmplayer.core.service")
core.service.MonitorCaptureError = RuntimeError
module("xmplayer.config")
module("xmplayer.config.loader").load_monitor_config = SimpleNamespace
module("xmplayer.media")
module("xmplayer.media.live_hevc").LiveXStreamHevcAssembler = SimpleNamespace

received = threading.Event()
directions = []
class Queue:
    def enqueue_pulse(self, direction, **kwargs):
        directions.append(direction)
        if len(directions) == 2:
            received.set()
core.ptz = module("xmplayer.core.ptz")
core.ptz.PtzCommandQueue = Queue
core.ptz.build_opptz_payload = lambda command, session_id, *, channel=0: channel

def end_source(*args, **kwargs):
    assert received.wait(3)
    assert core.ptz.build_opptz_payload("DirectionUp", 1) == 2
    print(",".join(directions), file=sys.stderr, flush=True)
    time.sleep(0.1)
core.service.run_monitor_live_stream = end_source

icsee_source.install_transport = lambda *args: None
icsee_source.main()
"""
        settings = {"cloudId": "fixture", "channel": 2, "tlsPins": {}, "username": "", "password": ""}
        frames = [settings, {"move": "left"}, {"move": "right"}]
        pipe_data = b"".join(json.dumps(frame).encode() + b"\n" for frame in frames)
        child = subprocess.Popen([sys.executable, "-B", "-c", fixture],
                                 cwd=Path(__file__).parent, stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        with child:
            try:
                child.stdin.write(pipe_data)
                child.stdin.flush()
                status = child.wait(timeout=8)
                errors = child.stderr.read().decode(errors="replace")
                self.assertEqual(status, 0, errors)
                self.assertEqual(errors.strip(), "left,right")
            finally:
                if child.poll() is None:
                    child.kill()

    def test_motion_reader_keeps_commands_prefetched_with_the_initial_settings_line(self):
        stream = BufferedReader(BytesIO(b'{"cloudId":"AB12345678"}\n{"move":"left"}\n'))
        self.assertEqual(stream.readline(), b'{"cloudId":"AB12345678"}\n')
        ptz = Mock()
        self.assertTrue(read_motion_command(stream, ptz))
        ptz.enqueue_pulse.assert_called_once_with("left", speed=4, hold=0.35)
        self.assertFalse(read_motion_command(stream, ptz))

    def test_motion_reader_rejects_oversized_commands_and_stops(self):
        stream = BufferedReader(BytesIO(b"x" * 16385 + b"\n"))
        self.assertFalse(read_motion_command(stream, Mock()))

    def test_status_discovery_uses_cloud_id_without_authenticating_or_starting_video(self):
        codes = object()
        client = Mock()
        client.auth_codes.return_value = codes
        client.discover_status.return_value = SimpleNamespace(status="Offline")
        self.assertEqual(discover_device_status("AB12345678", client), "Offline")
        client.auth_codes.assert_called_once_with("AB12345678")
        client.discover_status.assert_called_once_with(codes)

    def test_status_discovery_rejects_unknown_provider_states(self):
        client = Mock()
        client.auth_codes.return_value = object()
        client.discover_status.return_value = SimpleNamespace(status="Maybe")
        with self.assertRaises(ValueError):
            discover_device_status("AB12345678", client)

    def test_preview_reopens_once_after_the_source_ends(self):
        for first in ("finished", CaptureError()):
            with self.subTest(first=first):
                play = Mock(side_effect=[first, "reconnected"])
                stop = Mock()
                stop.is_set.return_value = False
                stop.wait.return_value = False
                result = run_live_source(play, stop, can_reconnect=lambda: True, capture_error=CaptureError)
                self.assertEqual(result, "reconnected")
                self.assertEqual(play.call_count, 2)

    def test_stop_and_single_view_preserve_the_first_result(self):
        for preview in (False, True):
            with self.subTest(preview=preview):
                play = Mock(return_value="finished")
                stop = Mock()
                stop.wait.return_value = True
                result = run_live_source(play, stop, can_reconnect=lambda: preview, capture_error=CaptureError)
                self.assertEqual(result, "finished")
                play.assert_called_once_with()

    def test_preview_that_produced_no_video_does_not_retry(self):
        play = Mock(side_effect=CaptureError())
        stop = Mock()
        stop.is_set.return_value = False
        stop.wait.return_value = False
        with self.assertRaises(CaptureError):
            run_live_source(play, stop, can_reconnect=lambda: False, capture_error=CaptureError)
        play.assert_called_once_with()

    def test_old_attempt_cannot_write_or_cancel_a_new_attempt(self):
        def first(receive, stopped):
            self.assertTrue(receive(b"first", "key"))
            return receive, stopped

        forward = Mock(return_value=True)
        old_receive, old_stop = run_guarded_live_attempt(first, forward)

        def second(receive, stopped):
            self.assertTrue(old_stop.is_set())
            self.assertFalse(stopped.is_set())
            self.assertFalse(old_receive(b"late", "key"))
            self.assertTrue(receive(b"second", "key"))

        run_guarded_live_attempt(second, forward)
        self.assertEqual([call.args[0] for call in forward.call_args_list], [b"first", b"second"])
