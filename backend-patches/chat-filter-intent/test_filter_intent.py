"""Isolated regression for the real, patched selection handler."""

import ast
from pathlib import Path
import sys
import unittest

SOURCE_PATH = None


def load_handler(source_path: Path):
    tree = ast.parse(source_path.read_text(encoding="utf-8"))
    method = next(node for cls in tree.body if isinstance(cls, ast.ClassDef)
                  for node in cls.body if isinstance(node, ast.FunctionDef)
                  and node.name == "_handle_selection_reply")
    module = ast.fix_missing_locations(ast.Module(body=[method], type_ignores=[]))
    namespace = {
        "normalize_text": lambda value: str(value).casefold(),
        "filter_options": lambda query, options: [
            option for option in options
            if query.casefold() in str(option.get("title", "")).casefold()
        ],
        "resolve_option": lambda reply, options, key: next(
            (option for option in options if str(option.get("id")) == str(reply)), None
        ),
    }
    exec(compile(module, str(source_path), "exec"), namespace)
    return namespace["_handle_selection_reply"]


class FakeEngine:
    def __init__(self):
        self.sent = []

    def _include_terminal_option(self, step, options):
        return options

    def _send_filtered_options(self, state, step, options):
        self.sent.append((step, options))

    def _send_options(self, state, step, options):
        self.sent.append((step, options))

    def _save(self, state, etag):
        return "saved"

    def _optional_text_target_field(self, state, step):
        return None


class FilterIntentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.handle = load_handler(SOURCE_PATH)

    def test_numeric_prefix_and_full_query_only_filter(self):
        for query, options in [
            ("8", [{"id": 8, "title": "8 - OUTRO"}, {"id": 657, "title": "657 - VERGALHÃO 8MM"}]),
            ("8mm", [{"id": 8, "title": "8 - OUTRO"}, {"id": 657, "title": "657 - VERGALHÃO 8MM"}]),
            ("0", [{"id": 0, "title": "0 - OUTRA FILIAL"}, {"id": 4, "title": "4 - 004 - EDIFÍCIO XAVANTE"}]),
            ("004", [{"id": 0, "title": "0 - OUTRA FILIAL"}, {"id": 4, "title": "4 - 004 - EDIFÍCIO XAVANTE"}]),
        ]:
            with self.subTest(query=query):
                engine = FakeEngine()
                state = {"flow": "payment", "batch_id": "test", "options": options, "step_index": 3}
                result = type(self).handle(engine, {"kind": "text", "reply_id": "filter_query", "text": query},
                                     state, None, {"key": "product"})
                self.assertEqual(result["status"], "filtered_options")
                self.assertEqual(state["step_index"], 3)
                self.assertEqual([row["id"] for row in engine.sent[-1][1]],
                                 [row["id"] for row in options if query.casefold() in row["title"].casefold()])

    def test_no_match_does_not_select_or_advance(self):
        engine = FakeEngine()
        state = {"flow": "payment", "batch_id": "test", "options": [{"id": 8, "title": "8 - OUTRO"}], "step_index": 3}
        result = type(self).handle(engine, {"kind": "text", "reply_id": "filter_query", "text": "004"},
                             state, None, {"key": "branch"})
        self.assertEqual(result["status"], "invalid_option")
        self.assertEqual(state["step_index"], 3)

    def test_old_clients_without_filter_marker_also_cannot_select_a_typed_id(self):
        for query in ("8", "0", "004"):
            with self.subTest(query=query):
                engine = FakeEngine()
                state = {"flow": "payment", "batch_id": "test", "options": [
                    {"id": 8, "title": "8 - PRODUTO"},
                    {"id": 0, "title": "0 - OUTRA FILIAL"},
                    {"id": 4, "title": "4 - 004 - EDIFÍCIO XAVANTE"},
                ], "step_index": 3}
                result = type(self).handle(engine, {"kind": "text", "text": query}, state, None, {"key": "branch"})
                self.assertEqual(result["status"], "filtered_options")
                self.assertEqual(state["step_index"], 3)


if __name__ == "__main__":
    SOURCE_PATH = Path(sys.argv[1])
    sys.argv = [sys.argv[0]]
    unittest.main()
