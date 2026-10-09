"""Real workflow, synthetic SharePoint boundary: no production posts."""
import copy
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(os.environ['TASK_POSTING_SOURCE']).resolve()
FIXTURES = Path(os.environ.get('TASK_POSTING_FIXTURES', ROOT)).resolve()
paths = [str(ROOT / 'worker'), str(ROOT), str(FIXTURES / 'tests')]
sys.path[:0] = paths
import workflow
import test_workflow as fixtures
sys.path[:0] = paths
assert Path(workflow.__file__).resolve() == ROOT / 'worker/workflow.py'


class PostingIdentityTests(unittest.TestCase):
    def setUp(self):
        fixtures.WorkflowTests.setUp(self)
        # The inherited external-data double lacks this production GET API.
        def find(token, target_list, idempotency_field='Title'):
            item_id = self.sharepoint.tokens.get(f'{target_list}:{token}')
            return {'Id': item_id} if item_id is not None else None
        self.sharepoint._find_item = find
    reply = fixtures.WorkflowTests.reply
    start_task = fixtures.WorkflowTests.start_task
    summary_text = fixtures.WorkflowTests.summary_text

    def complete_task(self):
        self.start_task()
        self.reply('NÃO')
        result = self.reply('SIM')
        self.assertEqual(result['status'], 'completed')
        key = next(iter(self.state.values))
        current, etag = self.state.load(key)
        return current, etag, result['sharepoint_item_id']

    def test_resume_after_completed_task_never_reuses_previous_submission(self):
        old, etag, old_id = self.complete_task()
        self.engine._resend_current_prompt(old, etag)
        self.reply('ADICIONAR UMA NOVA TAREFA')
        self.reply('2')
        for answer in ('EM 3 DIAS', '70', '1', '80', '1', '2', 'CONFERIR O NOVO RELATÓRIO.', 'NÃO'):
            self.reply(answer)
        result = self.reply('SIM')
        self.assertEqual(result['status'], 'completed')
        self.assertNotEqual(result['sharepoint_item_id'], old_id)
        self.assertEqual(len(self.sharepoint.items), 2)
        self.assertEqual(self.sharepoint.items[old_id]['fields']['DESCRIÇÃO'], 'PREPARAR O RELATÓRIO SEMANAL.')
        self.assertEqual(self.sharepoint.items[result['sharepoint_item_id']]['fields']['DESCRIÇÃO'], 'CONFERIR O NOVO RELATÓRIO.')

    def test_back_after_completion_does_not_reopen_confirmed_form(self):
        old, _, _ = self.complete_task()
        self.reply(reply_id=workflow.NAVIGATION_BACK_ID)
        current, _ = self.state.load(old['key'])
        self.assertIn(current['stage'], {'choosing_group', 'choosing_action'})
        self.assertNotEqual(current['batch_id'], old['batch_id'])
        self.assertEqual(current['sharepoint'], {})
        self.assertEqual(current['navigation_history'], [])
        self.assertEqual(len(self.sharepoint.items), 1)

    def test_completed_resume_clears_previous_receipts_for_all_flow_actions(self):
        actions = self.engine._start_actions()
        for action in actions:
            if not action.get('flow'):
                continue
            with self.subTest(flow=action['flow']):
                state = self.engine._new_state(fixtures.event('old-'+action['flow'], 'text'), 'case-'+action['flow'])
                state.update(flow=action['flow'], stage='completed', selected_group=action.get('group'),
                             sharepoint={'item_id': 77, 'verified': {'fields': True, 'attachments': True}},
                             fields={'DESCRIÇÃO': 'OLD'}, attachments=[], completion_id='old-completion',
                             completion_trigger_message_id='old-submit')
                etag = self.state.save(state['key'], state, None)
                old_batch = state['batch_id']
                self.engine._resend_current_prompt(state, etag)
                current, _ = self.state.load(state['key'])
                self.assertNotEqual(current['batch_id'], old_batch)
                self.assertEqual(current['sharepoint'], {})
                self.assertEqual(current['fields'], {})
                self.assertNotIn('completion_id', current)

    def test_begin_action_from_legacy_menu_has_independent_identity(self):
        state, etag, old_id = self.complete_task()
        old_batch = state['batch_id']
        state['stage'] = 'choosing_action'
        state['idempotency_token'] = 'old-token'
        state['partial_submission_items'] = [{'item_id': old_id, 'target_list': 'LANCAMENTOTAREFAS'}]
        self.engine._begin_action(state, etag, {'flow': 'task', 'group': 'group_demands'})
        self.assertNotEqual(state['batch_id'], old_batch)
        self.assertEqual(state['sharepoint'], {})
        for key in ('idempotency_token', 'partial_submission_items', 'completion_id', 'completion_trigger_message_id'):
            self.assertNotIn(key, state)

    def test_completed_resume_keeps_duplicate_confirmation_protection(self):
        old, etag, old_id = self.complete_task()
        confirmed_message_id = old['processed_message_ids'][-1]
        self.engine._resend_current_prompt(old, etag)
        self.reply('ADICIONAR UMA NOVA TAREFA')
        self.reply('2')
        for answer in ('EM 3 DIAS', '70', '1', '80', '1', '2', 'CONFERIR O NOVO RELATÓRIO.', 'NÃO'):
            self.reply(answer)
        replay = self.engine.handle(fixtures.event(confirmed_message_id, 'text', text='SIM'))
        self.assertEqual(replay['status'], 'duplicate')
        self.assertEqual(len(self.sharepoint.items), 1)
        current, _ = self.state.load(old['key'])
        self.assertEqual(current['stage'], 'awaiting_confirmation')
        self.assertEqual(self.reply('SIM')['status'], 'completed')
        self.assertEqual(len(self.sharepoint.items), 2)

    def test_legacy_new_action_cannot_reuse_previous_partial_diary(self):
        state, etag, old_id = self.complete_task()
        state.update(stage='choosing_action', flow='construction_diary',
                     partial_diary_item_id=old_id,
                     partial_diary_attachment_names=['previous.pdf'],
                     partial_diary_save={'item_id': old_id})
        self.engine._begin_action(state, etag, {'flow': 'task', 'group': 'group_demands'})
        for key in ('partial_diary_item_id', 'partial_diary_attachment_names', 'partial_diary_save'):
            self.assertNotIn(key, state)
        self.assertEqual(len(self.sharepoint.items), 1)

    def test_legacy_new_action_back_never_restores_previous_completed_batch(self):
        state, etag, _ = self.complete_task()
        old_batch = state['batch_id']
        state['stage'] = 'choosing_action'
        self.engine._begin_action(state, etag, {'flow': 'task', 'group': 'group_demands'})
        self.reply(reply_id=workflow.NAVIGATION_BACK_ID)
        self.reply(reply_id=workflow.NAVIGATION_BACK_ID)
        current, _ = self.state.load(state['key'])
        self.assertNotEqual(current['batch_id'], old_batch)
        self.assertNotEqual(current.get('fields', {}).get('DESCRIÇÃO'), 'PREPARAR O RELATÓRIO SEMANAL.')

    def test_new_action_does_not_carry_completed_cash_journal_into_new_batch(self):
        from launch_cash_receipt import cash_checkpoint_key
        state, etag, old_id = self.complete_task()
        state.update(stage='choosing_action', launch_cash_writes={'old': {'item_id': old_id}},
                     launch_cash_receipts={'old': {'done': True, 'item_id': 88}})
        old_key = cash_checkpoint_key(state)
        etag = self.engine._save(state, etag)
        saved, _ = self.state.load(old_key)
        self.engine._begin_action(state, etag, {'flow': 'task', 'group': 'group_demands'})
        self.assertNotIn('launch_cash_writes', state)
        self.assertNotIn('launch_cash_receipts', state)
        self.assertEqual(self.state.load(old_key)[0], saved)

    def test_new_action_with_unresolved_cash_remains_blocked(self):
        state, etag, old_id = self.complete_task()
        state.update(stage='cash_receipt_recovery', launch_cash_writes={'old': {'create_attempted': True}},
                     launch_cash_receipts={'old': {'done': False}})
        old_batch = state['batch_id']
        result = self.engine._begin_action(state, etag, {'flow': 'task', 'group': 'group_demands'})
        self.assertEqual(result['status'], 'cash_checkpoint_navigation_blocked')
        self.assertEqual(state['batch_id'], old_batch)
        self.assertEqual(state['sharepoint']['item_id'], old_id)

    def legacy_failed_draft(self):
        old, etag, old_id = self.complete_task()
        old['stage'] = 'choosing_action'
        menu = self.engine._navigation_snapshot(old)
        new_form = copy.deepcopy(menu)
        new_form.update(stage='selecting_fields', fields={}, display_values={}, answers={}, step_index=0)
        old.update(stage='submission_failed', fields={**old['fields'], 'DESCRIÇÃO': 'CONFERIR O NOVO RELATÓRIO.'},
                   navigation_history=[self.engine._encode_navigation_snapshot(menu),
                                       self.engine._encode_navigation_snapshot(new_form)])
        etag = self.state.save(old['key'], old, etag)
        return old, etag, old_id

    def test_legacy_failed_second_task_recovers_without_overwriting_first(self):
        old, _, old_id = self.legacy_failed_draft()
        result = self.reply('TENTAR NOVAMENTE')
        self.assertEqual(result['status'], 'completed')
        self.assertNotEqual(result['sharepoint_item_id'], old_id)
        self.assertEqual(len(self.sharepoint.items), 2)
        self.assertEqual(self.sharepoint.items[old_id]['fields']['DESCRIÇÃO'], 'PREPARAR O RELATÓRIO SEMANAL.')
        self.assertEqual(self.sharepoint.items[result['sharepoint_item_id']]['fields']['DESCRIÇÃO'], 'CONFERIR O NOVO RELATÓRIO.')

    def test_legacy_recovery_remains_idempotent_when_confirmation_fails_once(self):
        old, _, old_id = self.legacy_failed_draft()
        real_verify = self.sharepoint.verify_item
        failed = False
        def verify(item_id, *args, **kwargs):
            nonlocal failed
            if item_id != old_id and not failed:
                failed = True
                raise RuntimeError('Read temporarily unavailable')
            return real_verify(item_id, *args, **kwargs)
        self.sharepoint.verify_item = verify
        first = self.reply('TENTAR NOVAMENTE')
        self.assertEqual(first['status'], 'submission_failed')
        recovered, _ = self.state.load(old['key'])
        self.assertNotEqual(recovered['batch_id'], old['batch_id'])
        second = self.reply('TENTAR NOVAMENTE')
        self.assertEqual(second['status'], 'completed')
        self.assertEqual(len(self.sharepoint.items), 2)

    def test_legacy_recovery_with_changed_old_record_fails_closed(self):
        old, _, old_id = self.legacy_failed_draft()
        self.sharepoint.items[old_id]['fields']['DESCRIÇÃO'] = 'EDITED ELSEWHERE'
        self.assertEqual(self.reply('TENTAR NOVAMENTE')['status'], 'submission_failed')
        current, _ = self.state.load(old['key'])
        self.assertEqual(current['batch_id'], old['batch_id'])
        self.assertEqual(len(self.sharepoint.items), 1)

    def test_unrelated_verification_failure_does_not_allocate_new_identity(self):
        old, etag, old_id = self.legacy_failed_draft()
        old['navigation_history'] = []
        self.state.save(old['key'], old, etag)
        self.assertEqual(self.reply('TENTAR NOVAMENTE')['status'], 'submission_failed')
        current, _ = self.state.load(old['key'])
        self.assertEqual(current['batch_id'], old['batch_id'])
        self.assertEqual(len(self.sharepoint.items), 1)


if __name__ == '__main__':
    unittest.main()
