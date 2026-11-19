import importlib.util
from pathlib import Path
import unittest
from datetime import date

spec = importlib.util.spec_from_file_location('tax_guides', Path(__file__).with_name('run.py'))
module = importlib.util.module_from_spec(spec)
if spec.loader and Path(__file__).with_name('run.py').exists():
    spec.loader.exec_module(module)


class MonthlyGuidesTests(unittest.TestCase):
    def test_each_active_branch_receives_both_guides_for_previous_month(self):
        rows = module.plan(date(2026, 11, 19), [
            {'Id': 1, 'Title': '001 - CENTRAL', 'STATUS': 'ATIVO'},
            {'Id': 2, 'Title': '002 - OBRA', 'STATUS': 'ATIVO'},
            {'Id': 3, 'Title': '003 - ANTIGA', 'STATUS': 'INATIVO'},
        ])
        self.assertEqual([(r['FILIAL'], r['TIPO']) for r in rows], [
            ('001 - CENTRAL', 'INSS'), ('001 - CENTRAL', 'FGTS'),
            ('002 - OBRA', 'INSS'), ('002 - OBRA', 'FGTS')])
        self.assertEqual(rows[0]['COMPETENCIA'], '2026-10-01T12:00:00Z')
        self.assertEqual(rows[0]['CHAVE'], 'GUIA:2026-10:1:INSS')
        self.assertIsNone(rows[0]['VALOR'])
        self.assertIsNone(rows[0]['VENCIMENTO'])

    def test_january_uses_previous_year_and_backfills_missed_months(self):
        rows = module.plan(date(2027, 1, 1), [{'Id': 4, 'Title': 'FILIAL', 'STATUS': 'ATIVO'}])
        self.assertEqual(len(rows), 6)
        self.assertEqual(rows[-1]['CHAVE'], 'GUIA:2026-12:4:FGTS')

    def test_retries_never_change_values_dates_or_attachments(self):
        class Store:
            def __init__(self): self.rows = {}
            def ensure(self, row):
                if row['CHAVE'] in self.rows: return False
                self.rows[row['CHAVE']] = dict(row)
                return True
        store = Store()
        rows = module.plan(date(2026, 11, 19), [{'Id': 1, 'Title': 'CENTRAL', 'STATUS': 'ATIVO'}])
        self.assertEqual(module.synchronize(store, rows), {'expected': 2, 'created': 2, 'existing': 0})
        store.rows[rows[0]['CHAVE']].update(VALOR=152.50, VENCIMENTO='2026-11-19', Attachments=['oficial.pdf'])
        self.assertEqual(module.synchronize(store, rows), {'expected': 2, 'created': 0, 'existing': 2})
        self.assertEqual(store.rows[rows[0]['CHAVE']]['VALOR'], 152.50)
        self.assertEqual(store.rows[rows[0]['CHAVE']]['Attachments'], ['oficial.pdf'])

    def test_unknown_branch_state_is_rejected_before_any_creation(self):
        with self.assertRaises(ValueError):
            module.plan(date(2026, 11, 19), [{'Id': 1, 'Title': 'CENTRAL'}])

    def test_invalid_and_duplicate_branch_ids_are_rejected(self):
        branch = {'Id': 1, 'Title': 'CENTRAL', 'STATUS': 'ATIVO'}
        with self.assertRaises(ValueError): module.plan(date(2026, 11, 19), [branch, branch])
        with self.assertRaises(ValueError): module.plan(date(2026, 11, 19), [{**branch, 'Id': 0}])

    def test_concurrent_create_and_ambiguous_post_are_reconciled_without_another_write(self):
        expected = module.plan(date(2026, 11, 19), [{'Id': 1, 'Title': 'CENTRAL', 'STATUS': 'ATIVO'}])[0]
        for exception in (TimeoutError('response lost'), RuntimeError('unique key conflict')):
            class Client:
                site_url = 'https://example.sharepoint.com/site'
                def __init__(self): self.saved = None; self.writes = 0
                def _list_endpoint(self, _): return "web/lists/GetByTitle('GUIASINSSFGTS')"
                def _request(self, method, path, **kwargs):
                    if method == 'GET': return {'value': [self.saved] if self.saved else []}
                    if method == 'POST':
                        self.writes += 1
                        self.saved = {**kwargs['json'], 'Id': 1, 'VALOR': 320.50, 'Attachments': True}
                        raise exception
                    raise AssertionError('Unexpected update/delete')
            client = Client()
            store = module.SharePointStore(client)
            self.assertFalse(store.ensure(expected))
            self.assertEqual(client.writes, 1)
            self.assertFalse(store.ensure(expected))
            self.assertEqual(client.writes, 1)
            self.assertEqual(client.saved['VALOR'], 320.50)

    def test_partial_failure_resumes_only_the_missing_guide(self):
        rows = module.plan(date(2026, 11, 19), [{'Id': 1, 'Title': 'CENTRAL', 'STATUS': 'ATIVO'}])
        class Store:
            def __init__(self): self.keys = set(); self.fail = True
            def ensure(self, row):
                if row['TIPO'] == 'FGTS' and self.fail: raise TimeoutError()
                created = row['CHAVE'] not in self.keys
                self.keys.add(row['CHAVE'])
                return created
        store = Store()
        with self.assertRaises(TimeoutError): module.synchronize(store, rows)
        store.fail = False
        self.assertEqual(module.synchronize(store, rows), {'expected': 2, 'created': 1, 'existing': 1})

    def test_foreign_pagination_is_rejected_before_fetching_it(self):
        class Client:
            site_url = 'https://example.sharepoint.com/site'
            def _list_endpoint(self, _): return 'web/lists/guide'
            def _request(self, method, endpoint, **kwargs):
                if endpoint != 'web/lists/guide/items': raise AssertionError('Foreign URL fetched')
                return {'value': [{'Id': 1}], 'odata.nextLink': 'https://other.example/items'}
        with self.assertRaises(ValueError): module.SharePointStore(Client()).find('GUIA:2026-10:1:INSS')


if __name__ == '__main__': unittest.main()
