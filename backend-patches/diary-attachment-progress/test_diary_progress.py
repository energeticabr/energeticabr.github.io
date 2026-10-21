import ast
import io
import math
import os
import sys
import tempfile
import threading
import types
import json
import time
import unittest
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).parent))
from diary_progress import ProgressRegistry, emit_progress, finish_diary_request
from patch_backend import patch_sources

OWNER = {"tid": "tenant", "oid": "owner"}
REQUEST = "f7d76b08-62b3-4507-9ee4-8c49f5fa1801"


class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.registry = ProgressRegistry(clock=lambda: self.now, ttl=10, limit=2)

    def test_progress_is_monotonic_and_100_requires_completed_work(self):
        with self.registry.scope(OWNER, REQUEST):
            self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["percent"], 0)
            emit_progress(37, "photos")
            emit_progress(12, "photos")
            emit_progress(100, "photos")
            self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["percent"], 99)
        result = self.registry.snapshot(OWNER, REQUEST)
        self.assertEqual((result["percent"], result["status"]), (99, "failed"))

    def test_complete_only_after_public_response_and_explicit_finalization(self):
        def handle():
            emit_progress(99, "ready")
            return {"status": "processed", "messages": []}
        result = finish_diary_request(OWNER, {"messageId": REQUEST},
                                     handle, lambda value: value, registry=self.registry)
        self.assertEqual(result["diaryEvidenceProgress"]["percent"], 100)
        self.assertEqual(result["diaryEvidenceProgress"]["status"], "complete")

    def test_valid_error_response_does_not_claim_completion(self):
        result = finish_diary_request(OWNER, {"messageId": REQUEST},
            lambda: {"status": "processed", "results": [{"status": "diary_evidence_generation_failed"}]},
            lambda value: value, registry=self.registry)
        self.assertEqual(result["diaryEvidenceProgress"]["status"], "failed")
        self.assertLess(result["diaryEvidenceProgress"]["percent"], 100)

    def test_late_workflow_recovery_after_ready_never_reports_100(self):
        def handle():
            emit_progress(99, "ready")
            # The bridge recovers when the draft-marker save fails after PDF creation.
            return {"status": "processed_with_recovery", "messages": [],
                    "results": [{"status": "flow_paused_after_error"}]}
        result = finish_diary_request(OWNER, {"messageId": REQUEST}, handle, lambda value: value, registry=self.registry)
        self.assertEqual(result["diaryEvidenceProgress"]["status"], "failed")
        self.assertEqual(result["diaryEvidenceProgress"]["percent"], 99)

    def test_failed_public_response_never_reports_success(self):
        def handle():
            emit_progress(99, "ready")
            return {}
        def public(_):
            raise RuntimeError("response unavailable")
        with self.assertRaises(RuntimeError):
            finish_diary_request(OWNER, {"messageId": REQUEST}, handle, public, registry=self.registry)
        self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["status"], "failed")

    def test_other_identity_and_tenant_cannot_read_and_queries_do_not_wait_for_work(self):
        entered, release = threading.Event(), threading.Event()
        def process():
            with self.registry.scope(OWNER, REQUEST):
                emit_progress(37, "photos")
                entered.set()
                release.wait(2)
        thread = threading.Thread(target=process)
        thread.start()
        try:
            self.assertTrue(entered.wait(1))
            self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["percent"], 37)
            for identity in [{"tid": "tenant", "oid": "other"}, {"tid": "other", "oid": "owner"}]:
                self.assertEqual(self.registry.snapshot(identity, REQUEST)["status"], "unavailable")
        finally:
            release.set()
            thread.join()

    def test_expiry_and_capacity_are_bounded(self):
        for n in range(3):
            with self.registry.scope(OWNER, str(n)):
                emit_progress(37, "photos")
        self.assertEqual(self.registry.snapshot(OWNER, "0")["status"], "unavailable")
        self.now = 11
        self.assertEqual(self.registry.snapshot(OWNER, "2")["status"], "unavailable")

    def test_malformed_numeric_values_and_unknown_stages_are_ignored(self):
        with self.registry.scope(OWNER, REQUEST):
            for value in [None, "37", True, math.nan, math.inf, -1]:
                emit_progress(value, "photos")
            emit_progress(90, "<script>")
            self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["percent"], 0)
            emit_progress(37, "photos")
            self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["stage"], "photos")

    def test_context_is_not_left_bound_for_the_next_request(self):
        with self.registry.scope(OWNER, REQUEST):
            emit_progress(20, "photos")
        emit_progress(99, "ready")
        self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["percent"], 20)

    def test_current_graph_authenticator_identity_without_tid_is_supported(self):
        # The deployed authenticator returns a Graph /me profile, not JWT claims.
        identity = {"oid": "directory-object-id", "email": "user@example.com",
                    "name": "QA", "userPrincipalName": "user@example.com", "userType": "Member"}
        with self.registry.scope(identity, REQUEST):
            emit_progress(37, "photos")
            self.assertEqual(self.registry.snapshot(identity, REQUEST)["percent"], 37)
            self.assertEqual(self.registry.snapshot({**identity, "oid": "other"}, REQUEST)["status"], "unavailable")


