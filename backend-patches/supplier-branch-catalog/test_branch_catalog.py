"""Regression checks against the actual installed/candidate service modules."""
import copy
import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(os.environ["BRANCH_CATALOG_SOURCE"]) / "worker"))
from clients import SharePointClient
from workflow import WorkflowEngine
from config import load_workflow_config


class BranchCatalogTests(unittest.TestCase):
    def client(self, preferred, catalog):
        client = SharePointClient(host="example.sharepoint.com", site_path="sites/test",
            tenant_id="tenant", client_id="client", private_key_pem="key",
            certificate_pem="certificate", target_list="TESTE")
        client._field_cache["FILIAIS"] = {"Id": "Id", "FILIAL": "FILIAL"}
        client._field_cache["FORNECEDORES"] = {"CADASTRO": "CADASTRO", "FILIAL": "FILIAL"}
        def request(method, endpoint, **kwargs):
            self.assertEqual(method, "GET")
            if "GetByTitle('FILIAIS')" in endpoint:
                return {"value": copy.deepcopy(catalog)}
            self.assertIn("GetByTitle('FORNECEDORES')", endpoint)
            return {"value": [{"Id": 170, "FILIAL": preferred}]}
        client._request = request
        return client

    def options(self, preferred, catalog):
        step = {"key": "filial_lancamento", "source": {
            "type": "sharepoint_list", "list": "FILIAIS", "id_field": "Id",
            "label_field": "FILIAL", "value_field": "FILIAL", "recommended": {
                "list": "FORNECEDORES", "match_field": "CADASTRO",
                "match_value_from": "FORNECEDOR", "value_field": "FILIAL",
                "marker": "PADRÃO DO FORNECEDOR", "ensure_option": True,
            }}}
        return self.client(preferred, catalog).get_options(step, {"FORNECEDOR": "TESTE"})

    def test_missing_default_does_not_create_branch(self):
        options = self.options("004 - DIVINÓPOLIS", [{"Id": 5, "FILIAL": "004 - EDIFÍCIO XAVANTE"}])
        self.assertEqual([o["value"] for o in options], ["004 - EDIFÍCIO XAVANTE"])
        self.assertFalse(any(o.get("recommended") for o in options))

    def test_valid_default_keeps_official_id_and_value(self):
        options = self.options("004 - EDIFÍCIO XAVANTE", [{"Id": 5, "FILIAL": "004 - EDIFÍCIO XAVANTE"}])
        self.assertEqual(options[0]["id"], 5)
        self.assertEqual(options[0]["value"], "004 - EDIFÍCIO XAVANTE")
        self.assertTrue(options[0]["recommended"])

    def test_empty_catalog_is_not_replaced_by_default(self):
        self.assertEqual(self.options("004 - DIVINÓPOLIS", []), [])

    def test_override_does_not_create_branch_or_match_only_its_number(self):
        engine = WorkflowEngine.__new__(WorkflowEngine)
        options = [{"id": 5, "value": "004 - EDIFÍCIO XAVANTE", "title": "004 - EDIFÍCIO XAVANTE"}]
        for override in [None, {"id": 5, "value": "004 - DIVINÓPOLIS"}]:
            state = {"selections": {"fornecedor_lancamento": {"id": 170,
                "source_values": {"FILIAL": "004 - DIVINÓPOLIS"}}}}
            if override:
                state["launch_supplier_default_branch_overrides"] = {"170": override}
            self.assertEqual(engine._apply_launch_supplier_branch_override(state, options), options)
            self.assertEqual(engine._apply_launch_supplier_branch_override(state, []), [])

    def test_valid_override_recommends_only_existing_option(self):
        engine = WorkflowEngine.__new__(WorkflowEngine)
        state = {"selections": {"fornecedor_lancamento": {"id": 170}},
            "launch_supplier_default_branch_overrides": {"170": {"value": "004 - EDIFÍCIO XAVANTE"}}}
        options = [{"id": 5, "value": "004 - EDIFÍCIO XAVANTE", "title": "004 - EDIFÍCIO XAVANTE"}]
        result = engine._apply_launch_supplier_branch_override(state, options)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], 5)
        self.assertTrue(result[0]["recommended"])
        self.assertNotIn("recommended", options[0])

    def test_old_open_session_cannot_accept_synthetic_branch(self):
        engine = WorkflowEngine.__new__(WorkflowEngine)
        engine.config = load_workflow_config()
        engine.sharepoint = self.client("004 - DIVINÓPOLIS", [{"Id": 5, "FILIAL": "004 - EDIFÍCIO XAVANTE"}])
        # These are external messaging/persistence boundaries, not the selector.
        engine._send_text = lambda *args: None
        engine._send_options = lambda *args: None
        engine._save = lambda *args: "saved"
        step = next(s for s in engine.config["sharepoint"]["launch_flow"]["steps"] if s["key"] == "filial_lancamento")
        state = {"flow": "launch", "fields": {"FORNECEDOR": "TESTE"}, "answers": {},
            "options": [{"id": "OLD_DEFAULT", "title": "004 - DIVINÓPOLIS", "value": "004 - DIVINÓPOLIS"}]}
        result = engine._handle_selection_reply({"reply_id": "choice:filial_lancamento:OLD_DEFAULT"}, state, "etag", step)
        self.assertEqual(result["status"], "invalid_option")
        self.assertNotIn("FILIAL", state["fields"])
        self.assertNotIn("004 - DIVINÓPOLIS", [o.get("value") for o in state["options"]])


if __name__ == "__main__":
    unittest.main()
