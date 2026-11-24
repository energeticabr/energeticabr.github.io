import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from camera_status import CameraStatusMonitor, CameraStatusStore, is_icsee_status_due, query_icsee_status


class CameraStatusStoreTest(unittest.TestCase):
    def test_unseen_camera_starts_unknown_without_a_fake_last_online_time(self):
        with CameraStatusStore(":memory:") as store:
            self.assertEqual(store.get("ch-1"), {
                "status": "unknown", "lastOnlineAt": None, "checkedAt": None,
            })

    def test_persists_last_online_while_offline_and_across_restarts(self):
        online_at = "2026-11-24T12:00:00Z"
        checked_at = "2026-11-24T14:00:00Z"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "camera-status.sqlite3"
            with CameraStatusStore(path) as store:
                store.update("ch-1", "online", checked_at=online_at)
                store.update("ch-1", "offline", checked_at=checked_at)
            with CameraStatusStore(path) as reopened:
                self.assertEqual(reopened.get("ch-1"), {
                    "status": "offline", "lastOnlineAt": online_at, "checkedAt": checked_at,
                })

    def test_last_online_is_set_from_the_check_when_status_is_online(self):
        checked_at = "2026-11-24T14:00:00Z"
        with CameraStatusStore(":memory:") as store:
            store.update("ch-1", "online", checked_at=checked_at)
            self.assertEqual(store.get("ch-1")["lastOnlineAt"], checked_at)

    def test_invalid_last_online_timestamp_does_not_create_a_fake_current_time(self):
        with CameraStatusStore(":memory:") as store:
            store.update("ch-1", "online", checked_at="2026-11-24T14:00:00Z")
            store.update("ch-1", "offline", checked_at="2026-11-24T16:00:00Z",
                         last_online_at="not-a-time")
            self.assertEqual(store.get("ch-1")["lastOnlineAt"], "2026-11-24T14:00:00Z")


class IcseeStatusQueryTest(unittest.TestCase):
    def test_status_query_sends_only_cloud_id_and_tls_pins_without_opening_video(self):
        entry = {
            "id": "icsee-1", "command": ["python", "icsee_source.py"],
            "input": {"cloudId": "AB12345678", "username": "admin", "password": "secret",
                      "tlsPins": {"status": "a" * 64, "relay": "b" * 64}},
        }
        completed = subprocess.CompletedProcess(entry["command"], 0, b'{"status":"Online"}', b"")
        with patch("camera_status.subprocess.run", return_value=completed) as run:
            self.assertEqual(query_icsee_status(entry), "online")
        payload = json.loads(run.call_args.kwargs["input"])
        self.assertEqual(payload, {"operation": "status", "cloudId": "AB12345678",
                                   "tlsPins": entry["input"]["tlsPins"]})
        self.assertNotIn("password", payload)
        self.assertNotIn("username", payload)
        self.assertNotIn("ffmpeg", run.call_args.args[0])

    def test_explicit_offline_is_distinct_from_transport_errors(self):
        entry = {"command": ["python", "icsee_source.py"], "input": {"cloudId": "AB12345678",
                  "tlsPins": {"status": "a" * 64, "relay": "b" * 64}}}
        offline = subprocess.CompletedProcess(entry["command"], 0, b'{"status":"Offline"}', b"")
        failed = subprocess.CompletedProcess(entry["command"], 1, b"", b"safe error")
        with patch("camera_status.subprocess.run", side_effect=[offline, failed]):
            self.assertEqual(query_icsee_status(entry), "offline")
            self.assertEqual(query_icsee_status(entry), "unknown")

    def test_status_probe_is_due_at_two_hours_not_before(self):
        checked = datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)
        self.assertTrue(is_icsee_status_due(None, checked))
        self.assertFalse(is_icsee_status_due(checked.isoformat(), checked + timedelta(hours=2) - timedelta(seconds=1)))
        self.assertTrue(is_icsee_status_due(checked.isoformat(), checked + timedelta(hours=2)))

    def test_monitor_probes_icsee_at_start_and_again_only_after_two_hours(self):
        times = [datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)]
        calls = []
        entry = {"id": "icsee-1", "input": {"cloudId": "AB12345678"}}
        with CameraStatusStore(":memory:") as store:
            monitor = CameraStatusMonitor([entry], store, icsee_query=lambda item: calls.append(item) or "online",
                                          clock=lambda: times[0])
            monitor.poll_once()
            times[0] += timedelta(hours=2) - timedelta(seconds=1)
            monitor.poll_once()
            self.assertEqual(len(calls), 1)
            times[0] += timedelta(seconds=1)
            monitor.poll_once()
            self.assertEqual(len(calls), 2)

    def test_yoosee_poll_uses_the_existing_feed_snapshot_and_persists_its_last_packet_time(self):
        entry = {"id": "yoosee-1", "input": {"deviceId": 7312456789}}
        observed = datetime(2026, 11, 24, 14, 0, tzinfo=timezone.utc)
        packet_at = "2026-11-24T13:59:55Z"
        with CameraStatusStore(":memory:") as store:
            monitor = CameraStatusMonitor([entry], store,
                yoosee_query=lambda _path: {"7312456789": {"status": "offline", "lastOnlineAt": packet_at}},
                clock=lambda: observed)
            monitor.poll_once()
            self.assertEqual(store.get("yoosee-1"), {
                "status": "offline", "lastOnlineAt": packet_at, "checkedAt": "2026-11-24T14:00:00Z",
            })

    def test_yoosee_ipc_failure_sets_unknown_and_preserves_the_last_known_online_time(self):
        entry = {"id": "yoosee-1", "input": {"deviceId": 7312456789}}
        packet_at = "2026-11-24T13:59:55Z"
        with CameraStatusStore(":memory:") as store:
            store.update("yoosee-1", "offline", checked_at="2026-11-24T14:00:00Z",
                         last_online_at=packet_at)
            def unavailable(_path):
                raise OSError("socket unavailable")
            monitor = CameraStatusMonitor([entry], store, yoosee_query=unavailable,
                clock=lambda: datetime(2026, 11, 24, 14, 0, 30, tzinfo=timezone.utc))
            monitor.poll_once()
            self.assertEqual(store.get("yoosee-1"), {
                "status": "unknown", "lastOnlineAt": packet_at, "checkedAt": "2026-11-24T14:00:30Z",
            })


if __name__ == "__main__":
    unittest.main()
