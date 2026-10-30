"""Real engine, store and channel serialization; only external services are fake."""
import ast
import copy
import importlib.util
import os
from pathlib import Path
import sys
import unittest

SOURCE = Path(os.environ['ASSET_GROUP_SOURCE']).resolve()
sys.path[:0] = [str(SOURCE / 'tests'), str(SOURCE / 'worker'), str(SOURCE)]
if os.environ.get('ASSET_GROUP_CANDIDATE'):
    candidate = Path(os.environ['ASSET_GROUP_CANDIDATE']) / 'worker'
    for name in ('financial_catalog_registration', 'workflow'):
        spec = importlib.util.spec_from_file_location(name, candidate / (name + '.py'))
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
import test_workflow as fixtures
import financial_catalog_registration as catalog
from logic import condition_matches, is_binary_choice, visual_choice_title, visual_form_prompt, visual_option_title
from rhid_badge_source import attendance_rhid_option_context

# Execute the actual, unchanged serializer class without importing the HTTP
# bridge's unrelated signing services (not included in this code-only fixture).
bridge_path = SOURCE / 'channel_bridge.py'
bridge = ast.parse(bridge_path.read_text(encoding='utf-8'))
serializer = next(node for node in bridge.body if isinstance(node, ast.ClassDef)
                  and node.name == 'ChannelMessenger')
exec(compile(ast.Module(body=[serializer], type_ignores=[]), str(bridge_path), 'exec'), globals())

KEY = 'grupo_produto_imobilizado'
CREATE = 'financial_catalog_create'
PARENT = 'fixed_asset_product_registration'
CHILD = 'fixed_asset_group_registration'
GROUP_LIST = 'GRUPO IMOBILIZADOS'


class AssetGroupTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.WorkflowTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.engine, self.sp = self.case.engine, self.case.sharepoint
        self.config = self.case.config
        self.config['limits']['inactivity_expiration_enabled'] = False
        self.config['limits']['attachment_restart_on_inactivity_enabled'] = False
        self.sp.options_by_key[KEY] = [
            {'id': 11, 'title': 'FERRAMENTAS DE TESTE', 'value': 'FERRAMENTAS DE TESTE'},
            {'id': 12, 'title': 'MÁQUINAS FICTÍCIAS', 'value': 'MÁQUINAS FICTÍCIAS'}]
        self.reply = self.case.reply

    def current(self):
        return next(iter(self.case.state.values.values()))[0]

    def open_product(self):
        for text in ('OPA', 'SUPRIMENTOS', 'IMOBILIZADOS'):
            self.reply(text)
        result = self.reply('CADASTRAR PRODUTO IMOBILIZADO')
        self.assertEqual(result['field'], KEY)
        return result

    def poll(self):
        real, previous = ChannelMessenger(), self.engine.messenger
        try:
            self.engine.messenger = real
            self.engine._emit_option_page(self.current())
            return next(message for message in reversed(real.drain()) if message['type'] == 'poll')
        finally:
            self.engine.messenger = previous

    def assert_create_first(self):
        poll = self.poll()
        self.assertEqual(poll['options'][0]['reply'], CREATE)
        self.assertEqual(poll['options'][0]['label'], '➕ CADASTRAR GRUPO IMOBILIZADO')
        self.assertEqual(sum(option['reply'] == CREATE for option in poll['options']), 1)
        self.assertTrue(poll['databaseFilter'])
        self.assertEqual(poll['databaseFilterKey'], KEY)
        return poll

    def start_child(self):
        result = self.reply(reply_id=CREATE)
        self.assertEqual(self.current()['flow'], CHILD)
        self.assertEqual(result['field'], 'grupo_imobilizado_cadastro')
        return result

    def child_review(self):
        result = self.reply('GRUPO NOVO FICTÍCIO')
        if result['status'] == 'awaiting_attachment_decision':
            result = self.reply('NÃO')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        return result

    def assert_no_writes(self):
        self.assertEqual(self.sp.items, {})
        self.assertEqual(self.sp.update_calls, [])
        self.assertEqual(self.sp.delete_calls, [])

    def test_runtime_uses_real_current_mixin_without_hook_shims(self):
        import payment_provision_flow
        self.assertEqual(Path(payment_provision_flow.__file__).resolve(),
                         SOURCE / 'worker/payment_provision_flow.py')
        for name in ('_provision_first_freight_only', '_provision_reissue_skipped_freight',
                     '_provision_discount_before_review', '_provision_discount_before_commit',
                     '_provision_review_changed_freight'):
            with self.subTest(name=name):
                self.assertNotIn(name, vars(self.engine))
                self.assertIs(getattr(type(self.engine), name),
                              getattr(payment_provision_flow.PaymentProvisionFlow, name))

    def test_actual_first_poll_has_create_before_existing_groups(self):
        self.open_product()
        self.assert_create_first()
        self.assert_no_writes()

    def test_empty_group_catalog_still_has_first_create_control(self):
        self.sp.options_by_key[KEY] = []
        self.open_product()
        self.assert_create_first()
        self.assert_no_writes()

    def test_filter_matching_and_no_match_keep_create_first_without_accepting_text(self):
        self.open_product()
        for query in ('FERRAMENTAS', 'NO SUCH SYNTHETIC GROUP'):
            self.reply(query)
            self.assert_create_first()
            self.assertNotIn('GRUPOIMOBILIZADO', self.current()['fields'])
        self.assert_no_writes()

    def test_pagination_keeps_create_first_on_every_page(self):
        self.sp.options_by_key[KEY] = [
            {'id': i, 'title': f'GRUPO FICTÍCIO {i:03}', 'value': f'GRUPO FICTÍCIO {i:03}'}
            for i in range(1, 80)]
        self.open_product()
        self.assert_create_first()
        initial = self.current()['option_pagination']['offset']
        self.reply(reply_id='option_next')
        self.assertGreater(self.current()['option_pagination']['offset'], initial)
        self.assert_create_first()
        self.assert_no_writes()

    def test_clear_and_refresh_keep_create_first_without_duplicates(self):
        self.open_product()
        self.reply('FERRAMENTAS')
        for control in ('filter_clear', 'refresh_options', 'refresh_options'):
            self.reply(reply_id=control)
            self.assert_create_first()

    def test_existing_group_selection_retains_ordinary_behavior(self):
        self.open_product()
        result = self.reply(reply_id=f'choice:{KEY}:11')
        self.assertEqual(result['field'], 'produto_imobilizado_cadastro')
        self.assertEqual(self.current()['fields']['GRUPOIMOBILIZADO'], 'FERRAMENTAS DE TESTE')
        self.assertNotIn('embedded_return', self.current())
        self.assert_no_writes()

    def test_child_uses_existing_wizard_and_review_before_any_write(self):
        self.open_product()
        self.start_child()
        self.child_review()
        self.assertEqual(self.engine._flow_config(self.current())['target_list'], GROUP_LIST)
        self.assert_no_writes()

    def test_fake_completed_child_applies_name_and_restores_full_pending_parent(self):
        self.open_product()
        state = self.current()
        attachment = self.case.media.stage(fixtures.event('parent-file', 'attachment',
            original_filename='parent.pdf', content=b'parent fictional'), state['batch_id'], state['key'])
        state.update(attachments=[attachment], idempotency_token='parent-stable-token', edit_step_indices=[0, 1, 2])
        state['fields']['RASCUNHO'] = 'PRESERVAR'
        state['display_values']['RASCUNHO'] = 'PRESERVAR'
        state['answers']['pending_answer'] = 'PRESERVAR'
        state['embedded_return'] = {'type': 'synthetic-ancestor', 'state': {'flow': 'launch', 'fields': {'PARENT': 'PRESERVAR'}}}
        self.start_child()
        parent = copy.deepcopy(self.current()['embedded_return']['state'])
        self.current().update(fields={'GRUPOIMOBILIZADOS': 'GRUPO NOVO FICTÍCIO'},
            sharepoint={'item_id': 42}, stage='completed')
        result = self.engine._notify_completed(self.current(), next(iter(self.case.state.values.values()))[1])
        self.assertTrue(result['financial_catalog_registered'])
        self.assertEqual(self.current()['flow'], PARENT)
        self.assertEqual(self.current()['fields']['GRUPOIMOBILIZADO'], 'GRUPO NOVO FICTÍCIO')
        self.assertEqual(self.current()['selections'][KEY]['id'], 42)
        self.assertEqual(self.current()['idempotency_token'], 'parent-stable-token')
        for name in ('attachments', 'navigation_history', 'embedded_return', 'edit_step_indices'):
            self.assertEqual(self.current()[name], parent[name], name)
        self.assertEqual(self.current()['answers']['pending_answer'], 'PRESERVAR')
        self.assertEqual(self.current()['display_values']['RASCUNHO'], 'PRESERVAR')
        self.assertEqual(self.current()['fields']['RASCUNHO'], 'PRESERVAR')
        self.assertIn(attachment['object_name'], self.case.media.content)
        self.assertEqual(result['field'], 'produto_imobilizado_cadastro')
        self.assert_no_writes()

    def test_confirmed_write_creates_only_group_never_product_and_is_idempotent(self):
        self.open_product()
        self.start_child()
        self.child_review()
        incoming = fixtures.event('one-confirmation', 'text', reply_id='confirm_yes')
        result = self.engine.handle(incoming)
        self.assertTrue(result['financial_catalog_registered'])
        self.assertEqual(self.current()['flow'], PARENT)
        self.assertEqual([item['target_list'] for item in self.sp.items.values()], [GROUP_LIST])
        self.assertEqual(next(iter(self.sp.items.values()))['fields']['GRUPOIMOBILIZADOS'], 'GRUPO NOVO FICTÍCIO')
        self.engine.handle(incoming)
        self.assertEqual(len(self.sp.items), 1)
        self.assertFalse(any(item['target_list'] == 'CADASTROIMOBILIZADO' for item in self.sp.items.values()))

    def test_back_from_child_restores_same_parent_group_question_without_write(self):
        self.open_product()
        before = copy.deepcopy(self.current())
        self.start_child()
        result = self.reply(reply_id='navigation_back')
        self.assertEqual(self.current()['flow'], PARENT)
        self.assertEqual(result['field'], KEY)
        self.assertEqual(self.current()['fields'], before['fields'])
        self.assert_create_first()
        self.assert_no_writes()

    def test_delayed_parent_pagination_cannot_become_child_group_name(self):
        self.open_product()
        self.start_child()
        self.reply(reply_id='option_next')
        self.assertEqual(self.current()['flow'], CHILD)
        self.assertEqual(self.current()['fields'], {})
        self.assertNotIn('option_pagination', self.current())
        self.assert_no_writes()

    def test_group_write_failure_preserves_child_and_parent_for_retry(self):
        self.open_product()
        self.start_child()
        parent = copy.deepcopy(self.current()['embedded_return'])
        self.child_review()
        self.sp.fail_ensure_item_once = True
        result = self.reply(reply_id='confirm_yes')
        self.assertEqual(result['status'], 'submission_failed')
        self.assertEqual(self.current()['flow'], CHILD)
        self.assertEqual(self.current()['embedded_return'], parent)
        self.assert_no_writes()
        result = self.reply(reply_id='retry_after_error')
        self.assertIn('financial_catalog_registered', result, result)
        self.assertTrue(result['financial_catalog_registered'])
        self.assertEqual(self.current()['flow'], PARENT)
        self.assertEqual(self.current()['fields']['GRUPOIMOBILIZADO'], 'GRUPO NOVO FICTÍCIO')
        self.assertEqual([item['target_list'] for item in self.sp.items.values()], [GROUP_LIST])

    def test_function_question_and_asset_group_wizard_get_no_new_control(self):
        self.open_product()
        state = copy.deepcopy(self.current())
        state['step_index'] = 2
        self.assertIsNone(catalog.catalog(self.engine, state, self.engine._current_step(state)))
        self.start_child()
        self.assertNotIn(CREATE, [option['id'] for option in self.current().get('options', [])])

    def test_financial_matching_and_existing_order_remain_unchanged(self):
        self.assertEqual(catalog.FINANCIAL_FLOWS, frozenset({'financial_movement',
            'investment_registration', 'institution_registration', 'investment_type_registration',
            'profitability_registration', 'taxation_registration'}))
        self.open_product()
        state = copy.deepcopy(self.current())
        state.update(flow='investment_registration', step_index=0)
        original = self.config['sharepoint']['investment_registration_flow']['steps'][0]
        step = catalog.step_with_create(self.engine, state, original)
        self.assertEqual(catalog.catalog(self.engine, state, step)['flow'], 'institution_registration')
        self.assertFalse(step.get('terminal_options_first', False))
        self.assertEqual(original, self.config['sharepoint']['investment_registration_flow']['steps'][0])

    def test_wrong_asset_step_or_source_cannot_start_inline_registration(self):
        self.open_product()
        original = self.engine._current_step(self.current())
        for change in ({'key': 'unrelated'}, {'source': {**original['source'], 'list': 'OTHER LIST'}},
                       {'source': {**original['source'], 'label_field': 'OTHER FIELD'}}):
            with self.subTest(change=change):
                step = {**original, **change}
                self.assertIsNone(catalog.catalog(self.engine, self.current(), step))
        self.assert_no_writes()


if __name__ == '__main__':
    unittest.main()
