import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(os.environ['EXPENSE_TYPE_SOURCE']) / 'worker'))
import financial_catalog_registration as catalog


STEP = {
    'key': 'tipo_despesa_produto_cadastro',
    'kind': 'selection',
    'target_field': 'TIPODESPESA',
    'source': {'type': 'sharepoint_list', 'list': 'CADASTROTIPOMATERIAL',
               'label_field': 'TIPO', 'value_field': 'TIPO'},
}
STATE_FLOW = {'flow': 'supply_product_registration'}
FLOW = {'steps': [{'key': 'name'}, STEP, {'key': 'unit'}], 'target_list': 'CADASTROPRODUTO'}


class ProductExpenseTypeTests(unittest.TestCase):
    def setUp(self):
        self.engine = Mock()
        self.engine.config = {'sharepoint': {'supply_material_type_registration_flow':
                                              {'target_list': 'CADASTROTIPOMATERIAL'}}}
        self.engine._context.return_value = {}
        self.engine.sharepoint.get_options.return_value = [{'id': '24', 'value': 'EPI/EPC'}]
        self.engine._prompt_next_or_summary.return_value = {'status': 'awaiting_input'}

    def state(self, value):
        return dict(STATE_FLOW, fields={'TIPODESPESA': value, 'UNIDADE': 'PAR'},
                    display_values={'TIPODESPESA': value}, step_index=3,
                    options=[{'id': '4', 'value': 'EPI / EPC'}],
                    option_pagination={'step_key': STEP['key']},
                    answers={}, selections={}, attachments=['existing'])

    def test_filters_the_catalog_without_removing_inline_creation(self):
        shown = catalog.step_with_create(self.engine, STATE_FLOW, STEP)
        self.assertEqual(shown['source']['filters'], [{'field': 'STATUS', 'equals': 'ATIVO'}])
        self.assertEqual(shown['terminal_options'][0]['id'], catalog.CREATE_ID)
        self.assertNotIn('filters', STEP['source'])

    def test_a_legacy_product_source_uses_the_type_catalog_and_its_status(self):
        step = dict(STEP, source=dict(STEP['source'], list='CADASTROPRODUTO', fields=['PRODUTO']))
        shown = catalog.step_with_create(self.engine, STATE_FLOW, step)
        self.assertEqual(shown['source']['list'], 'CADASTROTIPOMATERIAL')
        self.assertEqual(shown['source']['filters'], [{'field': 'STATUS', 'equals': 'ATIVO'}])
        self.assertNotIn('fields', shown['source'])

    def test_stale_draft_reopens_only_expense_type(self):
        state = self.state('EPI / EPC')
        self.engine.sharepoint._find_item.return_value = None
        result = catalog.guard_product_expense_type(self.engine, state, 'etag', FLOW, 'token')
        self.assertEqual(result, (None, {'status': 'awaiting_input'}))
        self.engine._clear_step_value.assert_called_once_with(state, STEP)
        self.engine._prompt_next_or_summary.assert_called_once_with(state, 'etag')
        self.assertEqual(state['step_index'], 1)
        self.assertEqual(state['edit_step_indices'], [1])
        self.assertEqual(state['options'], [])
        self.assertNotIn('option_pagination', state)
        self.assertEqual(state['fields']['UNIDADE'], 'PAR')
        self.assertEqual(state['attachments'], ['existing'])

    def test_active_value_can_be_saved(self):
        state = self.state('EPI/EPC')
        self.assertEqual(catalog.guard_product_expense_type(self.engine, state, 'etag', FLOW, 'token'), (None, None))
        self.engine.sharepoint._find_item.assert_not_called()
        self.engine._prompt_next_or_summary.assert_not_called()

    def test_existing_migrated_product_is_reconciled_by_its_own_token(self):
        state = self.state('EPI / EPC')
        self.engine.sharepoint._find_item.return_value = {'Id': 660}
        self.engine.sharepoint.get_item_fields.return_value = {'TIPODESPESA': 'EPI/EPC'}
        self.assertEqual(catalog.guard_product_expense_type(self.engine, state, 'etag', FLOW, 'token'), (660, None))
        self.assertEqual(state['fields']['TIPODESPESA'], 'EPI/EPC')
        self.engine.sharepoint._find_item.assert_called_once_with('token', 'CADASTROPRODUTO', 'Title')
        self.engine._prompt_next_or_summary.assert_not_called()

    def test_another_flow_keeps_its_original_behavior(self):
        state = {'flow': 'launch'}
        self.assertIs(catalog.step_with_create(self.engine, state, STEP), STEP)
        self.assertEqual(catalog.guard_product_expense_type(self.engine, state, 'etag', FLOW, 'token'), (None, None))
        self.engine.sharepoint.get_options.assert_not_called()

    def test_already_committed_product_can_be_reconciled_after_type_is_blocked(self):
        state = self.state('EPI / EPC')
        self.engine.sharepoint._find_item.return_value = {'Id': 660}
        self.engine.sharepoint.get_item_fields.return_value = {'TIPODESPESA': 'EPI / EPC'}
        self.assertEqual(catalog.guard_product_expense_type(self.engine, state, 'etag', FLOW, 'token'), (660, None))
        self.engine._prompt_next_or_summary.assert_not_called()


if __name__ == '__main__':
    unittest.main()
