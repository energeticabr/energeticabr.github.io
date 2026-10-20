"""Run against a private backend snapshot; all storage/catalogs are in memory."""
import copy
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path.insert(0, str(ROOT / 'worker'))
from workflow import WorkflowEngine
from clients import SharePointClient
from logic import conversation_key


class Store:
    def __init__(self):
        self.saved = {}

    def save(self, key, state, etag):
        self.saved[key] = copy.deepcopy(state)
        return 'saved'

    def load(self, key):
        return copy.deepcopy(self.saved.get(key)), 'saved'


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
        self.sent.append({'type': 'input', 'body': body, 'actions': copy.deepcopy(actions)})


class Catalog:
    def __init__(self):
        self.suppliers = [{'id': i, 'title': f'FORNECEDOR {i}',
                           'value': f'FORNECEDOR {i}'} for i in range(1, 81)]
        self.suppliers[-1] = {'id': 80, 'title': 'JOSE GERALDO DOS SANTOS',
                               'value': 'JOSE GERALDO DOS SANTOS'}

    def get_options(self, step, context):
        source = step['source']
        if source['type'] == 'static':
            return copy.deepcopy(source['options'])
        return copy.deepcopy(self.suppliers) if source.get('list') == 'FORNECEDORES' else []

    def ensure_item(self, token, fields, *, target_list, **kwargs):
        if target_list != 'FORNECEDORES':
            raise AssertionError('No financial record may be created during supplier registration')
        self.suppliers.append({'id': 81, 'title': fields['CADASTRO'], 'value': fields['CADASTRO']})
        return 81

    def verify_item(self, item_id, fields, attachment_names, *, target_list):
        if target_list != 'FORNECEDORES' or attachment_names:
            raise AssertionError('Parent attachments must not be posted to supplier registration')
        return {'verified': True}


