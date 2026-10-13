"""Exercise Form54 through the installed engine without real records."""
import copy
import json
import os
import sys
import unittest
from unittest.mock import MagicMock

sys.path.insert(0, '/opt/energetica-whatsapp/worker')
from workflow import WorkflowEngine
from config import load_workflow_config


class IsolatedEngine(WorkflowEngine):
    def _save(self, state, etag):
        return 'test-etag'

    def _send_actions(self, state, prompt, actions, **kwargs):
        self.last_menu = copy.deepcopy(actions)

    def _send_input_question(self, state, prompt, **kwargs):
        self.last_question = prompt

    def _send_summary_card(self, state):
        self.summary_rows = self._summary_rows(state)
        return {'filename': 'synthetic-summary.png'}

    def _today_diary_photo_append_action(self):
        return None

    def _main_menu_diary_actions(self, state):
        return []


class InstitutionTests(unittest.TestCase):
    def setUp(self):
        self.config = load_workflow_config(os.getenv('INSTITUTION_CONFIG', '/opt/energetica-whatsapp/worker/workflow_config.json'))
        self.sharepoint = MagicMock()
        for method in ('ensure_item', 'create_item', 'update_item', 'delete_item'):
            getattr(self.sharepoint, method).side_effect = AssertionError('Unexpected write before confirmation')
        self.sharepoint.get_options.side_effect = lambda step, context: copy.deepcopy(step['source'].get('options', []))
        self.engine = IsolatedEngine(self.config, MagicMock(), MagicMock(), MagicMock(), self.sharepoint)
        self.event = {'conversation_id': 'synthetic-institution-test', 'sender': 'test-only', 'message_id': 'test-0', 'kind': 'text', 'text': ''}
        self.state = self.engine._new_state(self.event, 'synthetic-institution-test')

    def send(self, reply):
        self.event = {**self.event, 'message_id': self.event['message_id'] + 'x', 'reply_id': reply, 'text': reply}
        return self.engine._handle_text(self.event, self.state, 'test-etag')

    def open(self):
        self.send('group_financial')
        self.send('action_financial_registrations')
        self.assertEqual([a['id'] for a in self.engine.last_menu[:2]], ['action_register_investment', 'action_register_institution'])
        self.send('action_register_institution')
        self.assertEqual(self.state['flow'], 'institution_registration')

    def test_menu_opens_form54_after_investment(self):
        self.open()
        self.assertEqual(self.engine._flow_config(self.state)['target_list'], 'INSTITUICAOEMISSORA')
        self.assertEqual(self.engine._current_step(self.state)['target_field'], 'INSTITUICAOEMISSORA')
        self.sharepoint.ensure_item.assert_not_called()

    def test_form54_has_name_then_closed_status(self):
        self.open()
        flow = self.engine._flow_config(self.state)
        self.assertEqual([s['target_field'] for s in flow['steps']], ['INSTITUICAOEMISSORA', 'STATUS'])
        self.assertEqual(flow['powerapps_reference'], 'Screen16.pa.yaml#Form54')
        self.assertEqual([o['value'] for o in flow['steps'][1]['source']['options']], ['ATIVO', 'INATIVO'])

    def test_arbitrary_status_is_rejected(self):
        self.open()
        self.send('INSTITUIÇÃO DE TESTE')
        self.send('QUALQUER STATUS')
        self.assertNotIn('STATUS', self.state['fields'])
        self.assertEqual(self.engine._current_step(self.state)['target_field'], 'STATUS')
        self.sharepoint.ensure_item.assert_not_called()

    def test_both_status_options_reach_review_without_writes(self):
        for option_id, status in [(1, 'ATIVO'), (2, 'INATIVO')]:
            with self.subTest(status=status):
                self.setUp()
                self.open()
                self.send('INSTITUIÇÃO DE TESTE')
                result = self.send(f'choice:status_cadastro_instituicao:{option_id}')
                self.assertEqual(result['status'], 'awaiting_confirmation')
                self.assertEqual(self.state['fields'], {'INSTITUICAOEMISSORA': 'INSTITUIÇÃO DE TESTE', 'STATUS': status})
                self.assertEqual(len(self.engine.summary_rows), 2)
                self.sharepoint.ensure_item.assert_not_called()

    def test_previous_investment_flow_unchanged(self):
        source = os.getenv('INSTITUTION_ORIGINAL')
        if not source:
            self.skipTest('Original config not supplied')
        with open(source, encoding='utf-8') as stream:
            original = json.load(stream)
        self.assertEqual(self.config['sharepoint']['investment_registration_flow'], original['sharepoint']['investment_registration_flow'])
        self.assertEqual(self.config['whatsapp']['start_groups'], original['whatsapp']['start_groups'])


if __name__ == '__main__':
    unittest.main()
