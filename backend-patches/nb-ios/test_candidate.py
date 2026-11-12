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

    def test_nb_home_dispatches_only_nb_groups_and_actions(self):
        tree = ast.parse(self.patched["worker/workflow.py"])
        engine = next(node for node in tree.body if isinstance(node, ast.ClassDef)
                      and any(getattr(method, "name", "") == "_start_group_menu_options" for method in node.body))
        methods = [node for node in engine.body if getattr(node, "name", "") in {
            "_nb_portal_session", "_start_group_menu_options", "_handle_group_choice",
            "_handle_subaction_choice", "_actions_for_group", "_open_submenu",
        }]
        scope = {"normalize_text": lambda value: str(value).lower(), "PENDING_GROUP_ID": "group_pending"}
        exec(compile(ast.Module(body=methods, type_ignores=[]), "dispatch", "exec"), scope)
        obj = type("Dispatch", (), {method.name: scope[method.name] for method in methods})()
        obj._start_groups = lambda: self.catalog["start_groups"]
        obj._start_actions = lambda: self.catalog["start_actions"]
        obj._submenus = lambda: self.catalog["submenus"]
        obj._matches_menu_item = lambda command, item, **opts: command == item["id"]
        obj._mark_processed = lambda state, event_id: None
        obj._save = lambda state, etag: etag
        obj._send_group_action_menu = lambda state: None
        obj._send_start_group_menu = lambda state, prompt: None
        obj._send_subaction_menu = lambda state: None
        obj._begin_action = lambda state, etag, selected: selected["flow"]

        def state():
            return {"sender": "portal:00000000@nb-participacoes", "phone_number_id": "portal-admin",
                    "stage": "choosing_group", "batch_id": "fixture"}

        def select(reply):
            return {"reply_id": reply, "message_id": "synthetic"}

        for group in ["group_nb_participacoes", "group_personal_expenses"]:
            self.assertEqual(obj._handle_group_choice(select(group), state(), None)["group"], group)
        for unrelated in ["group_financial", "action_task", "start_today_pending_attendance"]:
            self.assertEqual(obj._handle_group_choice(select(unrelated), state(), None)["status"], "invalid_group")
        self.assertEqual(obj._handle_group_choice(select("action_rent_payment"), state(), None), "rent_payment")
        self.assertEqual(obj._handle_group_choice(select("action_personal_expense_launch"), state(), None), "personal_expense_launch")
        current = state()
        obj._handle_group_choice(select("action_nb_property_registrations"), current, None)
        self.assertEqual(obj._handle_subaction_choice(select("action_register_nb_property"), current, None), "nb_property_registration")
        self.assertEqual(obj._handle_subaction_choice(select("action_register_nb_property_group"), current, None), "nb_property_group_registration")


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=2)
