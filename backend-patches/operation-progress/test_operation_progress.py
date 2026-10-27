import sys
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from operation_progress import ProgressRegistry, advance, stage, public_progress, work_units

OWNER = {"tid": "tenant", "oid": "owner"}
REQUEST = "b4523789-1539-4587-9abe-30dcb63b322a"


class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.registry = ProgressRegistry(clock=lambda: self.now, ttl=10, limit=2)

    def test_actual_completed_stages_and_finer_units(self):
        with self.registry.scope(OWNER, REQUEST):
            advance("identity")
            self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["percent"], 20)
            work_units(50)
            self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["percent"], 30)
            work_units(10)
            self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["percent"], 30)
            advance("processing"); advance("flow"); advance("attachments")
            result = public_progress(200, {"status": "processed", "messages": []})
            self.assertEqual(result["operationProgress"]["percent"], 100)
        self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["status"], "complete")

    def test_errors_never_confirm_even_after_all_stages(self):
        with self.registry.scope(OWNER, REQUEST):
            for name in ("identity", "processing", "flow", "attachments"): advance(name)
            result = public_progress(200, {"status": "processed_with_recovery", "messages": []})
            self.assertLess(result["operationProgress"]["percent"], 100)
        self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["status"], "failed")

    def test_incomplete_plan_cannot_claim_100(self):
        with self.registry.scope(OWNER, REQUEST):
            advance("identity")
            result = public_progress(200, {"status": "processed", "messages": []})
            self.assertLess(result["operationProgress"]["percent"], 100)

    def test_identity_isolation_and_bounded_expiry(self):
        with self.registry.scope(OWNER, REQUEST): advance("identity")
        self.assertEqual(self.registry.snapshot({**OWNER, "oid": "other"}, REQUEST)["status"], "unavailable")
        self.assertEqual(self.registry.snapshot({**OWNER, "tid": "other"}, REQUEST)["status"], "unavailable")
        with self.assertRaises(ValueError): self.registry.snapshot(OWNER, "../secret")
        with self.assertRaises(ValueError): self.registry.snapshot({}, REQUEST)
        self.now = 11
        self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["status"], "unavailable")
        for request in ("a", "b", "c"):
            with self.registry.scope(OWNER, request): advance("identity")
        self.assertEqual(len(self.registry.jobs), 2)

    def test_snapshot_does_not_wait_for_conversation_and_contains_no_business_data(self):
        ready = threading.Event(); release = threading.Event()
        def business():
            with self.registry.scope(OWNER, REQUEST):
                advance("identity"); ready.set(); release.wait(2)
        thread = threading.Thread(target=business); thread.start()
        try:
            self.assertTrue(ready.wait(1))
            value = self.registry.snapshot(OWNER, REQUEST)
            self.assertEqual(value["percent"], 20)
            self.assertEqual(set(value), {"requestId", "percent", "completed", "total", "stage", "status"})
        finally:
            release.set(); thread.join()

    def test_decorator_only_marks_success_and_is_noop_without_opt_in(self):
        @stage("processing")
        def business(fail=False):
            if fail: raise RuntimeError("business")
            return 42
        self.assertEqual(business(), 42)
        with self.registry.scope(OWNER, REQUEST):
            with self.assertRaises(RuntimeError): business(True)
            self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["completed"], 0)
            self.assertEqual(business(), 42)
            self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["completed"], 1)

    def test_nested_scopes_restore_parent_and_unknown_units_are_ignored(self):
        with self.registry.scope(OWNER, REQUEST):
            advance("identity"); work_units(float("nan")); work_units(None)
            with self.registry.scope(OWNER, "nested"): advance("processing")
            advance("flow")
            self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["completed"], 2)

    def test_optional_telemetry_does_not_reject_an_existing_request_identifier_on_retry(self):
        with self.registry.scope(OWNER, REQUEST): advance("identity")
        with self.registry.scope(OWNER, REQUEST):
            advance("identity"); advance("processing")
            self.assertEqual(self.registry.snapshot(OWNER, REQUEST)["completed"], 2)


if __name__ == "__main__": unittest.main()
