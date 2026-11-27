import http.client
import json
import secrets
import threading
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from http.server import ThreadingHTTPServer

from camera_status import CameraStatusStore
from gateway import CATALOG, MEDIA, Gateway, Stream, handler_for


class CameraGatewayTest(unittest.TestCase):
    def setUp(self):
        config = {
            "origins": ["https://www.energeticabr.com"],
            "viewers": ["owner"],
            "ffmpeg": "unused",
            "channels": [{"id": "ch-1", "label": "Câmera de teste", "format": "hevc",
                          "command": ["/unused"], "input": {"password": secrets.token_urlsafe(16)}}],
        }
        gateway = Gateway(config, identity=lambda token: {"id": token, "userType": "Member"})
        self.gateway = gateway
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(gateway))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.addCleanup(gateway.status_store.close)

    def request(self, method, path, token=None, body=None, origin=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        self.addCleanup(connection.close)
        headers = {}
        if token:
            headers["Authorization"] = "Bearer " + token
        if origin:
            headers["Origin"] = origin
        connection.request(method, path, json.dumps(body) if body is not None else None, headers)
        response = connection.getresponse()
        return response.status, response.getheaders(), response.read()

    def test_catalog_requires_an_allowed_viewer_and_hides_the_source(self):
        body = {"action": "list"}
        self.assertEqual(self.request("POST", CATALOG, body=body)[0], 401)
        self.assertEqual(self.request("POST", CATALOG, "another", body)[0], 403)
        status, headers, result = self.request("POST", CATALOG, "owner", body,
                                              "https://www.energeticabr.com")
        self.assertEqual(status, 200)
        self.assertIn(("Cache-Control", "private, no-store"), headers)
        self.assertEqual(json.loads(result), {"channels": [{
            "id": "ch-1", "label": "Câmera de teste", "status": "unknown", "lastOnlineAt": None,
        }]})

    def test_catalog_includes_persisted_status_without_exposing_source_configuration(self):
        self.gateway.status_store.update("ch-1", "offline", checked_at="2026-11-24T14:00:00Z",
                                         last_online_at="2026-11-24T12:00:00Z")
        status, _, result = self.request("POST", CATALOG, "owner", {"action": "list"})
        self.assertEqual(status, 200)
        channel = json.loads(result)["channels"][0]
        self.assertEqual(channel["status"], "offline")
        self.assertEqual(channel["lastOnlineAt"], "2026-11-24T12:00:00Z")
        self.assertNotIn("input", channel)
        self.assertNotIn("command", channel)

    def test_saved_visuals_sync_only_with_the_same_viewer_and_preserve_camera_order(self):
        self.gateway.users.add("other-owner")
        self.gateway.entries["ch-2"] = self.gateway.entries["ch-1"]
        visual = {"id": "a" * 32, "name": "Portão", "cameraIds": ["ch-2", "ch-1"]}
        create = {"action": "create-visual", **visual}
        rename = {"action": "rename-visual", "id": visual["id"], "name": "Obra", "previousName": "Portão"}
        listing = {"action": "list-visuals"}
        self.assertEqual(self.request("POST", CATALOG, body=create)[0], 401)
        self.assertEqual(self.request("POST", CATALOG, "owner", create)[0], 200)
        self.assertEqual(self.request("POST", CATALOG, "owner", create)[0], 200)
        self.assertEqual(self.request("POST", CATALOG, "other-owner", rename)[0], 404)
        self.assertEqual(json.loads(self.request("POST", CATALOG, "other-owner", listing)[2]), {"visuals": []})
        self.assertEqual(json.loads(self.request("POST", CATALOG, "OWNER", listing)[2]), {"visuals": [visual]})
        self.assertEqual(self.request("POST", CATALOG, "owner", rename)[0], 200)
        self.assertEqual(self.request("POST", CATALOG, "owner", rename)[0], 200)
        self.assertEqual(self.request("POST", CATALOG, "owner", {**rename, "name": "Antigo"})[0], 409)
        self.assertEqual(json.loads(self.request("POST", CATALOG, "owner", listing)[2]),
                         {"visuals": [{**visual, "name": "Obra"}]})

    def test_legacy_visual_import_is_repeatable_and_does_not_revert_a_rename(self):
        legacy = {"action": "import-visual", "name": "Meu visual", "cameraIds": ["old-channel", "ch-1"],
                  "occurrence": 0}
        status, _, payload = self.request("POST", CATALOG, "owner", legacy)
        self.assertEqual(status, 200)
        visual = json.loads(payload)["visual"]
        rename = {"action": "rename-visual", "id": visual["id"], "name": "Novo nome", "previousName": legacy["name"]}
        self.assertEqual(self.request("POST", CATALOG, "owner", rename)[0], 200)
        self.assertEqual(json.loads(self.request("POST", CATALOG, "owner", legacy)[2]),
                         {"visual": {**visual, "name": "Novo nome"}})
        duplicate = json.loads(self.request("POST", CATALOG, "owner", {**legacy, "occurrence": 1})[2])["visual"]
        self.assertNotEqual(duplicate["id"], visual["id"])
        self.assertEqual(duplicate["cameraIds"], legacy["cameraIds"])
        self.assertEqual(self.request("POST", CATALOG, "owner", {**legacy, "name": "\u0085"})[0], 200)
        for invalid in [{"cameraIds": ["ch-1", "ch-1"]}, {"cameraIds": ["INVALID"]}, {"name": " "},
                        {"occurrence": True}, {"name": "\ud800"}, {"name": "\ufeff"}]:
            with self.subTest(invalid=invalid):
                self.assertEqual(self.request("POST", CATALOG, "owner", {**legacy, **invalid})[0], 400)

    def test_visuals_survive_reopening_the_existing_status_database(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "camera-status.sqlite3"
            store = CameraStatusStore(path)
            visual = {"id": "a" * 32, "name": "Visão geral", "cameraIds": ["ch-2", "ch-1"]}
            try:
                store.update("ch-1", "online")
                self.assertEqual(store.create_visual("owner", visual["id"], visual["name"], visual["cameraIds"]), visual)
            finally:
                store.close()
            store = CameraStatusStore(path)
            try:
                self.assertEqual(store.list_visuals("owner"), [visual])
                self.assertEqual(store.get("ch-1")["status"], "online")
            finally:
                store.close()

    def test_catalog_identifies_channels_from_the_same_physical_camera(self):
        sources = [
            ("patio-1", "Pátio · canal 1", {"cloudId": "17", "channel": 0}),
            ("other", "Pátio · canal 1", {"cloudId": "private-icsee-18", "channel": 0}),
            ("patio-2", "Pátio - canal 2", {"cloudId": "17", "channel": 1}),
            ("yoosee-1", "Entrada (Yoosee)", {"deviceId": 17}),
            ("yoosee-2", "Entrada (Yoosee)", {"deviceId": "17"}),
            ("unidentified", "Pátio · canal 3", {}),
            ("no-label", None, {"cloudId": "private-icsee-19", "channel": 0}),
            ("garden", "Jardim · canal 2", {"cloudId": "private-icsee-19", "channel": 1}),
        ]
        sample_password = secrets.token_urlsafe(16)
        self.gateway.entries = {
            channel: {"id": channel, "label": label, "input": {"password": sample_password, **settings}}
            for channel, label, settings in sources
        }
        status, _, response = self.request("POST", CATALOG, "owner", {"action": "list"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(response), {"channels": [
            {"id": "patio-1", "label": "Pátio · canal 1", "status": "unknown", "lastOnlineAt": None,
             "cameraGroup": "patio-1", "cameraLabel": "Pátio"},
            {"id": "other", "label": "Pátio · canal 1", "status": "unknown", "lastOnlineAt": None},
            {"id": "patio-2", "label": "Pátio - canal 2", "status": "unknown", "lastOnlineAt": None,
             "cameraGroup": "patio-1", "cameraLabel": "Pátio"},
            {"id": "yoosee-1", "label": "Entrada (Yoosee)", "status": "unknown", "lastOnlineAt": None,
             "cameraGroup": "yoosee-1", "cameraLabel": "Entrada (Yoosee)"},
            {"id": "yoosee-2", "label": "Entrada (Yoosee)", "status": "unknown", "lastOnlineAt": None,
             "cameraGroup": "yoosee-1", "cameraLabel": "Entrada (Yoosee)"},
            {"id": "unidentified", "label": "Pátio · canal 3", "status": "unknown", "lastOnlineAt": None},
            {"id": "no-label", "label": None, "status": "unknown", "lastOnlineAt": None,
             "cameraGroup": "no-label", "cameraLabel": "Jardim"},
            {"id": "garden", "label": "Jardim · canal 2", "status": "unknown", "lastOnlineAt": None,
             "cameraGroup": "no-label", "cameraLabel": "Jardim"},
        ]})

    def test_request_cannot_choose_a_source_or_access_files_without_a_capability(self):
        self.assertEqual(self.request("POST", CATALOG, "owner",
                                      {"action": "play", "channelId": "https://example.com"})[0], 404)
        self.assertEqual(self.request("GET", MEDIA + "/" + "a" * 43 + "/index.m3u8")[0], 404)
        self.assertEqual(self.request("GET", MEDIA + "/" + "a" * 43 + "/../gateway.py")[0], 404)
        self.assertEqual(self.request("OPTIONS", CATALOG, origin="https://example.com")[0], 403)

    def test_live_stream_copies_the_source_codec_when_the_client_can_play_it(self):
        entry = self.gateway.entries["ch-1"]
        cases = [
            ("h264", True, "live", "copy", "h264.m3u8"),
            ("hevc", True, "live", "copy", "hevc.m3u8"),
            ("hevc", False, "live", "libx264", "index.m3u8"),
            ("h264", False, "playback", "libx264", "index.m3u8"),
        ]
        for codec, direct, operation, encoder, playlist in cases:
            with self.subTest(codec=codec, direct=direct, operation=operation):
                with patch("gateway.subprocess.Popen") as spawn:
                    stream = Stream({**entry, "format": codec, "input": {"operation": operation}},
                                    "/unused", "owner", preview=True, direct=direct)
                    self.addCleanup(stream.close)
                    stream.launch()
                    command = spawn.call_args.args[0]
                    self.assertEqual(command[command.index("-c:v") + 1], encoder)
                    self.assertEqual(command[-1], playlist)
                    self.assertEqual("-vf" in command, encoder != "copy")
                    if playlist == "hevc.m3u8":
                        self.assertIn("hvc1", command)
                        (Path(stream.directory.name) / playlist).write_bytes(b"#EXTINF:2")
                        self.assertTrue(stream.ready())

    def test_fragmented_mp4_media_uses_scoped_paths_and_correct_mime(self):
        capability = secrets.token_urlsafe(32)
        stream = MagicMock(capability=capability, playlist="hevc.m3u8", startup_deadline=1)
        stream.read.return_value = b"fixture"
        self.gateway.streams[("owner", "ch-1", True)] = stream
        stream.last_request = stream.expires = float("inf")
        base = f"{MEDIA}/{capability}/"
        for filename in ("init.mp4", "segment-00000001.m4s"):
            status, headers, body = self.request("GET", base + filename)
            self.assertEqual((status, body), (200, b"fixture"))
            self.assertIn(("Content-Type", "video/mp4"), headers)
        self.assertEqual(self.request("GET", base + "hevc.m3u8?ready=1")[0], 204)
        self.assertEqual(self.request("GET", base + "index.m3u8?ready=1")[0], 404)
        self.assertEqual(self.request("GET", base + "../another.mp4")[0], 404)

    def test_live_compatibility_uses_one_second_segments_with_the_same_retention_window(self):
        entry = self.gateway.entries["ch-1"]
        for preview, direct, operation, duration, keyframe_interval in (
            (False, False, "live", "1", "10"),
            (False, True, "live", "2", None),
            (True, False, "live", "1", "6"),
            (False, False, "playback", "2", "20"),
        ):
            with self.subTest(preview=preview, direct=direct, operation=operation):
                with patch("gateway.subprocess.Popen") as spawn:
                    stream = Stream({**entry, "input": {"operation": operation}},
                                    "/unused", "owner", preview=preview, direct=direct)
                    self.addCleanup(stream.close)
                    if preview:
                        stream.launch()
                    command = spawn.call_args.args[0]
                    self.assertEqual(command[command.index("-hls_time") + 1], duration)
                    self.assertNotIn("-hls_init_time", command)
                    if preview:
                        self.assertEqual(command[command.index("-hls_list_size") + 1], "24")
                        self.assertEqual(command[command.index("-hls_delete_threshold") + 1], "32")
                    interval = command[command.index("-g") + 1] if "-g" in command else None
                    self.assertEqual(interval, keyframe_interval)

    def test_raw_live_input_uses_a_shorter_probe_than_recordings_or_transport_streams(self):
        entry = self.gateway.entries["ch-1"]
        for codec, mode, expected in (
            ("h264", "live", "500000"),
            ("hevc", "live", "500000"),
            ("mpegts", "live", "1500000"),
            ("hevc", "playback", "1500000"),
        ):
            with self.subTest(codec=codec, mode=mode), patch("gateway.subprocess.Popen") as spawn:
                stream = Stream({**entry, "format": codec, "input": {"operation": mode}}, "/unused", "owner")
                self.addCleanup(stream.close)
                command = spawn.call_args.args[0]
                self.assertEqual(command[command.index("-analyzeduration") + 1], expected)

    def test_compatible_preview_does_not_displace_direct_playback_for_the_same_viewer(self):
        channel = "ch-1"
        _, _, direct = self.request("POST", CATALOG, "owner",
                                    {"action": "play-grid", "channelIds": [channel], "codecs": ["hevc"]})
        _, _, compatible = self.request("POST", CATALOG, "owner",
                                        {"action": "play-grid", "channelIds": [channel]})
        self.assertEqual(len(self.gateway.streams), 2)
        self.assertTrue(json.loads(direct)["paths"][channel].endswith("/hevc.m3u8"))
        self.assertTrue(json.loads(compatible)["paths"][channel].endswith("/index.m3u8"))

    def test_grid_authorizes_once_and_checks_each_preview_without_authenticating_again(self):
        import gateway
        from time import monotonic

        for index in range(2, 9):
            channel = f"ch-{index}"
            self.gateway.entries[channel] = {**self.gateway.entries["ch-1"], "id": channel}
        channels = list(self.gateway.entries)
        authorize = self.gateway.identity
        with patch.object(self.gateway, "identity", wraps=authorize) as identity, patch.object(gateway, "Stream") as source:
            def preview(entry, _ffmpeg, viewer, *, preview, direct):
                stream = MagicMock()
                stream.mode = "live"
                stream.channel, stream.viewer = entry["id"], viewer
                stream.preview = preview
                stream.capability = secrets.token_urlsafe(32)
                stream.direct = direct
                stream.playlist = "index.m3u8"
                stream.path = f"{MEDIA}/{stream.capability}/{stream.playlist}"
                stream.last_request = monotonic()
                stream.started_at = None
                stream.startup_deadline = None if preview else stream.last_request + 40
                def launch():
                    stream.started_at = monotonic()
                    stream.startup_deadline = monotonic() + 40
                stream.launch.side_effect = launch
                stream.expires = stream.last_request + 60
                stream.alive.return_value = True
                stream.ready.return_value = False
                stream.ready_to_play.side_effect = stream.ready
                return stream
            source.side_effect = preview
            status, _, result = self.request("POST", CATALOG, "owner",
                                             {"action": "play-grid", "channelIds": channels})
            self.assertEqual(status, 200)
            grid = json.loads(result)
            self.assertEqual(grid["busy"], [])
            paths = grid["paths"]
            self.assertEqual(list(paths), channels)
            self.assertTrue(all(call.kwargs["preview"] for call in source.call_args_list))
            self.assertEqual(self.request("GET", paths[channels[0]] + "?ready=1")[0], 202)
            self.assertEqual(self.request("GET", paths[channels[1]] + "?ready=1")[0], 202)
            self.assertEqual(self.request("GET", paths[channels[2]] + "?ready=1")[0], 202)
            third = self.gateway.streams[("owner", channels[2], False)]
            third.launch.assert_not_called()
            stream = self.gateway.streams[("owner", channels[0], False)]
            stream.ready.return_value = True
            stream.read.return_value = b"#EXTM3U\n#EXTINF:2"
            self.assertEqual(self.request("GET", paths[channels[0]] + "?ready=1")[0], 204)
            self.assertEqual(self.request("GET", paths[channels[2]] + "?ready=1")[0], 202)
            third.launch.assert_called_once()
            self.assertEqual(self.request("GET", paths[channels[0]])[0], 200)
            self.assertEqual(identity.call_count, 1)
            self.assertEqual(self.gateway.start(channels[0], "owner"), paths[channels[0]])
            stream.last_request -= 13
            self.assertEqual(self.request("GET", paths[channels[0]])[0], 200)
            for channel in channels[1:]:
                self.gateway.streams.pop(("owner", channel, False))
            another_grid = self.gateway.start_grid(channels, "another")
            self.assertEqual(len(another_grid["paths"]), 7)
            self.assertEqual(another_grid["busy"], channels[-1:])
            self.assertEqual(self.request("GET", paths[channels[0]])[0], 200)
            self.assertEqual(self.request("POST", CATALOG, "owner",
                                          {"action": "play-grid", "channelIds": channels + [channels[0]]})[0], 400)

    def test_slow_previews_leave_one_opening_slot_and_expire_without_their_own_poll(self):
        import gateway
        from types import SimpleNamespace

        now = 100
        names = [f"ch-{index}" for index in range(1, 5)]
        streams = {}
        for name in names:
            self.gateway.entries[name] = {**self.gateway.entries["ch-1"], "id": name}

        def open_stream(entry, _ffmpeg, viewer, *, preview, direct):
            name = entry["id"]
            stream = SimpleNamespace(
                viewer=viewer, channel=name, direct=direct, preview=preview, mode="live",
                last_request=now, expires=300, startup_deadline=None, started_at=None, has_video=False,
                capability=secrets.token_urlsafe(32), playlist="index.m3u8",
                alive=lambda: True, ready=lambda: name == "ch-3",
                ready_to_play=lambda: name == "ch-3", close=MagicMock(),
            )
            stream.path = f"{MEDIA}/{stream.capability}/{stream.playlist}"

            def launch():
                stream.started_at = now
                stream.startup_deadline = now + 75

            stream.launch = launch
            streams[name] = stream
            return stream

        with (patch.object(gateway.time, "monotonic", side_effect=lambda: now),
              patch("gateway.Stream", side_effect=open_stream)):
            self.gateway.start_grid(names, "owner")
            poll = lambda name: self.gateway.preview_ready(streams[name].capability)
            self.assertFalse(poll("ch-1"))
            self.assertFalse(poll("ch-2"))
            self.assertFalse(poll("ch-3"))
            self.assertIsNone(streams["ch-3"].started_at)
            now = 113
            self.assertTrue(poll("ch-3"))
            self.assertEqual(streams["ch-3"].started_at, now)
            for now in (120, 132, 145, 158, 170):
                streams["ch-1"].last_request = streams["ch-2"].last_request = now - 2
                self.assertFalse(poll("ch-4"))
                streams["ch-1"].close.assert_not_called()
                streams["ch-2"].close.assert_not_called()
            now = 175
            self.assertFalse(poll("ch-4"))
            streams["ch-1"].close.assert_called_once()
            streams["ch-2"].close.assert_called_once()

    def test_frozen_playlist_expires_while_manifest_downloads_keep_the_session_active(self):
        entry = self.gateway.entries["ch-1"]
        stream = Stream(entry, "/unused", "owner", preview=True)
        stream.directory = tempfile.TemporaryDirectory()
        self.addCleanup(stream.close)
        stream.startup_deadline = 145
        stream.alive = lambda: True
        stream.expires = 300
        self.gateway.streams[("owner", "ch-1", False)] = stream
        manifest = Path(stream.directory.name) / stream.playlist
        with patch("gateway.time.monotonic") as clock:
            clock.return_value = 100
            manifest.write_text("#EXTM3U\n#EXTINF:2\nsegment-00000010.ts\n")
            self.assertTrue(stream.ready())
            self.gateway.expire(check_progress=True)
            clock.return_value = 140
            manifest.write_text("#EXTM3U\n#EXTINF:2\nsegment-00000011.ts\n")
            self.gateway.expire(check_progress=True)
            clock.return_value = 260
            stream.last_request = 260
            self.assertTrue(self.gateway.get(stream.capability, stream.playlist))
            self.gateway.expire(check_progress=True)
            self.assertTrue(self.gateway.streams)
            clock.return_value = 270
            self.gateway.expire(check_progress=True)
            self.assertFalse(self.gateway.streams)

    def test_preview_recovery_waits_for_fresh_segments_from_a_stalled_source(self):
        entry = self.gateway.entries["ch-1"]
        stream = Stream(entry, "/unused", "owner", preview=True)
        stream.directory = tempfile.TemporaryDirectory()
        self.addCleanup(stream.close)
        stream.startup_deadline = 175
        stream.alive = lambda: True
        self.gateway.streams[("owner", "ch-1", False)] = stream
        manifest = Path(stream.directory.name) / stream.playlist
        with patch("gateway.time.monotonic") as clock:
            clock.return_value = 100
            manifest.write_text("#EXTM3U\n#EXTINF:2\nsegment-00000010.ts\n")
            self.assertTrue(self.gateway.preview_ready(stream.capability))
            clock.return_value = 125
            stream.last_request = 124
            self.assertFalse(self.gateway.preview_ready(stream.capability))
            manifest.write_text("#EXTM3U\n#EXTINF:2\nsegment-00000011.ts\n")
            self.assertTrue(self.gateway.preview_ready(stream.capability))

    def test_active_live_encoder_survives_capability_expiry_and_renews_with_authentication(self):
        entry = self.gateway.entries["ch-1"]
        for action in ("play", "play-grid"):
            with self.subTest(action=action), patch("gateway.time.monotonic") as clock:
                clock.return_value = 100
                stream = Stream(entry, "/unused", "owner", preview=True)
                stream.preview = action == "play-grid"
                stream.directory = tempfile.TemporaryDirectory()
                stream.alive = lambda: True
                stream.startup_deadline = 175
                key = ("owner", "ch-1", False)
                self.gateway.streams[key] = stream
                try:
                    manifest = Path(stream.directory.name) / stream.playlist
                    manifest.write_text("#EXTM3U\n#EXTINF:2\nsegment-00000001.ts\n")
                    self.assertTrue(stream.ready_to_play())
                    old_path = stream.path
                    clock.return_value = stream.expires - 1
                    stream.last_request = clock.return_value - 2
                    manifest.write_text("#EXTM3U\n#EXTINF:2\nsegment-00000002.ts\n")
                    self.assertEqual(self.request("GET", old_path)[0], 200)
                    clock.return_value += 2
                    self.assertEqual(self.request("GET", old_path)[0], 404)
                    self.assertIs(self.gateway.streams.get(key), stream)
                    self.assertEqual(self.request("POST", CATALOG, "another", {"action": action})[0], 403)
                    body = {"action": action, "channelId": "ch-1", "channelIds": ["ch-1"]}
                    status, _, payload = self.request("POST", CATALOG, "owner", body)
                    self.assertEqual(status, 200)
                    refreshed = json.loads(payload)
                    new_path = refreshed["paths"]["ch-1"] if stream.preview else refreshed["path"]
                    self.assertIs(self.gateway.streams[key], stream)
                    self.assertNotEqual(new_path, old_path)
                    self.assertEqual(self.request("GET", new_path)[0], 200)
                    self.assertEqual(self.request("GET", old_path)[0], 404)
                    clock.return_value += 46
                    self.assertEqual(self.request("GET", new_path)[0], 404)
                    self.assertNotIn(key, self.gateway.streams)
                finally:
                    self.gateway.streams.pop(key, None)
                    stream.close()

    def test_decoder_fallback_reuses_only_an_inactive_preview_from_the_same_account(self):
        import gateway

        entry = self.gateway.entries["ch-1"]
        previous = MagicMock(preview=True, mode="live", last_request=98, expires=200,
                             startup_deadline=None, shared=False,
                             path=f"{MEDIA}/{secrets.token_urlsafe(32)}/hevc.m3u8")
        previous.alive.return_value = True
        others = {("owner", f"ch-{index}", True): MagicMock(preview=True, last_request=99, expires=200,
                                                          startup_deadline=None)
                  for index in range(2, 9)}
        self.gateway.streams = {("owner", "ch-1", True): previous, **others}
        with patch("gateway.time.monotonic", return_value=100):
            with self.assertRaises(gateway.PlaybackError) as denied:
                self.gateway.start_grid(["ch-1"], "another", replace_path=previous.path)
            self.assertEqual(denied.exception.status, 429)
            result = self.gateway.start_grid(["ch-1"], "owner", replace_path=previous.path)
            self.assertEqual(result, {"paths": {}, "busy": ["ch-1"], "retryAfterMs": 3000})
            previous.close.assert_not_called()
        with (patch("gateway.time.monotonic", return_value=103),
              patch("gateway.Stream", return_value=MagicMock(path=f"{MEDIA}/compatible/index.m3u8"))):
            result = self.gateway.start_grid(["ch-1"], "owner", replace_path=previous.path)
            self.assertEqual(result["paths"], {"ch-1": f"{MEDIA}/compatible/index.m3u8"})
            self.assertEqual(len(self.gateway.streams), 8)
            previous.close.assert_called_once()
            for stream in others.values():
                stream.close.assert_not_called()

    def test_decoder_fallback_preserves_a_preview_opened_in_a_second_tab(self):
        import gateway

        previous = MagicMock(preview=True, mode="live", last_request=98, expires=200,
                             startup_deadline=None, shared=False,
                             path=f"{MEDIA}/{secrets.token_urlsafe(32)}/hevc.m3u8")
        self.gateway.streams[("owner", "ch-1", True)] = previous
        with (patch.object(gateway, "MAX_STREAMS", 1),
              patch("gateway.time.monotonic") as clock):
            clock.return_value = 100
            self.gateway.start_grid(["ch-1"], "owner", codecs=("hevc",))
            self.assertTrue(previous.shared)
            clock.return_value = 106
            with self.assertRaises(gateway.PlaybackError) as busy:
                self.gateway.start_grid(["ch-1"], "owner", replace_path=previous.path)
            self.assertEqual(busy.exception.status, 429)
        previous.close.assert_not_called()

    def test_eight_streams_remain_available_until_individually_expired(self):
        import gateway
        from concurrent.futures import ThreadPoolExecutor
        names = [f"camera-{index}" for index in range(1, 10)]
        config = {"origins": [], "viewers": ["owner"], "ffmpeg": "/unused", "channels": [
            {"id": name, "label": name, "format": "hevc", "command": ["/unused"]}
            for name in names
        ]}
        class FakeStream:
            def __init__(self, entry, ffmpeg, viewer, *, preview=False, direct=False):
                self.channel, self.viewer = entry["id"], viewer
                self.mode = entry.get("input", {}).get("operation", "live")
                self.preview = preview
                self.capability = self.channel
                self.direct = direct
                self.path = f"{MEDIA}/{self.capability}/index.m3u8"
                self.startup_deadline = 1
                self.last_request, self.expires = gateway.time.monotonic(), gateway.time.monotonic() + 60
                self.has_video = True
                self.closed = False
            def alive(self): return not self.closed
            def ready(self): return True
            def ready_to_play(self): return self.ready()
            def read(self, filename): return b"#EXTINF" if filename.endswith(".m3u8") else b"video"
            def close(self): self.closed = True
        with patch.object(gateway, "Stream", FakeStream):
            server = Gateway(config)
            with ThreadPoolExecutor(max_workers=8) as pool:
                list(pool.map(lambda name: server.start(name, "owner"), names[:8]))
            for name in names[:8]:
                self.assertEqual(server.get(name, "segment-1.ts"), b"video")
            with self.assertRaises(gateway.PlaybackError) as error:
                server.start(names[8], "owner")
            self.assertEqual(error.exception.status, 429)
            server.streams[("owner", names[0], False)].last_request -= 13
            server.start(names[8], "owner")
            with self.assertRaises(gateway.PlaybackError) as expired:
                server.get(names[0], "segment-1.ts")
            self.assertEqual(expired.exception.status, 404)
            self.assertEqual(server.get(names[8], "segment-1.ts"), b"video")

    def test_only_the_latest_idle_single_live_stream_is_retained_and_yields_to_a_grid(self):
        import gateway

        def mock_stream(name, used_at, *, preview=False):
            stream = MagicMock(mode="live", preview=preview, has_video=True,
                               last_request=used_at, expires=160, startup_deadline=1,
                               path=f"{MEDIA}/{name}/index.m3u8")
            stream.alive.return_value = stream.ready.return_value = True
            return stream

        server = self.gateway
        for index in range(2, 10):
            channel = f"ch-{index}"
            server.entries[channel] = {**server.entries["ch-1"], "id": channel}
        older, recent = mock_stream("older", 80), mock_stream("recent", 83)
        older_key, recent_key = ("owner", "ch-1", False), ("owner", "ch-9", False)
        server.streams.update({older_key: older, recent_key: recent})
        with patch.object(gateway.time, "monotonic", return_value=100):
            self.assertEqual(server.start("ch-9", "owner"), recent.path)
            self.assertNotIn(older_key, server.streams)
            older.close.assert_called_once()
            recent.close.assert_not_called()

        with (patch.object(gateway.time, "monotonic", return_value=113),
              patch("gateway.Stream", side_effect=lambda entry, *args, **kwargs:
                    mock_stream(entry["id"], 113, preview=kwargs["preview"]))):
            grid = server.start_grid([f"ch-{index}" for index in range(1, 9)], "owner")
            self.assertEqual(len(grid["paths"]), 8)
            self.assertEqual(grid["busy"], [])
            self.assertNotIn(recent_key, server.streams)
            recent.close.assert_called_once()
        expired = mock_stream("expired", 100)
        server.streams = {recent_key: expired}
        with patch.object(gateway.time, "monotonic", return_value=146):
            server.expire()
        self.assertFalse(server.streams)
        expired.close.assert_called_once()

    def test_a_reopened_stream_is_claimed_before_a_contending_grid_can_evict_it(self):
        import gateway

        server = self.gateway
        server.entries["ch-2"] = {**server.entries["ch-1"], "id": "ch-2"}
        stream = MagicMock(mode="live", preview=False, has_video=True, last_request=80,
                           expires=160, startup_deadline=1, path=f"{MEDIA}/existing/index.m3u8")
        stream.alive.return_value = stream.ready.return_value = True
        server.streams[("owner", "ch-1", False)] = stream
        lock = server.lock
        grid_status = []

        class ContendingGrid:
            def __enter__(self):
                lock.acquire()

            def __exit__(self, *_):
                lock.release()
                if grid_status:
                    return
                grid_status.append(None)
                try:
                    server.start_grid(["ch-2"], "owner")
                except gateway.PlaybackError as error:
                    grid_status[0] = error.status

        with (patch.object(gateway, "MAX_STREAMS", 1),
              patch.object(gateway.time, "monotonic", return_value=100),
              patch.object(server, "lock", ContendingGrid())):
            self.assertEqual(server.start("ch-1", "owner"), stream.path)
        self.assertEqual(grid_status, [429])
        stream.close.assert_not_called()

    def test_motion_requires_the_viewers_own_live_stream_and_a_valid_direction(self):
        import gateway
        class FakeStream:
            channel, viewer, mode = "ch-1", "owner", "live"
            startup_deadline = 1
            def __init__(self): self.moves = []
            def alive(self): return True
            def control(self, direction): self.moves.append(direction)
        config = {"origins": [], "viewers": ["owner"], "ffmpeg": "/unused", "channels": [
            {"id": "ch-1", "label": "Camera", "format": "hevc", "command": ["/unused"]}]}
        instance = Gateway(config)
        instance.expire = lambda: None
        stream = FakeStream()
        instance.streams[("owner", "ch-1", False)] = stream
        instance.move("ch-1", "owner", "left")
        self.assertEqual(stream.moves, ["left"])
        for viewer, direction in [("other", "left"), ("owner", "reboot")]:
            with self.assertRaises(gateway.PlaybackError):
                instance.move("ch-1", viewer, direction)

    def test_http_motion_checks_identity_and_rejects_untrusted_directions(self):
        self.assertEqual(self.request("POST", CATALOG, body={"action": "move", "channelId": "ch-1", "direction": "up"})[0], 401)
        self.assertEqual(self.request("POST", CATALOG, "another", {"action": "move", "channelId": "ch-1", "direction": "up"})[0], 403)
        self.assertEqual(self.request("POST", CATALOG, "owner", {"action": "move", "channelId": [], "direction": "up"})[0], 400)
        self.assertEqual(self.request("POST", CATALOG, "owner", {"action": "move", "channelId": "ch-1", "direction": "reboot"})[0], 400)

    def test_recordings_are_opaque_scoped_to_user_and_channel(self):
        import gateway
        from types import SimpleNamespace
        secret = secrets.token_urlsafe(16)
        config = {"origins": [], "viewers": ["owner"], "ffmpeg": "/unused", "channels": [
            {"id": "ch-1", "label": "Camera", "format": "hevc", "command": ["/unused"],
             "input": {"password": secret}}]}
        instance = Gateway(config)
        records = [{"start_time": "2026-11-23 10:00:00", "end_time": "2026-11-23 10:05:00",
                    "file_name": "/private/camera-file", "channel": 0}]
        result = SimpleNamespace(returncode=0, stdout=json.dumps(records).encode())
        with patch.object(gateway.subprocess, "run", return_value=result):
            listed = instance.recordings("ch-1", "owner", "2026-11-23")
        self.assertEqual(len(listed), 1)
        self.assertNotIn("file_name", listed[0])
        self.assertNotIn("private", json.dumps(listed))
        self.assertNotIn(secret, json.dumps(listed))
        token = listed[0]["id"]
        with self.assertRaises(gateway.PlaybackError):
            instance.recording_entry("ch-1", "other", token)
        self.assertEqual(instance.recording_entry("ch-1", "owner", token)["file_name"], "/private/camera-file")
        with self.assertRaises(gateway.PlaybackError):
            instance.recordings("ch-1", "owner", "invalid")
        with patch.object(gateway.subprocess, "run", return_value=result) as run:
            instance.recordings("ch-1", "owner", "2026-11-23", "14")
            sent = json.loads(run.call_args.kwargs["input"])
            self.assertEqual(sent["hour"], 14)
        with self.assertRaises(gateway.PlaybackError):
            instance.recordings("ch-1", "owner", "2026-11-23", "24")

    def test_camera_status_probe_copies_video_without_transcoding(self):
        import gateway
        config = {"origins": [], "viewers": ["owner"], "ffmpeg": "/unused", "channels": [
            {"id": "ch-1", "label": "Camera", "format": "hevc", "command": ["/unused"]}]}
        instance = Gateway(config)
        entry = instance.entries["ch-1"]
        with patch.object(gateway, "Stream") as stream_type:
            stream = stream_type.return_value
            stream.alive.return_value = True
            stream.ready_to_play.return_value = True
            self.assertEqual(instance.probe_icsee_channel(entry), "online")
            stream_type.assert_called_once_with(entry, "/unused", gateway.STATUS_PROBE_VIEWER,
                                                preview=True, direct=True)
            stream.close.assert_called_once_with()
        self.assertEqual(instance.streams, {})

    def test_recording_query_does_not_overload_several_live_streams(self):
        import gateway
        config = {"origins": [], "viewers": ["owner"], "ffmpeg": "/unused", "channels": [
            {"id": "ch-1", "label": "Camera", "format": "hevc", "command": ["/unused"]}]}
        instance = Gateway(config)
        instance.expire = lambda: None
        now = gateway.time.monotonic()
        instance.streams = {
            ("owner", name, False): MagicMock(last_request=now)
            for name in ("one", "two")
        }
        with patch.object(gateway.subprocess, "run") as runner:
            with self.assertRaises(gateway.PlaybackError) as error:
                instance.recordings("ch-1", "owner", "2026-11-23")
            self.assertEqual(error.exception.status, 429)
            runner.assert_not_called()
        instance.streams.clear()
        instance.query_active = True
        with self.assertRaises(gateway.PlaybackError) as error:
            instance.start("ch-1", "owner")
        self.assertEqual(error.exception.status, 429)


if __name__ == "__main__":
    unittest.main()
