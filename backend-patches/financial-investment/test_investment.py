"""Exercise the installed workflow using isolated state and external adapters."""
import copy
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, '/opt/energetica-whatsapp/worker')
from workflow import WorkflowEngine
from config import load_workflow_config

FIELDS = ['INSTITUICAO', 'DESCRICAO', 'TIPO', 'INVESTIMENTO', 'TRIBUTAÇÃO',
          'RENTABILIDADE', 'LIQUIDEZ', 'RISCO', 'PRAZO']


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


class InvestmentTests(unittest.TestCase):
    def setUp(self):
        self.config = load_workflow_config(os.getenv('INVESTMENT_CONFIG', '/opt/energetica-whatsapp/worker/workflow_config.json'))
        self.sharepoint = MagicMock()
        for method in ('ensure_item', 'create_item', 'update_item', 'delete_item'):
            getattr(self.sharepoint, method).side_effect = AssertionError('Unexpected write before confirmation')
        self.sharepoint.get_options.return_value = [{'id': 1, 'title': 'INSTITUIÇÃO DE TESTE', 'value': 'INSTITUIÇÃO DE TESTE'}]
        self.engine = IsolatedEngine(self.config, MagicMock(), MagicMock(), MagicMock(), self.sharepoint)
        self.event = {'conversation_id': 'synthetic-test', 'sender': 'test-only', 'message_id': 'test-0', 'kind': 'text', 'text': ''}
        self.state = self.engine._new_state(self.event, 'synthetic-test')

    def send(self, reply):
        self.event = {**self.event, 'message_id': self.event['message_id'] + 'x', 'reply_id': reply, 'text': reply}
        return self.engine._handle_text(self.event, self.state, 'test-etag')

    def open(self):
        self.send('group_financial')
        self.assertEqual(self.state['selected_group'], 'group_financial')
        self.assertEqual(self.engine.last_menu[0]['id'], 'action_financial_registrations')
        self.send('action_financial_registrations')
        self.assertEqual(self.state['selected_submenu'], 'financial_registrations')
        self.send('action_register_investment')
        self.assertEqual(self.state['flow'], 'investment_registration')

    def test_menu_opens_form45_investment_flow(self):
        self.assertIn('group_financial', [g['id'] for g in self.engine._start_groups()])
        self.open()
        self.assertEqual(self.engine._flow_config(self.state)['target_list'], 'CADASTRO INVESTIMENTO')
        self.assertEqual(self.engine._current_step(self.state)['target_field'], 'INSTITUICAO')
        self.sharepoint.create_item.assert_not_called()
        self.sharepoint.ensure_item.assert_not_called()

    def test_form45_controls_order_and_optional_fields(self):
        self.state['flow'] = 'investment_registration'
        flow = self.engine._flow_config(self.state)
        self.assertEqual([s.get('target_field') for s in flow['steps']], FIELDS)
        self.assertEqual(flow['steps'][0]['source']['list'], 'INSTITUICAOEMISSORA')
        self.assertEqual(flow['steps'][0]['source']['value_field'], 'INSTITUICAOEMISSORA')
        self.assertEqual(flow['steps'][-1]['kind'], 'date')

    def test_institution_must_be_an_existing_option(self):
        self.open()
        result = self.send('NOME QUE NÃO EXISTE NA BASE')
        self.assertNotIn('INSTITUICAO', self.state['fields'])
        self.assertNotEqual(result['status'], 'completed')
        self.sharepoint.create_item.assert_not_called()
        self.sharepoint.ensure_item.assert_not_called()

    def test_all_answers_reach_review_without_writing(self):
        self.open()
        values = ['choice:instituicao_cadastro_investimento:1', 'EXEMPLO', 'RENDA FIXA', 'CDB', 'TABELA REGRESSIVA', '100% CDI', 'DIÁRIA', 'BAIXO', '31/12/2030']
        for value in values:
            result = self.send(value)
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(set(self.state['fields']), set(FIELDS))
        self.assertEqual(self.state['fields']['PRAZO'], '2030-12-31')
        self.assertEqual(self.state['fields']['INVESTIMENTO'], 'CDB')
        self.assertEqual(len(self.engine.summary_rows), 9)
        self.sharepoint.create_item.assert_not_called()
        self.sharepoint.ensure_item.assert_not_called()

    def test_back_from_cadastros_returns_to_financial_menu(self):
        self.send('group_financial')
        self.send('action_financial_registrations')
        self.send('back_to_group_actions')
        self.assertEqual(self.state['stage'], 'choosing_action')
        self.assertEqual(self.state['selected_group'], 'group_financial')
        self.assertEqual(self.engine.last_menu[0]['title'], '🗂️ CADASTROS')


if __name__ == '__main__':
    unittest.main()



