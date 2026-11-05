"""Real workflow with synthetic catalog/storage; no production records."""
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(os.environ['EXPENSE_TYPE_SOURCE']).resolve()
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT), str(ROOT / 'tests')]
import test_workflow as fixtures
import financial_catalog_registration as catalog


class ExpenseTypeTests(unittest.TestCase):
    def setUp(self):
        fixtures.WorkflowTests.setUp(self)
        self.config['limits']['inactivity_expiration_enabled'] = False
        temporary = tempfile.TemporaryDirectory(prefix='expense-type-test-')
        self.addCleanup(temporary.cleanup)
        self.state.directory = temporary.name
        self.sharepoint.site_url = 'https://synthetic.example.test/site'
        self.current = self.engine._new_state({'sender': 'qa', 'conversation_id': 'qa', 'message_id': 'seed',
            'phone_number_id': 'portal-admin'}, 'expense-type-qa')
        self.counter = 0
        self.media.content['qa/receipt'] = b'synthetic receipt'

    def open(self, flow='supply_product_registration', rows=None):
        self.current.update(flow=flow, stage='selecting_fields',
            fields={'PRODUTO': 'PRODUTO FICTÍCIO', 'SUBFAMÍLIA': 'FAMÍLIA TESTE'},
            answers={'submeter_lancamentos': 'SIM'},
            attachments=[{'object_name': 'qa/receipt', 'sharepoint_name': 'teste.pdf'}],
            idempotency_token='parent-token')
        steps = self.engine._flow_config(self.current)['steps']
        self.current['step_index'] = next(i for i,s in enumerate(steps)
            if s.get('target_field','').replace(' ','') == 'TIPODESPESA')
        step = steps[self.current['step_index']]
        self.key = step['key']
        self.sharepoint.options_by_key[self.key] = rows if rows is not None else [
            {'id': i, 'title': f'{i} - TIPO FICTÍCIO {i}', 'value': f'TIPO FICTÍCIO {i}'}
            for i in range(1, 31)]
        self.engine._prompt_next_or_summary(self.current, None)
        return step

    def reply(self, reply, text=''):
        self.counter += 1
        _, etag = self.state.load(self.current['key'])
        return self.engine._handle_text({'kind': 'text', 'message_id': f'qa-{self.counter}',
            'reply_id': reply, 'text': text}, self.current, etag)

    def etag(self):
        return self.state.load(self.current['key'])[1]

    def create(self):
        self.reply(f'choice:{self.key}:{catalog.CREATE_ID}')
        self.assertEqual(self.current['flow'], 'supply_material_type_registration')

    def assert_first(self):
        options = self.messenger.sent[-1]['options']
        self.assertEqual(options[0]['id'], catalog.CREATE_ID)
        self.assertEqual(options[0]['title'], '➕ CADASTRAR TIPO DESPESA')

    def test_all_product_expense_questions_offer_registration_first(self):
        for flow in ['supply_product_registration', 'launch', 'payment_settlement']:
            with self.subTest(flow=flow):
                self.setUp(); self.open(flow); self.assert_first()

    def test_empty_catalog_still_offers_registration(self):
        for flow in ['supply_product_registration', 'launch', 'payment_settlement']:
            with self.subTest(flow=flow):
                self.setUp(); self.open(flow, rows=[]); self.assert_first(); self.create()

    def test_only_one_type_still_leaves_registration_available(self):
        self.open('launch', rows=[{'id': 2, 'title': 'MATERIAL', 'value': 'MATERIAL'}])
        self.assert_first()
        self.assertNotIn('TIPO DESPESA', self.current['fields'])

    def test_filter_clear_no_match_and_next_page_keep_registration_first(self):
        self.open(); self.assert_first()
        self.reply('filter_query', 'TIPO FICTÍCIO 2'); self.assert_first()
        self.reply('filter_query', 'SEM RESULTADO'); self.assert_first()
        self.reply('filter_query', ''); self.assert_first()
        self.engine._send_next_option_page(self.current, self.etag()); self.assert_first()

    def test_confirmed_registration_writes_only_type_and_restores_parent(self):
        self.open(); before = copy.deepcopy(self.current)
        self.create(); self.reply('', 'TIPO NOVO FICTÍCIO')
        self.assertEqual(self.current['stage'], 'awaiting_confirmation')
        self.assertEqual(self.sharepoint.items, {})
        result = self.reply('confirm_yes')
        self.assertTrue(result['financial_catalog_registered'])
        self.assertEqual(self.current['flow'], before['flow'])
        self.assertEqual(self.current['fields']['TIPODESPESA'], 'TIPO NOVO FICTÍCIO')
        self.assertEqual(self.current['fields']['PRODUTO'], before['fields']['PRODUTO'])
        self.assertEqual(self.current['attachments'], before['attachments'])
        self.assertEqual(self.current['idempotency_token'], 'parent-token')
        self.assertNotIn('STATUS', self.current['fields'])
        self.assertEqual(len(self.sharepoint.items), 1)
        item = next(iter(self.sharepoint.items.values()))
        self.assertEqual(item['target_list'], 'CADASTROTIPOMATERIAL')
        self.assertEqual(item['fields'], {'TIPO': 'TIPO NOVO FICTÍCIO', 'STATUS': 'ATIVO'})

    def test_product_filtered_question_accepts_registered_type_without_changing_product(self):
        self.open('launch'); self.create()
        self.current['fields']['TIPO'] = 'TIPO NOVO FICTÍCIO'
        self.current['sharepoint'] = {'item_id': 987}
        self.engine._notify_completed(self.current, self.etag())
        self.assertEqual(self.current['fields']['TIPO DESPESA'], 'TIPO NOVO FICTÍCIO')
        self.assertEqual(self.current['fields']['PRODUTO'], 'PRODUTO FICTÍCIO')

    def test_cancel_preserves_parent_and_nested_provision_return(self):
        self.open()
        outer = {'type': 'payment_product_registration', 'state': {'flow': 'payment',
            'fields': {'FORNECEDOR': 'FICTÍCIO'}, 'provision_lines': [{'synthetic': True}]}}
        self.current['embedded_return'] = copy.deepcopy(outer)
        before = copy.deepcopy(self.current)
        self.create()
        catalog.cancel(self.engine, self.current, self.etag())
        self.assertEqual(self.current['fields'], before['fields'])
        self.assertEqual(self.current['attachments'], before['attachments'])
        self.assertEqual(self.current['embedded_return'], outer)
        self.assertEqual(self.sharepoint.items, {})
        self.assert_first()

    def test_legacy_pagination_is_upgraded(self):
        self.open()
        self.current['option_pagination']['step'].pop('terminal_options', None)
        self.current['option_pagination']['step'].pop('terminal_options_first', None)
        self.current['options'] = [o for o in self.current['options'] if not o.get('action')]
        self.engine._emit_option_page(self.current)
        self.assert_first(); self.create()

    def test_personal_recurrence_choices_are_not_material_types(self):
        self.current.update(flow='personal_expense_launch', step_index=0)
        step = next(s for s in self.engine._flow_config(self.current)['steps']
            if s['key'] == 'tipo_despesa_pessoal')
        self.assertIsNone(catalog.catalog(self.engine, self.current, step))

    def test_existing_type_selection_still_advances(self):
        self.open(); self.reply(f'choice:{self.key}:2')
        self.assertEqual(self.current['fields']['TIPODESPESA'], 'TIPO FICTÍCIO 2')
        self.assertEqual(self.sharepoint.items, {})

    def test_nested_completion_preserves_outer_provision_and_edit_state(self):
        self.open()
        outer = {'type': 'payment_product_registration', 'state': {'flow': 'payment',
            'fields': {'FORNECEDOR': 'FICTÍCIO'}, 'provision_lines': [{'synthetic': True}]}}
        self.current['embedded_return'] = copy.deepcopy(outer)
        self.current['edit_step_indices'] = [self.current['step_index']]
        self.current['provision_lines'] = [{'fields': {'QTD': '2'}}]
        self.create(); self.reply('', 'TIPO NOVO FICTÍCIO'); self.reply('confirm_yes')
        self.assertEqual(self.current['embedded_return'], outer)
        self.assertEqual(self.current['provision_lines'], [{'fields': {'QTD': '2'}}])
        self.assertEqual(self.current['stage'], 'awaiting_confirmation')

    def test_duplicate_type_is_rejected_before_confirmation(self):
        self.open(); self.create()
        self.sharepoint.has_matching_item = lambda *a, **kw: True
        self.reply('', 'TIPO DUPLICADO')
        self.assertEqual(self.current['stage'], 'selecting_fields')
        self.assertEqual(self.sharepoint.items, {})
        self.assertNotIn('TIPO', self.current['fields'])

    def test_back_from_child_restores_expense_question(self):
        self.open(); before = copy.deepcopy(self.current['fields']); self.create()
        self.engine._navigate_back(self.current, self.etag())
        self.assertEqual(self.current['flow'], 'supply_product_registration')
        self.assertEqual(self.current['fields'], before)
        self.assert_first()

    def test_stale_parent_choice_does_not_fill_child_type(self):
        self.open(); parent_key = self.key; self.create()
        self.reply(f'choice:{parent_key}:2')
        self.assertEqual(self.current['flow'], 'supply_material_type_registration')
        self.assertNotIn('TIPO', self.current['fields'])
        self.assertEqual(self.sharepoint.items, {})

    def test_double_tap_raw_create_and_delayed_search_do_not_fill_child_type(self):
        self.open(); self.reply(catalog.CREATE_ID)
        for reply in [catalog.CREATE_ID, 'filter_query', 'filter_clear', 'refresh_options', 'option_next']:
            self.reply(reply, 'TIPO FICTÍCIO 2')
            self.assertEqual(self.current['flow'], 'supply_material_type_registration')
            self.assertNotIn('TIPO', self.current['fields'])
            self.assertEqual(self.sharepoint.items, {})


if __name__ == '__main__':
    unittest.main()
