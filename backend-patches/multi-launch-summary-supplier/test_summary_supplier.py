"""Real workflow summary rows/card; synthetic data, no financial submissions."""
import copy
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(os.environ["SUMMARY_SUPPLIER_SOURCE"]).resolve()
FIXTURES = Path(os.environ.get("SUMMARY_SUPPLIER_FIXTURES", ROOT)).resolve()
source_paths = [str(ROOT / "worker"), str(ROOT), str(FIXTURES / "tests")]
sys.path[:0] = source_paths
# Load the target modules before the inherited fixtures prepend their own worker.
import workflow
import summary_cards
import test_workflow as fixtures
sys.path[:0] = source_paths
assert Path(workflow.__file__).resolve() == ROOT / "worker" / "workflow.py"
assert Path(summary_cards.__file__).resolve() == ROOT / "worker" / "summary_cards.py"
from summary_cards import SummaryCardBuilder
from PIL import Image


class SummarySupplierTests(unittest.TestCase):
    def setUp(self):
        fixtures.WorkflowTests.setUp(self)
        self.current = {
            "flow": "launch", "batch_id": "fornecedores-por-item",
            "fields": {"FORNECEDOR": "DIVERSOS"},
            "display_values": {"FORNECEDOR": "DIVERSOS"}, "attachments": [],
            "answers": {"tipo_lancamento": "LANÇAMENTO MÚLTIPLO"},
            "launch_lines": [self.line("FORNECEDOR TESTE A", "2", "10"),
                             self.line("FORNECEDOR TESTE B", "3", "20")],
        }

    @staticmethod
    def line(supplier, quantity="1", price="10"):
        fields = {"FORNECEDOR": supplier, "PRODUTO": "PEDREIRO",
                  "UN": "DIÁRIA", "TIPO DESPESA": "MÃO DE OBRA",
                  "QUANTIDADE": quantity, "VALOR UNITÁRIO": price,
                  "FRETE": "0", "DESCRIÇÃO": "EM BRANCO"}
        return {"fields": fields, "display_values": copy.deepcopy(fields),
                "answers": {"pedido_lancamento": "NOVO PEDIDO"}, "attachments": []}

    def details(self):
        return [row["value"] for row in self.engine._summary_rows(self.current)
                if row["label"].startswith("LINHA ")]

    def test_same_product_keeps_each_supplier_next_to_its_item(self):
        first, second = self.details()
        self.assertIn("PRODUTO: PEDREIRO\nFORNECEDOR: FORNECEDOR TESTE A\n", first)
        self.assertIn("PRODUTO: PEDREIRO\nFORNECEDOR: FORNECEDOR TESTE B\n", second)
        self.assertNotIn("FORNECEDOR TESTE B", first)
        self.assertNotIn("FORNECEDOR TESTE A", second)

    def test_inherited_supplier_is_repeated_even_without_edit_history(self):
        self.current["launch_lines"][1] = self.line("FORNECEDOR TESTE A")
        for detail in self.details():
            self.assertIn("FORNECEDOR: FORNECEDOR TESTE A\n", detail)

    def test_missing_or_blank_display_uses_only_its_own_saved_supplier(self):
        for value in (None, "", "   "):
            with self.subTest(display=value):
                self.current["launch_lines"][0]["display_values"]["FORNECEDOR"] = value
                self.assertIn("FORNECEDOR: FORNECEDOR TESTE A\n", self.details()[0])

    def test_supplier_label_is_preserved_when_display_differs_from_stored_value(self):
        line = self.current["launch_lines"][1]
        line["fields"]["FORNECEDOR"] = "203"
        line["display_values"]["FORNECEDOR"] = "FORNECEDOR TESTE B"
        self.assertIn("FORNECEDOR: FORNECEDOR TESTE B\n", self.details()[1])

    def test_missing_line_supplier_never_borrows_common_or_other_line_supplier(self):
        line = self.current["launch_lines"][1]
        line["fields"].pop("FORNECEDOR")
        line["display_values"].pop("FORNECEDOR")
        detail = self.details()[1]
        self.assertIn("FORNECEDOR: EM BRANCO\n", detail)
        self.assertNotIn("DIVERSOS", detail)
        self.assertNotIn("FORNECEDOR TESTE A", detail)

    def test_current_supplier_wins_over_old_edit_history(self):
        self.current["multi_launch_edit_history"] = {"1": {"FORNECEDOR": "FORNECEDOR ANTIGO"}}
        detail = self.details()[1]
        self.assertIn("FORNECEDOR: FORNECEDOR TESTE B\n", detail)

    def test_text_summary_and_real_image_receive_suppliers_without_financial_writes(self):
        self.current["launch_lines"][0] = self.line("FORNECEDOR <A> & FILHOS", "2", "10")
        with tempfile.TemporaryDirectory() as directory:
            self.engine.summary_builder = SummaryCardBuilder(directory)
            card = self.engine._send_summary_card(self.current)
            self.assertIn("FORNECEDOR: FORNECEDOR &lt;A&gt; &amp; FILHOS", card["html"])
            self.assertIn("FORNECEDOR: FORNECEDOR TESTE B", card["html"])
            self.assertIn("FORNECEDOR: FORNECEDOR <A> & FILHOS", self.engine._summary(self.current))
            with Image.open(card["path"]) as image:
                self.assertEqual(image.format, "PNG")
                self.assertEqual(image.width, 1080)
                self.assertEqual(image.height, card["height"])
                image.verify()
            self.assertEqual(self.sharepoint.items, {})
            self.assertEqual(next(row["value"] for row in card["rows"]
                                  if row["label"] == "VALOR TOTAL"), "R$ 80,00")


if __name__ == "__main__":
    unittest.main()
