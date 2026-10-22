"""Real workflow selection handler + real messenger + pinned pure logic.

Only the engine persistence boundary and pagination-to-messenger adapter are
isolated. No selection, query filtering or message metadata logic is mocked.
"""
import ast
import copy
import hashlib
import os
from pathlib import Path
import unittest

from bridge_fixture import PINS, document_step, messenger, pure_logic


class SelectionFilterIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(os.environ['DOCUMENT_PERSON_WORKFLOW_PATH'])
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != 'aac994185f7b6b540f32497ba79a87bb692509eb087db7c7e4598413d2a3aefd':
            raise RuntimeError('Workflow handler reference drifted')
        tree = ast.parse(raw)
        names = {'_handle_selection_reply', '_include_terminal_option', '_terminal_selection_options'}
        workflow = next(node for node in tree.body if isinstance(node, ast.ClassDef) and any(isinstance(item, ast.FunctionDef) and item.name == '_handle_selection_reply' for item in node.body))
        workflow.bases = []  # Unrelated business-action mixins are not exercised.
        workflow.body = [node for node in workflow.body if isinstance(node, ast.FunctionDef) and node.name in names]
        logic = pure_logic()
        namespace = {'normalize_text': logic.normalize_text, 'filter_options': logic.filter_options}
        module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), workflow], type_ignores=[])
        exec(compile(ast.fix_missing_locations(module), str(path), 'exec'), namespace)
        real = namespace[workflow.name]

        class Harness(real):
            def __init__(self, root):
                self.messenger = messenger(root)
                self.saved = []

            def _save(self, state, etag):
                self.saved.append(copy.deepcopy(state))
                return etag

            def _send_options(self, state, step, options):
                self.messenger.send_options(state, step, options, 20)

            def _send_filtered_options(self, state, step, options):
                self.messenger.send_filtered_options(state, step, options, 20)

            def _selection_options(self, state, step):
                raise AssertionError('Existing full catalog must be retained')

        cls.Harness = Harness

    def state(self):
        options = [{'id': i, 'title': f'Fornecedor Exemplo {i}', 'value': f'Fornecedor Exemplo {i}'} for i in range(1, 31)]
        options[26] = {'id': 27, 'title': 'José da Silva Completo', 'value': 'José da Silva Completo'}
        return {'flow': 'document', 'batch_id': 'synthetic', 'step_index': 3, 'options': options,
                'fields': {'TIPOHOMOLOGACAO': 'HOMOLOGAÇÃO CONTRATO'}, 'answers': {}, 'selections': {}}

    def query(self, engine, state, text, reply='filter_query'):
        return engine._handle_selection_reply({'kind': 'text', 'reply_id': reply, 'text': text}, state, 'synthetic-etag', document_step())

    def assert_preserved(self, engine, state, before):
        self.assertEqual(state, before)
        message = engine.messenger.messages[-1]
        self.assertIs(message.get('databaseFilter'), True)
        self.assertEqual(message.get('databaseFilterKey'), 'pessoa_relacionada')
        return message

    def test_global_full_name_outside_first_twenty_retains_scoped_choice_id(self):
        for root in PINS:
            with self.subTest(root=root):
                engine, state = self.Harness(root), self.state()
                before = copy.deepcopy(state)
                result = self.query(engine, state, 'completo jose silva')
                self.assertEqual(result['status'], 'filtered_options')
                self.assertEqual(result['option_count'], 1)
                message = self.assert_preserved(engine, state, before)
                self.assertEqual(message['options'][0]['reply'], 'choice:pessoa_relacionada:27')
                self.assertEqual(len(engine.saved), 1)

    def test_numeric_filter_does_not_advance_or_select_option(self):
        for root in PINS:
            with self.subTest(root=root):
                engine, state = self.Harness(root), self.state()
                before = copy.deepcopy(state)
                self.assertEqual(self.query(engine, state, '27')['status'], 'invalid_option')
                self.assert_preserved(engine, state, before)

    def test_no_match_then_followup_and_filter_clear_keep_full_catalog(self):
        for root in PINS:
            with self.subTest(root=root):
                engine, state = self.Harness(root), self.state()
                before = copy.deepcopy(state)
                self.assertEqual(self.query(engine, state, 'inexistente xyz')['status'], 'invalid_option')
                message = self.assert_preserved(engine, state, before)
                self.assertEqual(len(message['options']), 20)
                self.assertEqual(self.query(engine, state, 'jose silva completo')['status'], 'filtered_options')
                self.assert_preserved(engine, state, before)
                result = self.query(engine, state, '', 'filter_clear')
                self.assertEqual(result['status'], 'filter_cleared')
                self.assertEqual(result['option_count'], 30)
                message = self.assert_preserved(engine, state, before)
                self.assertEqual(message['options'][0]['reply'], 'choice:pessoa_relacionada:1')


if __name__ == '__main__':
    unittest.main()
