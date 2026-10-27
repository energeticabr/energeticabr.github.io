import ast
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).parent))
from operation_progress import ProgressRegistry, advance, public_progress, stage
from patch_backend import patch_bridge

# Protocol-only fixture; live business sources are deliberately not shipped.
FIXTURE = '''from diary_progress import REGISTRY, finish_diary_request
class Bridge:
    def portal_flow_status(self, identity, *, allowed_emails):
        return None
    def portal_attachment_snapshot(self, identity, store, *, allowed_emails):
        return []
    def handle(self, payload):
        return payload
class BridgeHandler:
    def _send_json(self, status: int, payload: dict, cors_origin: str = ""):
        return status, payload
    def do_POST(self):
        path = urlsplit(self.path).path
        if path == "/portal/chat":
            origin = self.headers.get("Origin", "")
            try:
                identity = self._portal_identity()
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                action = body.get("action", "")
                if action == "diary_evidence_progress":
                    return self._send_json(200, {}, cors_origin=origin)
                if action == "launch_gallery":
                    result = self.bridge.portal_launch_gallery(identity, body.get("operation"), body.get("payload"))
                    return self._send_json(200, result, cors_origin=origin)
                else:
                    self.bridge.portal_authorize(identity, allowed_emails=self.portal_authenticator.allowed_emails)
                    result = self.bridge.handle(portal_channel_payload(body, identity))
                return self._send_json(
                    200, portal_public_result(result, identity=identity, media_store=None,
                        active_flow=self.bridge.portal_flow_status(identity, allowed_emails=set()),
                        attachments=self.bridge.portal_attachment_snapshot(identity, None, allowed_emails=set())),
                    cors_origin=origin,
                )
            except (ValueError, RuntimeError) as error:
                return self._send_json(422, {"error": str(error)}, cors_origin=origin)
'''


class PatchTests(unittest.TestCase):
    def make_handler(self, source=FIXTURE):
        patched = patch_bridge(source)
        tree = ast.parse(patched)
        handler = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "BridgeHandler")
        method = next(node for node in handler.body if isinstance(node, ast.FunctionDef) and node.name == "do_POST")
        registry = ProgressRegistry()
        calls = []
        def payload(body, identity):
            self.assertNotIn("progressRequestId", body)
            calls.append(body)
            return body
        namespace = dict(json=json, urlsplit=urlsplit, time=types.SimpleNamespace(monotonic=lambda: 0),
            portal_origin_allowed=lambda *_: True, portal_channel_payload=payload,
            portal_public_result=lambda value, **_: value, OPERATION_PROGRESS=registry,
            REGISTRY=registry, operation_stage=advance, log=lambda *_args, **_kwargs: None)
        namespace["AttachmentUnavailableError"] = type("AttachmentUnavailableError", (ValueError,), {})
        exec(compile(ast.Module(body=[method], type_ignores=[]), "patched_handler", "exec"), namespace)
        class Business:
            portal_authorize = lambda *_args, **_kwargs: None
            @stage("processing")
            def handle(self, body): return {"status": "processed", "messages": [], "results": []}
            @stage("flow")
            def portal_flow_status(self, *_args, **_kwargs): return None
            @stage("attachments")
            def portal_attachment_snapshot(self, *_args, **_kwargs): return []
            def portal_launch_gallery(self, *_args, **_kwargs): return self.handle({})
        handler = types.SimpleNamespace(path="/portal/chat", max_body_bytes=1_000_000,
            bridge=Business(), portal_origins=set(), portal_authenticator=types.SimpleNamespace(allowed_emails=set()),
            portal_media_store=None, _portal_media_root=lambda: None)
        handler._portal_identity = lambda: {"tid": "tenant", "oid": "owner"}
        handler._send_json = lambda status, value, **_: (status, public_progress(status, value))
        def send(body):
            content = json.dumps(body).encode()
            handler.rfile = io.BytesIO(content); handler.headers = {"Content-Length": str(len(content))}
            return namespace["do_POST"](handler)
        return send, registry, calls

    def test_actual_dispatch_opts_in_without_changing_business_input_or_duplicates(self):
        send, registry, calls = self.make_handler()
        status, value = send({"messageId": "request", "replyId": "input_continue", "progressRequestId": "request"})
        self.assertEqual(status, 200)
        self.assertEqual(value["operationProgress"]["percent"], 100)
        self.assertEqual(calls, [{"messageId": "request", "replyId": "input_continue"}])
        before = list(calls)
        status, progress = send({"action": "operation_progress", "requestId": "request"})
        self.assertEqual((status, progress["completed"]), (200, 5))
        self.assertEqual(calls, before)

    def test_strict_query_rejects_extra_fields_without_running_business(self):
        send, _registry, calls = self.make_handler()
        status, value = send({"action": "operation_progress", "requestId": "request", "replyId": "SIM"})
        self.assertEqual(status, 422); self.assertIn("error", value); self.assertEqual(calls, [])

    def test_untracked_requests_preserve_the_original_contract(self):
        send, _registry, calls = self.make_handler()
        status, value = send({"messageId": "old", "text": "SIM"})
        self.assertEqual(status, 200); self.assertNotIn("operationProgress", value)
        self.assertEqual(len(calls), 1)

    def test_gallery_early_return_counts_only_the_three_real_gallery_boundaries(self):
        source = FIXTURE
        if os.getenv("OPERATION_PROGRESS_BASE"):
            source = (Path(os.environ["OPERATION_PROGRESS_BASE"]) / "channel_bridge.py").read_text(encoding="utf-8-sig")
        send, _registry, calls = self.make_handler(source)
        status, value = send({"action": "launch_gallery", "operation": "snapshot", "payload": {}, "progressRequestId": "gallery-request"})
        self.assertEqual(status, 200)
        progress = value["operationProgress"]
        self.assertEqual((progress["status"], progress["percent"], progress["completed"], progress["total"]), ("complete", 100, 3, 3))
        self.assertEqual(send({"action": "operation_progress", "requestId": "gallery-request"})[1]["status"], "complete")
        self.assertEqual(calls, [])

    def test_anchors_fail_closed_and_patch_is_not_reapplied(self):
        with self.assertRaises(ValueError): patch_bridge(FIXTURE.replace('if action == "diary_evidence_progress":', 'if False:'))
        with self.assertRaises(ValueError): patch_bridge(patch_bridge(FIXTURE))

    @unittest.skipUnless(os.getenv("OPERATION_PROGRESS_BASE"), "live source snapshot is private")
    def test_current_live_handler_has_same_verified_dispatch_behavior(self):
        source = (Path(os.environ["OPERATION_PROGRESS_BASE"]) / "channel_bridge.py").read_text(encoding="utf-8-sig")
        send, _registry, calls = self.make_handler(source)
        status, value = send({"messageId": "live-fixture", "replyId": "input_continue", "progressRequestId": "live-fixture"})
        self.assertEqual(status, 200); self.assertEqual(value["operationProgress"]["percent"], 100)
        self.assertEqual(len(calls), 1)
        self.assertEqual(send({"action": "operation_progress", "requestId": "live-fixture"})[1]["percent"], 100)


if __name__ == "__main__": unittest.main()
