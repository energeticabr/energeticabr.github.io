import unittest
from copy import deepcopy
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('realign', Path(__file__).with_name('realign_initial.py'))
module = importlib.util.module_from_spec(spec)
if Path(__file__).with_name('realign_initial.py').exists(): spec.loader.exec_module(module)


def initial_rows():
    rows = []
    for branch_id, label in [(1, '000 - ESCRITÓRIO CENTRAL'), (2, '001 - OURO PRETO'), (3, '002 - OURO PRETO'), (5, '004 - EDIFÍCIO XAVANTE')]:
        for tax in ('INSS', 'FGTS'):
            rows.append({'Id': len(rows) + 1, 'CHAVE': f'GUIA:2026-10:{branch_id}:{tax}', 'TIPO': tax,
                         'Title': f'Solicitar guia {tax} — 2026-10 — {label}', 'FILIAL': label,
                         'COMPETENCIA': '2026-10-01T12:00:00Z', 'VENCIMENTO': None, 'VALOR': None,
                         'Attachments': False, 'Created': '2026-11-19T19:15:11Z', 'Modified': '2026-11-19T19:15:11Z', 'eTag': '"1"'})
    return rows


class InitialAlignmentTests(unittest.TestCase):
    def test_only_six_pristine_original_rows_are_removed_and_dates_are_filled(self):
        rows = initial_rows()
        before = deepcopy(rows)
        actions = module.plan_alignment(rows)
        self.assertEqual([a['id'] for a in actions if a['operation'] == 'delete'], [1, 2, 3, 4, 5, 6])
        edits = [a for a in actions if a['operation'] == 'patch']
        self.assertEqual([a['id'] for a in edits], [7, 8])
        self.assertEqual(edits[0]['fields'], {'COMPETENCIA': '2026-10-20T12:00:00Z', 'VENCIMENTO': '2026-11-20T12:00:00Z'})
        self.assertTrue(all(a['eTag'] == '"1"' for a in actions))
        self.assertEqual(rows, before)

    def test_any_edit_or_attachment_on_a_discarded_row_blocks_the_whole_plan(self):
        for change in ({'VALOR': 0}, {'Attachments': True}, {'VENCIMENTO': '2026-11-19T12:00:00Z'},
                       {'Modified': '2026-11-19T20:00:00Z'}, {'eTag': '*'}, {'Id': 99}):
            rows = initial_rows(); rows[5].update(change)
            with self.assertRaises(ValueError): module.plan_alignment(rows)

    def test_target_user_values_and_attachments_are_preserved_and_retry_is_empty(self):
        rows = initial_rows()[6:]
        rows[0].update(VALOR=125.32, Attachments=True, VENCIMENTO='2026-11-19T12:00:00Z')
        actions = module.plan_alignment(rows)
        self.assertEqual(actions[0]['fields'], {'COMPETENCIA': '2026-10-20T12:00:00Z'})
        for row, action in zip(rows, actions): row.update(action['fields'])
        self.assertEqual(module.plan_alignment(rows), [])
        self.assertEqual(rows[0]['VALOR'], 125.32)
        self.assertTrue(rows[0]['Attachments'])

    def test_concurrent_user_edit_rejects_old_etag_without_overwriting_dates(self):
        class Store:
            base = 'web/lists/guide'
            def __init__(self):
                self.rows = {row['Id']: row for row in initial_rows()[6:]}
                self.client = self
            def schema(self): pass
            def pages(self, *_args): return deepcopy(list(self.rows.values()))
            def _request(self, method, endpoint, **kwargs):
                ident = int(endpoint.split('items(')[1].split(')')[0])
                row = self.rows[ident]
                if method == 'GET':
                    return SimpleNamespace(json=lambda: deepcopy(row), headers={'ETag': row['eTag']})
                row.update(VALOR=55.10, eTag='"2"')  # user edits after preflight
                if kwargs['headers']['IF-MATCH'] != row['eTag']:
                    raise RuntimeError('precondition failed')
                row.update(kwargs.get('json', {}))
        store = Store()
        with TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, 'precondition failed'):
                module.apply_alignment(store, Path(directory))
            self.assertEqual(len(list(Path(directory).glob('*.json'))), 1)
        self.assertEqual(store.rows[7]['COMPETENCIA'], '2026-10-01T12:00:00Z')
        self.assertEqual(store.rows[7]['VALOR'], 55.10)


if __name__ == '__main__': unittest.main()
