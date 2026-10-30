"""Real WorkflowEngine and optimistic memory store; external services are fakes.

BACK_NAVIGATION_SOURCE points to a private, code-only mirror with tests/test_workflow.py.
BACK_NAVIGATION_WORKFLOW optionally selects the candidate worker/workflow.py.
No portal credentials, remote records or network clients are used.
"""
import copy
import importlib.util
import os
from pathlib import Path
import sys
import unittest

SOURCE = Path(os.environ['BACK_NAVIGATION_SOURCE']).resolve()
sys.path[:0] = [str(SOURCE / 'tests'), str(SOURCE / 'worker'), str(SOURCE)]
if os.environ.get('BACK_NAVIGATION_WORKFLOW'):
    spec = importlib.util.spec_from_file_location('workflow', os.environ['BACK_NAVIGATION_WORKFLOW'])
    module = importlib.util.module_from_spec(spec)
    sys.modules['workflow'] = module
    spec.loader.exec_module(module)
import test_workflow as fixtures


class PreviousScreenTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.WorkflowTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.engine = self.case.engine
        self.config = self.case.config
        self.config['limits']['inactivity_expiration_enabled'] = False
        self.config['limits']['attachment_restart_on_inactivity_enabled'] = False
        self.sharepoint = self.case.sharepoint
        self.reply = self.case.reply
        # The pinned mirror calls this absent helper even for unrelated flows.
        # Keep that independent production defect out of this navigation patch.
        # This fixture shim may never supply policy for a payment/provision flow.
        if not hasattr(self.engine, '_provision_first_freight_only'):
            def no_provision_freight(state):
                self.assertNotIn(state.get('flow'), {'payment', 'payment_settlement'})
                return False
            self.engine._provision_first_freight_only = no_provision_freight
        if not hasattr(self.engine, '_provision_reissue_skipped_freight'):
            def no_provision_reissue(state, *args):
                self.assertNotIn(state.get('flow'), {'payment', 'payment_settlement'})
                return None
            self.engine._provision_reissue_skipped_freight = no_provision_reissue
        self.sharepoint.options_by_key['grupo_produto_imobilizado'] = [
            {'id': 11, 'title': 'MÁQUINAS TESTE', 'value': 'MÁQUINAS TESTE'}]

    def current(self):
        return next(iter(self.case.state.values.values()))[0]

    def assert_no_writes(self):
        self.assertEqual(self.sharepoint.items, {})
        self.assertEqual(self.sharepoint.update_calls, [])
        self.assertEqual(self.sharepoint.delete_calls, [])

    def asset_menu(self):
        self.reply('OPA')
        self.reply('SUPRIMENTOS')
        self.reply('IMOBILIZADOS')
        self.assertEqual(self.current()['selected_submenu'], 'supply_fixed_assets')

    def asset_question(self):
        self.asset_menu()
        result = self.reply('CADASTRAR PRODUTO IMOBILIZADO')
        self.assertEqual(result['field'], 'grupo_produto_imobilizado')
        return result

    def embedded_product(self):
        original_reply = self.case.reply
        def canonical_reply(text=None, reply_id=None):
            if text and text.isdigit() and not reply_id:
                step = self.engine._current_step(self.current())
                if step and step.get('kind') == 'selection':
                    return original_reply(reply_id=f"choice:{step['key']}:{text}")
            return original_reply(text, reply_id)
        self.case.reply = canonical_reply
        self.case._start_launch_to_product()
        create = next(option for option in self.current()['options']
                      if option.get('action') == 'start_embedded_product_registration')
        return self.reply(reply_id=f"choice:produto_lancamento:{create['id']}")

    def test_asset_first_question_restores_exact_submenu_with_existing_history(self):
        self.asset_question()
        before = copy.deepcopy(self.current())
        previous = self.engine._decode_navigation_snapshot(before['navigation_history'][-1])
        self.assertEqual(previous['stage'], 'choosing_subaction')
        self.assertEqual(previous['selected_submenu'], 'supply_fixed_assets')
        result = self.reply(reply_id='navigation_back')
        self.assertTrue(result.get('navigation_back'), result)
        self.assertEqual(self.current()['stage'], 'choosing_subaction')
        self.assertEqual(self.current()['selected_submenu'], 'supply_fixed_assets')
        self.assertEqual(len(self.current()['navigation_history']), len(before['navigation_history']) - 1)
        self.assertNotIn('pending_portal_draft_exit', self.current())
        self.assertNotIn('returned_to_main_menu', result)
        self.assert_no_writes()

    def test_asset_same_flow_back_restores_group_then_submenu_then_area_then_home(self):
        self.asset_question()
        self.assertEqual(self.reply(reply_id='choice:grupo_produto_imobilizado:11')['field'], 'produto_imobilizado_cadastro')
        self.assertEqual(self.reply(reply_id='navigation_back')['field'], 'grupo_produto_imobilizado')
        self.assertNotIn('GRUPOIMOBILIZADO', self.current()['fields'])
        self.reply(reply_id='navigation_back')
        self.assertEqual(self.current()['selected_submenu'], 'supply_fixed_assets')
        self.reply(reply_id='navigation_back')
        self.assertEqual(self.current()['stage'], 'choosing_action')
        self.assertEqual(self.current()['selected_group'], 'group_supplies')
        self.reply(reply_id='navigation_back')
        self.assertEqual(self.current()['stage'], 'choosing_group')
        self.assert_no_writes()

    def test_back_to_nested_menu_keeps_its_parent_navigation(self):
        self.case._start_supply_registration('CADASTRAR GRUPO')
        self.reply(reply_id='navigation_back')
        self.assertEqual(self.current()['stage'], 'choosing_subaction')
        self.assertEqual(self.current()['selected_submenu'], 'supply_registrations')
        self.reply(reply_id='navigation_back')
        self.assertEqual(self.current()['stage'], 'choosing_action')
        self.assert_no_writes()

    def test_task_first_question_returns_to_demands_without_main_menu(self):
        self.reply('OPA')
        self.reply('DEMANDAS')
        self.reply(reply_id='action_task')
        self.reply(reply_id='navigation_back')
        self.assertEqual(self.current()['stage'], 'choosing_action')
        self.assertEqual(self.current()['selected_group'], 'group_demands')
        self.assert_no_writes()

    def test_first_embedded_product_question_restores_parent_without_losing_parent_files(self):
        # The old shared fixture uses bare numeric text. Current selection
        # controls send the canonical, step-scoped transport reply instead.
        original_reply = self.case.reply
        def canonical_reply(text=None, reply_id=None):
            if text and text.isdigit() and not reply_id:
                step = self.engine._current_step(self.current())
                if step and step.get('kind') == 'selection':
                    return original_reply(reply_id=f"choice:{step['key']}:{text}")
            return original_reply(text, reply_id)
        self.case.reply = canonical_reply
        self.case._start_launch_to_product()
        parent_file = self.case.media.stage(fixtures.event('parent-file', 'attachment',
            original_filename='parent.pdf', content=b'parent synthetic'),
            self.current()['batch_id'], self.current()['key'])
        self.current()['attachments'] = [parent_file]
        parent = copy.deepcopy(self.current())
        create = next(option for option in self.current()['options']
                      if option.get('action') == 'start_embedded_product_registration')
        self.reply(reply_id=f"choice:produto_lancamento:{create['id']}")
        self.assertEqual(self.current()['navigation_history'], [])
        self.assertIn('embedded_return', self.current())
        child_file = self.case.media.stage(fixtures.event('child-file', 'attachment',
            original_filename='child.pdf', content=b'child synthetic'),
            self.current()['batch_id'], self.current()['key'])
        self.current()['attachments'] = [child_file]
        result = self.reply(reply_id='navigation_back')
        self.assertEqual(result.get('field'), 'produto_lancamento', result)
        self.assertEqual(self.current()['flow'], 'launch')
        self.assertEqual(self.current()['fields'], parent['fields'])
        self.assertEqual(self.current()['attachments'], parent['attachments'])
        self.assertIn(parent_file['object_name'], self.case.media.content)
        self.assertNotIn(child_file['object_name'], self.case.media.content)
        self.assertNotIn('embedded_return', self.current())
        self.assert_no_writes()

    def test_duplicate_back_does_not_pop_history_twice(self):
        self.asset_question()
        incoming = fixtures.event('same-back-message', 'text', reply_id='navigation_back')
        self.engine.handle(incoming)
        before = copy.deepcopy(self.current())
        result = self.engine.handle(incoming)
        self.assertEqual(result['status'], 'duplicate')
        self.assertEqual(self.current(), before)
        self.assert_no_writes()

    def test_nested_embedded_back_keeps_outer_parent_for_the_next_back(self):
        self.embedded_product()
        state, etag = next(iter(self.case.state.values.values()))
        self.engine._start_embedded_supply_subfamily_registration(state, etag)
        self.assertEqual(self.current()['flow'], 'supply_subfamily_registration')
        self.reply(reply_id='navigation_back')
        self.assertEqual(self.current()['flow'], 'supply_product_registration')
        self.assertEqual(self.current().get('embedded_return', {}).get('type'),
                         'launch_product_registration')
        self.reply(reply_id='navigation_back')
        self.assertEqual(self.current()['flow'], 'launch')
        self.assert_no_writes()

    def test_no_history_falls_back_to_selected_area_without_main_menu(self):
        self.asset_question()
        self.current()['navigation_history'] = []
        result = self.reply(reply_id='navigation_back')
        self.assertEqual(result['status'], 'navigation_back_to_menu')
        self.assertEqual(self.current()['stage'], 'choosing_action')
        self.assertEqual(self.current()['selected_group'], 'group_supplies')
        self.assertIsNone(self.current()['flow'])
        self.assert_no_writes()

    def test_completed_state_cannot_restore_old_form_history(self):
        self.asset_question()
        state = self.current()
        state.update(stage='completed', sharepoint={'item_id': 901}, fields={'IMOBILIZADO': 'POSTED'})
        self.reply(reply_id='navigation_back')
        self.assertIsNone(self.current()['flow'])
        self.assertEqual(self.current()['fields'], {})
        self.assertEqual(self.current()['navigation_history'], [])
        self.assertNotEqual(self.current()['stage'], 'selecting_fields')
        self.assert_no_writes()

    def test_new_flow_after_post_keeps_new_identity_and_discards_old_history(self):
        self.asset_menu()
        old_batch = self.current()['batch_id']
        self.current()['sharepoint'] = {'item_id': 901}
        self.current()['fields'] = {'IMOBILIZADO': 'POSTED'}
        self.reply('CADASTRAR PRODUTO IMOBILIZADO')
        new_batch = self.current()['batch_id']
        self.assertNotEqual(new_batch, old_batch)
        self.assertEqual(self.current()['navigation_history'], [])
        self.reply(reply_id='navigation_back')
        self.assertEqual(self.current()['batch_id'], new_batch)
        self.assertEqual(self.current()['sharepoint'], {})
        self.assertEqual(self.current()['fields'], {})
        self.assertEqual(self.current()['stage'], 'choosing_action')
        self.assert_no_writes()

    def test_pending_cash_checkpoint_blocks_back_before_navigation(self):
        self.asset_question()
        self.current()['launch_cash_writes'] = {'synthetic': {'create_attempted': True}}
        before = copy.deepcopy(self.current())
        result = self.reply(reply_id='navigation_back')
        self.assertEqual(result['status'], 'cash_checkpoint_navigation_blocked')
        self.assertEqual(self.current(), before)
        self.assert_no_writes()

    def test_finished_cash_checkpoint_still_cannot_pop_history(self):
        self.asset_question()
        self.current()['launch_cash_receipts'] = {'synthetic': {'done': True}}
        before = copy.deepcopy(self.current())
        result = self.reply(reply_id='navigation_back')
        self.assertEqual(result['status'], 'cash_checkpoint_navigation_blocked')
        self.assertEqual(self.current()['navigation_history'], before['navigation_history'])
        self.assertEqual(self.current()['flow'], before['flow'])
        self.assert_no_writes()

    def test_explicit_home_retains_abandon_confirmation_contract(self):
        self.asset_question()
        result = self.reply(reply_id='portal_confirm_main_menu')
        self.assertEqual(result['status'], 'awaiting_portal_draft_exit')
        self.assertEqual(self.current()['pending_portal_draft_exit']['intent'], 'main_menu')
        result = self.reply(reply_id='portal_draft_exit_discard')
        self.assertTrue(result['returned_to_main_menu'])
        self.assertEqual(self.current()['stage'], 'choosing_group')
        self.assert_no_writes()

    def test_corrupt_snapshot_is_not_silently_treated_as_main_menu_exit(self):
        self.asset_question()
        self.current()['navigation_history'][-1]['sha256'] = 'invalid'
        before = copy.deepcopy(self.current())
        with self.assertRaisesRegex(ValueError, 'integridade'):
            self.reply(reply_id='navigation_back')
        self.assertEqual(self.current(), before)
        self.assert_no_writes()


if __name__ == '__main__':
    unittest.main()
