"""Regressions assert actual outbound metadata from both real messenger classes."""
import copy
import os
import unittest

from bridge_fixture import PINS, document_step, messenger


class DocumentPersonFilterTests(unittest.TestCase):
    def setUp(self):
        self.step = document_step()

    def send(self, root, *, step=None, state=None, options=None, method="_send_option_poll"):
        bridge = messenger(root, baseline=os.getenv("DOCUMENT_PERSON_BASELINE") == "1")
        step = copy.deepcopy(self.step if step is None else step)
        state = copy.deepcopy(state if state is not None else {"flow": "document", "fields": {}})
        options = copy.deepcopy(options if options is not None else [{"id": 42, "title": "Pessoa Exemplo", "value": "Pessoa Exemplo"}])
        before = copy.deepcopy((state, step, options))
        if method == "_send_option_poll":
            bridge._send_option_poll(state, step, options)
        else:
            getattr(bridge, method)(state, step, options, 20)
        self.assertEqual((state, step, options), before, "Classification must not mutate workflow input")
        return bridge.messages

    def assert_filter(self, messages, expected, key="pessoa_relacionada"):
        self.assertEqual(len(messages), 1)
        if expected:
            self.assertIs(messages[0].get("databaseFilter"), True)
            self.assertEqual(messages[0].get("databaseFilterKey"), key)
        else:
            self.assertNotIn("databaseFilter", messages[0])
            self.assertNotIn("databaseFilterKey", messages[0])

    def test_actual_document_config_all_homologation_branches_enable_filter(self):
        for root in PINS:
            for homologation in ("HOMOLOGAÇÃO FILIAL", "HOMOLOGAÇÃO CONTRATO", "HOMOLOGAÇÃO MÃO DE OBRA", "HOMOLOGAÇÃO COMERCIAL", "OUTRA", None):
                with self.subTest(root=root, homologation=homologation):
                    self.assert_filter(self.send(root, state={"flow": "document", "fields": {"TIPOHOMOLOGACAO": homologation}}), True)

    def test_active_branch_only_and_answers_override_fields(self):
        step = {**self.step, "source": {"type": "conditional", "branches": [
            {"when": {"field": "TIPOHOMOLOGACAO", "equals": "ESTÁTICO"}, "source": {"type": "static", "options": []}},
        ], "default": {"type": "union", "sources": [{"type": "sharepoint_list"}, {"type": "sharepoint_list"}]}}}
        for root in PINS:
            for fields, answers, expected in (("ESTÁTICO", "BANCO", True), ("BANCO", "ESTÁTICO", False), ("ESTÁTICO", None, False), ("BANCO", None, True)):
                with self.subTest(root=root, fields=fields, answers=answers):
                    state = {"flow": "document", "fields": {"TIPOHOMOLOGACAO": fields}, "answers": {} if answers is None else {"TIPOHOMOLOGACAO": answers}}
                    self.assert_filter(self.send(root, step=step, state=state), expected)

    def test_union_requires_nonempty_all_database_children(self):
        for root in PINS:
            for children, expected in (([{"type": "sharepoint_list"}, {"type": "sharepoint_list"}], True), ([], False), ([{"type": "static"}], False), ([{"type": "sharepoint_list"}, {"type": "static"}], False)):
                with self.subTest(root=root, children=children):
                    self.assert_filter(self.send(root, step={**self.step, "source": {"type": "union", "sources": children}}), expected)

    def test_static_unknown_and_missing_sources_never_enable_filter(self):
        for root in PINS:
            for source in ({"type": "static"}, {"type": "lookup_chain"}, {}, None, {"type": "conditional", "branches": []}):
                with self.subTest(root=root, source=source):
                    self.assert_filter(self.send(root, step={**self.step, "source": source}), False)

    def test_direct_text_and_freeform_do_not_enable_filter(self):
        for root in PINS:
            for source in (self.step["source"], {"type": "sharepoint_list"}, {"type": "static"}):
                with self.subTest(root=root, source=source["type"]):
                    self.assert_filter(self.send(root, step={**self.step, "source": source, "accepts_direct_text": True}), False)

    def test_other_conditional_steps_and_flows_remain_unflagged(self):
        for root in PINS:
            with self.subTest(root=root):
                self.assert_filter(self.send(root, step={**self.step, "key": "unrelated"}), False)
                self.assert_filter(self.send(root, state={"flow": "unrelated", "fields": {}}), False)
                self.assert_filter(self.send(root, state={}), False)

    def test_existing_direct_list_behavior_is_preserved(self):
        for root in PINS:
            with self.subTest(root=root):
                self.assert_filter(self.send(root, step={**self.step, "key": "supplier", "source": {"type": "sharepoint_list"}}, state={"flow": "other"}), True, "supplier")

    def test_poll_option_ids_and_presentation_are_preserved(self):
        options = [{"id": 42, "title": "Pessoa Exemplo", "tone": "success", "disabled": False}, {"id": "filter_clear", "title": "Limpar"}]
        for root in PINS:
            with self.subTest(root=root):
                messages = self.send(root, step={**self.step, "presentation": "cards"}, options=options)
                self.assert_filter(messages, True)
                self.assertEqual(messages[0]["presentation"], "cards")
                self.assertEqual(messages[0]["options"][0]["id"], "choice:pessoa_relacionada:42")
                self.assertEqual(messages[0]["options"][0]["reply"], "choice:pessoa_relacionada:42")
                self.assertEqual(messages[0]["options"][1]["reply"], "filter_clear")
                self.assertEqual(messages[0]["options"][0]["tone"], "success")
                self.assertIs(messages[0]["options"][0]["disabled"], False)

    def test_one_option_normal_and_filtered_polls_keep_metadata(self):
        for root in PINS:
            for method, reply in (("send_options", "refresh_options"), ("send_filtered_options", "filter_clear")):
                with self.subTest(root=root, method=method):
                    messages = self.send(root, method=method)
                    self.assert_filter(messages, True)
                    self.assertEqual(messages[0]["options"][1]["reply"], reply)

    def test_zero_visible_poll_keeps_filter_metadata(self):
        for root in PINS:
            with self.subTest(root=root):
                messages = self.send(root, options=[])
                self.assert_filter(messages, True)
                self.assertEqual(messages[0]["options"], [])

    def test_empty_option_wrappers_keep_existing_behavior(self):
        for root in PINS:
            with self.subTest(root=root):
                normal = self.send(root, options=[], method="send_options")
                self.assertEqual(normal[0]["type"], "text")
                self.assertNotIn("databaseFilter", normal[0])
                self.assertEqual(self.send(root, options=[], method="send_filtered_options"), [])


if __name__ == "__main__":
    unittest.main()
