"""Real WorkflowEngine; every external service is the project's in-memory fixture."""
import copy
import os
from pathlib import Path
import sys
import unittest

SOURCE = Path(os.environ['ATTENDANCE_INLINE_SOURCE']).resolve()
sys.path.insert(0, str(SOURCE / 'tests'))
import test_workflow as fixtures


class InlineTests(unittest.TestCase):
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
            c.sharepoint.items[int(option['value'])] = {
                'fields': copy.deepcopy(option['source_values']), 'attachments': {},
                'target_list': 'DESCRITIVOPRESENCA'}
        c.sharepoint.options_by_key['validar_atividade_presenca_consistencia'].append(
            copy.deepcopy(c.sharepoint.options_by_key['editar_atividade_presenca'][0]))
        c.reply('OPA'); c.reply('RECURSOS HUMANOS'); c.reply('VALIDAR PRESENÇAS APONTADAS'); c.reply(reply_id='choice:data_presenca_pendente:1814')
        c.reply(reply_id='attendance_batch:1814,1815')
        result = c.reply(reply_id='attendance_batch_present')
        self.assertEqual(result.get('status'), 'awaiting_attendance_batch_confirmation', (result, c.messenger.sent[-2:]))

    def state(self):
        return next(iter(self.c.state.values.values()))

    def rows(self):
        return self.c.messenger.sent[-1]['detail_table']['rows']

    def cell(self, row, field):
        return next(cell for cell in self.rows()[row] if cell['label'] == field)

    def command(self, row, field, contains):
        return next(o['value'] for o in self.cell(row, field)['editor']['options'] if contains in o['label'])

    def test_cells_offer_opaque_current_and_options_without_writes(self):
        for row in range(2):
            for field in ('IDDESCRITIVO', 'ATIVIDADEEXECUTADA'):
                editor = self.cell(row, field)['editor']
                self.assertTrue(editor['value'].startswith('attendance_inline:'))
                self.assertIn(editor['value'], [o['value'] for o in editor['options']])
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_activity_edit_is_isolated_and_commits_only_after_submit(self):
        self.c.reply(reply_id=self.command(0, 'ATIVIDADEEXECUTADA', 'ARMAÇÃO DE VIGAS'))
        self.assertEqual(self.cell(0, 'ATIVIDADEEXECUTADA')['value'], 'ARMAÇÃO DE VIGAS')
        self.assertEqual(self.cell(1, 'ATIVIDADEEXECUTADA')['value'], 'MONTAGEM DE FORMAS')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        result = self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(result['status'], 'attendance_batch_completed')
        calls = self.c.sharepoint.update_calls
        self.assertEqual(calls[0]['fields']['ATIVIDADEEXECUTADA'], 'ARMAÇÃO DE VIGAS')
        self.assertNotIn('ATIVIDADEEXECUTADA', calls[1]['fields'])

    def test_changed_descriptor_clears_only_row_activity_and_blocks_submit(self):
        self.c.reply(reply_id=self.command(0, 'IDDESCRITIVO', '405 -'))
        self.assertEqual(self.cell(0, 'ATIVIDADEEXECUTADA')['editor']['value'], '')
        self.assertEqual(self.cell(1, 'ATIVIDADEEXECUTADA')['value'], 'MONTAGEM DE FORMAS')
        result = self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(result['status'], 'attendance_batch_incomplete')
        self.assertEqual(self.state()[0]['stage'], 'attendance_batch_confirmation')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        self.c.reply(reply_id=self.command(0, 'ATIVIDADEEXECUTADA', 'ARMAÇÃO DE VIGAS'))
        self.assertEqual(self.cell(0, 'ATIVIDADEEXECUTADA')['value'], 'ARMAÇÃO DE VIGAS')

    def test_same_descriptor_keeps_activity(self):
        self.c.reply(reply_id=self.cell(0, 'IDDESCRITIVO')['editor']['value'])
        self.assertEqual(self.cell(0, 'ATIVIDADEEXECUTADA')['value'], 'MONTAGEM DE FORMAS')

    def test_forged_and_old_revision_do_not_change_rows(self):
        stale = self.command(0, 'ATIVIDADEEXECUTADA', 'ARMAÇÃO DE VIGAS')
        self.c.reply(reply_id=self.cell(0, 'IDDESCRITIVO')['editor']['value'])
        self.c.reply(reply_id=stale)
        self.assertEqual(self.cell(0, 'ATIVIDADEEXECUTADA')['value'], 'MONTAGEM DE FORMAS')
        self.c.reply(reply_id='attendance_inline:forged:1815:ATIVIDADEEXECUTADA:0')
        self.assertEqual(self.cell(1, 'ATIVIDADEEXECUTADA')['value'], 'MONTAGEM DE FORMAS')
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_cancel_does_not_write_and_invalidates_commands(self):
        command = self.command(0, 'ATIVIDADEEXECUTADA', 'ARMAÇÃO DE VIGAS')
        self.c.reply(reply_id='attendance_batch_cancel')
        self.assertNotIn(command, self.state()[0].get('attendance_inline_commands', {}))
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_reconnect_keeps_draft_rotates_whitelist(self):
        self.c.reply(reply_id=self.command(0, 'ATIVIDADEEXECUTADA', 'ARMAÇÃO DE VIGAS'))
        old = self.command(0, 'IDDESCRITIVO', '405 -')
        state, etag = self.state()
        self.c.engine._resend_current_prompt(state, etag)
        self.assertEqual(self.cell(0, 'ATIVIDADEEXECUTADA')['value'], 'ARMAÇÃO DE VIGAS')
        self.assertNotIn(old, self.state()[0]['attendance_inline_commands'])
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_catalog_failure_retains_summary_and_blocks_submit_then_retries(self):
        original = self.c.sharepoint.get_options
        def fail(step, context):
            if step.get('key') == 'editar_atividade_presenca':
                raise RuntimeError('catalog offline')
            return original(step, context)
        self.c.sharepoint.get_options = fail
        state, etag = self.state()
        self.c.engine._resend_current_prompt(state, etag)
        self.assertEqual(self.cell(0, 'ATIVIDADEEXECUTADA')['value'], 'MONTAGEM DE FORMAS')
        result = self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(result['status'], 'attendance_batch_catalog_unavailable')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        self.c.sharepoint.get_options = original
        self.c.reply(reply_id='attendance_inline_retry')
        self.assertIn('editor', self.cell(0, 'ATIVIDADEEXECUTADA'))
        self.assertFalse(self.state()[0]['attendance_inline_catalog_errors'])

    def test_missing_current_catalog_value_is_noop(self):
        value = self.cell(0, 'ATIVIDADEEXECUTADA')['editor']['value']
        self.c.reply(reply_id=value)
        self.assertEqual(self.cell(0, 'ATIVIDADEEXECUTADA')['value'], 'MONTAGEM DE FORMAS')
        self.assertEqual(self.state()[0].get('attendance_batch_row_changes', {}), {})

    def test_catalog_queries_are_shared_only_by_declared_context(self):
        calls = []
        original = self.c.sharepoint.get_options
        def count(step, context):
            if step.get('edit_only'):
                calls.append((step['key'], copy.deepcopy(context)))
            return original(step, context)
        self.c.sharepoint.get_options = count
        state, etag = self.state()
        self.c.engine._resend_current_prompt(state, etag)
        self.assertEqual(len([x for x in calls if x[0]=='editar_iddescritivoetapa_presenca']), 1)
        self.assertEqual(len([x for x in calls if x[0]=='editar_atividade_presenca']), 1)
        state, etag = self.state()
        state['attendance_batch_records'][1]['source_values']['ETAPA'] = 'ESTRUTURA'
        calls.clear()
        self.c.engine._prompt_attendance_batch_confirmation(state, etag)
        activity = [x[1]['ETAPA'] for x in calls if x[0]=='editar_atividade_presenca']
        self.assertEqual(activity, ['FUNDAÇÃO', 'ESTRUTURA'])

    def test_bulk_activity_replaces_per_row_override(self):
        self.c.reply(reply_id=self.command(0, 'ATIVIDADEEXECUTADA', 'ARMAÇÃO DE VIGAS'))
        self.c.reply(reply_id='attendance_batch_cancel')
        self.c.reply(reply_id='attendance_batch_edit')
        self.c.reply(reply_id='attendance_batch_field:ATIVIDADEEXECUTADA')
        self.c.reply('409')
        self.c.reply(reply_id='attendance_batch_edit_continue')
        self.c.reply(reply_id='attendance_batch_present')
        self.assertEqual(self.cell(0, 'ATIVIDADEEXECUTADA')['value'], 'CONCRETAGEM DE VIGAS')
        self.assertEqual(self.cell(1, 'ATIVIDADEEXECUTADA')['value'], 'CONCRETAGEM DE VIGAS')

    def test_consistency_still_blocks_wrong_branch_without_writes(self):
        self.c.reply(reply_id=self.command(0, 'IDDESCRITIVO', '405 -'))
        self.c.reply(reply_id=self.command(0, 'ATIVIDADEEXECUTADA', 'ARMAÇÃO DE VIGAS'))
        result = self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(result['status'], 'attendance_batch_consistency_blocked')
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_concurrent_validation_is_not_overwritten(self):
        self.c.reply(reply_id=self.command(0, 'ATIVIDADEEXECUTADA', 'ARMAÇÃO DE VIGAS'))
        self.c.sharepoint.items[1815]['fields']['PRESENCA'] = 'PRESENTE'
        self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_recovery_uses_entry_updates_and_skips_completed_id(self):
        self.c.reply(reply_id=self.command(0, 'ATIVIDADEEXECUTADA', 'ARMAÇÃO DE VIGAS'))
        original = self.c.sharepoint.update_item_with_etag
        failed = []
        def intermittent(item_id, fields, etag, target_list=None):
            if item_id == 1815 and not failed:
                failed.append(True)
                raise RuntimeError('temporary network failure')
            return original(item_id, fields, etag, target_list=target_list)
        self.c.sharepoint.update_item_with_etag = intermittent
        result = self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(result['status'], 'attendance_batch_recovery_pending')
        state, etag = self.state()
        self.c.engine._resume_attendance_batch_commit(state, etag)
        self.assertEqual([x['item_id'] for x in self.c.sharepoint.update_calls], [1814, 1815])
        self.assertEqual(self.c.sharepoint.items[1814]['fields']['ATIVIDADEEXECUTADA'], 'ARMAÇÃO DE VIGAS')
        self.assertEqual(self.c.sharepoint.items[1815]['fields']['ATIVIDADEEXECUTADA'], 'MONTAGEM DE FORMAS')
        self.assertNotIn('attendance_batch_row_changes', self.state()[0])

    def test_real_channel_messenger_delivers_editor_metadata(self):
        # Load the real adapter class without starting HTTP/auth/application services.
        import ast
        import json
        import logic
        tree = ast.parse((SOURCE/'channel_bridge.py').read_text())
        node = next(item for item in tree.body if isinstance(item,ast.ClassDef) and item.name=='ChannelMessenger')
        namespace = {'Path':Path, 'visual_form_prompt':logic.visual_form_prompt,
                     'visual_choice_title':logic.visual_choice_title}
        exec(compile(ast.Module(body=[node],type_ignores=[]),'real-channel-messenger','exec'),namespace)
        messenger = namespace['ChannelMessenger']()
        state, etag = self.state()
        original = self.c.engine.messenger
        self.c.engine.messenger = messenger
        try:
            self.c.engine._prompt_attendance_batch_confirmation(state,etag)
        finally:
            self.c.engine.messenger = original
        delivered = json.loads(json.dumps(messenger.drain()))[-1]
        self.assertEqual(delivered['type'],'poll')
        editor = next(cell for cell in delivered['detail_table']['rows'][0] if cell['label']=='IDDESCRITIVO')['editor']
        self.assertTrue(editor['value'].startswith('attendance_inline:'))
        self.assertIn(editor['value'],[choice['value'] for choice in editor['options']])
        self.assertEqual(self.c.sharepoint.update_calls,[])

if __name__ == '__main__':
    unittest.main()
