"""Test the patched production or mirror legacy payroll writer without a SharePoint write."""
from contextlib import contextmanager
import copy
from decimal import Decimal
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

from test_router import BASELINE, GalleryError, get_class


@unittest.skipUnless(BASELINE, "Set PAYROLL_ROUTER_BASELINE to a worker source snapshot")
class LegacyWriterTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.blocked = None
        self.verify_success = True
        self.already_created = None

        @contextmanager
        def guard(gallery, origin, token):
            self.events.append(("guard", origin, token))
            if self.blocked:
                raise GalleryError(self.blocked, "O lançamento tem aplicações no relatório IDFOLHA.", 409)
            yield self.already_created
            self.events.append(("released",))

        package = ModuleType("payroll_pending")
        package.legacy_origin_write = guard
        gallery = ModuleType("launch_gallery")
        gallery.LaunchGalleryService = lambda engine: SimpleNamespace(engine=engine)
        gallery.LaunchGalleryError = GalleryError
        modules = patch.dict(sys.modules, {"payroll_pending": package, "launch_gallery": gallery})
        modules.start()
        self.addCleanup(modules.stop)
        worker_class = get_class(
            "worker/workflow.py", None, {"_apply_launch_payroll_type", "_record_launch_payroll_type"},
            {"__package__": None, "copy": copy, "_parse_decimal": lambda value, **_: Decimal(str(value)),
             "_decimal_storage": str, "copy_launch_to_payroll": lambda *args: []},
        )
        self.worker = worker_class()
        self.worker.sharepoint = SimpleNamespace(ensure_item=self.post, verify_item=self.check)
        self.worker._send_text = lambda state, message: self.events.append(("message", message))
        self.worker._save = lambda state, etag: etag
        self.worker._prompt_launch_payroll_type = lambda state, etag: "prompt"
        self.worker._continue_launch_after_payroll = lambda state, etag: "next"

    def post(self, token, fields, **options):
        self.events.append(("post", token, fields.get("IDLANCAMENTO"), options["idempotency_field"]))
        return 456

    def check(self, *args, **options):
        self.events.append(("verify", args[0]))
        return self.verify_success

    @staticmethod
    def entry(**overrides):
        return {"item_id": 123, "IDFOLHA": 98, "fields": {
            "FORNECEDOR": "Pessoa física", "DATA": "2026-11-14", "VALOR UNITÁRIO": "10", "QUANTIDADE": "1"
        }, **overrides}

    def test_new_launch_legacy_post_and_verification_run_under_origin_guard(self):
        entry = self.entry()
        self.worker._record_launch_payroll_type({"batch_id": "fixture"}, entry, "SALÁRIO")
        self.assertEqual(entry["FOLHAPGTO_ID"], 456)
        self.assertEqual(self.events, [
            ("guard", "123", "WA-launch-payroll-fixture-123"), ("post", "WA-launch-payroll-fixture-123", 123, "Title"),
            ("verify", 456), ("released",),
        ])

    def test_observed_legacy_title_skips_second_lookup_and_post_but_verifies_item(self):
        self.already_created = 922
        entry = self.entry()
        self.worker._record_launch_payroll_type({"batch_id": "fixture"}, entry, "SALÁRIO")
        self.assertEqual(entry["FOLHAPGTO_ID"], 922)
        self.assertEqual(self.events, [
            ("guard", "123", "WA-launch-payroll-fixture-123"), ("verify", 922), ("released",),
        ])

    def test_provision_guard_uses_actual_launch_and_not_provision_id(self):
        entry = self.entry(item_id=444, provision_id=444, launch_id=123)
        self.worker._record_launch_payroll_type({"batch_id": "fixture"}, entry, "SALÁRIO")
        self.assertEqual(self.events[0], ("guard", "123", "WA-provision-payroll-444"))

    def test_provision_without_legacy_origin_uses_unchanged_post(self):
        entry = self.entry(item_id=444, provision_id=444)
        self.worker._record_launch_payroll_type({"batch_id": "fixture"}, entry, "SALÁRIO")
        self.assertEqual(self.events, [("post", "WA-provision-payroll-444", None, "Title"), ("verify", 456)])

    def test_failed_verification_never_commits_legacy_lock_or_conversation_checkpoint(self):
        self.verify_success = False
        entry = self.entry()
        with self.assertRaisesRegex(RuntimeError, "ainda não foi confirmado"):
            self.worker._record_launch_payroll_type({"batch_id": "fixture"}, entry, "SALÁRIO")
        self.assertNotIn("FOLHAPGTO_ID", entry)
        self.assertNotIn(("released",), self.events)

    def test_existing_report_allocation_skips_legacy_post_and_preserves_rest_of_flow(self):
        self.blocked = "payroll_allocation_locked"
        entry = self.entry()
        state = {"batch_id": "fixture", "pending_launch_payroll": {"selected_entries": [entry]}}
        self.assertEqual(self.worker._apply_launch_payroll_type(state, "tag", "SALÁRIO"), "next")
        self.assertNotIn("FOLHAPGTO_ID", entry)
        self.assertFalse(any(event[0] == "post" for event in self.events))
        self.assertEqual(state["pending_launch_payroll"]["type_index"], 1)
        messages = [event[1] for event in self.events if event[0] == "message"]
        self.assertTrue(any("IDFOLHA" in message for message in messages))
        self.assertFalse(any("ADICIONADO(S)" in message for message in messages))

    def test_uncertain_prior_legacy_post_retains_same_payment_checkpoint(self):
        self.blocked = "payroll_legacy_uncertain"
        entry = self.entry()
        state = {"batch_id": "fixture", "pending_launch_payroll": {"selected_entries": [entry]}}
        self.assertEqual(self.worker._apply_launch_payroll_type(state, "tag", "SALÁRIO"), "prompt")
        self.assertNotIn("type_index", state["pending_launch_payroll"])
        self.assertNotIn("FOLHAPGTO_ID", entry)
        self.assertFalse(any(event[0] == "post" for event in self.events))
