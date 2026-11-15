"""Exercise the gallery transfer plan with a provision-backed original payment."""
import ast
import os
from pathlib import Path
import unittest


class TransferRejected(Exception):
    pass


def transfer_plan():
    source = Path(os.environ["GALLERY_SOURCE_FILE"])
    root = ast.parse(source.read_bytes())
    service = next(node for node in root.body
                   if isinstance(node, ast.ClassDef) and node.name == "LaunchGalleryService")
    method = next(node for node in service.body
                  if isinstance(node, ast.FunctionDef) and node.name == "_payroll_transfer_plan")

    def fail(code, message, status):
        raise TransferRejected(code, message, status)

    namespace = {"_fail": fail}
    exec(compile(ast.Module(body=[method], type_ignores=[]), str(source), "exec"), namespace)
    return namespace["_payroll_transfer_plan"]


class Gallery:
    def _pending_payroll_rows(self, item_id):
        return [{"ID": 189, "Title": "APP-folha-provisao-471"}]

    def _supplier_key(self, name):
        return name.casefold()

    def _field(self, list_name, label):
        raise AssertionError("The transfer must be rejected before resolving write columns")


class SupplierChangeTest(unittest.TestCase):
    def test_supplier_change_is_rejected_before_transferring_a_provision_payment(self):
        with self.assertRaises(TransferRejected) as rejected:
            transfer_plan()(Gallery(), "3810", "OUTRO", {"FORNECEDOR": "RAFAEL"})
        self.assertEqual(rejected.exception.args[0], "payroll_provision_link")
