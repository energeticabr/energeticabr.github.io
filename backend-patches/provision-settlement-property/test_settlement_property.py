"""Regressions against an isolated staging copy of the installed workflow."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

SOURCE = Path(os.environ['SETTLEMENT_TEST_SOURCE'])
RUNTIME = Path(os.environ['SETTLEMENT_TEST_RUNTIME'])
sys.path.insert(0, str(RUNTIME / 'worker'))
sys.path.insert(0, str(RUNTIME))

import worker

worker.__path__.insert(0, str(SOURCE / 'worker'))

from worker.config import load_workflow_config
from worker.workflow import WorkflowEngine


class SettlementPropertyTests(unittest.TestCase):
    def setUp(self):
        self.engine = WorkflowEngine.__new__(WorkflowEngine)
        self.engine.config = load_workflow_config(SOURCE / 'worker/workflow_config.json')
        self.engine._context = lambda state: state['fields']
        self.engine._save = Mock(return_value='next-etag')
        self.engine._send_actions = Mock()
        self.engine._prompt_next_or_summary = Mock(return_value={'status': 'awaiting_confirmation'})
        self.state = {
            'flow': 'payment_settlement', 'stage': 'selecting_fields', 'batch_id': 'qa-settlement',
            'options': [], 'answers': {}, 'selections': {}, 'display_values': {},
            'processed_message_ids': [], 'attachments': [{'id': 'qa-proof'}],
            'fields': {'DATA PREVISTO PGTO': '2026-11-27', 'FORNECEDOR': 'QA', 'FILIAL': 'QA',
                       'PRODUTO': 'QA', 'OBS': 'CONFERIDO', 'IMOVEL': None},
        }

    def test_blank_property_goes_directly_to_the_summary(self):
        self.assertIsNone(self.engine._maybe_prompt_payment_settlement_blank_review(self.state, 'etag'))
        self.engine._send_actions.assert_not_called()

    def test_other_blanks_are_still_reviewed(self):
        self.state['fields'].update(FORNECEDOR='', OBS='')
        result = self.engine._maybe_prompt_payment_settlement_blank_review(self.state, 'etag')
        self.assertEqual(result['blank_fields'], ['FORNECEDOR', 'OBS'])
        self.assertNotIn('IMÓVEL', self.engine._send_actions.call_args.args[1])

    def test_blank_observation_keeps_its_own_question(self):
        self.state['fields']['OBS'] = ''
        result = self.engine._maybe_prompt_payment_settlement_blank_review(self.state, 'etag')
        self.assertEqual(result['status'], 'awaiting_payment_settlement_observation_decision')
        self.assertEqual(result['blank_fields'], ['OBS'])

    def test_preexisting_blank_question_can_be_resumed_with_its_attachments(self):
        self.state['stage'] = 'reviewing_payment_settlement_blank_fields'
        self.state['payment_settlement_blank_fields'] = [{'field': 'IMOVEL'}]
        result = self.engine._resend_current_prompt(self.state, 'etag')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(self.state['stage'], 'selecting_fields')
        self.assertEqual(self.state['attachments'], [{'id': 'qa-proof'}])
        self.assertNotIn('payment_settlement_blank_fields', self.state)
        self.engine._send_actions.assert_not_called()

    def test_old_question_reply_does_not_reopen_property(self):
        self.state['stage'] = 'reviewing_payment_settlement_blank_fields'
        result = self.engine._handle_payment_settlement_blank_review_reply(
            {'reply_id': 'old-property-question', 'message_id': 'qa-reply'}, self.state, 'etag')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertIn('qa-reply', self.state['processed_message_ids'])
        self.engine._send_actions.assert_not_called()

    def test_property_is_only_copied_for_identification(self):
        flow = self.engine._flow_config(self.state)
        index = next(i for i, step in enumerate(flow['steps']) if step['key'] == 'preencher_imovel_baixa')
        self.state['fields']['IMOVEL'] = self.state['display_values']['IMOVEL'] = 'BLOCO QA'
        self.assertTrue(any(item.get('source_field') == 'IMOVEL' for item in flow['steps'][0]['copy_fields']))
        self.assertNotIn(index, [item['value'] for item in self.engine._editable_options(self.state)])
        self.state.update(step_index=index, edit_step_indices=[index])
        self.assertIsNone(self.engine._current_step(self.state))
        self.assertEqual(self.state['fields']['IMOVEL'], 'BLOCO QA')
        self.assertEqual(self.state['display_values']['IMOVEL'], 'BLOCO QA')

    def test_old_edit_menu_reloads_without_touching_identification(self):
        steps = self.engine._flow_config(self.state)['steps']
        index = next(i for i, step in enumerate(steps) if step['key'] == 'preencher_imovel_baixa')
        self.state['stage'] = 'editing_field_choice'
        self.state['options'] = [{'id': index + 1, 'title': 'IMÓVEL', 'value': index}]
        self.state['fields']['IMOVEL'] = 'BLOCO QA'
        self.engine._prompt_edit_field = Mock(return_value={'status': 'awaiting_edit_field'})
        result = self.engine._handle_edit_field_reply(
            {'reply_id': str(index + 1), 'message_id': 'qa-old-edit'}, self.state, 'etag')
        self.assertEqual(result['status'], 'awaiting_edit_field')
        self.assertEqual(self.state['fields']['IMOVEL'], 'BLOCO QA')
        self.engine._prompt_edit_field.assert_called_once_with(self.state, 'etag')

    def test_old_property_selection_reply_is_discarded(self):
        steps = self.engine._flow_config(self.state)['steps']
        index = next(i for i, step in enumerate(steps) if step['key'] == 'preencher_imovel_baixa')
        self.state.update(step_index=index, edit_step_indices=[index], options=[{'id': 'qa-property'}])
        result = self.engine._handle_step_reply(
            {'reply_id': 'qa-property', 'message_id': 'qa-old-property'}, self.state, 'etag')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertIn('qa-old-property', self.state['processed_message_ids'])
        self.assertEqual(self.state['options'], [])
        self.assertIsNone(self.state['fields']['IMOVEL'])


if __name__ == '__main__':
    unittest.main()
