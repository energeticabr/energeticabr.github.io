"""Exercise the actual portal serializer, not just fabricated app options."""
import ast
from copy import deepcopy
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
patch = load('patch_bridge')
badge_source = load('rhid_badge_source')
BASELINE = ROOT / 'tests/fixtures/bridge_rhid_report.py.txt'

class ChoiceContextTests(unittest.TestCase):
    def serialize(self, key, choices):
        source = patch.patch_bridge(BASELINE.read_text(encoding='utf-8'))
        parsed = ast.parse(source)
        method = next(node for node in ast.walk(parsed) if isinstance(node, ast.FunctionDef) and node.name == '_send_option_poll')
        namespace = {'visual_option_title': lambda item: item.get('title', '')}
        if hasattr(badge_source, 'attendance_rhid_option_context'):
            namespace['attendance_rhid_option_context'] = badge_source.attendance_rhid_option_context
        exec(compile(ast.Module(body=[method], type_ignores=[]), str(BASELINE), 'exec'), namespace)
        messages = []
        def send(state, question, options):
            messages.append({'question': question, 'options': options})
        messenger = SimpleNamespace(_send_poll=send, messages=messages)
        namespace['_send_option_poll'](messenger, {}, {'key': key, 'prompt': 'Qual presença?', 'presentation': 'attendance_multi_select'}, choices)
        return messages[-1]['options']

    def test_rh_choice_preserves_its_real_day_and_supplier_without_exposing_the_source_row(self):
        original = {'id': '2239', 'title': '2239 - ANA', 'source_values': {'Id': 2239,
            'FORNECEDOR': 'ANA', 'DATA': '2026-10-13T12:00:00Z', 'ID_PESSOA_RHID': 7,
            'CPF': 'not-public', 'PIS': 'not-public', 'OBSERVACAO_INTERNA': 'not-public'}}
        before = deepcopy(original)
        actual = self.serialize('registro_presenca_pendente', [original])[0]
        self.assertEqual(actual.get('date'), '2026-10-13')
        self.assertEqual(actual.get('name'), 'ANA')
        self.assertEqual(actual.get('rhidId'), '7')
        self.assertEqual(actual['reply'], 'choice:registro_presenca_pendente:2239')
        self.assertEqual(actual['label'], '2239 - ANA')
        self.assertFalse({'source_values', 'CPF', 'PIS', 'OBSERVACAO_INTERNA'} & actual.keys())
        self.assertEqual(original, before)

    def test_pending_presence_uses_its_own_day_not_the_current_day(self):
        actual = self.serialize('pending_attendance_record', [{'id': 'pending_attendance_record:2237',
            'title': '2237 - BIA', 'source_values': {'DATA': '12/10/2026', 'FORNECEDOR': 'BIA'},
            'detail_table': [[{'label': 'DATA', 'value': '12/10/2026'}]]}])[0]
        self.assertEqual(actual.get('date'), '2026-10-12')
        self.assertEqual(actual.get('name'), 'BIA')
        self.assertEqual(actual['reply'], 'pending_attendance_record:2237')
        self.assertEqual(actual['detail_table'][0][0]['value'], '12/10/2026')

    def test_supplier_sync_keeps_each_records_distinct_day(self):
        choices = [{'id': 'supplier_sync_target:' + str(index), 'title': str(index) + ' - ANA',
            'source_values': {'FORNECEDOR': 'ANA', 'DATA': day}} for index, day in [(1, '2026-10-12'), (2, '2026-10-13')]]
        actual = self.serialize('sincronizar_atividade_fornecedor_presenca', choices)
        self.assertEqual([option.get('date') for option in actual], ['2026-10-12', '2026-10-13'])

    def test_other_steps_and_terminal_controls_never_acquire_attendance_metadata(self):
        source = {'DATA': '2026-10-13', 'FORNECEDOR': 'ANA', 'ID_PESSOA_RHID': 7}
        choices = [{'id': '1', 'title': 'ANA', 'source_values': source}]
        for key in ['fornecedor', 'documento', 'data_presenca']:
            self.assertFalse({'date', 'name', 'rhidId'} & self.serialize(key, choices)[0].keys())
        for identifier in ['pending_attendance_other_date', 'endstage', 'finish_supplier_sync', 'attendance_continue']:
            actual = self.serialize('pending_attendance_record', [{'id': identifier, 'title': 'CONTINUAR', 'source_values': source}])[0]
            self.assertFalse({'date', 'name', 'rhidId'} & actual.keys())

    def test_impossible_dates_and_missing_rows_never_use_today_as_a_fallback(self):
        for values in [{'DATA': '2026-02-30'}, {'DATA': '30/02/2026'}, {'DATA': ''}, {'DATA': None}, {}, None, 'bad']:
            actual = self.serialize('registro_presenca_pendente', [{'id': '2239', 'title': '2239 - ANA', 'source_values': values}])[0]
            self.assertNotRegex(actual.get('date', ''), r'^\d{4}-\d{2}-\d{2}$')
            self.assertEqual(actual.get('date'), 'INVALID', 'old clients must not fall back to an earlier day')

if __name__ == '__main__':
    unittest.main()