class PatchedBuilderTests(unittest.TestCase):
    def test_real_builder_emits_per_photo_progress_and_does_not_complete_itself(self):
        source = Path(os.environ["DIARY_PROGRESS_BASE"]) if os.environ.get("DIARY_PROGRESS_BASE") else None
        if source is None:
            self.skipTest("pass source directory using DIARY_PROGRESS_BASE")
        self.check_builder(source)

    def check_builder(self, source):
        from PIL import Image
        import types
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            patch_sources(source, target)
            for name in ["channel_bridge.py", "worker/diary_evidence.py", "worker/workflow.py"]:
                compile((target / name).read_text(encoding="utf-8"), name, "exec")
            builder_module = types.ModuleType("progress_test_builder")
            exec(compile((target / "worker/diary_evidence.py").read_text(encoding="utf-8"), "diary_evidence.py", "exec"), builder_module.__dict__)
            output = io.BytesIO()
            Image.new("RGB", (40, 40), "blue").save(output, format="JPEG")
            content = output.getvalue()
            class Media:
                def read(self, item):
                    return content
            builder = builder_module.ConstructionDiaryEvidenceBuilder(Media(), target)
            photos = [{"message_id": str(i), "mime_type": "image/jpeg"} for i in range(4)]
            updates = []
            registry = ProgressRegistry()
            with registry.scope(OWNER, REQUEST, observer=lambda p: updates.append(p)):
                preview = builder.build_preview([{"message_ids": ["0", "1", "2", "3"]}], photos, "test", 1)
            self.assertEqual(preview["photo_count"], 4)
            self.assertEqual([p["percent"] for p in updates if p["stage"] == "photos"], [18, 37, 56, 75])
            self.assertFalse(any(p["percent"] == 100 for p in updates))

            # Joining/compressing an existing diary reports completed pages too.
            from reportlab.pdfgen import canvas
            source_pdf = target / "three-pages.pdf"
            output_pdf = canvas.Canvas(str(source_pdf))
            for _ in range(3):
                output_pdf.drawString(10, 20, "Synthetic evidence")
                output_pdf.showPage()
            output_pdf.save()
            merging = []
            with registry.scope(OWNER, REQUEST, observer=lambda p: merging.append(p)):
                pages = builder._render_combined_pdf([source_pdf], target / "merged.pdf", dpi=36, quality=24)
            self.assertEqual(pages, 3)
            self.assertEqual([p["percent"] for p in merging if p["stage"] == "merging"], [92, 95, 98])

    def test_http_status_route_authenticates_and_bypasses_all_conversation_methods(self):
        base = os.environ.get("DIARY_PROGRESS_BASE")
        if not base:
            self.skipTest("set DIARY_PROGRESS_BASE for deployed-source integration")
        with tempfile.TemporaryDirectory() as temporary:
            patch_sources(Path(base), Path(temporary))
            tree = ast.parse((Path(temporary) / "channel_bridge.py").read_text(encoding="utf-8"))
            method = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "do_POST")
            registry = ProgressRegistry()
            scope = {"urlsplit": urlsplit, "time": time, "json": json, "REGISTRY": registry,
                "portal_origin_allowed": lambda *_: True, "log": lambda *_a, **_k: None,
                "AttachmentUnavailableError": type("AttachmentUnavailableError", (Exception,), {})}
            exec(compile(ast.Module(body=[method], type_ignores=[]), "channel_bridge.py", "exec"), scope)
            class ForbiddenBridge:
                def __getattr__(self, key):
                    raise AssertionError("A status query must not touch the conversation: " + key)
            class Handler:
                path = "/portal/chat"
                max_body_bytes = 10000
                portal_origins = set()
                bridge = ForbiddenBridge()
                authenticated = True
                auth_calls = 0
                def _portal_identity(self):
                    self.auth_calls += 1
                    if not self.authenticated:
                        raise PermissionError("no token")
                    return OWNER
                def _send_json(self, status, payload, **kwargs):
                    return status, payload
                def query(self, body):
                    data = json.dumps(body).encode()
                    self.headers = {"Content-Length": str(len(data))}
                    self.rfile = io.BytesIO(data)
                    return scope["do_POST"](self)
            handler = Handler()
            with registry.scope(OWNER, REQUEST):
                emit_progress(37, "photos")
                status, value = handler.query({"action": "diary_evidence_progress", "requestId": REQUEST})
                self.assertEqual((status, value["percent"]), (200, 37))
                self.assertEqual(handler.auth_calls, 1)
                handler.authenticated = False
                self.assertEqual(handler.query({"action": "diary_evidence_progress", "requestId": REQUEST})[0], 401)
                handler.authenticated = True
                self.assertEqual(handler.query({"action": "diary_evidence_progress", "requestId": REQUEST, "text": "do not execute"})[0], 422)


if __name__ == "__main__":
    unittest.main()