class SupplierWorkflows(unittest.TestCase):
    def setUp(self):
        config = json.loads((ROOT / 'worker/workflow_config.json').read_text(encoding='utf-8'))
        self.messenger = Messenger()
        self.catalog = Catalog()
        self.engine = WorkflowEngine(config, Store(), None, self.messenger, self.catalog)
        identity = {'message_id': 'start', 'sender': 'qa',
                    'conversation_id': 'qa', 'phone_number_id': 'portal-admin'}
        self.state = self.engine._new_state(identity, conversation_key(identity))
        self.state.update(flow='launch', stage='choosing_multi_launch_grouping_supplier',
            attachments=[{'object_name': 'qa/receipt', 'sharepoint_name': 'receipt.pdf'}],
            answers={'tipo_lancamento': 'LANÇAMENTO MÚLTIPLO', 'pedido_lancamento': 'NOVO PEDIDO'},
            fields={'FORNECEDOR': 'ORIGINAL B'},
            launch_lines=[{'fields': {'FORNECEDOR': 'ORIGINAL A'}},
                          {'fields': {'FORNECEDOR': 'ORIGINAL B'}}])

    def prompt(self):
        return self.engine._prompt_multi_launch_grouping_supplier(self.state, None)

    def reply(self, text='', reply_id='filter_query'):
        return self.engine._handle_multi_launch_grouping_supplier_reply({
            'kind': 'text', 'message_id': 'reply', 'text': text, 'reply_id': reply_id}, self.state, None)

    def test_grouping_offers_registration_on_first_page_with_remote_catalog_metadata(self):
        self.prompt()
        poll = self.messenger.sent[-1]
        self.assertEqual(poll['step'].get('source', {}).get('type'), 'sharepoint_list')
        self.assertIn('NOVO_FORNECEDOR', [str(x['id']) for x in poll['options']])

    def test_search_finds_supplier_outside_visible_page_without_selecting_it(self):
        self.prompt()
        self.assertNotIn('JOSE GERALDO DOS SANTOS', [x.get('value') for x in self.messenger.sent[-1]['options']])
        self.reply('JOSE GERALDO DOS SANTOS')
        poll = self.messenger.sent[-1]
        self.assertIn('JOSE GERALDO DOS SANTOS', [x.get('value') for x in poll['options']])
        self.assertIn('NOVO_FORNECEDOR', [str(x['id']) for x in poll['options']])
        self.assertNotIn('multi_launch_grouping_supplier', self.state)

    def test_numeric_filter_is_not_a_choice_and_clear_restores_all(self):
        self.prompt()
        self.reply('80')
        self.assertNotIn('multi_launch_grouping_supplier', self.state)
        self.assertEqual(self.reply('Limpar filtro', 'filter_clear')['status'], 'filter_cleared')
        self.assertEqual(self.messenger.sent[-1]['step']['_pagination']['total'], 82)

    def test_empty_search_keeps_only_registration_and_navigation(self):
        self.prompt()
        self.reply('NO SUCH SUPPLIER')
        options = self.messenger.sent[-1]['options']
        self.assertTrue(any(x.get('action') == 'start_embedded_supplier_registration' for x in options))
        self.assertFalse(any(x.get('value', '').startswith('FORNECEDOR ') for x in options))

    def test_grouping_registration_uses_standard_wizard_and_restores_parent(self):
        self.prompt()
        parent = copy.deepcopy(self.state)
        self.reply('', 'NOVO_FORNECEDOR')
        self.assertEqual(self.state['flow'], 'supply_supplier_registration')
        self.assertEqual(self.state['step_index'], 0)
        self.assertEqual(self.messenger.sent[-1]['type'], 'input')
        self.assertIn(self.engine._flow_config(self.state)['steps'][0]['prompt'], self.messenger.sent[-1]['body'])
        self.assertEqual(self.state['embedded_return']['type'], 'multi_launch_grouping_supplier_registration')
        self.state['fields']['CADASTRO'] = 'NEW SUPPLIER'
        self.catalog.suppliers.append({'id': 81, 'title': 'NEW SUPPLIER', 'value': 'NEW SUPPLIER'})
        with patch.object(self.engine, '_prompt_next_or_summary', return_value={'status': 'continued'}):
            self.engine._resume_origin_with_registered_supplier(self.state, None, 81)
        self.assertEqual(self.state['multi_launch_grouping_supplier'], 'NEW SUPPLIER')
        self.assertEqual(self.state['launch_lines'], parent['launch_lines'])
        self.assertEqual(self.state['fields'], parent['fields'])
        self.assertEqual(self.state['attachments'], parent['attachments'])
        self.assertFalse(self.engine._needs_multi_launch_grouping_supplier(self.state))

    def test_recurring_registration_returns_to_correct_supplier_step(self):
        self.state.update(flow='recurring_expense', stage='selecting_fields', launch_lines=[])
        steps = self.engine._flow_config(self.state)['steps']
        index, step = next((i, s) for i, s in enumerate(steps) if s['key'] == 'fornecedor_despesa_recorrente')
        self.state['step_index'] = index
        self.state['options'] = self.engine._selection_options(self.state, step)
        self.assertIn('NOVO_FORNECEDOR', [str(x['id']) for x in self.state['options']])
        parent = copy.deepcopy(self.state)
        self.engine._handle_selection_reply({'kind': 'text', 'message_id': 'register',
            'reply_id': 'NOVO_FORNECEDOR'}, self.state, None, step)
        self.assertEqual(self.state['flow'], 'supply_supplier_registration')
        self.assertEqual(self.state['step_index'], 0)
        self.state['fields']['CADASTRO'] = 'NEW RECURRING SUPPLIER'
        with patch.object(self.engine, '_prompt_next_or_summary', return_value={'status': 'continued'}):
            self.engine._resume_origin_with_registered_supplier(self.state, None, 82)
        self.assertEqual(self.state['flow'], 'recurring_expense')
        self.assertEqual(self.state['fields']['FORNECEDOR'], 'NEW RECURRING SUPPLIER')
        self.assertEqual(self.state['step_index'], index + 1)
        self.assertEqual(self.state['attachments'], parent['attachments'])
        self.assertEqual(self.state['answers']['fornecedor_despesa_recorrente'], 'NEW RECURRING SUPPLIER')

    def test_catalog_follows_all_sharepoint_pages_when_requested(self):
        client = SharePointClient('qa.invalid', '/sites/qa', '', '', '', '', 'FORNECEDORES')
        pages = [{'value': [{'Id': 1, 'CADASTRO': 'FIRST'}], '@odata.nextLink': 'next'},
                 {'value': [{'Id': 2, 'CADASTRO': 'LAST'}]}]
        with patch.object(client, '_internal_field', side_effect=lambda _, name: name), \
             patch.object(client, '_request', side_effect=pages) as request:
            result = client.get_options({'source': {'type': 'sharepoint_list', 'list': 'FORNECEDORES',
                'id_field': 'Id', 'label_field': 'CADASTRO', 'value_field': 'CADASTRO', 'fetch_all_pages': True}})
        self.assertEqual({x['value'] for x in result}, {'FIRST', 'LAST'})
        self.assertEqual(request.call_args_list[1].args[:2], ('GET', 'next'))
        self.assertIsNone(request.call_args_list[1].kwargs.get('params'))

    def test_selecting_remote_match_uses_unchanged_reply_id_and_preserves_lines(self):
        self.prompt()
        self.reply('JOSE GERALDO DOS SANTOS')
        option = next(x for x in self.messenger.sent[-1]['options']
                      if x.get('value') == 'JOSE GERALDO DOS SANTOS')
        lines = copy.deepcopy(self.state['launch_lines'])
        with patch.object(self.engine, '_prompt_next_or_summary', return_value={'status': 'continued'}):
            self.reply('', f"choice:fornecedor_agrupador_lancamento:{option['id']}")
        self.assertEqual(self.state['multi_launch_grouping_supplier'], 'JOSE GERALDO DOS SANTOS')
        self.assertEqual(self.state['launch_lines'], lines)

    def test_actual_registration_commit_dispatches_back_without_financial_writes(self):
        for flow in ('launch', 'recurring_expense'):
            with self.subTest(flow=flow):
                self.setUp()
                self.state['flow'] = flow
                if flow == 'launch':
                    self.prompt()
                    self.reply('', 'NOVO_FORNECEDOR')
                else:
                    self.state['stage'] = 'selecting_fields'
                    self.engine._start_embedded_supplier_registration(self.state, None)
                self.state['fields']['CADASTRO'] = 'COMMITTED SUPPLIER'
                with patch.object(self.engine, '_prompt_next_or_summary', return_value={'status': 'continued'}):
                    result = self.engine._commit(self.state, None)
                self.assertTrue(result.get('embedded_supplier_registered'), result)
                self.assertEqual(self.state['flow'], flow)
                self.assertEqual(self.state['attachments'][0]['sharepoint_name'], 'receipt.pdf')
                self.assertNotIn('embedded_return', self.state)

    def test_existing_grouping_reply_ids_survive_catalog_refresh(self):
        self.state['options'] = [{'id': 1, 'title': 'FORNECEDOR 70', 'value': 'FORNECEDOR 70'}]
        self.reply('JOSE GERALDO DOS SANTOS')
        with patch.object(self.engine, '_prompt_next_or_summary', return_value={'status': 'continued'}):
            self.reply('', 'choice:fornecedor_agrupador_lancamento:1')
        self.assertEqual(self.state['multi_launch_grouping_supplier'], 'FORNECEDOR 70')

    def test_grouping_embedded_return_without_registration_restores_draft(self):
        self.prompt()
        parent = copy.deepcopy(self.state)
        self.reply('', 'NOVO_FORNECEDOR')
        result = self.engine._restore_embedded_supply_ancestor(self.state, None, 1)
        self.assertTrue(result['embedded_flow_returned'])
        self.assertEqual(self.state['flow'], 'launch')
        self.assertEqual(self.state['launch_lines'], parent['launch_lines'])
        self.assertEqual(self.state['attachments'], parent['attachments'])
        self.assertEqual(self.state['stage'], 'choosing_multi_launch_grouping_supplier')

    def test_registration_discards_parent_pagination_and_ignores_stale_supplier_controls(self):
        for flow, field in [('launch', 'fornecedor_agrupador_lancamento'),
                            ('recurring_expense', 'fornecedor_despesa_recorrente')]:
            for reply in ['option_next', f'choice:{field}:1', 'filter_query', 'NOVO_FORNECEDOR']:
                with self.subTest(flow=flow, reply=reply):
                    self.setUp()
                    self.state['flow'] = flow
                    if flow == 'launch':
                        self.prompt()
                    else:
                        steps = self.engine._flow_config(self.state)['steps']
                        index, step = next((i, s) for i, s in enumerate(steps) if s['key'] == field)
                        self.state.update(stage='selecting_fields', step_index=index)
                        self.state['options'] = self.engine._selection_options(self.state, step)
                        self.engine._send_options(self.state, step, self.state['options'])
                    self.engine._start_embedded_supplier_registration(self.state, None)
                    self.assertNotIn('option_pagination', self.state)
                    self.engine._save(self.state, None)
                    self.engine.config['whatsapp']['accepted_sender_ids'] = ['qa']
                    self.engine.config['whatsapp']['scheduled_alerts'] = {}
                    self.engine.handle({'kind': 'text', 'message_id': 'stale',
                        'reply_id': reply, 'text': '1 - OLD SUPPLIER', 'sender': 'qa',
                        'conversation_id': 'qa', 'phone_number_id': 'portal-admin'})
                    saved = self.engine.state_store.saved[self.state['key']]
                    self.assertEqual(saved['step_index'], 0)
                    self.assertNotIn('CADASTRO', saved['fields'])

    def test_repeated_sharepoint_page_fails_closed(self):
        client = SharePointClient('qa.invalid', '/sites/qa', '', '', '', '', 'FORNECEDORES')
        page = {'value': [], 'odata.nextLink': 'loop'}
        with patch.object(client, '_internal_field', side_effect=lambda _, name: name), \
             patch.object(client, '_request', return_value=page):
            with self.assertRaisesRegex(RuntimeError, 'Paginação repetida'):
                client.get_options({'source': {'type': 'sharepoint_list', 'list': 'FORNECEDORES',
                    'id_field': 'Id', 'label_field': 'CADASTRO', 'value_field': 'CADASTRO', 'fetch_all_pages': True}})

    def test_stale_filter_at_registration_confirmation_does_not_read_past_last_step(self):
        self.prompt()
        self.reply('', 'NOVO_FORNECEDOR')
        self.state.update(stage='awaiting_confirmation',
                          step_index=len(self.engine._flow_config(self.state)['steps']))
        self.engine._save(self.state, None)
        self.engine.config['whatsapp']['accepted_sender_ids'] = ['qa']
        with patch.object(self.engine, '_resend_current_prompt', return_value={'status': 'awaiting_confirmation'}):
            result = self.engine.handle({'kind': 'text', 'message_id': 'latefilter',
                'reply_id': 'filter_query', 'text': 'JOSE', 'sender': 'qa',
                'conversation_id': 'qa', 'phone_number_id': 'portal-admin'})
        self.assertEqual(result['status'], 'awaiting_confirmation')


if __name__ == '__main__':
    unittest.main()
