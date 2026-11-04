from test_supplier_defaults import SupplierDefaultsTests


class ComparisonTests(SupplierDefaultsTests):
    def test_comparison_uses_supplier_current_values_before_and_proposed_values_after(self):
        self.c.sharepoint.items[777]['fields']['DESCRITIVOETAPA ATUAL'] = '57'
        self.c.sharepoint.items[777]['fields']['ATIVIDADE EXERCIDA'] = 'ATIVIDADE CADASTRADA'
        self.change_activity()
        result = self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(result['status'], 'awaiting_attendance_supplier_defaults')
        table = self.c.messenger.sent[-1]['detail_table']
        self.assertEqual(table['kind'], 'presence')
        self.assertEqual(table['variant'], 'supplier_defaults_comparison')
        self.assertEqual(table['rows'][0]['supplier'], self.supplier)
        self.assertEqual(table['rows'][0]['branch'], '001 - OURO PRETO')
        self.assertEqual(table['rows'][0]['descriptor'], {'before': '57', 'after': '119'})
        self.assertEqual(table['rows'][0]['activity'], {'before': 'ATIVIDADE CADASTRADA', 'after': 'ARMAÇÃO DE VIGAS'})
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_comparison_changed_supplier_after_preview_requires_new_confirmation(self):
        self.change_activity()
        self.c.reply(reply_id='attendance_batch_confirm')
        self.c.sharepoint.items[777]['fields']['ATIVIDADE EXERCIDA'] = 'EDIÇÃO CONCORRENTE'
        result = self.c.reply(reply_id='attendance_supplier_defaults_yes')
        self.assertEqual(result['status'], 'awaiting_attendance_supplier_defaults')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        self.assertEqual(self.c.messenger.sent[-1]['detail_table']['rows'][0]['activity']['before'], 'EDIÇÃO CONCORRENTE')
        self.assertEqual(self.c.reply(reply_id='attendance_supplier_defaults_yes')['status'], 'attendance_batch_completed')

    def test_comparison_lookup_failure_allows_no_without_supplier_write(self):
        self.change_activity()
        get_options = self.c.sharepoint.get_options
        def fail_supplier(step, context):
            if step.get('key') == 'fornecedor_sincronizacao_atividade_presenca':
                raise RuntimeError('consulta indisponível')
            return get_options(step, context)
        self.c.sharepoint.get_options = fail_supplier
        result = self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(result['status'], 'awaiting_attendance_supplier_defaults')
        table = self.c.messenger.sent[-1]['detail_table']
        self.assertEqual(table['rows'][0]['activity']['before'], 'NÃO DISPONÍVEL')
        state, _ = self.state()
        self.assertNotIn('attendance_supplier_defaults_yes', [option['id'] for option in state['options']])
        self.assertEqual(self.c.reply(reply_id='attendance_supplier_defaults_no')['status'], 'attendance_batch_completed')
        self.assertFalse([call for call in self.c.sharepoint.update_calls if call['target_list'] == 'FORNECEDORES'])

    def test_comparison_channel_transports_structured_rows_and_fallback_text(self):
        import ast
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
        delivered = messenger.drain()[-1]
        self.assertEqual(delivered['detail_table']['variant'], 'supplier_defaults_comparison')
        self.assertEqual(delivered['detail_table']['rows'][0]['activity']['before'], 'MONTAGEM DE FORMAS')
        self.assertIn('MONTAGEM DE FORMAS', delivered['question'])
        self.assertIn('ARMAÇÃO DE VIGAS', delivered['question'])

    def test_comparison_retry_after_lookup_failure_requires_explicit_yes(self):
        self.change_activity()
        get_options = self.c.sharepoint.get_options
        def fail_supplier(step, context):
            if step.get('key') == 'fornecedor_sincronizacao_atividade_presenca':
                raise RuntimeError('consulta indisponível')
            return get_options(step, context)
        self.c.sharepoint.get_options = fail_supplier
        self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(self.c.reply(reply_id='attendance_supplier_defaults_yes')['status'], 'awaiting_attendance_supplier_defaults')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        self.c.sharepoint.get_options = get_options
        result = self.c.reply(reply_id='attendance_supplier_defaults_retry')
        self.assertEqual(result['status'], 'awaiting_attendance_supplier_defaults')
        self.assertTrue(self.c.messenger.sent[-1]['detail_table']['available'])
        self.assertEqual(self.c.sharepoint.update_calls, [])
        self.assertEqual(self.c.reply(reply_id='attendance_supplier_defaults_yes')['status'], 'attendance_batch_completed')
