"""Real workflow regressions with sandbox state, media and SharePoint doubles."""
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(os.environ['TRANSPORT_SOURCE']).resolve()
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT), str(ROOT / 'tests')]
if os.environ.get('TRANSPORT_TESTS'):
    sys.path.insert(0, os.environ['TRANSPORT_TESTS'])
import test_workflow as fixtures


class TransportTests(unittest.TestCase):
    setUp = fixtures.WorkflowTests.setUp

    def seed(self):
        return {'key': 'transport-test', 'batch_id': 'transport-batch', 'flow': 'launch',
                'stage': 'selecting_launch_payroll_type', 'fields': {}, 'answers': {},
                'selections': {}, 'display_values': {}, 'options': [],
                'sharepoint': {'item_id': 3498}, 'processed_message_ids': [],
                'pending_launch_payroll': {'type_index': 0, 'selected_entries': [{
                    'item_id': 3498, 'supplier': 'FORNECEDOR TESTE', 'IDFOLHA': 19,
                    'fields': {'FORNECEDOR': 'FORNECEDOR TESTE', 'PRODUTO': 'SERVIÇO',
                               'VALOR UNITÁRIO': '11', 'QUANTIDADE': '3',
                               'FRETE': '0', 'DATA': '2026-10-04'}}]}}

    def test_prompt_offers_transport_and_preserves_previous_choices_without_writes(self):
        state = self.seed()
        result = self.engine._prompt_launch_payroll_type(state, None)
        message = self.messenger.sent[-1]
        actions = [a for a in message['actions'] if a['id'].startswith('launch_payroll_type_')]
        self.assertEqual(result['status'], 'awaiting_launch_payroll_type')
        self.assertEqual([a['title'] for a in actions], ['SALÁRIO', 'VALE REFEIÇÃO',
            'VALE TRANSPORTE', 'AJUDA DE CUSTO', '13 SALÁRIO', 'FÉRIAS E/OU ENCARGOS', 'PREMIAÇÃO'])
        self.assertEqual(next(a['id'] for a in actions if a['title'] == 'VALE TRANSPORTE'),
                         'launch_payroll_type_transport')
        self.assertEqual(self.sharepoint.items, {})
        self.assertIn('R$ 33,00', message['body'])
        if os.environ.get('TRANSPORT_FIXTURE'):
            Path(os.environ['TRANSPORT_FIXTURE']).write_text(json.dumps({
                'type': 'poll', 'question': message['body'],
                'options': [{'id': a['id'], 'label': a['title']} for a in actions]
            }, ensure_ascii=False), encoding='utf-8')

    def submit(self, event):
        state = self.seed()
        etag = self.engine._prompt_launch_payroll_type(state, None)['etag']
        result = self.engine._handle_launch_payroll_type_reply(event, state, etag)
        return state, result

    def assert_transport_row(self):
        rows = [i for i in self.sharepoint.items.values() if i['target_list'] == 'FOLHAPGTO']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['fields'], {'FORNECEDOR': 'FORNECEDOR TESTE',
            'TIPOPGTO': 'VALE TRANSPORTE', 'VALORUNITARIO': '11', 'QTD': '3',
            'DATA': '2026-10-04', 'IDFOLHA': 19, 'IDLANCAMENTO': 3498})

    def test_button_creates_verified_transport_row_linked_to_correct_launch(self):
        state, result = self.submit({'message_id': 'transport-button',
                                   'reply_id': 'launch_payroll_type_transport'})
        self.assertEqual(result['status'], 'completed')
        self.assert_transport_row()
        self.assertEqual(state['sharepoint']['folhapgto_rows'][0]['fields']['TIPOPGTO'], 'VALE TRANSPORTE')
        self.assertTrue(state['sharepoint']['folhapgto_rows'][0]['verified'])

    def test_typed_transport_is_accepted_and_normalized(self):
        _, result = self.submit({'message_id': 'transport-text', 'text': 'vale transporte'})
        self.assertEqual(result['status'], 'completed')
        self.assert_transport_row()

    def test_duplicate_transport_click_does_not_create_second_payment(self):
        event = {'message_id': 'transport-duplicate', 'reply_id': 'launch_payroll_type_transport'}
        state, result = self.submit(event)
        self.assertEqual(result['status'], 'completed')
        again = self.engine._handle_launch_payroll_type_reply(event, state, result['etag'])
        self.assertEqual(again['status'], 'duplicate')
        self.assert_transport_row()

    def test_unknown_type_does_not_create_a_payment(self):
        _, result = self.submit({'message_id': 'unknown-type', 'reply_id': 'launch_payroll_type_unknown'})
        self.assertEqual(result['status'], 'awaiting_launch_payroll_type')
        self.assertEqual(self.sharepoint.items, {})


if __name__ == '__main__':
    unittest.main(verbosity=2)
