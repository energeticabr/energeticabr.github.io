"""Actual engine and portal serializer; synthetic states and in-memory writes."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(os.environ.get('ENERGETICA_BACKEND_TEST_ROOT', '/opt/energetica-whatsapp'))
SOURCE = Path(os.environ.get('WHATSAPP_SOURCE_DIR', ROOT / 'worker'))
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT)]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


workflow = load('whatsapp_qa_workflow', SOURCE / 'workflow.py')
bridge = load('whatsapp_qa_bridge', ROOT / 'channel_bridge.py')
from clients import SharePointClient

KEY = 'whatsapp_fornecedor_suprimentos'
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
        # Conditional/static options have no external constructor dependencies.
        pass


class WhatsAppTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((SOURCE / 'workflow_config.json').read_text(encoding='utf-8'))
        self.store, self.messenger = Store(), bridge.ChannelMessenger()
        self.engine = workflow.WorkflowEngine(self.config, self.store, None, self.messenger, Catalog())
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

    def phone(self, value):
        if value is not None:
            self.state['fields']['TELEFONECONTATO'] = value

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

    def assert_answer(self, result, value, parent):
        self.assertEqual(self.state['fields'].get('WHATSAPP'), value)
        self.assertEqual(self.state['answers'].get(KEY), value)
        self.assertEqual(self.state['display_values'].get('WHATSAPP'), value)
        self.assertEqual(result.get('field'), 'email_fornecedor_suprimentos')
        self.assertEqual(self.state['embedded_return'], parent)

    def test_new_question_is_binary_for_blank_missing_and_filled_phone(self):
        for phone in [None, '', '5511999999999']:
            with self.subTest(phone=phone):
                self.setUp()
                self.phone(phone)
                self.prompt()
                self.assert_direct()

    def test_each_button_saves_its_literal_answer_and_advances_with_parent_intact(self):
        for phone, choices in [('', {1: 'NÃO', 2: 'SIM'}), ('5511999999999', {1: 'SIM', 2: 'NÃO'})]:
            for choice, value in choices.items():
                with self.subTest(phone=phone, choice=choice):
                    self.setUp()
                    self.phone(phone)
                    self.prompt()
                    parent = copy.deepcopy(self.state['embedded_return'])
                    result = self.reply(reply_id='choice:' + KEY + ':' + str(choice))
                    self.assert_answer(result, value, parent)

    def test_typed_text_does_not_answer_without_explicit_selection(self):
        for phone in ['', '5511999999999']:
            for value in ['SIM', 'NÃO']:
                with self.subTest(phone=phone, value=value):
                    self.setUp()
                    self.phone(phone)
                    self.prompt()
                    parent = copy.deepcopy(self.state['embedded_return'])
                    result = self.reply(text=value)
                    self.assertEqual(result.get('status'), 'filtered_options')
                    self.assertNotIn('WHATSAPP', self.state['fields'])
                    self.assertEqual(self.state['step_index'], self.index)
                    self.assertEqual(self.state['embedded_return'], parent)

    @staticmethod
    def legacy_options(value):
        return [
            {'id': 1, 'title': '✅ SIM, MANTER — ' + value, 'value': value, 'recommended': True},
            {'id': KEY + '__alterar_padrao', 'title': '✏️ NÃO, ESCOLHER OUTRO VALOR',
             'value': '__ESCOLHER_OUTRO_VALOR__', 'action': 'expand_recommended_selection',
             'terminal_option': True},
        ]

    def test_resume_replaces_cached_menu_without_answering(self):
        self.state['options'] = self.legacy_options('NÃO')
        self.engine._resend_current_prompt(self.state, self.store.version)
        self.assert_direct()
        self.assertNotIn('WHATSAPP', self.state['fields'])
        self.assertEqual(self.state['step_index'], self.index)

    def test_old_expand_only_reopens_binary_question(self):
        self.state['options'] = self.legacy_options('NÃO')
        self.reply(reply_id=KEY + '__alterar_padrao')
        self.assert_direct()
        self.assertNotIn('WHATSAPP', self.state['fields'])
        self.assertEqual(self.state['step_index'], self.index)

    def test_old_keep_retains_the_original_value_for_each_phone_branch(self):
        for phone, value in [('', 'NÃO'), ('5511999999999', 'SIM')]:
            with self.subTest(phone=phone):
                self.setUp()
                self.phone(phone)
                self.state['options'] = self.legacy_options(value)
                parent = copy.deepcopy(self.state['embedded_return'])
                self.assert_answer(self.reply(reply_id='choice:' + KEY + ':1'), value, parent)

    def test_direct_second_button_works_even_with_cached_collapsed_menu(self):
        for phone, old, value in [('', 'NÃO', 'SIM'), ('5511999999999', 'SIM', 'NÃO')]:
            with self.subTest(phone=phone):
                self.setUp()
                self.phone(phone)
                self.state['options'] = self.legacy_options(old)
                parent = copy.deepcopy(self.state['embedded_return'])
                self.assert_answer(self.reply(reply_id='choice:' + KEY + ':2'), value, parent)


if __name__ == '__main__':
    unittest.main()
