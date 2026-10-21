"""Real workflow with synthetic catalogs/media only; no business records are posted."""
import copy
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT)]
from workflow import WorkflowEngine


class Store:
    def __init__(self):
        self.rows = {}
        self.versions = {}

    def load(self, key):
        return copy.deepcopy(self.rows.get(key)), self.versions.get(key)

    def save(self, key, state, etag):
        if etag != self.versions.get(key):
            raise RuntimeError('etag conflict')
        self.rows[key] = copy.deepcopy(state)
        self.versions[key] = str(int(self.versions.get(key, '0')) + 1)
        return self.versions[key]


class Messenger:
    def __init__(self):
        self.sent = []

    def send_text(self, state, body):
        self.sent.append({'type': 'text', 'body': body})

    def send_options(self, state, step, options, maximum):
        self.sent.append({'type': 'poll', 'step': copy.deepcopy(step),
                          'options': copy.deepcopy(options[:maximum])})

    send_filtered_options = send_options

    def send_actions(self, state, body, actions):
        self.sent.append({'type': 'actions', 'body': body, 'actions': copy.deepcopy(actions)})

    def send_image(self, *args, **kwargs):
        pass


class Summary:
    def build(self, *args, **kwargs):
        return {'path': 'synthetic.png', 'filename': 'synthetic.png', 'width': 100, 'height': 100}


class Media:
    def read(self, item):
        return b'QA attachment bytes'


class Catalog:
    def __init__(self):
        self.rows = {}
        self.creates = []
        self.attachments = {}
        self.fail_attachment = False
        self.fail_verify = False
        self.unknown_create = False
        self.hide_rows = False

    def get_options(self, step, context):
        source = step.get('source', {})
        if source.get('type') == 'static':
            return copy.deepcopy(source['options'])
        target = step.get('target_field')
        values = {'FILIAL': ['004 - OBRA QA', '003 - OUTRA QA'],
                  'TIPODOCUMENTO': ['TIPO A QA', 'TIPO B QA'],
                  'PESSOARELACIONADA': ['PESSOA A QA', 'PESSOA B QA'],
                  'IMOVEL': ['TODOS'], 'ETAPA': ['ETAPA A QA'],
                  'NUMCONTRATO': ['CONTRATO QA']}.get(target, [])
        return [{'id': n, 'title': value, 'value': value}
                for n, value in enumerate(values, 1)]

    def ensure_item(self, token, fields, *, target_list, **kwargs):
        if target_list != 'DOCUMENTOS':
            raise AssertionError('Unexpected real business target')
        if token in self.rows:
            return self.rows[token]['Id']
        item_id = 100 + len(self.rows)
        self.rows[token] = {'Id': item_id, 'fields': copy.deepcopy(fields)}
        self.creates.append(token)
        if self.unknown_create:
            self.unknown_create = False
            raise TimeoutError('Unknown POST outcome')
        return item_id

    def _find_item(self, token, target_list, idempotency_field):
        return None if self.hide_rows else copy.deepcopy(self.rows.get(token))

    def ensure_attachment(self, item_id, name, content, mime_type, *, target_list):
        if self.fail_attachment:
            raise RuntimeError('Synthetic attachment failure')
        self.attachments.setdefault(item_id, {})[name] = bytes(content)

    def verify_item(self, item_id, fields, names, *, target_list):
        if self.fail_verify:
            raise RuntimeError('Synthetic verification failure')
        row = next(row for row in self.rows.values() if row['Id'] == item_id)
        if row['fields'] != fields or set(self.attachments.get(item_id, {})) != set(names):
            raise AssertionError('Fields or attachment isolation broken')
        return {'fields': True, 'attachments': True}


class DocumentBatchTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / 'worker/workflow_config.json').read_text(encoding='utf-8'))
        self.config['limits']['post_completion_menu_enabled'] = False
        self.store, self.catalog, self.messenger = Store(), Catalog(), Messenger()
        self.engine = WorkflowEngine(self.config, self.store, Media(), self.messenger,
                                     self.catalog, summary_builder=Summary())
        self.event_counter = 0
        self.state = self.engine._new_state({'message_id': 'qa-start', 'sender': 'qa',
            'conversation_id': 'qa', 'phone_number_id': 'portal-admin'}, 'qa')

    def etag(self):
        return self.store.load(self.state['key'])[1]

    def begin(self):
        return self.engine._begin_action(self.state, self.etag(),
            {'flow': 'document', 'title': 'ADICIONAR UM NOVO DOCUMENTO'})

    def reply(self, reply_id='', text=''):
        self.event_counter += 1
        return self.engine._handle_text({'kind': 'text', 'message_id': f'qa-{self.event_counter}',
            'reply_id': reply_id, 'text': text}, self.state, self.etag())

    def ready(self):
        self.begin()
        self.reply('document_mode_multiple')
        self.state['fields'].update(FILIAL='004 - OBRA QA',
            TIPOHOMOLOGACAO='HOMOLOGAÇÃO MÃO DE OBRA', TIPODOCUMENTO='TIPO A QA',
            PESSOARELACIONADA='PESSOA A QA', DATA='2026-10-21', IMOVEL='TODOS', ETAPA='ETAPA A QA')
        self.state['display_values'].update(self.state['fields'])
        self.state['answers'] = {'filial': '004 - OBRA QA',
            'tipo_homologacao': 'HOMOLOGAÇÃO MÃO DE OBRA', 'tipo_documento': 'TIPO A QA',
            'pessoa_relacionada': 'PESSOA A QA', 'data_emissao': '2026-10-21',
            'tem_data_validade': 'NÃO', 'imovel': 'TODOS', 'tem_observacao': 'NÃO',
            'etapa_obra': 'ETAPA A QA'}
        self.attach('first-qa.pdf')
        self.state['step_index'] = len(self.config['sharepoint']['steps'])
        self.state['attachments_phase_completed'] = True
        self.state['attachments_decision'] = 'yes'
        self.engine._summarize_and_confirm(self.state, self.etag())

    def attach(self, name):
        self.state['attachments'] = [{'object_name': 'qa/' + name, 'sharepoint_name': name,
            'message_id': name, 'mime_type': 'application/pdf', 'size': 19}]

    def action_ids(self):
        return [action['id'] for action in self.messenger.sent[-1].get('actions', [])]

    def test_entry_offers_single_or_multiple_before_first_field(self):
        self.begin()
        self.assertEqual(self.state['stage'], 'choosing_document_mode')
        self.assertIn('document_mode_single', self.action_ids())
        self.assertIn('document_mode_multiple', self.action_ids())
        self.assertFalse(self.catalog.creates)

    def test_single_mode_returns_to_existing_first_field(self):
        self.begin()
        result = self.reply('document_mode_single')
        self.assertEqual(result.get('field'), 'filial')
        self.assertEqual(self.state['stage'], 'selecting_fields')
        self.engine._send_confirmation_actions(self.state)
        self.assertIn('confirm_yes', self.action_ids())
        self.assertNotIn('document_add_another', self.action_ids())

    def test_multiple_confirmation_offers_add_and_finish_without_posting(self):
        self.ready()
        self.assertIn('document_add_another', self.action_ids())
        self.assertIn('document_submit_final', self.action_ids())
        self.assertIn('confirm_edit', self.action_ids())
        self.assertFalse(self.catalog.creates)

    def test_add_posts_current_document_and_opens_editable_context(self):
        self.ready()
        previous = copy.deepcopy(self.state['fields'])
        result = self.reply('document_add_another')
        self.assertEqual(len(self.catalog.creates), 1)
        self.assertEqual(self.catalog.rows[self.catalog.creates[0]]['fields'], previous)
        self.assertEqual(self.catalog.attachments[100], {'first-qa.pdf': b'QA attachment bytes'})
        self.assertEqual(result['status'], 'awaiting_document_defaults')
        self.assertEqual(self.state['fields']['PESSOARELACIONADA'], 'PESSOA A QA')
        self.assertEqual(self.state['fields']['DATA'], '2026-10-21')
        self.assertNotIn('TIPODOCUMENTO', self.state['fields'])
        self.assertEqual(self.state['attachments'], [])
        self.assertEqual(self.state['navigation_history'], [])
        self.assertEqual(self.state['sharepoint'], {})

    def test_proceed_asks_only_type_then_fresh_required_attachment(self):
        self.ready()
        self.reply('document_add_another')
        result = self.reply('document_defaults_proceed')
        self.assertEqual(result.get('field'), 'tipo_documento')
        result = self.reply('2')
        self.assertEqual(self.state['fields']['TIPODOCUMENTO'], 'TIPO B QA')
        self.assertEqual(self.state['stage'], 'collecting_attachments')
        self.assertEqual(result['status'], 'waiting_for_attachments')
        self.assertEqual(len(self.catalog.creates), 1)

    def test_defaults_offer_person_branch_dates_stage_and_observation(self):
        self.ready()
        self.reply('document_add_another')
        values = [option['value'] for option in self.state['options']]
        steps = self.config['sharepoint']['steps']
        keys = [steps[value]['key'] for value in values if isinstance(value, int)]
        for key in ['filial', 'pessoa_relacionada', 'data_emissao',
                    'tem_data_validade', 'etapa_obra', 'tem_observacao']:
            self.assertIn(key, keys)
        self.assertNotIn('tipo_documento', keys)

    def test_edit_issue_date_returns_to_defaults_without_changing_previous_row(self):
        self.ready()
        self.reply('document_add_another')
        option = next(x for x in self.state['options'] if x.get('value') == 4)
        self.reply(str(option['id']))
        result = self.reply(text='22/10/2026')
        self.assertEqual(result['status'], 'awaiting_document_defaults')
        self.assertEqual(self.state['fields']['DATA'], '2026-10-22')
        self.assertEqual(self.catalog.rows[self.catalog.creates[0]]['fields']['DATA'], '2026-10-21')

    def test_final_submits_new_type_and_attachment_as_separate_document(self):
        self.ready()
        self.reply('document_add_another')
        self.reply('document_defaults_proceed')
        self.reply('2')
        self.attach('second-qa.pdf')
        self.state['attachments_phase_completed'] = True
        self.engine._summarize_and_confirm(self.state, self.etag())
        result = self.reply('document_submit_final')
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(self.state['stage'], 'completed')
        self.assertEqual(len(self.catalog.creates), 2)
        self.assertEqual(self.catalog.rows[self.catalog.creates[1]]['fields']['TIPODOCUMENTO'], 'TIPO B QA')
        self.assertEqual(set(self.catalog.attachments[101]), {'second-qa.pdf'})
        self.assertEqual(set(self.catalog.attachments[100]), {'first-qa.pdf'})

    def test_mode_and_defaults_are_resendable_without_writes(self):
        self.begin()
        self.engine._resend_current_prompt(self.state, self.etag())
        self.assertIn('document_mode_multiple', self.action_ids())
        self.ready()
        self.reply('document_add_another')
        self.engine._resend_current_prompt(self.state, self.etag())
        self.assertEqual(self.state['stage'], 'document_batch_defaults')
        self.assertEqual(len(self.catalog.creates), 1)


if __name__ == '__main__':
    unittest.main()
