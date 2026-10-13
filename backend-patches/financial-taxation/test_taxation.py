"""Exercise Screen16_3/Form53_1 without real SharePoint writes."""
import copy
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'financial-institution'))
sys.path.insert(0, '/opt/energetica-whatsapp/worker')
from test_institution import IsolatedEngine
from config import load_workflow_config


class TaxationTests(unittest.TestCase):
    def setUp(self):
        self.config = load_workflow_config(os.getenv('TAXATION_CONFIG', '/opt/energetica-whatsapp/worker/workflow_config.json'))
        self.sharepoint = MagicMock()
        self.sharepoint.get_options.return_value = []
        for method in ('ensure_item', 'create_item', 'update_item', 'delete_item'):
            getattr(self.sharepoint, method).side_effect = AssertionError('Unexpected write before confirmation')
        self.engine = IsolatedEngine(self.config, MagicMock(), MagicMock(), MagicMock(), self.sharepoint)
        self.event = {'conversation_id': 'synthetic-taxation', 'sender': 'test-only', 'message_id': 'test-0', 'kind': 'text', 'text': ''}
        self.state = self.engine._new_state(self.event, 'synthetic-taxation')

    def send(self, reply):
        self.event = {**self.event, 'message_id': self.event['message_id'] + 'x', 'reply_id': reply, 'text': reply}
        return self.engine._handle_text(self.event, self.state, 'test-etag')

    def open(self):
        self.send('group_financial')
        self.send('action_financial_registrations')
        self.assertEqual([a['id'] for a in self.engine.last_menu], [
            'action_register_investment', 'action_register_institution',
            'action_register_investment_type', 'action_register_profitability', 'action_register_taxation'])
        self.send('action_register_taxation')
        self.assertEqual(self.state['flow'], 'taxation_registration')

    def test_menu_and_form53_1_contract(self):
        self.open()
        flow = self.engine._flow_config(self.state)
        self.assertEqual(flow['target_list'], 'TRIBUTAÇÃO')
        self.assertEqual(flow['powerapps_reference'], 'Screen16_3.pa.yaml#Form53_1')
        self.assertEqual([s['target_field'] for s in flow['steps']], ['TRIBUTACAO', 'STATUS', 'DESCRICAO'])
        self.assertEqual([s['kind'] for s in flow['steps']], ['text', 'text', 'text'])

    def test_answers_reach_review_without_writes(self):
        self.open()
        self.send('TABELA REGRESSIVA')
        self.send('ATIVO')
        result = self.send('DESCRIÇÃO DE TESTE')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(self.state['fields'], {'TRIBUTACAO': 'TABELA REGRESSIVA', 'STATUS': 'ATIVO', 'DESCRICAO': 'DESCRIÇÃO DE TESTE'})
        self.assertEqual(len(self.engine.summary_rows), 3)
        self.sharepoint.ensure_item.assert_not_called()

    def test_status_is_text_as_in_original_form(self):
        self.open()
        # The home menu reads pending counters; only the form must avoid selection queries.
        self.sharepoint.get_options.reset_mock()
        self.send('TEXTO DE TESTE')
        self.send('EM ANÁLISE')
        result = self.send('taxation_blank')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(self.state['fields']['STATUS'], 'EM ANÁLISE')
        self.sharepoint.get_options.assert_not_called()
        self.sharepoint.ensure_item.assert_not_called()

    def test_optional_fields_can_be_blank(self):
        self.open()
        for _ in range(3):
            result = self.send('taxation_blank')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertFalse(any(self.state['fields'].get(f) for f in ['TRIBUTACAO', 'STATUS', 'DESCRICAO']))
        self.sharepoint.ensure_item.assert_not_called()

    def test_every_previous_setting_is_preserved(self):
        original_path = os.getenv('TAXATION_ORIGINAL')
        if not original_path:
            self.skipTest('Original config not supplied')
        with open(original_path, encoding='utf-8') as stream:
            original = json.load(stream)
        recovered = copy.deepcopy(self.config)
        recovered['whatsapp']['submenus']['financial_registrations']['actions'].pop()
        recovered['sharepoint'].pop('taxation_registration_flow')
        self.assertEqual(recovered, original)


if __name__ == '__main__':
    unittest.main()
