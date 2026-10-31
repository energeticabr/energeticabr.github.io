"""Create-payment provision row edits through the real engine; synthetic IO only."""
import copy
from decimal import Decimal
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

PATCHES = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PATCHES / 'provision-global-discount/tests'))
import test_global_discount as discount_fixture
from payment_provision_group import provision_preview
from payment_provision_flow import PROVISION_STATE_KEYS


class ProvisionEditLineTests(unittest.TestCase):
    def setUp(self):
        self.qa = discount_fixture.GlobalDiscountTests()
        self.qa.setUp()
        self.engine, self.state = self.qa.engine, self.qa.state
        self.store = self.qa.fixture.store
        self.catalog = self.qa.catalog
        for line in self.state['provision_lines']:
            line['answers'].update(produto_pagamento=line['fields']['PRODUTO'],
                                   fornecedor_pagamento=line['fields']['FORNECEDOR'])
        self.state['answers'].update(self.state['provision_lines'][-1]['answers'])
        self.qa.reply('2')
        self.qa.reply('2')
        self.assertEqual(self.state['stage'], 'awaiting_confirmation')

    def reply(self, text):
        return self.qa.reply(text)

    def edit(self, line=0):
        self.reply('confirm_edit')
        self.assertEqual(self.state['stage'], 'editing_provision_line_choice',
                         'Multiple provisions must choose the row before any field')
        self.reply(str(line + 1))
        self.assertEqual(self.state['stage'], 'editing_field_choice')

    def field(self, key):
        steps = self.engine._flow_config(self.state)['steps']
        index = next(i for i, step in enumerate(steps) if step['key'] == key)
        offered = next((row for row in self.state['options'] if row.get('value') == index), None)
        self.assertIsNotNone(offered, f'{key} should be editable for this row')
        return self.reply(str(offered['id']))

    def units(self):
        return [Decimal(row['fields']['VALOR TOTAL'].replace(',', '.'))
                for row in self.state['provision_lines']]

    def apply_discount(self, raw):
        self.state['stage'] = 'asking_provision_discount'
        self.engine._prompt_provision_question(self.state, self.qa.fixture.etag())
        self.reply('1')
        self.reply(raw)
        self.assertEqual(self.state['stage'], 'awaiting_confirmation')

    def test_edit_asks_for_number_product_and_supplier_before_field(self):
        before = copy.deepcopy(self.state['provision_lines'])
        self.reply('confirm_edit')
        self.assertEqual(self.state['stage'], 'editing_provision_line_choice')
        choices = self.qa.messenger.sent[-1]
        self.assertIn('LINHA', choices['step']['prompt'])
        for index, product in enumerate(['PRODUTO A QA', 'PRODUTO B QA'], 1):
            option = next(row for row in self.state['options'] if row['id'] == index)
            self.assertIn(f'LINHA {index}', option['title'])
            self.assertIn(product, option['title'])
            self.assertIn('FORNECEDOR QA', option['title'])
        self.assertEqual(self.state['provision_lines'], before)
        self.assertEqual(self.catalog.creates, [])

    def test_first_row_quantity_changes_only_first_snapshot_and_restores_last_cursor(self):
        last = copy.deepcopy(self.state['provision_lines'][1])
        self.edit(0)
        self.assertIn('LINHA 1', self.qa.messenger.sent[-1]['step']['prompt'])
        self.field('quantidade_pagamento')
        self.reply('4')
        self.assertEqual(self.state['stage'], 'awaiting_confirmation')
        self.assertEqual(self.state['provision_lines'][0]['fields']['QTD'], '4')
        self.assertEqual(self.state['provision_lines'][1], last)
        self.assertEqual(self.state['fields']['QTD'], '3')
        self.assertEqual(self.state['fields']['PRODUTO'], 'PRODUTO B QA')
        self.assertNotIn('editing_provision_line_index', self.state)
        self.assertNotIn('provision_line_edit_return', self.state)
        self.assertEqual(provision_preview(self.state)['totalDisplay'], 'R$ 1.030,00')

    def test_last_row_edit_and_repeated_edit_always_choose_row_again(self):
        first = copy.deepcopy(self.state['provision_lines'][0])
        self.edit(1)
        self.field('valor_unitario_pagamento')
        self.reply('50')
        self.assertEqual(self.state['stage'], 'awaiting_confirmation')
        self.assertEqual(self.units(), [Decimal('100'), Decimal('50')])
        self.assertEqual(self.state['provision_lines'][0], first)
        self.assertEqual(self.state['fields']['VALOR TOTAL'], '50')
        self.edit(0)
        self.field('quantidade_pagamento')
        self.reply('5')
        self.assertEqual(self.state['provision_lines'][0]['fields']['QTD'], '5')
        self.assertEqual(self.state['provision_lines'][1]['fields']['QTD'], '3')

    def test_first_row_keeps_freight_edit_while_later_rows_cannot_gain_freight(self):
        self.edit(0)
        self.field('frete_pagamento')
        self.reply('12,50')
        self.assertEqual(self.state['stage'], 'awaiting_confirmation')
        self.assertEqual([row['fields']['FRETE'] for row in self.state['provision_lines']], ['12,5', '0'])
        self.edit(1)
        steps = self.engine._flow_config(self.state)['steps']
        offered = {steps[row['value']]['key'] for row in self.state['options']
                   if isinstance(row.get('value'), int)}
        self.assertTrue({'frete_pagamento', 'tem_frete_pagamento'}.isdisjoint(offered))

    def test_signed_discount_uses_selected_original_price_without_compounding(self):
        self.apply_discount('-0,06')
        self.edit(0)
        result = self.field('valor_unitario_pagamento')
        self.assertEqual(result['inputPrefill']['value'], '100')
        self.reply('50')
        self.assertEqual(self.state['stage'], 'awaiting_confirmation')
        self.assertEqual(self.state['provision_lines'][0]['fields']['QTD'], '2')
        self.assertEqual(self.state['provision_lines'][1]['fields']['QTD'], '3')
        self.assertEqual(self.state['provision_discount']['amount'], '-0.06')
        self.assertEqual(provision_preview(self.state)['totalDisplay'], 'R$ 730,06')
        frozen = copy.deepcopy(self.state['provision_lines'])
        self.engine._summarize_and_confirm(self.state, self.qa.fixture.etag())
        self.assertEqual(self.state['provision_lines'], frozen)

    def test_filter_resume_and_invalid_choice_do_not_change_rows(self):
        before = copy.deepcopy(self.state['provision_lines'])
        self.reply('confirm_edit')
        self.assertEqual(self.state['stage'], 'editing_provision_line_choice')
        self.reply('PRODUTO A')
        self.assertTrue(any('PRODUTO A' in row['title'] for row in self.qa.messenger.sent[-1]['options']))
        self.reply('nenhuma linha com esse texto')
        self.engine._resume_draft_prompt(self.state, self.qa.fixture.etag())
        self.assertEqual(self.state['stage'], 'editing_provision_line_choice')
        self.assertEqual(self.state['provision_lines'], before)
        self.reply('1')
        self.engine._resume_draft_prompt(self.state, self.qa.fixture.etag())
        self.assertEqual(self.state['editing_provision_line_index'], 0)
        self.field('quantidade_pagamento')
        self.engine._resume_draft_prompt(self.state, self.qa.fixture.etag())
        self.reply('6')
        self.assertEqual(self.state['provision_lines'][0]['fields']['QTD'], '6')
        self.assertEqual(self.state['provision_lines'][1], before[1])

    def test_back_from_field_and_row_chooser_preserves_cursor_rows_and_discount(self):
        self.apply_discount('-0,06')
        before = copy.deepcopy(self.state['provision_lines'])
        self.edit(0)
        self.field('quantidade_pagamento')
        self.engine._navigate_back(self.state, self.qa.fixture.etag())
        self.assertEqual(self.state['stage'], 'editing_field_choice')
        self.reply('0')
        self.assertEqual(self.state['stage'], 'editing_provision_line_choice')
        self.reply('0')
        self.assertEqual(self.state['stage'], 'awaiting_confirmation')
        self.assertEqual(self.state['provision_lines'], before)
        self.assertEqual(self.state['fields']['QTD'], '3')
        self.assertEqual(self.state['fields']['PRODUTO'], 'PRODUTO B QA')

    def test_parent_reference_and_batch_attachments_remain_batch_scoped(self):
        self.state.update(provision_reference_supplier='FORNECEDOR QA', provision_parent_mode='EXISTING',
                          provision_parent_selection={'parent_id': 123}, provision_parent_choice_complete=True)
        attachments = [{'original_name': 'synthetic.txt', 'sharepoint_name': 'synthetic.txt', 'size': 3}]
        self.engine.media_repository = SimpleNamespace(read=lambda attachment: b'qa!')
        self.state['attachments'] = copy.deepcopy(attachments)
        self.edit(0)
        self.assertNotIn('__edit_attachments__', [row['value'] for row in self.state['options']])
        self.field('quantidade_pagamento')
        self.reply('4')
        self.assertEqual(self.state['attachments'], attachments)
        self.assertEqual(self.state['provision_parent_selection'], {'parent_id': 123})
        self.assertEqual(self.state['provision_reference_supplier'], 'FORNECEDOR QA')
        self.assertEqual(self.state['provision_parent_mode'], 'EXISTING')
        self.assertEqual(self.catalog.creates, [])

    def test_edited_selected_child_and_parent_total_match_synthetic_persistence(self):
        self.edit(0)
        self.field('quantidade_pagamento')
        self.reply('4')
        self.engine._persist_provision_group(self.state, self.qa.fixture.etag(), self.engine._flow_config(self.state))
        children = [row['fields'] for (target, _), row in self.catalog.rows.items() if target == 'PROVISÃO PGTOS']
        parent = next(row['fields'] for (target, _), row in self.catalog.rows.items() if target == 'DESCRITIVOPROVISAO')
        self.assertEqual([row['QTD'] for row in children], ['4', '3'])
        self.assertEqual(Decimal(parent['VALORTOTAL']), Decimal('1030'))

    def test_new_cursor_keys_are_in_reset_and_embedded_registration_contract(self):
        self.assertIn('editing_provision_line_index', PROVISION_STATE_KEYS)
        self.assertIn('provision_line_edit_return', PROVISION_STATE_KEYS)
        self.edit(0)
        self.field('produto_pagamento')
        self.engine._start_embedded_product_registration(self.state, self.qa.fixture.etag())
        parent = self.state['embedded_return']['state']
        self.assertEqual(parent['editing_provision_line_index'], 0)
        self.assertIn('provision_line_edit_return', parent)
        self.assertEqual(parent['provision_lines'][1]['fields']['QTD'], '3')
        self.state['fields']['PRODUTO'] = 'PRODUTO NOVO QA'
        result = self.engine._resume_payment_with_registered_product(self.state, self.qa.fixture.etag(), 999)
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(self.state['provision_lines'][0]['fields']['PRODUTO'], 'PRODUTO NOVO QA')
        self.assertEqual(self.state['provision_lines'][1]['fields']['PRODUTO'], 'PRODUTO B QA')
        self.assertEqual(self.state['fields']['PRODUTO'], 'PRODUTO B QA')

    def test_single_provision_keeps_direct_field_edit(self):
        self.state['answers']['tipo_provisao_pagamento'] = 'UNICO'
        self.state['provision_lines'] = self.state['provision_lines'][-1:]
        self.reply('confirm_edit')
        self.assertEqual(self.state['stage'], 'editing_field_choice')
        self.assertNotIn('editing_provision_line_index', self.state)

    def test_frozen_commit_remains_locked_and_payload_is_immutable(self):
        self.state['provision_commit'] = {'parent_id': 12, 'children': [{'fields': {'QTD': '2'}}]}
        before = copy.deepcopy(self.state['provision_commit'])
        self.assertEqual(self.reply('confirm_edit')['status'], 'provision_submission_locked')
        self.assertEqual(self.state['provision_commit'], before)
        self.assertEqual(self.catalog.creates, [])


if __name__ == '__main__':
    unittest.main()
