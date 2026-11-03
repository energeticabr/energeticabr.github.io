"""Exercise the real attendance engine against the in-memory SharePoint fixture."""
import copy
from test_inline import InlineTests


class SupplierDefaultsTests(InlineTests):
    def setUp(self):
        super().setUp()
        self.supplier = str(self.state()[0]['attendance_batch_records'][0]['source_values']['FORNECEDOR'])
        self.c.sharepoint.options_by_key['fornecedor_sincronizacao_atividade_presenca'] = [{
            'id': 777, 'value': '777', 'title': self.supplier,
            'source_values': {'Id': 777, 'CADASTRO': self.supplier, 'FILIAL': '001 - OURO PRETO'}}]
        self.c.sharepoint.items[777] = {'fields': {'CADASTRO': self.supplier, 'FILIAL': '001 - OURO PRETO',
            'ATIVIDADE EXERCIDA': 'MONTAGEM DE FORMAS', 'DESCRITIVOETAPA ATUAL': '119'},
            'attachments': {}, 'target_list': 'FORNECEDORES'}

    def change_activity(self):
        self.c.reply(reply_id=self.command(0, 'ATIVIDADEEXECUTADA', 'ARMAÇÃO DE VIGAS'))

    def test_supplier_defaults_no_writes_supplier_on_no(self):
        self.change_activity()
        result = self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(result['status'], 'awaiting_attendance_supplier_defaults')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        result = self.c.reply(reply_id='attendance_supplier_defaults_no')
        self.assertEqual(result['status'], 'attendance_batch_completed')
        self.assertFalse([x for x in self.c.sharepoint.update_calls if x['target_list'] == 'FORNECEDORES'])

    def test_supplier_defaults_yes_updates_only_edited_supplier(self):
        self.change_activity()
        self.assertEqual(self.c.reply(reply_id='attendance_batch_confirm')['status'], 'awaiting_attendance_supplier_defaults')
        result = self.c.reply(reply_id='attendance_supplier_defaults_yes')
        self.assertEqual(result['status'], 'attendance_batch_completed')
        calls = [x for x in self.c.sharepoint.update_calls if x['target_list'] == 'FORNECEDORES']
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]['item_id'], 777)
        self.assertEqual(calls[0]['fields']['ATIVIDADE EXERCIDA'], 'ARMAÇÃO DE VIGAS')
        self.assertEqual(str(calls[0]['fields']['DESCRITIVOETAPA ATUAL']), '119')

    def test_supplier_defaults_unchanged_does_not_ask(self):
        result = self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(result['status'], 'attendance_batch_completed')
        self.assertFalse([x for x in self.c.sharepoint.update_calls if x['target_list'] == 'FORNECEDORES'])

    def test_supplier_defaults_duplicate_names_fail_closed_before_any_write(self):
        duplicate = copy.deepcopy(self.c.sharepoint.options_by_key['fornecedor_sincronizacao_atividade_presenca'][0])
        duplicate['id'] = duplicate['source_values']['Id'] = 778
        duplicate['value'] = '778'
        self.c.sharepoint.options_by_key['fornecedor_sincronizacao_atividade_presenca'].append(duplicate)
        self.change_activity()
        self.c.reply(reply_id='attendance_batch_confirm')
        self.c.reply(reply_id='attendance_supplier_defaults_yes')
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_supplier_defaults_ambiguous_changes_to_one_supplier_are_rejected(self):
        state, etag = self.state()
        state['attendance_batch_records'][1]['source_values']['FORNECEDOR'] = self.supplier
        self.c.engine._prompt_attendance_batch_confirmation(state, etag)
        self.change_activity()
        state, etag = self.state()
        state.setdefault('attendance_batch_row_changes', {})['1815'] = {'ATIVIDADEEXECUTADA': 'CONCRETAGEM DE VIGAS'}
        self.c.engine._prompt_attendance_batch_confirmation(state, etag)
        self.c.reply(reply_id='attendance_batch_confirm')
        self.c.reply(reply_id='attendance_supplier_defaults_yes')
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_supplier_defaults_recovers_supplier_write_without_reposting_presence(self):
        self.change_activity()
        self.c.reply(reply_id='attendance_batch_confirm')
        original = self.c.sharepoint.update_item_with_etag
        failed = []
        def intermittent(item_id, fields, etag, target_list=None):
            if target_list == 'FORNECEDORES' and not failed:
                failed.append(True)
                raise RuntimeError('falha temporária')
            return original(item_id, fields, etag, target_list=target_list)
        self.c.sharepoint.update_item_with_etag = intermittent
        result = self.c.reply(reply_id='attendance_supplier_defaults_yes')
        self.assertEqual(result['status'], 'attendance_batch_recovery_pending')
        state, etag = self.state()
        self.c.engine._resume_attendance_batch_commit(state, etag)
        calls = self.c.sharepoint.update_calls
        self.assertEqual([x['item_id'] for x in calls if x['target_list'] == 'DESCRITIVOPRESENCA'], [1814, 1815])
        self.assertEqual(len([x for x in calls if x['target_list'] == 'FORNECEDORES']), 1)

    def test_supplier_defaults_question_survives_reconnect(self):
        self.change_activity()
        self.c.reply(reply_id='attendance_batch_confirm')
        state, etag = self.state()
        result = self.c.engine._resend_current_prompt(state, etag)
        self.assertEqual(result['status'], 'awaiting_attendance_supplier_defaults')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        result = self.c.reply(reply_id='attendance_supplier_defaults_no')
        self.assertEqual(result['status'], 'attendance_batch_completed')

    def test_supplier_defaults_reverting_activity_does_not_ask(self):
        self.c.sharepoint.options_by_key['editar_atividade_presenca'].append({
            'id': 410, 'title': 'MONTAGEM DE FORMAS', 'value': 'MONTAGEM DE FORMAS',
            'source_values': {'ATIVIDADEEXECUTADA': 'MONTAGEM DE FORMAS', 'ETAPA': 'FUNDAÇÃO', 'FILIAL': '001 - OURO PRETO'}})
        self.change_activity()
        self.c.reply(reply_id=self.command(0, 'ATIVIDADEEXECUTADA', 'MONTAGEM DE FORMAS'))
        result = self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(result['status'], 'attendance_batch_completed')
        self.assertFalse([x for x in self.c.sharepoint.update_calls if x['target_list'] == 'FORNECEDORES'])

    def test_supplier_defaults_concurrent_supplier_change_is_not_overwritten(self):
        self.change_activity()
        self.c.reply(reply_id='attendance_batch_confirm')
        original = self.c.sharepoint.update_item_with_etag
        def change_supplier_after_preflight(item_id, fields, etag, target_list=None):
            if target_list == 'DESCRITIVOPRESENCA' and item_id == 1814:
                self.c.sharepoint.items[777]['fields']['ATIVIDADE EXERCIDA'] = 'ALTERAÇÃO CONCORRENTE'
            return original(item_id, fields, etag, target_list=target_list)
        self.c.sharepoint.update_item_with_etag = change_supplier_after_preflight
        self.c.reply(reply_id='attendance_supplier_defaults_yes')
        self.assertEqual(self.c.sharepoint.items[777]['fields']['ATIVIDADE EXERCIDA'], 'ALTERAÇÃO CONCORRENTE')
        self.assertFalse([x for x in self.c.sharepoint.update_calls if x['target_list'] == 'FORNECEDORES'])

    def test_supplier_defaults_changed_attendance_identity_blocks_all_writes(self):
        self.change_activity()
        self.c.reply(reply_id='attendance_batch_confirm')
        self.c.sharepoint.items[1814]['fields']['FORNECEDOR'] = 'OUTRO FORNECEDOR'
        self.c.reply(reply_id='attendance_supplier_defaults_yes')
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_supplier_defaults_wrong_supplier_branch_blocks_all_writes(self):
        self.c.sharepoint.options_by_key['fornecedor_sincronizacao_atividade_presenca'][0]['source_values']['FILIAL'] = 'OUTRA FILIAL'
        self.change_activity()
        self.c.reply(reply_id='attendance_batch_confirm')
        self.c.reply(reply_id='attendance_supplier_defaults_yes')
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_supplier_defaults_back_restores_summary_without_writes(self):
        self.change_activity()
        self.c.reply(reply_id='attendance_batch_confirm')
        result = self.c.reply(reply_id='attendance_supplier_defaults_back')
        self.assertEqual(result['status'], 'awaiting_attendance_batch_confirmation')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        self.assertEqual(self.c.reply(reply_id='attendance_batch_confirm')['status'], 'awaiting_attendance_supplier_defaults')

    def test_supplier_defaults_changed_attendance_activity_blocks_all_writes(self):
        self.change_activity()
        self.c.reply(reply_id='attendance_batch_confirm')
        self.c.sharepoint.items[1814]['fields']['ATIVIDADEEXECUTADA'] = 'ALTERAÇÃO CONCORRENTE'
        self.c.reply(reply_id='attendance_supplier_defaults_yes')
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_supplier_defaults_updates_each_edited_supplier(self):
        second = self.state()[0]['attendance_batch_records'][1]['source_values']['FORNECEDOR']
        self.c.sharepoint.options_by_key['fornecedor_sincronizacao_atividade_presenca'].append({
            'id': 778, 'value': '778', 'title': second,
            'source_values': {'Id': 778, 'CADASTRO': second, 'FILIAL': '001 - OURO PRETO'}})
        self.c.sharepoint.items[778] = {'fields': {'CADASTRO': second, 'FILIAL': '001 - OURO PRETO',
            'ATIVIDADE EXERCIDA': 'MONTAGEM DE FORMAS', 'DESCRITIVOETAPA ATUAL': '119'},
            'attachments': {}, 'target_list': 'FORNECEDORES'}
        self.change_activity()
        self.c.reply(reply_id=self.command(1, 'ATIVIDADEEXECUTADA', 'ARMAÇÃO DE VIGAS'))
        self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(self.c.reply(reply_id='attendance_supplier_defaults_yes')['status'], 'attendance_batch_completed')
        self.assertEqual([x['item_id'] for x in self.c.sharepoint.update_calls if x['target_list'] == 'FORNECEDORES'], [777, 778])

    def test_supplier_defaults_changed_description_updates_pair(self):
        option = self.c.sharepoint.options_by_key['editar_iddescritivoetapa_presenca'][1]
        option['source_values']['FILIAL'] = '001 - OURO PRETO'
        self.c.sharepoint.items[405] = {'fields': dict(option['source_values']), 'attachments': {}, 'target_list': 'DEMONSTRATIVOETAPA'}
        state, etag = self.state()
        self.c.engine._prompt_attendance_batch_confirmation(state, etag)
        self.c.reply(reply_id=self.command(0, 'IDDESCRITIVO', '405 -'))
        self.c.reply(reply_id=self.command(0, 'ATIVIDADEEXECUTADA', 'CONCRETAGEM DE VIGAS'))
        self.assertEqual(self.c.reply(reply_id='attendance_batch_confirm')['status'], 'awaiting_attendance_supplier_defaults')
        self.assertEqual(self.c.reply(reply_id='attendance_supplier_defaults_yes')['status'], 'attendance_batch_completed')
        calls = [x for x in self.c.sharepoint.update_calls if x['target_list'] == 'FORNECEDORES']
        self.assertEqual(str(calls[0]['fields']['DESCRITIVOETAPA ATUAL']), '405')
        self.assertEqual(calls[0]['fields']['ATIVIDADE EXERCIDA'], 'CONCRETAGEM DE VIGAS')

    def test_supplier_defaults_recovers_lost_response_without_repeating_write(self):
        self.change_activity()
        self.c.reply(reply_id='attendance_batch_confirm')
        original = self.c.sharepoint.update_item_with_etag
        failed = []
        def response_lost(item_id, fields, etag, target_list=None):
            result = original(item_id, fields, etag, target_list=target_list)
            if target_list == 'FORNECEDORES' and not failed:
                failed.append(True)
                raise RuntimeError('resposta perdida após gravação')
            return result
        self.c.sharepoint.update_item_with_etag = response_lost
        self.assertEqual(self.c.reply(reply_id='attendance_supplier_defaults_yes')['status'], 'attendance_batch_recovery_pending')
        state, etag = self.state()
        self.c.engine._resume_attendance_batch_commit(state, etag)
        calls = self.c.sharepoint.update_calls
        self.assertEqual(len([x for x in calls if x['target_list'] == 'FORNECEDORES']), 1)
        self.assertEqual(len([x for x in calls if x['target_list'] == 'DESCRITIVOPRESENCA']), 2)

    def test_supplier_defaults_real_channel_delivers_question_and_choices(self):
        import ast
        import json
        from pathlib import Path
        from test_inline import SOURCE
        import logic
        self.change_activity()
        tree = ast.parse((SOURCE/'channel_bridge.py').read_text())
        node = next(item for item in tree.body if isinstance(item, ast.ClassDef) and item.name == 'ChannelMessenger')
        namespace = {'Path': Path, 'visual_form_prompt': logic.visual_form_prompt, 'visual_choice_title': logic.visual_choice_title}
        exec(compile(ast.Module(body=[node], type_ignores=[]), 'real-channel', 'exec'), namespace)
        messenger = namespace['ChannelMessenger']()
        original = self.c.engine.messenger
        self.c.engine.messenger = messenger
        try:
            state, etag = self.state()
            self.c.engine._prompt_attendance_supplier_defaults(state, etag)
        finally:
            self.c.engine.messenger = original
        delivered = json.loads(json.dumps(messenger.drain()))[-1]
        self.assertEqual(delivered['type'], 'poll')
        self.assertIn(self.supplier, delivered['question'])
        self.assertIn('ARMAÇÃO DE VIGAS', delivered['question'])
        self.assertEqual([item['id'] for item in delivered['options'][:3]], [
            'attendance_supplier_defaults_yes', 'attendance_supplier_defaults_no', 'attendance_supplier_defaults_back'])

    def test_supplier_defaults_global_back_does_not_write(self):
        self.change_activity()
        self.c.reply(reply_id='attendance_batch_confirm')
        self.c.reply(reply_id='navigation_back')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        state, _ = self.state()
        self.assertFalse(state.get('attendance_supplier_defaults_question'))
