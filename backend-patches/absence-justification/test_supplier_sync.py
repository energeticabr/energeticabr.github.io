"""Exercise actual supplier-sync methods against synthetic SharePoint records."""
import ast
import copy
import os
from pathlib import Path
import types
import unittest


def workflow_methods():
    # These methods have no dependency on media or network clients. Compile the
    # production AST unchanged so this focused test also runs on Windows.
    path = Path(os.environ['ABSENCE_JUSTIFICATION_SOURCE']) / 'worker/workflow.py'
    tree = ast.parse(path.read_text(encoding='utf-8'))
    names = {'_attendance_saved_justification', '_attendance_supplier_confirmation_updates',
             '_attendance_confirmation_detail_table', '_commit_attendance_supplier_confirmation'}
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'WorkflowEngine')
    methods = [node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name in names]
    if {node.name for node in methods} != names:
        raise RuntimeError('Missing production supplier-sync methods')
    compiled = ast.Module(body=[ast.ClassDef(name='Subject', bases=[], keywords=[], body=methods,
                                            decorator_list=[])], type_ignores=[])
    scope = {'copy': copy, 'normalize_text': lambda value: str(value).strip().lower(),
             'ATTENDANCE_CONSISTENCY_FIELDS': ('FORNECEDOR', 'FILIAL')}
    exec(compile(ast.fix_missing_locations(compiled), str(path), 'exec'), scope)
    return scope['Subject']


class SupplierJustificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.Subject = workflow_methods()

    def setUp(self):
        self.engine = self.Subject()
        self.items = {
            1: {'DATA': '2026-11-06', 'PRESENCA': 'PENDENTE', 'FORNECEDOR': 'A', 'FILIAL': 'X',
                'MOTIVACAO': '', 'VLORDIARIO': '10', 'IDPGTO': '', 'IRREGULARIDADES': 'Consulta médica'},
            2: {'DATA': '2026-11-06', 'PRESENCA': 'PENDENTE', 'FORNECEDOR': 'B', 'FILIAL': 'X',
                'MOTIVACAO': '', 'VLORDIARIO': '10', 'IDPGTO': '', 'IRREGULARIDADES': 'Transporte'},
        }
        self.fields = ['DATA', 'PRESENCA', 'MOTIVACAO', 'VLORDIARIO', 'IDPGTO']
        self.flow = {'writable_fields': self.fields}
        self.state = {'flow': 'attendance_validation', 'batch_id': 'synthetic',
                      'fields': {**copy.deepcopy(self.items[1]), 'ID PRESENÇA': '1',
                                 'PRESENCA': 'AUSENTE', 'MOTIVACAO': 'Consulta médica',
                                 'VLORDIARIO': '0', 'IDPGTO': 'AUSENTE'},
                      'attendance_justification_default': {
                          'record_id': '1', 'date': '2026-11-06', 'note': 'Consulta médica'},
                      'attendance_supplier_sync_records': [
                          {'item_id': key, 'source_values': copy.deepcopy(value)}
                          for key, value in self.items.items()]}
        self.reads = []
        self.commits = []
        self.engine._flow_config = lambda state: self.flow
        self.engine._attendance_supplier_confirmation_records = lambda state: state['attendance_supplier_sync_records']
        self.engine._selection_date_key = lambda value: str(value or '')[:10]
        self.engine._same_attendance_value = lambda left, right: str(left or '') == str(right or '')
        self.engine._attendance_consistency_record = lambda *args, **kwargs: None
        self.engine._pending_attendance_date_display = lambda value: value
        self.engine._send_text = lambda *args: None
        self.engine._save = lambda state, etag: 'next-etag'
        self.engine._send_confirmation_actions = lambda state: self.engine._attendance_confirmation_detail_table(state)
        self.engine._resume_attendance_batch_commit = self.commit
        self.engine.sharepoint = types.SimpleNamespace(
            get_item_fields=self.read, get_item_fields_with_etag=self.versioned_read)

    def read(self, item_id, fields, *, target_list):
        self.assertEqual(target_list, 'DESCRITIVOPRESENCA')
        self.reads.append((item_id, list(fields)))
        return {key: self.items[item_id].get(key) for key in fields}

    def versioned_read(self, item_id, fields, *, target_list):
        return self.read(item_id, fields, target_list=target_list), 'item-etag'

    def commit(self, state, etag):
        self.commits.append(copy.deepcopy(state['attendance_batch_commit']))
        return {'status': 'committing'}

    def motivations(self):
        table = self.engine._attendance_confirmation_detail_table(self.state)
        return [next(cell['value'] for cell in row if cell['label'] == 'MOTIVACAO') for row in table['rows']]

    def test_summary_and_journal_keep_each_saved_note(self):
        self.assertEqual(self.motivations(), ['Consulta médica', 'Transporte'])
        result = self.engine._commit_attendance_supplier_confirmation(self.state, 'etag', self.flow)
        self.assertEqual(result['status'], 'committing')
        entries = self.commits[0]['entries']
        self.assertEqual([entry['updates']['MOTIVACAO'] for entry in entries], ['Consulta médica', 'Transporte'])
        self.assertEqual([entry['original']['IRREGULARIDADES'] for entry in entries], ['Consulta médica', 'Transporte'])

    def test_blank_other_record_does_not_inherit_original_reason(self):
        self.items[2]['IRREGULARIDADES'] = '  '
        self.assertEqual(self.motivations(), ['Consulta médica', 'NÃO APONTADO'])

    def test_manual_or_holiday_reason_keeps_explicit_fanout(self):
        self.state.pop('attendance_justification_default')
        for reason in ('FERIADO', 'Motivação editada manualmente'):
            self.state['fields']['MOTIVACAO'] = reason
            self.assertEqual(self.motivations(), [reason, reason])

    def test_changed_note_rebuilds_summary_and_stops_before_journal(self):
        self.motivations()
        self.items[2]['IRREGULARIDADES'] = 'Nota atualizada'
        result = self.engine._commit_attendance_supplier_confirmation(self.state, 'etag', self.flow)
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(self.commits, [])
        self.assertNotIn('attendance_batch_commit', self.state)
        self.assertEqual(self.motivations(), ['Consulta médica', 'Nota atualizada'])

    def test_note_race_at_versioned_read_cannot_commit_old_motivation(self):
        self.motivations()
        def changed(item_id, fields, *, target_list):
            if item_id == 2:
                self.items[2]['IRREGULARIDADES'] = 'Mudança concorrente'
            return self.versioned_read(item_id, fields, target_list=target_list)
        self.engine.sharepoint.get_item_fields_with_etag = changed
        result = self.engine._commit_attendance_supplier_confirmation(self.state, 'etag', self.flow)
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(self.commits, [])
        self.assertEqual(self.motivations(), ['Consulta médica', 'Mudança concorrente'])


if __name__ == '__main__':
    unittest.main()
