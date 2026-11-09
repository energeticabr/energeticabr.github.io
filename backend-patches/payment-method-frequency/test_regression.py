"""Exercise the payment-method picker with a read-only fake SharePoint."""
from pathlib import Path
import os
import sys
import unittest
from unittest.mock import Mock


root = Path(os.environ["PAYMENT_METHOD_WORKFLOW"])
sys.path[:0] = [str(root / "worker"), str(root)]
from config import load_workflow_config
from workflow import WorkflowEngine


class PaymentMethodFrequencyTests(unittest.TestCase):
    def setUp(self):
        self.sharepoint = Mock(spec=["get_options"])
        self.engine = WorkflowEngine.__new__(WorkflowEngine)
        self.engine.sharepoint = self.sharepoint
        config = load_workflow_config(root / "worker/workflow_config.json")
        self.engine.config = config
        self.step = next(step for step in config["sharepoint"]["payment_settlement_flow"]["steps"]
                         if step["key"] == "forma_pgto_baixa")
        self.state = {"flow": "payment_settlement", "fields": {}, "selections": {}}
        self.catalog = [
            {"id": 11, "title": "ENERGÉTICA BTG", "value": "ENERGÉTICA BTG"},
            {"id": 2, "title": "DINHEIRO", "value": "DINHEIRO"},
            {"id": 10, "title": "ENERGÉTICA SICOOB", "value": "ENERGÉTICA SICOOB"},
            {"id": 5, "title": "AMAEL SICOOB", "value": "AMAEL SICOOB"},
        ]

    def options(self, history):
        self.sharepoint.get_options.side_effect = [self.catalog, history]
        return self.engine._selection_options(self.state, self.step)

    def test_payment_options_follow_frequency_and_keep_ids(self):
        rows = [{"value": value} for value in
                ["energetica sicoob", " ENERGÉTICA  SICOOB ", "amael sicoob", None, "outra"]]
        options = self.options(rows)
        self.assertEqual([row["id"] for row in options], [10, 5, 2, 11])
        self.assertEqual([row["value"] for row in options],
                         ["ENERGÉTICA SICOOB", "AMAEL SICOOB", "DINHEIRO", "ENERGÉTICA BTG"])
        self.assertEqual([row["id"] for row in self.catalog], [11, 2, 10, 5])
        source = self.sharepoint.get_options.call_args.args[0]["source"]
        self.assertEqual(source["list"], "PROVISÃO PGTOS")
        self.assertEqual(source["top"], 100)
        self.assertEqual(source["sort_field"], "DATAPGTOEFETUADO")
        self.assertEqual(source["sort_direction"], "desc")
        self.assertIn({"field": "PGTOAGENDADO", "equals": "PAGO"}, source["filters"])
        self.assertEqual(self.step["presentation"], "payment_method_frequency")
        self.assertNotIn("sort_direction", self.step["source"])

    def test_ties_and_failures_keep_ascending_ids(self):
        tied = [{"value": "ENERGÉTICA BTG"}, {"value": "DINHEIRO"}]
        self.assertEqual([row["id"] for row in self.options(tied)], [2, 11, 5, 10])
        for history in ([], RuntimeError("SharePoint unavailable")):
            with self.subTest(history=history):
                self.assertEqual([row["id"] for row in self.options(history)], [2, 5, 10, 11])

    def test_rows_outside_the_100_record_window_do_not_count(self):
        history = [{"value": "ENERGÉTICA SICOOB"}] + [{"value": None}] * 99
        history += [{"value": "DINHEIRO"}] * 2
        self.assertEqual([row["id"] for row in self.options(history)], [10, 2, 5, 11])

    def test_other_flows_do_not_query_payment_history(self):
        self.state["flow"] = "launch"
        self.sharepoint.get_options.return_value = self.catalog
        self.engine._selection_options(self.state, self.step)
        self.sharepoint.get_options.assert_called_once()


if __name__ == "__main__":
    unittest.main()
