"""Exercise the product-unit prompt through the launch flow with fictitious history."""
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(os.environ["UNIT_FREQUENCY_SOURCE"]).resolve()
sys.path[:0] = [str(ROOT / "worker"), str(ROOT), str(ROOT / "tests")]
import workflow  # Load the selected revision before the legacy fixtures adjust sys.path.
import test_workflow as fixtures


class ProductUnitFrequencyTests(unittest.TestCase):
    def setUp(self):
        self.h = fixtures.WorkflowTests()
        self.h.setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.h.state.directory = directory.name
        self.h.config["limits"]["inactivity_expiration_enabled"] = False
        self.catalog = [
            dict(id=5, title="t", value="t"),
            dict(id=7, title="m²", value="m²"),
            dict(id=9, title="m³", value="m³"),
            dict(id=10, title="KG", value="KG"),
        ]
        self.history = [
            dict(id=number, value="t" if number <= 100 else " M3 ")
            for number in range(1, 161)
        ]
        self.reads = []
        self.history_unavailable = False
        original_get_options = self.h.sharepoint.get_options

        def get_options(step, context=None):
            if step["key"] == "recent_launch_unit_usage":
                self.reads.append(step["source"])
                if self.history_unavailable:
                    raise RuntimeError("History unavailable")
                return self.history
            if step["key"] == "unidade_produto_cadastro":
                return self.catalog
            return original_get_options(step, context)

        self.h.sharepoint.get_options = get_options

    def ask_for_unit(self):
        seed = fixtures.event("unit-frequency-seed", "text")
        parent = self.h.engine._new_state(seed, fixtures.conversation_key(seed))
        parent.update(flow="launch", stage="selecting_fields")
        steps = self.h.engine._flow_config(parent)["steps"]
        parent["step_index"] = next(i for i, step in enumerate(steps) if step["key"] == "produto_lancamento")
        response = self.h.engine._start_embedded_product_registration(parent, None)
        self.assertEqual(response["field"], "subfamilia_produto_cadastro")
        state, etag = self.h.state.load(parent["key"])
        state["fields"].update(PRODUTO="PRODUTO FICTÍCIO", TIPODESPESA="MATERIAL")
        steps = self.h.engine._flow_config(state)["steps"]
        state["step_index"] = next(i for i, step in enumerate(steps) if step["key"] == "unidade_produto_cadastro")
        response = self.h.engine._prompt_next_or_summary(state, etag)
        self.assertEqual(response["field"], "unidade_produto_cadastro")
        state = next(iter(self.h.state.values.values()))[0]
        return [option["id"] for option in state["options"]]

    def test_prompt_ranks_only_latest_100_and_preserves_selectable_ids(self):
        self.assertEqual(self.ask_for_unit(), [9, 5, 7, 10])
        poll = self.h.messenger.sent[-1]
        self.assertEqual(poll["presentation"], "product_unit_frequency")
        choices = [option["id"] for option in poll["options"] if isinstance(option["id"], int)]
        self.assertEqual(choices, [9, 5, 7, 10])
        (source,) = self.reads
        self.assertEqual((source["list"], source["value_field"], source["fields"]),
                         ("LANCAMENTOS", "UN", ["Id", "UN"]))
        self.assertEqual((source["top"], source["sort_field"], source["sort_direction"]),
                         (100, "Id", "desc"))
        self.assertFalse(source.get("distinct") or source.get("filters"))
        result = self.h.reply(reply_id="choice:unidade_produto_cadastro:9")
        self.assertEqual(result["status"], "awaiting_confirmation")
        state = next(iter(self.h.state.values.values()))[0]
        self.assertEqual(state["fields"]["UNIDADE"], "m³")
        self.assertEqual(self.h.sharepoint.items, {})

    def test_ties_keep_catalog_order_and_square_and_cubic_meters_are_distinct(self):
        self.history = [
            dict(id=1, value="M3"),
            dict(id=2, value=" m² "),
            dict(id=3, value=" kg "),
            dict(id=4, value="M2"),
        ]
        self.assertEqual(self.ask_for_unit(), [7, 9, 10, 5])

    def test_catalog_is_available_when_history_fails(self):
        self.history_unavailable = True
        self.assertEqual(self.ask_for_unit(), [5, 7, 9, 10])
        self.assertEqual(len(self.reads), 1)


if __name__ == "__main__":
    unittest.main()
