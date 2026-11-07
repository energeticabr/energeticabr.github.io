"""Exercise real WorkflowEngine with existing in-memory SharePoint fixtures."""
import copy
import os
from pathlib import Path
import sys
import unittest

SOURCE = Path(os.environ['ATTENDANCE_INLINE_SOURCE'])
sys.path.insert(0, str(SOURCE / 'tests'))
import test_workflow as fixtures


class SummaryRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.c = fixtures.WorkflowTests('runTest')
        self.c.setUp()
        self.addCleanup(self.c.doCleanups)
        c = self.c
        second = copy.deepcopy(c.sharepoint.options_by_key['registro_presenca_pendente'][0])
        second.update(id=1815, value='1815', title='1815 - FORNECEDOR TESTE BETA')
        second['source_values'].update(Id=1815, FORNECEDOR='FORNECEDOR TESTE BETA')
        c.sharepoint.options_by_key['registro_presenca_pendente'].append(second)
        for option in c.sharepoint.options_by_key['registro_presenca_pendente']:
            c.sharepoint.items[int(option['value'])] = {'fields': copy.deepcopy(option['source_values']), 'attachments': {}, 'target_list': 'DESCRITIVOPRESENCA'}
        c.reply('OPA'); c.reply('RECURSOS HUMANOS'); c.reply('VALIDAR PRESENÇAS APONTADAS')
        c.reply(reply_id='choice:data_presenca_pendente:1814')
        c.reply(reply_id='attendance_batch:1814,1815')
        result = c.reply(reply_id='attendance_batch_present')
        self.assertEqual(result['status'], 'awaiting_attendance_batch_confirmation')

    def state(self):
        return next(iter(self.c.state.values.values()))

    def choose(self, kind):
        self.c.reply(reply_id='attendance_batch_register')
        return self.c.reply(reply_id='attendance_batch_register_' + kind)

    def answer(self, value):
        state, _ = self.state()
        if state['stage'] == 'selecting_fields':
            step = self.c.engine._current_step(state)
            if step['kind'] == 'selection':
                return self.c.reply(reply_id=f"choice:{step['key']}:{value}")
        return self.c.reply(value)

    def assert_summary(self):
        state, _ = self.state()
        self.assertEqual(state['stage'], 'attendance_batch_confirmation')
        self.assertEqual(len(state['attendance_batch_records']), 2)
        self.assertEqual(state['attendance_batch_presence'], 'PRESENTE')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        return state

    def test_button_precedes_submit_and_choice_has_both_flows(self):
        ids = [o['id'] for o in self.c.messenger.sent[-1]['actions']]
        self.assertLess(ids.index('attendance_batch_register'), ids.index('attendance_batch_confirm'))
        self.c.reply(reply_id='attendance_batch_register')
        state, _ = self.state()
        self.assertEqual([o['id'] for o in state['options']], ['attendance_batch_register_descriptor', 'attendance_batch_register_activity', 'attendance_batch_register_back'])
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_choice_reconnect_and_back_preserve_summary(self):
        self.c.reply(reply_id='attendance_batch_register')
        state, etag = self.state()
        self.c.engine._resend_current_prompt(state, etag)
        state, _ = self.state()
        self.assertEqual(state['options'][0]['id'], 'attendance_batch_register_descriptor')
        self.c.reply(reply_id='attendance_batch_register_back')
        self.assert_summary()

    def test_stale_registration_choice_does_not_start_child(self):
        self.c.reply(reply_id='attendance_batch_register_activity')
        self.assert_summary()

    def test_both_flows_preserve_full_snapshot_and_return_without_applying(self):
        for kind, flow in [('descriptor', 'construction_stage_demonstrative_create'), ('activity', 'hr_activity_registration')]:
            with self.subTest(kind=kind):
                state, etag = self.state()
                state['attendance_batch_row_changes'] = {'1814': {'ATIVIDADEEXECUTADA': 'RASCUNHO TESTE'}}
                state['attendance_batch_motivation'] = 'MOTIVAÇÃO TESTE'
                state['pending_attendance_custom_context'] = {'keep': True}
                before = copy.deepcopy(state)
                self.choose(kind)
                child, etag = self.state()
                self.assertEqual(child['flow'], flow)
                self.assertEqual(child['embedded_return']['type'], 'attendance_summary_registration')
                self.assertNotIn('attendance_batch_records', child)
                child['fields']['ATIVIDADEEXECUTADA'] = 'NOVO CADASTRO'
                child['processed_message_ids'].append('child-final')
                result = self.c.engine._resume_attendance_summary_registration(child, etag, 999)
                state = self.assert_summary()
                self.assertEqual(state['attendance_batch_row_changes'], before['attendance_batch_row_changes'])
                self.assertEqual(state['pending_attendance_custom_context'], before['pending_attendance_custom_context'])
                self.assertEqual(state['fields'], before['fields'])
                self.assertEqual(state['attendance_batch_motivation'], 'MOTIVAÇÃO TESTE')
                self.assertNotIn('embedded_return', state)
                self.assertNotIn('idempotency_token', state) if 'idempotency_token' not in before else self.assertEqual(state['idempotency_token'], before['idempotency_token'])
                self.assertIn('child-final', state['processed_message_ids'])
                self.assertEqual(result['registered_item_id'], 999)

    def test_cancel_child_returns_to_summary(self):
        self.choose('activity')
        state, etag = self.state()
        self.c.engine._restore_embedded_supply_ancestor(state, etag, 1)
        self.assert_summary()

    def test_global_cancel_child_preserves_summary(self):
        self.choose('activity')
        self.c.reply('fim')
        self.assert_summary()

    def test_confirmation_cancel_child_preserves_summary(self):
        self.choose('activity')
        self.answer('412')
        result = self.c.reply('ATIVIDADE FICTÍCIA NOVA')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.c.reply(reply_id='confirm_cancel')
        self.assert_summary()

    def test_activity_full_registration_creates_only_catalog_and_returns(self):
        self.choose('activity')
        self.answer('412')
        result = self.c.reply('ATIVIDADE FICTÍCIA NOVA')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        result = self.c.reply('SIM')
        self.assertTrue(result['embedded_attendance_summary_registered'])
        self.assertEqual(self.c.sharepoint.items[result['registered_item_id']]['target_list'], 'ATIVIDADE EXECUTADA')
        self.assert_summary()

    def test_descriptor_full_registration_creates_only_catalog_and_returns(self):
        self.choose('descriptor')
        for value in ('431', '432', '433'):
            self.answer(value)
        self.c.reply(reply_id='demonstrative_start_today')
        self.c.reply(reply_id='demonstrative_end_blank')
        for value in ('10', '20', '1', '434', '2', 'NÃO'):
            result = self.answer(value)
        self.assertEqual(result['status'], 'awaiting_confirmation')
        result = self.c.reply('SIM')
        self.assertTrue(result['embedded_attendance_summary_registered'])
        self.assertEqual(self.c.sharepoint.items[result['registered_item_id']]['target_list'], 'DEMONSTRATIVOETAPA')
        self.assert_summary()

    def test_completed_registration_refreshes_catalog_and_preserves_old_values(self):
        self.choose('activity')
        state, etag = self.state()
        new = copy.deepcopy(self.c.sharepoint.options_by_key['editar_atividade_presenca'][0])
        new.update(id=999, value='ATIVIDADE NOVA TESTE', title='ATIVIDADE NOVA TESTE')
        self.c.sharepoint.options_by_key['editar_atividade_presenca'].append(new)
        self.c.engine._resume_attendance_summary_registration(state, etag, 999)
        rows = self.c.messenger.sent[-1]['detail_table']['rows']
        cell = next(c for c in rows[0] if c['label'] == 'ATIVIDADEEXECUTADA')
        self.assertIn('ATIVIDADE NOVA TESTE', [o['label'] for o in cell['editor']['options']])
        self.assertNotEqual(cell['value'], 'ATIVIDADE NOVA TESTE')

    def test_nested_activity_returns_to_descriptor_then_original_summary(self):
        self.choose('descriptor')
        for value in ('431', '432', '433'):
            self.answer(value)
        self.c.reply(reply_id='demonstrative_start_today')
        self.c.reply(reply_id='demonstrative_end_blank')
        for value in ('10', '20', '1'):
            self.answer(value)
        self.c.reply(reply_id='NOVO_DEMONSTRATIVO_ETAPA_ATIVIDADE')
        self.c.reply('ATIVIDADE ANINHADA FICTÍCIA')
        result = self.c.reply('SIM')
        self.assertTrue(result['embedded_demonstrative_activity_registered'])
        state, _ = self.state()
        self.assertEqual(state['embedded_return']['type'], 'attendance_summary_registration')
        self.answer('2')
        self.c.reply('NÃO')
        result = self.c.reply('SIM')
        self.assertTrue(result['embedded_attendance_summary_registered'])
        self.assert_summary()

    def test_header_back_from_menu_returns_to_summary(self):
        self.c.reply(reply_id='attendance_batch_register')
        self.c.reply(reply_id='navigation_back')
        self.assert_summary()


if __name__ == '__main__':
    unittest.main()
