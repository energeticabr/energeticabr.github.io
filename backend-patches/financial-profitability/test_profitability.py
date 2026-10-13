"""Exercise Screen16_2/Form53 using the installed engine and isolated adapters."""
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


class ProfitabilityTests(unittest.TestCase):
    def setUp(self):
        self.config = load_workflow_config(os.getenv('PROFITABILITY_CONFIG', '/opt/energetica-whatsapp/worker/workflow_config.json'))
        self.sharepoint = MagicMock()
        for method in ('ensure_item', 'create_item', 'update_item', 'delete_item'):
            getattr(self.sharepoint, method).side_effect = AssertionError('Unexpected write before confirmation')
        self.sharepoint.get_options.side_effect = lambda step, context: copy.deepcopy(step['source'].get('options', []))
        self.engine = IsolatedEngine(self.config, MagicMock(), MagicMock(), MagicMock(), self.sharepoint)
        self.event = {'conversation_id': 'synthetic-profitability', 'sender': 'test-only', 'message_id': 'test-0', 'kind': 'text', 'text': ''}
        self.state = self.engine._new_state(self.event, 'synthetic-profitability')

    def send(self, reply):
        self.event = {**self.event, 'message_id': self.event['message_id'] + 'x', 'reply_id': reply, 'text': reply}
        return self.engine._handle_text(self.event, self.state, 'test-etag')

    def open(self):
        self.send('group_financial')
        self.send('action_financial_registrations')
        self.assertEqual([a['id'] for a in self.engine.last_menu[:4]], [
            'action_register_investment', 'action_register_institution',
            'action_register_investment_type', 'action_register_profitability'])
        self.send('action_register_profitability')
        self.assertEqual(self.state['flow'], 'profitability_registration')

    def test_menu_and_form53_contract(self):
        self.open()
        flow = self.engine._flow_config(self.state)
        self.assertEqual(flow['target_list'], 'RENTABILIDADE')
        self.assertEqual(flow['powerapps_reference'], 'Screen16_2.pa.yaml#Form53')
        self.assertEqual([s['target_field'] for s in flow['steps']], ['RENTABILIDADE', 'STATUS'])
        self.assertEqual(flow['steps'][0]['kind'], 'text')
        self.assertEqual([o['value'] for o in flow['steps'][1]['source']['options']], ['ATIVO', 'INATIVO'])

    def test_invalid_status_is_rejected(self):
        self.open()
        self.send('100% CDI')
        self.send('STATUS INEXISTENTE')
        self.assertNotIn('STATUS', self.state['fields'])
        self.assertEqual(self.engine._current_step(self.state)['target_field'], 'STATUS')
        self.sharepoint.ensure_item.assert_not_called()

    def test_both_statuses_reach_review_without_writes(self):
        for status_id, status in [(1, 'ATIVO'), (2, 'INATIVO')]:
            with self.subTest(status=status):
                self.setUp()
                self.open()
                self.send('100% CDI')
                result = self.send(f'choice:status_cadastro_rentabilidade:{status_id}')
                self.assertEqual(result['status'], 'awaiting_confirmation')
                self.assertEqual(self.state['fields'], {'RENTABILIDADE': '100% CDI', 'STATUS': status})
                self.assertEqual(len(self.engine.summary_rows), 2)
                self.sharepoint.ensure_item.assert_not_called()

    def test_optional_profitability_can_be_blank(self):
        self.open()
        self.send('profitability_blank')
        result = self.send('choice:status_cadastro_rentabilidade:1')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertFalse(self.state['fields'].get('RENTABILIDADE'))
        self.sharepoint.ensure_item.assert_not_called()

    def test_every_previous_setting_is_preserved(self):
        original_path = os.getenv('PROFITABILITY_ORIGINAL')
        if not original_path:
            self.skipTest('Original config not supplied')
        with open(original_path, encoding='utf-8') as stream:
            original = json.load(stream)
        recovered = copy.deepcopy(self.config)
        # New registrations may append entries; all original settings must remain exact.
        actions = recovered['whatsapp']['submenus']['financial_registrations']['actions']
        actions[:] = actions[:len(original['whatsapp']['submenus']['financial_registrations']['actions'])]
        for key in set(recovered['sharepoint']) - set(original['sharepoint']):
            self.assertTrue(key.endswith('_registration_flow'))
            recovered['sharepoint'].pop(key)
        self.assertEqual(recovered, original)


if __name__ == '__main__':
    unittest.main()
