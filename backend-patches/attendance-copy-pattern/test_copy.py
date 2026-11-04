"""Verify copying a stage/activity pair remains a draft until final confirmation."""
from test_inline_regression import InlineTests

class CopyPatternTests(InlineTests):
    def offer(self):
        self.c.reply(reply_id=self.command(0, 'IDDESCRITIVO', '405 -'))
        self.c.reply(reply_id=self.command(0, 'ATIVIDADEEXECUTADA', 'ARMAÇÃO DE VIGAS'))
        offer = self.c.messenger.sent[-1]['detail_table']['copy_offer']
        self.assertEqual([item['id'] for item in offer['targets']], ['1815'])
        return offer

    def test_copy_pattern_updates_only_selected_draft(self):
        offer = self.offer()
        result = self.c.reply(reply_id='attendance_copy:' + offer['token'] + ':1815')
        self.assertEqual(result['status'], 'awaiting_attendance_batch_confirmation')
        state, _ = self.state()
        target = state['attendance_batch_row_changes']['1815']
        self.assertEqual(target['IDDESCRITIVOETAPA'], state['attendance_batch_row_changes']['1814']['IDDESCRITIVOETAPA'])
        self.assertEqual(target['ATIVIDADEEXECUTADA'], 'ARMAÇÃO DE VIGAS')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        self.assertNotIn('copy_offer', self.c.messenger.sent[-1]['detail_table'])

    def test_copy_pattern_skip_or_forgery_never_changes_other_rows(self):
        offer = self.offer()
        self.c.reply(reply_id='attendance_copy:' + offer['token'] + ':9999')
        self.assertNotIn('1815', self.state()[0]['attendance_batch_row_changes'])
        self.assertEqual(self.c.sharepoint.update_calls, [])
        self.c.reply(reply_id='attendance_copy_skip:' + offer['token'])
        self.assertNotIn('1815', self.state()[0]['attendance_batch_row_changes'])
        self.assertNotIn('copy_offer', self.c.messenger.sent[-1]['detail_table'])

    def test_copy_pattern_catalog_failure_is_atomic(self):
        offer = self.offer()
        original = self.c.sharepoint.get_options
        def fail(step, context):
            if step.get('target_field') == 'ATIVIDADEEXECUTADA' and context.get('FORNECEDOR') == 'FORNECEDOR TESTE BETA':
                raise RuntimeError('unavailable')
            return original(step, context)
        self.c.sharepoint.get_options = fail
        self.c.reply(reply_id='attendance_copy:' + offer['token'] + ':1815')
        self.assertNotIn('1815', self.state()[0]['attendance_batch_row_changes'])
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_copy_offer_clears_when_leaving_summary(self):
        self.offer()
        self.c.reply(reply_id='attendance_batch_cancel')
        self.assertNotIn('attendance_copy_offer', self.state()[0])
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_copy_offer_survives_real_channel_transport(self):
        import ast
        from pathlib import Path
        from test_inline import SOURCE
        import logic
        self.offer()
        tree = ast.parse((SOURCE/'channel_bridge.py').read_text())
        node = next(item for item in tree.body if isinstance(item, ast.ClassDef) and item.name == 'ChannelMessenger')
        namespace = {'Path': Path, 'visual_form_prompt': logic.visual_form_prompt, 'visual_choice_title': logic.visual_choice_title}
        exec(compile(ast.Module(body=[node], type_ignores=[]), 'real-channel', 'exec'), namespace)
        messenger = namespace['ChannelMessenger']()
        old = self.c.engine.messenger
        self.c.engine.messenger = messenger
        try:
            state, etag = self.state()
            self.c.engine._prompt_attendance_batch_confirmation(state, etag)
        finally:
            self.c.engine.messenger = old
        self.assertEqual(messenger.drain()[-1]['detail_table']['copy_offer']['targets'][0]['id'], '1815')

    def test_copy_pattern_final_submission_keeps_supplier_consent(self):
        descriptor = next(x for x in self.c.sharepoint.options_by_key['editar_iddescritivoetapa_presenca'] if x['value'] == '405')
        descriptor['source_values'].update(ETAPA='FUNDAÇÃO', FILIAL='001 - OURO PRETO')
        offer = self.offer()
        self.c.reply(reply_id='attendance_copy:' + offer['token'] + ':1815')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        result = self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(result['status'], 'awaiting_attendance_supplier_defaults')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        result = self.c.reply(reply_id='attendance_supplier_defaults_no')
        self.assertEqual(result['status'], 'attendance_batch_completed')
        calls = self.c.sharepoint.update_calls
        self.assertEqual(len([call for call in calls if call['target_list']=='DESCRITIVOPRESENCA']), 2)
        self.assertFalse([call for call in calls if call['target_list']=='FORNECEDORES'])
