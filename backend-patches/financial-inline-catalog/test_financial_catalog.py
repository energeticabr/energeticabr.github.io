"""Run real workflow transitions with isolated adapters; never write live records."""
import copy
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock

sys.path.insert(0, '/opt/energetica-whatsapp/worker')
sys.path.insert(0, os.getenv('FINANCIAL_CANDIDATE', '/opt/energetica-whatsapp/worker'))
from workflow import WorkflowEngine
from config import load_workflow_config

CREATE_ID = 'financial_catalog_create'
KEY = 'instituicao_cadastro_investimento'


class Engine(WorkflowEngine):
    def _event_allowed(self, event): return True
    def _save(self, state, etag): return 'isolated-etag'
    def _send_text(self, *args, **kwargs): pass
    def _send_actions(self, state, prompt, actions, **kwargs): self.menu = copy.deepcopy(actions)
    def _send_input_question(self, *args, **kwargs): pass
    def _send_summary_card(self, state): return {'filename': 'isolated.png'}
    def _send_completion_notice(self, *args, **kwargs): pass
    def _today_diary_photo_append_action(self): return None
    def _main_menu_diary_actions(self, state): return []


class FinancialCatalogTests(unittest.TestCase):
    def setUp(self):
        self.config = load_workflow_config('/opt/energetica-whatsapp/worker/workflow_config.json')
        self.sp = MagicMock()
        self.rows = [{'id': 7, 'title': 'BANCO EXISTENTE', 'value': 'BANCO EXISTENTE'}]
        self.sp.get_options.side_effect = lambda step, context: copy.deepcopy(
            step.get('source', {}).get('options', self.rows))
        for name in ('ensure_item', 'create_item', 'update_item', 'delete_item'):
            getattr(self.sp, name).side_effect = AssertionError('Live write forbidden')
        self.engine = Engine(self.config, MagicMock(), MagicMock(), MagicMock(), self.sp)
        self.event = {'conversation_id': 'isolated-financial-catalog', 'sender': 'test-only',
                      'message_id': 'test-0', 'kind': 'text', 'text': ''}
        self.state = self.engine._new_state(self.event, 'isolated-financial-catalog')

    def send(self, reply):
        self.event = {**self.event, 'message_id': self.event['message_id']+'x',
                      'reply_id': reply, 'text': reply}
        return self.engine._handle_text(self.event, self.state, 'isolated-etag')

    def open(self):
        self.send('group_financial')
        self.send('action_financial_registrations')
        self.send('action_register_investment')

    def create(self):
        self.open()
        self.send(f'choice:{KEY}:{CREATE_ID}')
        self.assertEqual(self.state['flow'], 'institution_registration')

    def test_create_available_in_populated_empty_and_filtered_catalog(self):
        for rows in [self.rows, []]:
            with self.subTest(empty=not rows):
                self.setUp(); self.rows = rows
                self.open()
                self.assertIn(CREATE_ID, [o['id'] for o in self.state['options']])
                self.send('SEM CORRESPONDENCIA')
                self.assertIn(CREATE_ID, [o['id'] for o in self.state['options']])

    def test_child_requires_review_before_write(self):
        self.create()
        self.send('BANCO NOVO')
        result = self.send('choice:status_cadastro_instituicao:1')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.sp.ensure_item.assert_not_called()
        self.sp.create_item.assert_not_called()

    def test_completion_restores_parent_inputs_and_automatically_selects_new_record(self):
        self.open()
        self.state['fields']['DESCRICAO'] = 'DESCRICAO PRESERVADA'
        self.state['idempotency_token'] = 'original-investment-token'
        self.send(f'choice:{KEY}:{CREATE_ID}')
        self.send('BANCO NOVO')
        self.send('choice:status_cadastro_instituicao:1')
        self.state['sharepoint'] = {'item_id': 42, 'recorded_at': '2026-10-13T15:00:00Z'}
        self.state['stage'] = 'completed'
        result = self.engine._notify_completed(self.state, 'isolated-etag')
        self.assertEqual(self.state['flow'], 'investment_registration')
        self.assertEqual(self.state['fields']['DESCRICAO'], 'DESCRICAO PRESERVADA')
        self.assertEqual(self.state['fields']['INSTITUICAO'], 'BANCO NOVO')
        self.assertEqual(self.state['selections'][KEY]['id'], 42)
        self.assertEqual(self.state['idempotency_token'], 'original-investment-token')
        self.assertNotIn('STATUS', self.state['fields'])
        self.assertEqual(self.state['sharepoint'], {})
        self.assertEqual(result['status'], 'awaiting_field')
        self.sp.ensure_item.assert_not_called()

    def test_cancel_returns_to_same_question_without_changing_parent(self):
        self.open()
        self.state['fields']['DESCRICAO'] = 'PRESERVAR'
        self.state['idempotency_token'] = 'original-token'
        self.send(f'choice:{KEY}:{CREATE_ID}')
        self.send('BANCO NÃO GRAVADO')
        self.engine._cancel(self.state, 'isolated-etag', {**self.event, 'text': 'FIM'})
        self.assertEqual(self.state['flow'], 'investment_registration')
        self.assertEqual(self.state['fields'], {'DESCRICAO': 'PRESERVAR'})
        self.assertEqual(self.state['step_index'], 0)
        self.assertEqual(self.state['idempotency_token'], 'original-token')
        self.assertIn(CREATE_ID, [o['id'] for o in self.state['options']])
        self.sp.ensure_item.assert_not_called()

    def test_back_at_child_start_restores_original_question(self):
        self.create()
        self.engine._navigate_back(self.state, 'isolated-etag')
        self.assertEqual(self.state['flow'], 'investment_registration')
        self.assertEqual(self.engine._current_step(self.state)['key'], KEY)

    def test_public_back_control_returns_to_parent_without_exit_discard_prompt(self):
        self.create()
        self.engine.state_store.load.return_value = (self.state, 'isolated-etag')
        self.assertFalse(self.engine._back_would_leave_flow(self.state))
        event = {**self.event, 'message_id': 'child-navigation-back',
                 'reply_id': 'navigation_back', 'text': 'navigation_back'}
        result = self.engine.handle(event)
        self.assertEqual(self.state['flow'], 'investment_registration')
        self.assertEqual(self.engine._current_step(self.state)['key'], KEY)
        self.assertNotEqual(result['status'], 'awaiting_portal_draft_exit')
        self.assertIn(CREATE_ID, [o['id'] for o in self.state['options']])
        self.sp.ensure_item.assert_not_called()

    def test_existing_option_still_advances_and_arbitrary_text_is_not_an_answer(self):
        self.open()
        self.send('BANCO QUE NÃO EXISTE')
        self.assertNotIn('INSTITUICAO', self.state['fields'])
        self.send(f'choice:{KEY}:7')
        self.assertEqual(self.state['fields']['INSTITUICAO'], 'BANCO EXISTENTE')

    def test_static_choices_and_other_flows_remain_unchanged(self):
        self.state['flow'] = 'institution_registration'
        self.state['step_index'] = 1
        step = self.engine._current_step(self.state)
        self.assertNotIn(CREATE_ID, [o['id'] for o in self.engine._selection_options(self.state, step)])
        self.state['flow'] = 'launch'
        self.state['step_index'] = 0
        self.assertNotIn(CREATE_ID, [o['id'] for o in self.engine._selection_options(
            self.state, self.config['sharepoint']['investment_registration_flow']['steps'][0])])

    def test_confirmation_writes_only_child_and_then_returns_to_parent(self):
        self.create()
        self.send('BANCO NOVO')
        self.send('choice:status_cadastro_instituicao:1')
        self.sp.ensure_item.side_effect = None
        self.sp.ensure_item.return_value = 42
        result = self.send('confirm_yes')
        self.sp.ensure_item.assert_called_once()
        args, kwargs = self.sp.ensure_item.call_args
        self.assertEqual(kwargs['target_list'], 'INSTITUICAOEMISSORA')
        self.assertEqual(args[1], {'INSTITUICAOEMISSORA': 'BANCO NOVO', 'STATUS': 'ATIVO'})
        self.assertEqual(self.state['flow'], 'investment_registration')
        self.assertEqual(self.state['fields']['INSTITUICAO'], 'BANCO NOVO')
        self.assertTrue(result['financial_catalog_registered'])
        self.sp.create_item.assert_not_called()

    def test_blank_optional_child_does_not_fill_or_advance_parent(self):
        self.create()
        self.send('institution_blank')
        self.send('choice:status_cadastro_instituicao:1')
        self.state['sharepoint'] = {'item_id': 43, 'recorded_at': '2026-10-13T15:00:00Z'}
        self.state['stage'] = 'completed'
        self.engine._notify_completed(self.state, 'isolated-etag')
        self.assertEqual(self.state['flow'], 'investment_registration')
        self.assertEqual(self.state['step_index'], 0)
        self.assertNotIn('INSTITUICAO', self.state['fields'])

    def test_summary_edit_returns_with_other_answers_and_edit_progress_preserved(self):
        self.open()
        self.state['fields'].update({'DESCRICAO': 'MANTER', 'INVESTIMENTO': 'CDB'})
        self.state['edit_step_indices'] = [0]
        self.send(f'choice:{KEY}:{CREATE_ID}')
        self.send('BANCO NOVO')
        self.send('choice:status_cadastro_instituicao:1')
        self.state['sharepoint'] = {'item_id': 42, 'recorded_at': '2026-10-13T15:00:00Z'}
        self.state['stage'] = 'completed'
        result = self.engine._notify_completed(self.state, 'isolated-etag')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(self.state['fields'], {'DESCRICAO': 'MANTER', 'INVESTIMENTO': 'CDB',
                                              'INSTITUICAO': 'BANCO NOVO'})

    def test_registered_institution_is_available_after_refresh(self):
        self.open()
        self.rows.append({'id': 42, 'title': 'BANCO NOVO', 'value': 'BANCO NOVO'})
        self.send('refresh_options')
        self.assertIn(42, [o['id'] for o in self.state['options']])

    def test_catalog_read_failure_never_permits_arbitrary_values_or_writes(self):
        self.sp.get_options.side_effect = RuntimeError('Isolated unavailable catalog')
        with self.assertRaisesRegex(RuntimeError, 'unavailable catalog'):
            self.open()
        self.assertNotIn('INSTITUICAO', self.state['fields'])
        self.sp.ensure_item.assert_not_called()

    def test_child_discards_parent_pagination_and_delayed_next_cannot_replay_catalog(self):
        self.rows = [{'id': i, 'title': f'BANCO {i}', 'value': f'BANCO {i}'} for i in range(1, 75)]
        self.create()
        self.assertNotIn('option_pagination', self.state)
        self.engine.state_store.load.return_value = (self.state, 'isolated-etag')
        event = {**self.event, 'message_id': 'delayed-parent-next', 'reply_id': 'option_next',
                 'text': 'option_next'}
        self.engine.handle(event)
        self.assertEqual(self.state['flow'], 'institution_registration')
        self.assertEqual(self.state['fields'], {})
        self.assertEqual(self.state['step_index'], 0)
        self.assertNotIn('option_pagination', self.state)
        self.assertFalse(any(str(o.get('title', '')).startswith('BANCO ') for o in self.engine.menu))


if __name__ == '__main__': unittest.main()
