"""Exercise the real payment workflow with in-memory external services only."""
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(os.environ['PROVISION_SOURCE']).resolve()
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT), str(ROOT / 'tests')]
if os.environ.get('PROVISION_TESTS'):
    sys.path.insert(0, os.environ['PROVISION_TESTS'])
import test_workflow as fixtures


class SupplierTests(unittest.TestCase):
    setUp = fixtures.WorkflowTests.setUp

    def prompt(self):
        flow = self.config['sharepoint']['payment_flow']
        step_index = next(i for i, step in enumerate(flow['steps']) if step['key'] == 'fornecedor_pagamento')
        state = {'key': 'supplier-test', 'batch_id': 'supplier-batch', 'flow': 'payment',
                 'stage': 'collecting_fields', 'step_index': step_index, 'fields': {}, 'answers': {},
                 'selections': {}, 'display_values': {}, 'options': [], 'attachments': [],
                 'processed_message_ids': []}
        self.sharepoint.options_by_key['fornecedor_pagamento'] = [
            {'id': 273, 'title': 'ZURICH SEGUROS', 'value': 'ZURICH SEGUROS'},
            {'id': 272, 'title': 'ELÉTRICA CATEDRAL', 'value': 'ELÉTRICA CATEDRAL'},
        ]
        result = self.engine._prompt_next_or_summary(state, None)
        return state, result, flow['steps'][step_index]

    def test_supplier_prompt_contains_real_suppliers_without_blank(self):
        state, result, _ = self.prompt()
        self.assertEqual(result['field'], 'fornecedor_pagamento')
        self.assertEqual([row['id'] for row in state['options'] if isinstance(row['id'], int)], [273, 272])
        self.assertIn('payment_supplier_registration', [row['id'] for row in state['options']])
        self.assertNotIn('EM BRANCO', [row['title'] for row in state['options']])
        self.assertEqual(self.sharepoint.items, {})
        if os.environ.get('PROVISION_FIXTURE'):
            message = self.messenger.sent[-1]
            Path(os.environ['PROVISION_FIXTURE']).write_text(json.dumps({
                'type': 'poll', 'question': message.get('prompt') or message.get('body'),
                'options': [{'id': f"choice:fornecedor_pagamento:{row['id']}" if isinstance(row['id'], int) else row['id'],
                             'label': f"{row['id']} - {row['title']}" if isinstance(row['id'], int) else row['title']} for row in state['options']]
            }, ensure_ascii=False), encoding='utf-8')

    def test_supplier_filter_does_not_restore_blank_option(self):
        state, result, step = self.prompt()
        filtered = self.engine._handle_selection_reply({'kind': 'text', 'text': 'ZURICH', 'message_id': 'filter'}, state, result['etag'], step)
        self.assertEqual(filtered['status'], 'filtered_options')
        rows = self.messenger.sent[-1]['options']
        self.assertEqual([row['id'] for row in rows if isinstance(row['id'], int)], [273])
        self.assertNotIn('EM BRANCO', [row['title'] for row in rows])
        self.assertEqual(state['step_index'], self.config['sharepoint']['payment_flow']['steps'].index(step))

    def test_blank_supplier_button_is_not_accepted(self):
        state, result, step = self.prompt()
        before = state['step_index']
        rejected = self.engine._handle_selection_reply({'kind': 'text', 'reply_id': 'choice:fornecedor_pagamento:0', 'text': '', 'message_id': 'blank'}, state, result['etag'], step)
        self.assertEqual(rejected['status'], 'invalid_option')
        self.assertEqual(state['step_index'], before)
        self.assertNotIn('FORNECEDOR', state['fields'])
        self.assertEqual(self.sharepoint.items, {})

    def test_real_supplier_selection_advances_without_financial_write(self):
        state, result, step = self.prompt()
        selected = self.engine._handle_selection_reply({'kind': 'text', 'reply_id': 'choice:fornecedor_pagamento:273', 'text': '', 'message_id': 'supplier'}, state, result['etag'], step)
        self.assertEqual(state['fields']['FORNECEDOR'], 'ZURICH SEGUROS')
        self.assertEqual(selected['field'], 'filial_pagamento')
        self.assertEqual(self.sharepoint.items, {})

    def test_other_optional_fields_keep_blank_choice(self):
        state, result, step = self.prompt()
        self.engine._handle_selection_reply({'kind': 'text', 'reply_id': 'choice:fornecedor_pagamento:273', 'text': '', 'message_id': 'supplier'}, state, result['etag'], step)
        self.assertIn('EM BRANCO', [row['title'] for row in state['options']])


if __name__ == '__main__':
    unittest.main(verbosity=2)
