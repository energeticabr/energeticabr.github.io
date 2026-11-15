"""Exercise the confirmed settlement path against an existing payslip payment."""

from pathlib import Path
from contextlib import contextmanager
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "provision-existing-payroll" / "tests"))
import test_workflow as previous


class Worker(previous.Worker):
    def __init__(self, stored_launch=None):
        self.row = {
            "Title": "APP-folha-provisao-471", "IDPROVISAO": 471.0,
            "IDFOLHA": "21", "IDLANCAMENTO": stored_launch,
        }
        self.writes = []
        self.block_origin = False
        super().__init__({471: [self.row]})

    @contextmanager
    def _settlement_payroll_origin_guard(self, launch_id, title, payroll_id):
        assert (launch_id, title, payroll_id) == (3810, self.row["Title"], 189)
        if self.block_origin:
            raise RuntimeError("O lançamento já tem rateio")
        yield None

    def get_options(self, step, context):
        return [{"id": 189, **option} for option in super().get_options(step, context)]

    def get_item_fields_with_etag(self, item_id, fields, target_list):
        assert (item_id, target_list) == (189, "FOLHAPGTO")
        return {field: self.row[field] for field in fields}, '"etag-189"'

    def update_item_with_etag(self, item_id, fields, etag, target_list):
        assert (item_id, etag, target_list) == (189, '"etag-189"', "FOLHAPGTO")
        self.writes.append(fields)
        self.row.update(fields)


def confirmed_settlement():
    state = previous.settlement(471)
    state["sharepoint"]["line_items"][0]["launch_item"] = {"item_id": 3810}
    return state


class LaunchLinkTest(unittest.TestCase):
    def test_confirmed_settlement_fills_existing_payment_link_once(self):
        worker = Worker()
        for _ in range(2):
            worker._maybe_prompt_settlement_payroll(confirmed_settlement(), None)
            self.assertEqual(worker.candidates, [])
        self.assertEqual(worker.writes, [{"IDLANCAMENTO": "3810"}])

    def test_preserves_an_existing_launch_link(self):
        worker = Worker("3999")
        worker._maybe_prompt_settlement_payroll(confirmed_settlement(), None)
        self.assertEqual(worker.candidates, [])
        self.assertEqual(worker.row["IDLANCAMENTO"], "3999")
        self.assertEqual(worker.writes, [])

    def test_resume_reconciles_a_confirmed_launch_before_skipping_payroll_prompt(self):
        worker = Worker()
        state = previous.pending_settlement(previous.SELECTION, 471)
        for key in ("entries", "selected_entries"):
            state["pending_launch_payroll"][key][0]["launch_id"] = 3810
        result = worker._reconcile_pending_settlement_payroll(state, None)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(worker.writes, [{"IDLANCAMENTO": "3810"}])

    def test_failed_link_write_gives_a_retry_after_confirmed_settlement(self):
        worker = Worker()

        def failed_write(*args):
            raise TimeoutError("SharePoint unavailable")

        worker.update_item_with_etag = failed_write
        state = confirmed_settlement()
        result = worker._maybe_prompt_settlement_payroll(state, None)
        self.assertEqual(result["status"], "settlement_payroll_load_failed")
        self.assertTrue(state["pending_launch_payroll"]["settlement_loading"])
        self.assertTrue(state["sharepoint"]["line_items"][0]["verified"])

    def test_origin_with_existing_allocation_keeps_the_provision_unlinked(self):
        worker = Worker()
        worker.block_origin = True
        result = worker._maybe_prompt_settlement_payroll(confirmed_settlement(), None)
        self.assertEqual(result["status"], "settlement_payroll_load_failed")
        self.assertEqual(worker.writes, [])
