"""Run the real settlement continuation with an in-memory SharePoint boundary."""
import ast
import copy
from contextlib import contextmanager
from decimal import Decimal
import importlib.util
import os
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ["WORKFLOW_SOURCE"])
tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
engine = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "WorkflowEngine")
names = {"_maybe_prompt_settlement_payroll", "_reconcile_pending_settlement_payroll"}
namespace = {"Decimal": Decimal, "LAUNCH_PAYROLL_DECISION_STAGE": "asking_launch_payroll",
             "LAUNCH_PAYROLL_SELECTION_STAGE": "selecting_launch_payroll_entries",
             "LAUNCH_PAYROLL_SHEET_STAGE": "selecting_launch_payroll_sheet",
             "LAUNCH_PAYROLL_TYPE_STAGE": "selecting_launch_payroll_type"}
exec(compile(ast.fix_missing_locations(ast.Module(body=[n for n in engine.body
     if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[])), str(SOURCE), "exec"), namespace)


class Worker:
    def __init__(self, rubric="FGTS", competence="2027-01", due="2027-02-20", paid="2027-02-18",
                 provision_id=471, launch_id=3810, sheet_id=21, supplier="FUNCIONARIO A"):
        self.sharepoint = self
        self.provision_id, self.launch_id, self.sheet_id = provision_id, launch_id, sheet_id
        self.source = {"Title": f"ENCARGOS:{competence}:{rubric}:253", "OBS": f"{rubric} - COMPETÊNCIA {competence}",
                       "TIPOPGTO": None, "IDFOLHA": float(sheet_id), "FORNECEDOR": supplier,
                       "DATAPREVISTOPGTO": due + "T12:00:00Z", "DATAPGTOEFETUADO": paid + "T03:00:00Z",
                       "IDLANCAMENTOS": str(launch_id), "VALORTOTAL": "120.00", "QTD": "1", "FRETE": "0"}
        self.sheet = {"FORNECEDOR": supplier, "MESREFERENCIA": competence}
        self.row = {"Title": f"APP-folha-provisao-{provision_id}", "IDPROVISAO": float(provision_id), "IDFOLHA": str(sheet_id),
                    "FORNECEDOR": supplier, "TIPOPGTO": rubric, "IDLANCAMENTO": None,
                    "VALORUNITARIO": "120.00", "QTD": "1", "DATA": due + "T12:00:00Z"}
        self.launch = {"FORNECEDOR": supplier, "IDPGTOAGENDADO": str(provision_id),
                       "DATA PGTO EFETUADO": self.source["DATAPGTOEFETUADO"]}
        self.rows = [self.row]
        self.writes = []
        self.creates = []
        self.candidates = None
        self.fail_write = False
        self.uncertain_write = False
        self.sheet_count = 1
        self.confirm = True

    def _settlement_sync_payroll_tax(self, provision_id, launch_id=None):
        module_path = ROOT / "payroll_tax_settlement.py"
        if not module_path.exists():
            return False
        spec = importlib.util.spec_from_file_location("tax_sync", module_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.synchronize(self, provision_id, launch_id)

    def get_item_fields(self, item_id, fields, target_list=None):
        data = {"PROVISÃO PGTOS": self.source, "IDFOLHA": self.sheet, "LANCAMENTOS": self.launch}[target_list]
        return {k: data.get(k) for k in fields}

    def get_item_fields_with_etag(self, item_id, fields, target_list=None):
        assert target_list == "FOLHAPGTO" and item_id == 189
        return {k: self.row.get(k) for k in fields}, '"row-v1"'

    def get_options(self, step, context):
        assert step["source"]["list"] == "FOLHAPGTO"
        return [{"id": 189, "source_values": copy.deepcopy(r)} for r in self.rows]

    def _launch_payroll_sheets_for_supplier(self, supplier, *, month_key):
        assert supplier == self.source["FORNECEDOR"]
        return [{"id": self.sheet_id, "source_values": self.sheet}] * self.sheet_count

    @staticmethod
    def _launch_payroll_month_key(raw):
        if not raw:
            return None
        a, b = str(raw).split("-")
        return int(a), int(b)

    @contextmanager
    def _settlement_payroll_origin_guard(self, launch_id, title, payroll_id):
        assert launch_id == self.launch_id and title in {
            f"APP-folha-provisao-{self.provision_id}", f"WA-provision-payroll-{self.provision_id}"}
        yield None

    def update_item_with_etag(self, item_id, fields, etag, target_list=None):
        assert (item_id, etag, target_list) == (189, '"row-v1"', "FOLHAPGTO")
        if self.fail_write:
            raise TimeoutError("SharePoint offline")
        self.writes.append(fields)
        self.row.update(fields)
        if self.uncertain_write:
            self.uncertain_write = False
            raise TimeoutError("Response lost after commit")

    def ensure_item(self, token, fields, **kwargs):
        assert token == "APP-folha-provisao-471" and kwargs["merge_existing"] is False
        self.creates.append(fields)
        self.row.update(fields, Title=token)
        self.rows = [self.row]
        return 189

    def verify_item(self, item_id, fields, attachments, **kwargs):
        return self.confirm

    def _settlement_has_payroll_link(self, provision_id, **kwargs):
        return bool(self.rows)

    def _maybe_prompt_launch_payroll(self, state, etag, items):
        self.candidates = items

    def _launch_payroll_total(self, fields):
        return Decimal("120")

    def _settlement_payroll_lookup_failed(self, state, etag):
        return {"status": "settlement_payroll_load_failed"}

    def _continue_launch_after_payroll(self, state, etag):
        return {"status": "completed"}


for name in names:
    setattr(Worker, name, namespace[name])


def state(worker):
    return {"flow": "payment_settlement", "batch_id": "tax-batch", "sharepoint": {"line_items": [
        {"item_id": worker.provision_id, "verified": True, "launch_item": {"item_id": worker.launch_id},
         "expected_fields": {"ID PROVISÃO": worker.provision_id, "VALOR TOTAL": "120", "QTD": "1",
                             "DATA PGTO EFETUADO": worker.source["DATAPGTOEFETUADO"]}}]}}


class TaxSettlementTest(unittest.TestCase):
    def test_february_payment_updates_january_payslip_automatically(self):
        for rubric in ("FGTS", "INSS"):
            with self.subTest(rubric=rubric):
                w = Worker(rubric)
                w._maybe_prompt_settlement_payroll(state(w), None)
                self.assertEqual(w.row["IDLANCAMENTO"], "3810")
                self.assertEqual(w.row["DATA"][:10], "2027-02-18")
                self.assertEqual(w.row["IDFOLHA"], "21")
                self.assertEqual(w.candidates, [])

    def test_january_payment_uses_december_of_previous_year(self):
        w = Worker(competence="2026-12", due="2027-01-20", paid="2027-01-18")
        w._maybe_prompt_settlement_payroll(state(w), None)
        self.assertEqual(w.row["DATA"][:10], "2027-01-18")

    def test_late_payment_preserves_original_competence(self):
        w = Worker(paid="2027-04-02")
        w._maybe_prompt_settlement_payroll(state(w), None)
        self.assertEqual(w.row["IDLANCAMENTO"], "3810")
        self.assertEqual(w.row["DATA"][:10], "2027-04-02")

    def test_retry_does_not_duplicate_row_or_write(self):
        w = Worker()
        for _ in range(2):
            w._maybe_prompt_settlement_payroll(state(w), None)
        self.assertEqual(len(w.writes), 1)
        self.assertEqual(w.creates, [])

    def test_missing_payment_row_is_created_with_stable_provision_key(self):
        w = Worker(); w.rows = []
        w._maybe_prompt_settlement_payroll(state(w), None)
        self.assertEqual(len(w.creates), 1)
        self.assertEqual(int(w.row["IDPROVISAO"]), 471)
        self.assertEqual(w.row["TIPOPGTO"], "FGTS")
        self.assertEqual(w.candidates, [])

    def test_without_launch_still_records_actual_payment_date(self):
        w = Worker(); w.source["IDLANCAMENTOS"] = None
        s = state(w); s["sharepoint"]["line_items"][0].pop("launch_item")
        w._maybe_prompt_settlement_payroll(s, None)
        self.assertEqual(w.row["DATA"][:10], "2027-02-18")
        self.assertIsNone(w.row["IDLANCAMENTO"])

    def test_invalid_or_conflicting_destinations_are_recoverable(self):
        changes = [lambda w: w.sheet.update(MESREFERENCIA="2027-02"),
                   lambda w: w.sheet.update(FORNECEDOR="OUTRO FUNCIONARIO"),
                   lambda w: w.row.update(FORNECEDOR="OUTRO FUNCIONARIO"),
                   lambda w: w.row.update(TIPOPGTO="INSS"),
                   lambda w: w.row.update(IDLANCAMENTO="9999"),
                   lambda w: w.row.update(IDFOLHA="99"),
                   lambda w: w.rows.append(copy.deepcopy(w.row)),
                   lambda w: setattr(w, "sheet_count", 0),
                   lambda w: setattr(w, "sheet_count", 2),
                   lambda w: w.source.update(DATAPGTOEFETUADO=None),
                   lambda w: w.source.update(DATAPREVISTOPGTO="2027-03-20"),
                   lambda w: w.launch.update(IDPGTOAGENDADO="472")]
        for change in changes:
            with self.subTest(change=changes.index(change)):
                w = Worker(); change(w)
                s = state(w)
                result = w._maybe_prompt_settlement_payroll(s, None)
                self.assertEqual(result, {"status": "settlement_payroll_load_failed"})
                self.assertEqual(w.writes, [])
                self.assertEqual(w.creates, [])
                self.assertTrue(s["sharepoint"]["line_items"][0]["verified"])

    def test_uncertain_committed_update_is_reconciled_on_retry(self):
        w = Worker(); w.uncertain_write = True
        w._maybe_prompt_settlement_payroll(state(w), None)
        w._maybe_prompt_settlement_payroll(state(w), None)
        self.assertEqual(len(w.writes), 1)
        self.assertEqual(w.row["IDLANCAMENTO"], "3810")

    def test_failed_write_keeps_confirmed_settlement_for_retry(self):
        w = Worker(); w.fail_write = True
        s = state(w)
        self.assertEqual(w._maybe_prompt_settlement_payroll(s, None)["status"], "settlement_payroll_load_failed")
        self.assertTrue(s["sharepoint"]["line_items"][0]["verified"])

    def test_unconfirmed_settlement_does_not_write(self):
        w = Worker(); s = state(w); s["sharepoint"]["line_items"][0]["verified"] = False
        w._maybe_prompt_settlement_payroll(s, None)
        self.assertEqual(w.writes, [])
        self.assertEqual(w.creates, [])

    def test_ordinary_provision_keeps_existing_optional_flow(self):
        w = Worker(); w.source.update(Title="OUTRA PROVISAO", OBS="TRANSPORTE"); w.rows = []
        w._maybe_prompt_settlement_payroll(state(w), None)
        self.assertEqual(len(w.candidates), 1)
        self.assertEqual(w.writes, [])

    def test_stale_optional_payroll_resume_completes_tax_link_without_question(self):
        w = Worker(); s = state(w)
        s["stage"] = "selecting_launch_payroll_sheet"
        entry = {"item_id": 471, "provision_id": 471, "launch_id": 3810, "eligible": True}
        s["pending_launch_payroll"] = {"entries": [entry], "selected_entries": [entry.copy()]}
        result = w._reconcile_pending_settlement_payroll(s, None)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(w.row["IDLANCAMENTO"], "3810")
        self.assertEqual(w.row["DATA"][:10], "2027-02-18")

    def test_pre_upgrade_checked_session_still_runs_tax_reconciliation(self):
        w = Worker(); s = state(w); s["stage"] = "selecting_launch_payroll_sheet"
        entry = {"item_id": 471, "provision_id": 471, "launch_id": 3810, "eligible": True}
        s["pending_launch_payroll"] = {"entries": [entry], "settlement_links_checked": True}
        result = w._reconcile_pending_settlement_payroll(s, None)
        self.assertEqual(result, {"status": "completed"})
        self.assertEqual(w.row["IDLANCAMENTO"], "3810")

    def test_existing_legacy_provision_payment_is_reused(self):
        w = Worker(); w.row["Title"] = "WA-provision-payroll-471"
        w._maybe_prompt_settlement_payroll(state(w), None)
        self.assertEqual(w.row["Title"], "WA-provision-payroll-471")
        self.assertEqual(w.row["IDLANCAMENTO"], "3810")
        self.assertEqual(w.creates, [])

    def test_confirmed_group_processes_each_employee_independently(self):
        first = Worker("FGTS")
        second = Worker("INSS", provision_id=472, launch_id=3811, sheet_id=22, supplier="FUNCIONARIO B")
        original_sync = first._settlement_sync_payroll_tax
        first._settlement_sync_payroll_tax = lambda provision_id, launch_id=None: (
            original_sync(provision_id, launch_id) if provision_id == 471 else second._settlement_sync_payroll_tax(provision_id, launch_id))
        s = state(first)
        other = state(second)["sharepoint"]["line_items"][0]
        s["sharepoint"]["line_items"].append(other)
        first._maybe_prompt_settlement_payroll(s, None)
        self.assertEqual(first.row["FORNECEDOR"], "FUNCIONARIO A")
        self.assertEqual(second.row["FORNECEDOR"], "FUNCIONARIO B")
        self.assertEqual((first.row["TIPOPGTO"], second.row["TIPOPGTO"]), ("FGTS", "INSS"))
        self.assertEqual([len(first.writes), len(second.writes)], [1, 1])

    def test_missing_row_creation_must_be_confirmed(self):
        w = Worker(); w.rows = []; w.confirm = False
        self.assertEqual(w._maybe_prompt_settlement_payroll(state(w), None)["status"], "settlement_payroll_load_failed")

