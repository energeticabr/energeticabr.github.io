"""Real attendance workflow, synthetic SharePoint and no external writes."""
import copy
import os
from pathlib import Path
import sys
import unittest

SOURCE = Path(os.environ['ABSENCE_JUSTIFICATION_SOURCE']).resolve()
sys.path.insert(0, str(SOURCE))
sys.path.insert(0, str(SOURCE / 'tests'))
import test_workflow as fixtures


class AbsenceJustificationTests(unittest.TestCase):
    def setUp(self):
        self.c = fixtures.WorkflowTests('runTest')
        self.c.setUp()
        self.addCleanup(self.c.doCleanups)
        self.option = self.c.sharepoint.options_by_key['registro_presenca_pendente'][0]
        self.record_id = int(self.option['value'])
        self.c.sharepoint.items[self.record_id] = {
            'fields': copy.deepcopy(self.option['source_values']),
            'attachments': {}, 'target_list': 'DESCRITIVOPRESENCA',
        }
        self.c.sharepoint.options_by_key['validar_atividade_presenca_consistencia'].append(
            copy.deepcopy(self.c.sharepoint.options_by_key['editar_atividade_presenca'][0]))

    def start(self):
        for text in ('OPA', 'RECURSOS HUMANOS', 'VALIDAR PRESENÇAS APONTADAS'):
            self.c.reply(text)
        self.c.reply(reply_id='choice:data_presenca_pendente:' + str(self.record_id))
        result = self.c.reply(reply_id='choice:registro_presenca_pendente:' + str(self.record_id))
        self.assertEqual(result.get('field'), 'revisar_dados_presenca', result)

    def note(self, text):
        self.c.sharepoint.items[self.record_id]['fields']['IRREGULARIDADES'] = text

    def state(self):
        return next(iter(self.c.state.values.values()))[0]

    def test_single_uses_saved_justification_and_waits_for_confirmation(self):
        self.start()
        # The modal saves after the pending list was loaded: use a fresh read.
        self.note('  Consulta médica\nCom atestado.  ')
        result = self.c.reply(reply_id='choice:revisar_dados_presenca:3')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(self.state()['fields']['MOTIVACAO'], 'Consulta médica\nCom atestado.')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        self.c.reply('SIM')
        fields = self.c.sharepoint.items[self.record_id]['fields']
        self.assertEqual(fields['MOTIVACAO'], 'Consulta médica\nCom atestado.')
        self.assertEqual(fields['IRREGULARIDADES'], '  Consulta médica\nCom atestado.  ')
        self.assertEqual(fields['PRESENCA'], 'AUSENTE')
        self.assertEqual(fields['VLORDIARIO'], '0')
        self.assertEqual(fields['IDPGTO'], 'AUSENTE')

    def test_blank_justification_still_asks(self):
        self.note('  \n ')
        self.start()
        result = self.c.reply(reply_id='choice:revisar_dados_presenca:3')
        self.assertEqual(result['field'], 'motivacao_ausencia_presenca')
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def test_present_does_not_copy_justification(self):
        self.note('Motivo registrado')
        self.start()
        self.c.reply(reply_id='choice:revisar_dados_presenca:2')
        self.assertFalse(self.state()['fields'].get('MOTIVACAO'))

    def test_holiday_keeps_explicit_holiday_reason(self):
        self.note('Motivo registrado')
        self.start()
        result = self.c.reply(reply_id='choice:revisar_dados_presenca:4')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(self.state()['fields']['MOTIVACAO'], 'FERIADO')

    def batch(self, notes):
        options = self.c.sharepoint.options_by_key['registro_presenca_pendente']
        for offset, note in enumerate(notes):
            option = copy.deepcopy(self.option)
            item_id = self.record_id + offset
            option.update(id=item_id, value=str(item_id), title=f'{item_id} - COLABORADOR TESTE {offset}')
            option['source_values'].update(Id=item_id, FORNECEDOR=f'COLABORADOR TESTE {offset}')
            self.c.sharepoint.items[item_id] = {
                'fields': {**copy.deepcopy(option['source_values']), 'IRREGULARIDADES': note},
                'attachments': {}, 'target_list': 'DESCRITIVOPRESENCA',
            }
            if offset == 0:
                options[0] = option
            else:
                options.append(option)
        for text in ('OPA', 'RECURSOS HUMANOS', 'VALIDAR PRESENÇAS APONTADAS'):
            self.c.reply(text)
        self.c.reply(reply_id='choice:data_presenca_pendente:' + str(self.record_id))
        ids = ','.join(str(self.record_id + offset) for offset in range(len(notes)))
        self.c.reply(reply_id='attendance_batch:' + ids)
        return self.c.reply(reply_id='attendance_batch_absent')

    def motivations(self):
        return [next(cell['value'] for cell in row if cell['label'] == 'MOTIVAÇÃO')
                for row in self.c.messenger.sent[-1]['detail_table']['rows']]

    def test_batch_preserves_each_records_justification_in_summary_and_post(self):
        result = self.batch(['Consulta médica', 'Problema de transporte'])
        self.assertEqual(result['status'], 'awaiting_attendance_batch_confirmation')
        self.assertEqual(self.motivations(), ['Consulta médica', 'Problema de transporte'])
        self.assertEqual(self.c.sharepoint.update_calls, [])
        self.c.reply(reply_id='attendance_batch_confirm')
        updates = self.c.sharepoint.update_calls
        self.assertEqual(len(updates), 2)
        self.assertEqual([item['fields']['MOTIVACAO'] for item in updates], ['Consulta médica', 'Problema de transporte'])

    def test_mixed_batch_only_asks_for_records_without_justification(self):
        result = self.batch(['Consulta médica', ' '])
        self.assertEqual(result['status'], 'awaiting_attendance_batch_motivation')
        prompt = self.c.messenger.sent[-1].get('body') or self.c.messenger.sent[-1].get('prompt', '')
        self.assertIn(str(self.record_id + 1), prompt)
        self.assertIn('SEM JUSTIFICATIVA', prompt)
        self.c.reply('Motivo informado agora')
        self.assertEqual(self.motivations(), ['Consulta médica', 'Motivo informado agora'])

    def test_batch_holiday_overrides_justification_and_present_clears_it(self):
        self.batch(['Consulta médica', 'Transporte'])
        self.c.reply(reply_id='attendance_batch_cancel')
        self.c.reply(reply_id='attendance_batch_holiday')
        self.assertEqual(self.motivations(), ['FERIADO', 'FERIADO'])
        self.c.reply(reply_id='attendance_batch_cancel')
        self.c.reply(reply_id='attendance_batch_present')
        for row in self.c.messenger.sent[-1]['detail_table']['rows']:
            self.assertFalse(any(cell['label'] == 'MOTIVAÇÃO' for cell in row))

    def test_batch_refreshes_changed_justification_before_any_write(self):
        self.batch(['Consulta médica', 'Transporte'])
        self.note('Justificativa atualizada')
        self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        self.assertEqual(self.motivations(), ['Justificativa atualizada', 'Transporte'])

    def test_batch_checks_justification_in_the_versioned_snapshot(self):
        self.batch(['Consulta médica', 'Transporte'])
        original = self.c.sharepoint.get_item_fields_with_etag
        def change_before_read(item_id, fields, target_list=None):
            if int(item_id) == self.record_id:
                self.note('Justificativa concorrente')
            return original(item_id, fields, target_list=target_list)
        self.c.sharepoint.get_item_fields_with_etag = change_before_read
        self.c.reply(reply_id='attendance_batch_confirm')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        self.assertEqual(self.motivations(), ['Justificativa concorrente', 'Transporte'])

    def test_manual_motivation_edit_remains_available(self):
        self.start()
        self.note('Justificativa original')
        self.c.reply(reply_id='choice:revisar_dados_presenca:3')
        state, etag = next(iter(self.c.state.values.values()))
        steps = self.c.engine._flow_config(state)['steps']
        index = next(i for i, step in enumerate(steps) if step['key'] == 'motivacao_ausencia_presenca')
        state.update(stage='selecting_fields', step_index=index, edit_step_indices=[index])
        result = self.c.engine._prompt_next_or_summary(state, etag)
        self.assertEqual(result['field'], 'motivacao_ausencia_presenca')
        self.c.reply('Motivação editada manualmente')
        self.assertEqual(self.state()['fields']['MOTIVACAO'], 'MOTIVAÇÃO EDITADA MANUALMENTE')

    def test_single_refreshes_note_changed_after_summary(self):
        self.start()
        self.note('Justificativa inicial')
        self.c.reply(reply_id='choice:revisar_dados_presenca:3')
        self.note('Justificativa corrigida')
        result = self.c.reply('SIM')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        self.assertEqual(self.state()['fields']['MOTIVACAO'], 'Justificativa corrigida')
        self.c.reply('SIM')
        self.assertEqual(self.c.sharepoint.items[self.record_id]['fields']['MOTIVACAO'], 'Justificativa corrigida')

    def test_single_removed_note_requires_motivation(self):
        self.start()
        self.note('Justificativa inicial')
        self.c.reply(reply_id='choice:revisar_dados_presenca:3')
        self.note('')
        result = self.c.reply('SIM')
        self.assertEqual(result['field'], 'motivacao_ausencia_presenca')
        self.assertEqual(self.c.sharepoint.update_calls, [])

    def supplier_sync(self):
        self.start()
        self.note('Consulta médica')
        self.c.reply(reply_id='choice:revisar_dados_presenca:3')
        second = copy.deepcopy(self.c.sharepoint.items[self.record_id])
        second['fields'].update(Id=self.record_id + 1, IRREGULARIDADES='Transporte')
        self.c.sharepoint.items[self.record_id + 1] = second
        state, etag = next(iter(self.c.state.values.values()))
        state['attendance_supplier_sync_records'] = [
            {'item_id': identifier, 'source_values': copy.deepcopy(self.c.sharepoint.items[identifier]['fields'])}
            for identifier in (self.record_id, self.record_id + 1)]
        self.c.engine._send_confirmation_actions(state)
        self.c.engine._save(state, etag)

    def test_real_engine_supplier_sync_posts_each_records_own_note(self):
        self.supplier_sync()
        self.c.reply('SIM')
        self.assertEqual(len(self.c.sharepoint.update_calls), 2)
        self.assertEqual([item['fields']['MOTIVACAO'] for item in self.c.sharepoint.update_calls],
                         ['Consulta médica', 'Transporte'])

    def test_real_engine_supplier_sync_refreshes_changed_note_before_writing(self):
        self.supplier_sync()
        self.note('Consulta remarcada')
        self.c.reply('SIM')
        self.assertEqual(self.c.sharepoint.update_calls, [])
        self.c.reply('SIM')
        self.assertEqual(len(self.c.sharepoint.update_calls), 2)
        self.assertEqual([item['fields']['MOTIVACAO'] for item in self.c.sharepoint.update_calls],
                         ['Consulta remarcada', 'Transporte'])


if __name__ == '__main__':
    unittest.main()
