"""Exercise the payment workflow with in-memory connectors."""

import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

root = Path(os.environ["PROVISION_SOURCE"])
fixtures = Path(os.environ.get("PROVISION_TESTS", "/home/opc/energetica-build/tests"))
sys.path[:0] = [os.environ.get("PROVISION_CANDIDATE", str(root / "worker")),
                str(root / "worker"), str(root), str(fixtures)]

import workflow  # Load the selected worker before the shared fixtures adjust sys.path.
import test_workflow


PRODUCT_STEP = "produto_pagamento"
BLANK = {"id": 0, "title": "EM BRANCO", "value": None}


class RequiredProductTests(unittest.TestCase):
    setUp = test_workflow.WorkflowTests.setUp

    def start_product(self, provision_type="UNICO"):
        self.flow = self.config["sharepoint"]["payment_flow"]
        index = next(index for index, step in enumerate(self.flow["steps"])
                     if step["key"] == PRODUCT_STEP)
        self.product_index = index
        state = {
            "key": "provision-product-test", "batch_id": "product-test",
            "flow": "payment", "stage": "selecting_fields", "step_index": index,
            "fields": {"FORNECEDOR": "FORNECEDOR TESTE"}, "options": [],
            "answers": {"tipo_provisao_pagamento": provision_type},
            "selections": {}, "display_values": {}, "attachments": [],
            "processed_message_ids": [],
        }
        self.sharepoint.options_by_key[PRODUCT_STEP] = [
            {"id": 21, "title": "CIMENTO TESTE", "value": "CIMENTO TESTE"},
            {"id": 20, "title": "AREIA TESTE", "value": "AREIA TESTE"},
        ]
        result = self.engine._prompt_next_or_summary(state, None)
        self.assertEqual(result["field"], PRODUCT_STEP)
        return state, result["etag"]

    def reply(self, state, etag, reply_id, message_id, text=""):
        return self.engine._handle_step_reply(
            {"kind": "text", "text": text, "reply_id": reply_id,
             "message_id": message_id}, state, etag
        )

    def test_single_product_prompt_only_has_catalog_and_registration(self):
        state, _ = self.start_product()
        self.assertEqual([row["id"] for row in state["options"]], [21, 20, "NOVO"])
        self.assertEqual(state["options"][-1]["action"], "start_embedded_product_registration")

    def test_multiple_product_prompt_still_requires_product(self):
        state, _ = self.start_product("MULTIPLOS")
        self.assertEqual([row["id"] for row in state["options"]], [21, 20, "NOVO"])

    def test_stale_blank_button_reissues_product_question(self):
        state, etag = self.start_product()
        state["options"].insert(0, BLANK)
        result = self.reply(state, etag, "choice:produto_pagamento:0", "old-blank")
        self.assertEqual(result["status"], "provision_product_required")
        self.assertEqual(state["step_index"], self.product_index)
        self.assertNotIn("PRODUTO", state["fields"])
        self.assertNotIn(0, [row["id"] for row in state["options"]])

    def test_filter_and_clear_do_not_redisplay_cached_blank(self):
        for query in ("CIMENTO", ""):
            with self.subTest(query=query):
                self.state = self.engine.state_store = test_workflow.MemoryStateStore()
                state, etag = self.start_product()
                state["options"].insert(0, BLANK)
                result = self.reply(state, etag, "filter_query", "filter", query)
                self.assertEqual(result["status"], "filtered_options" if query else "filter_cleared")
                options = self.messenger.sent[-1]["options"]
                product_ids = [row["id"] for row in options
                               if isinstance(row["id"], int) or row["id"] == "NOVO"]
                self.assertEqual(product_ids, [21, "NOVO"] if query else [21, 20, "NOVO"])
                self.assertEqual(state["step_index"], self.product_index)

    def test_resumed_product_draft_drops_old_paginated_blank(self):
        state, etag = self.start_product()
        state["options"].insert(0, BLANK)
        state["option_pagination"]["options"].insert(0, BLANK)
        result = self.engine._resume_draft_prompt(state, etag)
        self.assertEqual(result["status"], "draft_resumed")
        self.assertEqual(result["field"], PRODUCT_STEP)
        self.assertNotIn(0, [row["id"] for row in self.messenger.sent[-1]["options"]])

    def test_valid_product_advances_to_quantity(self):
        state, etag = self.start_product()
        result = self.reply(state, etag, "choice:produto_pagamento:21", "choose-product")
        self.assertEqual(result["field"], "quantidade_pagamento")
        self.assertEqual(state["fields"]["PRODUTO"], "CIMENTO TESTE")
        self.assertEqual(self.sharepoint.items, {})

    def test_legacy_draft_reopens_product_before_write(self):
        state, etag = self.start_product()
        state["fields"].update({"QTD": "2", "VALOR TOTAL": "20", "OBS": "OBS TESTE",
                                "DATA PREVISTO PGTO": "2026-11-20"})
        attachment = self.media.stage(
            {"message_id": "attachment", "original_filename": "anexo-teste.pdf"},
            state["batch_id"], state["key"]
        )
        state["attachments"] = [attachment]
        state["attachments_decision"] = "yes"
        state["attachments_phase_completed"] = True
        state["stage"] = "committing"
        state["step_index"] = len(self.flow["steps"])
        state["provision_lines"] = [self.engine._provision_snapshot(state)]
        state["provision_current_saved"] = True
        with patch.object(self.engine, "_provision_ensure_once",
                          side_effect=AssertionError("Attempted a financial write")):
            result = self.engine._persist_provision_group(state, etag, self.flow)
        self.assertEqual(result["field"], PRODUCT_STEP)
        self.assertEqual(state["stage"], "selecting_fields")
        self.assertEqual(state["edit_step_indices"], [self.product_index])
        self.assertEqual(state["fields"]["OBS"], "OBS TESTE")
        self.assertEqual(state["fields"]["QTD"], "2")
        self.assertEqual(state["attachments"], [attachment])
        self.assertNotIn("provision_commit", state)
        self.assertEqual(self.sharepoint.items, {})

        result = self.reply(state, result["etag"], "choice:produto_pagamento:21", "fix-product")
        self.assertEqual(result["status"], "awaiting_confirmation")
        self.assertEqual(len(state["provision_lines"]), 1)
        self.assertEqual(state["provision_lines"][0]["fields"]["PRODUTO"], "CIMENTO TESTE")
        self.assertEqual(state["attachments"], [attachment])
        self.assertEqual(self.sharepoint.items, {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
