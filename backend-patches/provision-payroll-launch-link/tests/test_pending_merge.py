"""Test recovery of a reserved conditional update using the real journal guard."""
import ast
from contextlib import contextmanager
import os
from pathlib import Path
import unittest


class ReservedOrigin(Exception):
    pass


class Journal:
    def __init__(self):
        self.saved = None
        self.rows = []
        self.locked = False

    @contextmanager
    def lock(self, gallery, item_id):
        self.locked = True
        try:
            yield
        finally:
            self.locked = False

    def save(self, store, key, record, tag):
        assert self.locked
        self.saved = record.copy()
        return '"new-tag"'

    def guard(self):
        path = Path(os.environ["PENDING_SOURCE_FILE"])
        root = ast.parse(path.read_bytes())
        names = {"legacy_origin_write", "settled_reservation", "finish_reservation",
                 "find_application", "reservation_title", "confirmed_tokens"}
        methods = [part for part in root.body if isinstance(part, ast.FunctionDef) and part.name in names]

        def fail(code, message, status):
            raise ReservedOrigin(code, message, status)

        context = {
            "contextmanager": contextmanager, "origin_write_lock": self.lock,
            "input_id": str, "identifier": str, "load_payroll": lambda *_: self.rows,
            "is_application_title": lambda title: title.startswith("IDFOLHA-PENDENTE:"),
            "store_key": lambda *_: "origin", "load_reservation": lambda *_: (self, self.saved, '"tag"'),
            "save_reservation": self.save, "missing_confirmed": lambda *_: False,
            "populated": bool, "fail": fail, "definitive_http_rejection": lambda _error: False,
        }
        exec(compile(ast.Module(body=methods, type_ignores=[]), str(path), "exec"), context)
        return context["legacy_origin_write"]


class PendingMergeTest(unittest.TestCase):
    def test_only_the_same_conditional_update_can_resume_a_pending_reservation(self):
        journal = Journal()
        guard = journal.guard()
        title = "APP-folha-provisao-471"
        with self.assertRaises(TimeoutError):
            with guard(journal, "3810", title, existing_row_id=189):
                raise TimeoutError("The update did not take effect")
        self.assertEqual(journal.saved["status"], "pending")
        for other_title, other_row in [(title, 190), ("APP-folha-provisao-472", 189)]:
            with self.assertRaises(ReservedOrigin):
                with guard(journal, "3810", other_title, existing_row_id=other_row):
                    self.fail("Another update acquired the reserved launch")
        with guard(journal, "3810", title, existing_row_id=189):
            journal.rows.append({"Title": title, "ID": 189, "IDFOLHA": "21"})
        self.assertEqual(journal.saved["status"], "settled")

    def test_response_lost_after_write_reconciles_existing_row(self):
        journal = Journal()
        guard = journal.guard()
        title = "APP-folha-provisao-471"
        with self.assertRaises(TimeoutError):
            with guard(journal, "3810", title, existing_row_id=189):
                journal.rows.append({"Title": title, "ID": 189, "IDFOLHA": "21"})
                raise TimeoutError("Update response was lost")
        with guard(journal, "3810", title, existing_row_id=189) as already_linked:
            self.assertEqual(already_linked, 189)
        self.assertEqual(journal.saved["status"], "settled")
