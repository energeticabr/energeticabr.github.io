"""Real workflow/catalog/adaptor regression; all writes stay in memory."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(os.environ.get('ENERGETICA_BACKEND_TEST_ROOT', '/opt/energetica-whatsapp'))
SOURCE = Path(os.environ.get('HOMOLOGATION_SOURCE_DIR', ROOT / 'worker'))
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT)]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


workflow = load('homologation_qa_workflow', SOURCE / 'workflow.py')
bridge = load('homologation_qa_bridge', ROOT / 'channel_bridge.py')
from clients import SharePointClient

KEY = 'homologacao_fornecedor_suprimentos'
FLOW = 'supply_supplier_registration'


class Store:
    def __init__(self):
        self.state, self.version = None, None

    def save(self, key, state, etag):
        if etag != self.version:
            raise AssertionError('stale test state')
        self.state = copy.deepcopy(state)
        self.version = str(int(self.version or 0) + 1)
        return self.version


class Catalog(SharePointClient):
    def __init__(self):
        # Static/conditional sources have no constructor dependencies.
        # The next question is the only external catalog boundary in this test.
        pass

    def get_options(self, step, context=None):
        if step['key'] == 'tipo_documento_fornecedor_suprimentos':
            return [{'id': 410, 'title': 'DOCUMENTO QA', 'value': 'DOCUMENTO QA'}]
        return super().get_options(step, context)


class HomologationTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((SOURCE / 'workflow_config.json').read_text(encoding='utf-8'))
        self.store, self.catalog, self.messenger = Store(), Catalog(), bridge.ChannelMessenger()
        self.engine = workflow.WorkflowEngine(self.config, self.store, None, self.messenger, self.catalog)
        self.steps = self.config['sharepoint'][FLOW + '_flow']['steps']
        self.index = next(i for i, step in enumerate(self.steps) if step['key'] == KEY)
        self.step = self.steps[self.index]
        self.state = self.engine._new_state({'message_id': 'qa', 'sender': 'qa',
            'conversation_id': 'qa', 'phone_number_id': 'portal-admin'}, 'qa')
        self.state.update(flow=FLOW, stage='selecting_fields', step_index=self.index,
            supplier_employment_version=2,
            fields={'TIPO': 'MÃO DE OBRA', 'EMPREITEIRO': 'NÃO', 'CADASTRO': 'FORNECEDOR QA'},
            display_values={}, answers={}, selections={}, options=[],
            embedded_return={'type': 'launch_supplier_registration', 'qa_context': 'preserve'})

    def prompt(self):
        return self.engine._prompt_next_or_summary(self.state, self.store.version)

    def reply(self, text='', reply_id=None):
        event = {'kind': 'text', 'text': text}
        if reply_id is not None:
            event['reply_id'] = reply_id
        return self.engine._handle_selection_reply(event, self.state, self.store.version, self.step)

    def assert_direct(self):
        options = self.state['options']
        self.assertEqual({item['value'] for item in options}, {'SIM', 'NÃO'})
        self.assertEqual(len(options), 2)
        self.assertEqual({item['title'] for item in options}, {'SIM', 'NÃO'})
        poll = self.messenger.messages[-1]
        labels = [item['label'] for item in poll['options']]
        self.assertEqual(len([label for label in labels if '✅ SIM' in label]), 1)
        self.assertEqual(len([label for label in labels if '❌ NÃO' in label]), 1)
        self.assertNotIn('MANTER', ' '.join(labels))
        self.assertNotIn('ESCOLHER OUTRO', ' '.join(labels))
        self.assertNotIn('FILTRAR', poll['question'])
        self.assertFalse(poll.get('databaseFilter', False))

    def test_new_question_offers_both_answers_in_all_supplier_branches(self):
        for contractor in ['SIM', 'NÃO', None]:
            with self.subTest(contractor=contractor):
                self.setUp()
                self.state['fields']['EMPREITEIRO'] = contractor
                self.prompt()
                self.assert_direct()

    def test_each_button_persists_its_value_and_preserves_parent_context(self):
        for contractor in ['SIM', 'NÃO', None]:
            for value in ['SIM', 'NÃO']:
                with self.subTest(contractor=contractor, value=value):
                    self.setUp()
                    self.state['fields']['EMPREITEIRO'] = contractor
                    self.prompt()
                    parent = copy.deepcopy(self.state['embedded_return'])
                    choices = [item for item in self.state['options'] if item['value'] == value]
                    self.assertEqual(len(choices), 1, 'Both literal answers must be selectable')
                    selected = choices[0]
                    result = self.reply(reply_id='choice:' + KEY + ':' + str(selected['id']))
                    self.assertEqual(self.state['fields']['HOMOLOGAÇÃO'], value)
                    self.assertEqual(self.state['answers'][KEY], value)
                    self.assertEqual(self.state['display_values']['HOMOLOGAÇÃO'], value)
                    self.assertEqual(result['field'], 'tipo_documento_fornecedor_suprimentos')
                    self.assertEqual(self.state['embedded_return'], parent)

    def test_resume_replaces_old_collapsed_question_without_writing_an_answer(self):
        self.state['options'] = self.legacy_options()
        self.engine._resend_current_prompt(self.state, self.store.version)
        self.assert_direct()
        self.assertNotIn('HOMOLOGAÇÃO', self.state['fields'])
        self.assertEqual(self.state['step_index'], self.index)

    @staticmethod
    def legacy_options():
        return [
            {'id': 1, 'title': '✅ SIM, MANTER — NÃO', 'value': 'NÃO', 'recommended': True},
            {'id': KEY + '__alterar_padrao', 'title': '✏️ NÃO, ESCOLHER OUTRO VALOR',
             'value': '__ESCOLHER_OUTRO_VALOR__', 'action': 'expand_recommended_selection',
             'terminal_option': True},
        ]

    def test_old_expand_button_only_reopens_the_direct_question(self):
        self.state['options'] = self.legacy_options()
        self.reply(reply_id=KEY + '__alterar_padrao')
        self.assert_direct()
        self.assertNotIn('HOMOLOGAÇÃO', self.state['fields'])
        self.assertEqual(self.state['step_index'], self.index)

    def test_second_direct_button_is_not_hidden_by_cached_collapsed_options(self):
        self.state['options'] = self.legacy_options()
        result = self.reply(reply_id='choice:' + KEY + ':2')
        self.assertEqual(self.state['fields'].get('HOMOLOGAÇÃO'), 'SIM')
        self.assertEqual(result.get('field'), 'tipo_documento_fornecedor_suprimentos')

    def test_old_keep_button_still_keeps_no_instead_of_inverting_the_answer(self):
        self.state['options'] = self.legacy_options()
        self.reply(reply_id='choice:' + KEY + ':1')
        self.assertEqual(self.state['fields'].get('HOMOLOGAÇÃO'), 'NÃO')

    def test_other_recommended_questions_keep_their_existing_confirmation(self):
        unrelated = {'key': 'other_default', 'confirm_recommended': True}
        result = self.engine._recommended_confirmation_options(self.state, unrelated,
            [{'id': 91, 'title': '⭐ CONTA QA', 'value': 'CONTA QA', 'recommended': True}])
        self.assertEqual(result[0]['title'], '✅ SIM, MANTER — CONTA QA')
        self.assertEqual(result[1]['action'], 'expand_recommended_selection')


if __name__ == '__main__':
    unittest.main()
