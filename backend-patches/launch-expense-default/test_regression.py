"""Exercise real workflow prompts with synthetic catalogs and in-memory storage."""
import copy
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(os.environ['EXPENSE_DEFAULT_SOURCE']).resolve()
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT), str(ROOT / 'tests')]
import test_workflow as fixtures
import financial_catalog_registration as catalog


class ProductExpenseDefaultTests(unittest.TestCase):
    def setUp(self):
        fixtures.WorkflowTests.setUp(self)
        self.config['limits']['inactivity_expiration_enabled'] = False
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state.directory = temporary.name
        self.sharepoint.site_url = 'https://synthetic.example.test/site'
        initial = fixtures.event('seed', 'text')
        self.current = self.engine._new_state(initial, fixtures.conversation_key(initial))

    def send(self, reply, text=''):
        _, etag = self.state.load(self.current['key'])
        self.engine._save(self.current, etag)
        result = self.engine.handle(fixtures.event('public-reply', 'text', reply_id=reply, text=text))
        self.current = self.state.load(self.current['key'])[0]
        return result

    def prepare(self, flow='launch', value='MÃO DE OBRA'):
        self.current.update(flow=flow, stage='selecting_fields',
            fields={'PRODUTO': 'PRODUTO FICTÍCIO', 'UN': 'UN'},
            answers={'submeter_lancamentos': 'SIM'},
            attachments=[{'object_name': 'qa/receipt', 'sharepoint_name': 'teste.pdf'}],
            idempotency_token='preserved-token')
        steps = self.engine._flow_config(self.current)['steps']
        self.current['step_index'] = next(i for i, s in enumerate(steps)
            if s.get('target_field', '').replace(' ', '') == 'TIPODESPESA')
        self.step = steps[self.current['step_index']]
        self.sharepoint.options_by_key[self.step['key']] = [
            {'id': 365, 'title': '365 - ' + value, 'value': value}]
        return self.step

    def assert_default(self, value='MÃO DE OBRA'):
        self.assertIn('TIPO DESPESA', self.current['fields'])
        self.assertEqual(self.current['fields']['TIPO DESPESA'], value)
        self.assertEqual(self.current['answers'][self.step['key']], value)
        self.assertEqual(self.current['idempotency_token'], 'preserved-token')
        self.assertEqual(self.current['attachments'][0]['object_name'], 'qa/receipt')
        self.assertFalse(any(m.get('field') == self.step['key'] for m in self.messenger.sent))
        self.assertEqual(self.sharepoint.items, {})

    def test_single_launch_skips_expense_question_and_preserves_draft(self):
        self.prepare()
        result = self.engine._prompt_next_or_summary(self.current, None)
        self.assertEqual(result['field'], 'quantidade_lancamento')
        self.assert_default()

    def test_each_multiple_launch_line_uses_its_product_type(self):
        self.prepare(value='MATERIAL')
        self.current['answers']['modo_lancamento'] = 'MÚLTIPLOS LANÇAMENTOS'
        self.current['launch_lines'] = [{'fields': {'PRODUTO': 'PRIMEIRO', 'TIPO DESPESA': 'SERVIÇO'}}]
        before = copy.deepcopy(self.current['launch_lines'])
        self.engine._prompt_next_or_summary(self.current, None)
        self.assert_default('MATERIAL')
        self.assertEqual(self.current['launch_lines'], before)

    def test_settlement_uses_product_default_without_catalog_creation(self):
        self.prepare('payment_settlement', 'ENERGIA')
        self.engine._prompt_next_or_summary(self.current, None)
        self.assert_default('ENERGIA')

    def test_resuming_the_reported_question_uses_product_default(self):
        self.prepare()
        self.current['options'] = [{'id': catalog.CREATE_ID, 'title': 'CADASTRAR TIPO DESPESA', 'action': catalog.CREATE_ACTION}]
        self.engine._resend_current_prompt(self.current, None)
        self.assert_default()

    def test_stale_question_controls_cannot_create_or_override_type(self):
        for reply in [catalog.CREATE_ID, 'choice:tipo_despesa_lancamento:365',
                      'filter_query', 'filter_clear', 'refresh_options', 'option_next']:
            with self.subTest(reply=reply):
                self.setUp()
                self.prepare()
                old_step = catalog.step_with_create(self.engine, self.current, self.step)
                old_step = {**old_step, 'auto_select_single': False}
                self.current['options'] = [{'id': catalog.CREATE_ID, 'title': 'CADASTRAR TIPO DESPESA', 'action': catalog.CREATE_ACTION}]
                self.engine._send_options(self.current, old_step, self.current['options'])
                self.messenger.sent.clear()
                self.send(reply, 'TIPO INCORRETO')
                self.assertEqual(self.current['flow'], 'launch')
                self.assert_default()

    def test_product_registration_keeps_its_explicit_type_selection(self):
        step = self.prepare('supply_product_registration')
        self.engine._prompt_next_or_summary(self.current, None)
        self.assertEqual(self.messenger.sent[-1]['options'][0]['id'], catalog.CREATE_ID)
        self.assertNotIn('TIPODESPESA', self.current['fields'])
        self.assertEqual(self.sharepoint.items, {})

    def open_legacy_child(self, flow='launch'):
        self.prepare(flow)
        self.engine._start_embedded_launch_registration(self.current, None,
            flow='supply_material_type_registration', return_type=catalog.RETURN_TYPE,
            heading='CADASTRO ANTIGO')

    def test_legacy_child_replies_return_to_product_default_without_writing(self):
        for flow, reply in [('launch', 'confirm_yes'), ('launch', 'filter_query'),
                            ('payment_settlement', 'confirm_yes')]:
            with self.subTest(flow=flow, reply=reply):
                self.setUp()
                self.open_legacy_child(flow)
                self.current['fields']['TIPO'] = 'TIPO INDEVIDO'
                self.current['stage'] = 'awaiting_confirmation'
                self.send(reply)
                self.assertEqual(self.current['flow'], flow)
                self.assert_default()

    def test_legacy_child_resume_returns_to_parent_without_writing(self):
        self.open_legacy_child()
        _, etag = self.state.load(self.current['key'])
        self.engine._resend_current_prompt(self.current, etag)
        self.assertEqual(self.current['flow'], 'launch')
        self.assert_default()

    def test_legacy_already_completed_child_does_not_override_product_default(self):
        self.open_legacy_child()
        self.current['fields']['TIPO'] = 'TIPO INDEVIDO'
        _, etag = self.state.load(self.current['key'])
        catalog.complete(self.engine, self.current, etag, 987)
        self.assertEqual(self.current['flow'], 'launch')
        self.assert_default()

    def test_financial_checkpoint_still_blocks_recovery_before_any_write(self):
        self.open_legacy_child()
        self.current['launch_cash_writes'] = {'row': {'create_attempted': True}}
        before = copy.deepcopy(self.current['embedded_return'])
        result = self.send('confirm_yes')
        self.assertEqual(result['status'], 'cash_checkpoint_navigation_blocked')
        self.assertEqual(self.current['embedded_return'], before)
        self.assertEqual(self.current['flow'], 'supply_material_type_registration')
        self.assertEqual(self.sharepoint.items, {})


if __name__ == '__main__':
    unittest.main()
