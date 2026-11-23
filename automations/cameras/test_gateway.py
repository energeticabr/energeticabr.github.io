import http.client
import json
import secrets
import threading
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer

from gateway import CATALOG, MEDIA, Gateway, handler_for


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
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(gateway))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

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
        self.assertEqual(json.loads(result), {"channels": [{"id": "ch-1", "label": "Câmera de teste"}]})

    def test_request_cannot_choose_a_source_or_access_files_without_a_capability(self):
        self.assertEqual(self.request("POST", CATALOG, "owner",
                                      {"action": "play", "channelId": "https://example.com"})[0], 404)
        self.assertEqual(self.request("GET", MEDIA + "/" + "a" * 43 + "/index.m3u8")[0], 404)
        self.assertEqual(self.request("GET", MEDIA + "/" + "a" * 43 + "/../gateway.py")[0], 404)
        self.assertEqual(self.request("OPTIONS", CATALOG, origin="https://example.com")[0], 403)

    def test_multiple_streams_remain_available_until_individually_expired(self):
        import gateway
        config = {"origins": [], "viewers": ["owner"], "ffmpeg": "/unused", "channels": [
            {"id": name, "label": name, "format": "hevc", "command": ["/unused"]}
            for name in ["one", "two", "three", "four"]
        ]}
        class FakeStream:
            def __init__(self, entry, ffmpeg, viewer):
                self.channel, self.viewer = entry["id"], viewer
                self.capability = self.channel
                self.last_request, self.expires = gateway.time.monotonic(), gateway.time.monotonic() + 60
                self.closed = False
            def alive(self): return not self.closed
            def read(self, filename): return b"#EXTINF" if filename.endswith(".m3u8") else b"video"
            def close(self): self.closed = True
        with patch.object(gateway, "Stream", FakeStream):
            server = Gateway(config)
            for name in ("one", "two", "three"):
                server.start(name, "owner")
            self.assertEqual(server.get("one", "segment-1.ts"), b"video")
            self.assertEqual(server.get("three", "segment-1.ts"), b"video")
            with self.assertRaises(gateway.PlaybackError) as error:
                server.start("four", "owner")
            self.assertEqual(error.exception.status, 429)


if __name__ == "__main__":
    unittest.main()
