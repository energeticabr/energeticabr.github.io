"""Behavioral regression against real workflow/adaptor; no tenant or session writes."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(os.environ.get('ENERGETICA_BACKEND_TEST_ROOT', '/opt/energetica-whatsapp'))
SOURCE = Path(os.environ.get('ACTIVITY_SOURCE_DIR', ROOT / 'worker'))
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT)]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


workflow = load('activity_qa_workflow', SOURCE / 'workflow.py')
bridge_path = SOURCE / 'channel_bridge.py'
if not bridge_path.exists() and (SOURCE.parent / 'channel_bridge.py').exists():
    bridge_path = SOURCE.parent / 'channel_bridge.py'
bridge = load('activity_qa_bridge', bridge_path if bridge_path.exists() else ROOT / 'channel_bridge.py')
KEY = 'atividade_demonstrativo_etapa'
INSTRUCTION = ('SE PREFERIR, DIGITE SUA PRÓPRIA DESCRIÇÃO E CLIQUE EM ENVIAR PARA USÁ-LA '
               'COMO DESCRIÇÃO DA ATIVIDADE. VOCÊ TAMBÉM PODE FILTRAR E SELECIONAR UMA DAS OPÇÕES.')


class Store:
    def __init__(self):
        self.state, self.version = None, None

    def load(self, key):
        return copy.deepcopy(self.state), self.version

    def save(self, key, state, etag):
        if etag != self.version:
            raise AssertionError('stale test state')
        self.state = copy.deepcopy(state)
        self.version = str(int(self.version or 0) + 1)
        return self.version


class Catalog:
    def __init__(self):
        self.activities = [{'id': 134, 'title': 'ALVENARIA QA', 'value': 'ALVENARIA QA'}]

    def get_options(self, step, context):
        if step['key'] == KEY:
            return copy.deepcopy(self.activities)
        source = step.get('source') or {}
        if source.get('type') == 'static':
            return copy.deepcopy(source['options'])
        raise AssertionError('Unexpected catalog query: ' + step['key'])


class ActivityDescriptionTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((SOURCE / 'workflow_config.json').read_text(encoding='utf-8'))
        self.store, self.catalog, self.messenger = Store(), Catalog(), bridge.ChannelMessenger()
        self.engine = workflow.WorkflowEngine(self.config, self.store, None, self.messenger, self.catalog)
        self.state = self.engine._new_state({'message_id': 'qa', 'sender': 'qa',
            'conversation_id': 'qa', 'phone_number_id': 'portal-admin'}, 'qa')
        self.steps = self.config['sharepoint']['construction_stage_demonstrative_create_flow']['steps']
        self.index = next(i for i, step in enumerate(self.steps) if step['key'] == KEY)
        self.state.update(flow='construction_stage_demonstrative_create', stage='selecting_fields',
            step_index=self.index, fields={'FILIAL': '004 - OBRA QA', 'ETAPA': 'ESTRUTURA QA'},
            display_values={}, answers={}, selections={}, options=copy.deepcopy(self.catalog.activities),
            embedded_return={'type': 'attendance_demonstrative_registration', 'context': 'preserved QA'})
        self.step = self.steps[self.index]

    def reply(self, text, reply_id=None):
        event = {'kind': 'text', 'text': text}
        if reply_id is not None:
            event['reply_id'] = reply_id
        return self.engine._handle_selection_reply(event, self.state, self.store.version, self.step)

    def test_prompt_explains_submission_while_retaining_native_filter(self):
        self.engine._send_options(self.state, self.step, self.state['options'])
        poll = self.messenger.messages[-1]
        self.assertIn(INSTRUCTION, poll['question'])
        self.assertTrue(poll.get('databaseFilter'))
        self.assertEqual(poll.get('databaseFilterKey'), KEY)
        self.assertIs(poll.get('acceptsCustomText'), True)

    def test_custom_description_is_the_activity_and_advances_without_catalog_creation(self):
        parent = copy.deepcopy(self.state['embedded_return'])
        result = self.reply('  Preparação do pavimento para concretagem  ')
        self.assertEqual(self.state['fields'].get('ATIVIDADEEXECUTADA'), 'PREPARAÇÃO DO PAVIMENTO PARA CONCRETAGEM')
        self.assertEqual(self.state['display_values'].get('ATIVIDADEEXECUTADA'), 'PREPARAÇÃO DO PAVIMENTO PARA CONCRETAGEM')
        self.assertTrue(self.state['selections'][KEY]['free_text'])
        self.assertEqual(result['field'], 'tem_observacao_demonstrativo_etapa')
        self.assertEqual(self.state['embedded_return'], parent)

    def test_short_and_numeric_custom_text_are_not_interpreted_as_option_ids(self):
        for value in ['Limpeza', '134']:
            with self.subTest(value=value):
                self.setUp()
                self.reply(value)
                self.assertEqual(self.state['fields'].get('ATIVIDADEEXECUTADA'), value.upper())
                self.assertEqual(self.state['step_index'], self.index + 1)

    def test_existing_button_keeps_the_selected_value(self):
        self.reply('134 - ALVENARIA QA', 'choice:' + KEY + ':134')
        self.assertEqual(self.state['fields']['ATIVIDADEEXECUTADA'], 'ALVENARIA QA')
        self.assertFalse(self.state['selections'][KEY].get('free_text', False))

    def test_submitted_control_words_are_literal_activity_descriptions(self):
        for value in ['Limpar filtro', 'filter_clear', 'refresh_options']:
            with self.subTest(value=value):
                self.setUp()
                result = self.engine._handle_text({'kind': 'text', 'message_id': 'qa-description', 'text': value},
                                                 self.state, self.store.version)
                self.assertEqual(self.state['fields'].get('ATIVIDADEEXECUTADA'), value.upper())
                self.assertEqual(result.get('field'), 'tem_observacao_demonstrativo_etapa')

    def test_actual_filter_control_replies_keep_their_behavior(self):
        for control, expected in [('filter_clear', 'filter_cleared'), ('refresh_options', 'options_refreshed')]:
            with self.subTest(control=control):
                self.setUp()
                before = copy.deepcopy(self.state['fields'])
                self.assertEqual(self.reply('Limpar filtro', control)['status'], expected)
                self.assertEqual(self.state['fields'], before)
                self.assertEqual(self.state['step_index'], self.index)

    def test_filter_queries_never_write_or_advance_even_for_exact_id_or_no_match(self):
        for query in ['alv', '134', 'Nada correspondente']:
            with self.subTest(query=query):
                self.setUp()
                before = copy.deepcopy(self.state['fields'])
                self.reply(query, 'filter_query')
                self.assertEqual(self.state['fields'], before)
                self.assertEqual(self.state['step_index'], self.index)
                self.assertTrue(self.messenger.messages[-1].get('acceptsCustomText'))

    def test_empty_catalog_keeps_the_question_open_for_custom_text(self):
        self.catalog.activities = []
        self.state['options'] = []
        self.engine._prompt_next_or_summary(self.state, self.store.version)
        self.assertEqual(self.state['flow'], 'construction_stage_demonstrative_create')
        self.assertEqual(self.state['step_index'], self.index)
        self.reply('Limpeza')
        self.assertEqual(self.state['fields'].get('ATIVIDADEEXECUTADA'), 'LIMPEZA')

    def test_whitespace_does_not_replace_or_advance_the_activity(self):
        before = copy.deepcopy(self.state['fields'])
        self.reply('   ')
        self.assertEqual(self.state['fields'], before)
        self.assertEqual(self.state['step_index'], self.index)

    def test_unmarked_selection_remains_filter_only(self):
        unrelated = {'key': 'fornecedor', 'kind': 'selection', 'target_field': 'FORNECEDOR',
                     'prompt': 'QUAL FORNECEDOR?', 'source': {'type': 'sharepoint_list'}}
        self.messenger.send_options(self.state, unrelated, self.state['options'], 20)
        poll = self.messenger.messages[-1]
        self.assertTrue(poll.get('databaseFilter'))
        self.assertNotIn('acceptsCustomText', poll)


if __name__ == '__main__':
    unittest.main()
