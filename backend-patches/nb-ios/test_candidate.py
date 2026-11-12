import ast
import json
import sys
import unittest
from pathlib import Path

from candidate import prepare


class PatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(sys.argv.pop())
        cls.patched = prepare(cls.root)
        cls.catalog = json.loads((cls.root / "worker/workflow_config.json").read_text())["whatsapp"]

    def test_existing_menu_and_actions_supply_four_flows(self):
        areas = {"group_nb_participacoes", "group_personal_expenses"}
        groups = {item["id"] for item in self.catalog["start_groups"]}
        self.assertTrue(areas <= groups)
        actions = [item for item in self.catalog["start_actions"] if item.get("group") in areas]
        flows = {item["flow"] for item in actions if "flow" in item}
        for item in actions:
            if "submenu" in item:
                flows.update(action["flow"] for action in self.catalog["submenus"][item["submenu"]]["actions"])
        self.assertEqual(flows, {"rent_payment", "personal_expense_launch",
                                 "nb_property_registration", "nb_property_group_registration"})

    def test_sender_leaves_legacy_intact_and_scopes_authenticated_nb_account(self):
        tree = ast.parse(self.patched["channel_bridge.py"])
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "portal_sender"]
        scope = {}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), "sender", "exec"), scope)
        sender = scope["portal_sender"]
        base = {"oid": "00000000-1111-2222-3333-444444444444"}
        self.assertEqual(sender(base), f"portal:{base['oid']}")
        self.assertEqual(sender({**base, "portalApp": "nb-participacoes"}),
                         f"portal:{base['oid']}@nb-participacoes")

    def test_nb_menu_uses_production_labels_and_skips_unrelated_queries(self):
        tree = ast.parse(self.patched["worker/workflow.py"])
        engine = next(node for node in tree.body if isinstance(node, ast.ClassDef)
                      and any(getattr(method, "name", "") == "_start_group_menu_options" for method in node.body))
        methods = [node for node in engine.body if getattr(node, "name", "") in {
            "_nb_portal_session", "_start_group_menu_options", "_send_start_group_menu",
        }]
        scope = {}
        exec(compile(ast.Module(body=methods, type_ignores=[]), "menu", "exec"), scope)
        obj = type("Menu", (), scope)()
        obj._start_groups = lambda: self.catalog["start_groups"]
        results = []
        obj._send_actions = lambda state, prompt, actions, **kw: results.extend(actions)
        obj._send_start_group_menu({
            "sender": "portal:00000000@nb-participacoes",
            "phone_number_id": "portal-admin",
            "stage": "choosing_group",
        })
        self.assertEqual([item["id"] for item in results], ["group_nb_participacoes", "group_personal_expenses"])


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=2)
