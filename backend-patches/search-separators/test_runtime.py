"""Run the actual provision and launch search paths with in-memory test data."""
import os
import unittest

import worker

if os.environ.get("SEARCH_CANDIDATE"):
    worker.__path__.insert(0, os.environ["SEARCH_CANDIDATE"])

from worker import launch_gallery, workflow


class RecordingWorkflow(workflow.WorkflowEngine):
    def __init__(self):
        self.sent = []

    def _send_filtered_options(self, state, step, options):
        self.sent.append(options)

    def _save(self, state, etag):
        return etag


class RuntimeSearchTests(unittest.TestCase):
    def test_provision_product_filter_keeps_both_options_and_registration(self):
        engine = RecordingWorkflow()
        titles = ["VERGALHÃO 6.3", "VERGALHÃO 6,3", "VERGALHÃO 63",
                  "VERGALHÃO 8 MM", "VERGALHÃO 8MM", "VERGALHÃO 8 CM"]
        options = [{"id": str(i), "title": title, "value": title} for i, title in enumerate(titles, 1)]
        state = {"flow": "payment", "options": options, "batch_id": "fixture", "step_index": 3}
        step = {
            "key": "produto_pagamento", "kind": "selection", "target_field": "PRODUTO",
            "terminal_option": {"id": "NOVO", "title": "CADASTRAR NOVO PRODUTO"},
        }
        for query, ids in (("6.3", ["1", "2"]), ("6,3", ["1", "2"]),
                           ("8mm", ["4", "5"]), ("8 mm", ["4", "5"])):
            with self.subTest(query=query):
                result = engine._handle_selection_reply(
                    {"kind": "text", "reply_id": "filter_query", "text": query}, state, None, step,
                )
                self.assertEqual(result["status"], "filtered_options")
                self.assertEqual([option["id"] for option in engine.sent[-1]], [*ids, "NOVO"])
                self.assertEqual(state["step_index"], 3)
                self.assertEqual([option["title"] for option in state["options"]], titles)

    def test_launch_description_uses_the_same_search_rule(self):
        service = next(cls for cls in vars(launch_gallery).values()
                       if isinstance(cls, type) and "_search_text" in vars(cls))
        instance = object.__new__(service)
        values = instance._search_text({
            "DESCRIÇÃO": "<p>Vergalhão 6,3 e barra 8 MM</p>",
            "QUANTIDADE": 1, "VALOR UNITÁRIO": 10, "FRETE": 0,
        })
        self.assertIn("vergalhao 6.3", values)
        for query in ("6.3", "8mm", "barra 8mm"):
            with self.subTest(query=query):
                self.assertTrue(launch_gallery.matches_search_terms(values, launch_gallery._search_terms(query)))
        self.assertFalse(launch_gallery.matches_search_terms(values, launch_gallery._search_terms("63")))


if __name__ == "__main__":
    unittest.main()
