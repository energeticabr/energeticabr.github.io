from copy import deepcopy
import importlib.util
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).parent))
spec = importlib.util.spec_from_file_location('initialize_status', Path(__file__).with_name('initialize_status.py'))
module = importlib.util.module_from_spec(spec)
if Path(__file__).with_name('initialize_status.py').exists(): spec.loader.exec_module(module)


class StatusInitializationTests(unittest.TestCase):
    def store(self, conflict=False):
        rows = [dict(Id=7, CHAVE='GUIA:2026-10:5:INSS', STATUS=None, VALOR=123.45, Attachments=True, eTag='"1"'),
                dict(Id=8, CHAVE='GUIA:2026-10:5:FGTS', STATUS='CONCLUÍDO', VALOR=None, Attachments=False, eTag='"2"')]
        writes = []
        def request(method, endpoint, **kwargs):
            ident = int(endpoint.split('(')[-1].split(')')[0])
            row = next(row for row in rows if row['Id'] == ident)
            if method == 'GET': return SimpleNamespace(json=lambda: deepcopy(row), headers={'ETag': row['eTag']})
            if conflict:
                row['STATUS'] = 'REVISADO PELO USUÁRIO'
                raise RuntimeError('412 Precondition Failed')
            self.assertEqual(kwargs['headers'], {'IF-MATCH': row['eTag'], 'X-HTTP-Method': 'MERGE'})
            self.assertEqual(kwargs['json'], {'STATUS': 'PENDENTE'})
            row.update(kwargs['json']); writes.append(ident)
        store = SimpleNamespace(base='web/lists/guide', client=SimpleNamespace(_request=request), schema=lambda: None,
                                pages=lambda *args, **kwargs: deepcopy(rows))
        return store, rows, writes

    def test_only_blank_status_is_initialized_and_retry_preserves_user_fields(self):
        store, rows, writes = self.store()
        with TemporaryDirectory() as directory:
            result = module.initialize_status(store, Path(directory))
            self.assertEqual(result['initialized'], 1)
            self.assertTrue(Path(result['backup']).is_file())
            self.assertEqual(rows[0]['STATUS'], 'PENDENTE')
            self.assertEqual(rows[0]['VALOR'], 123.45)
            self.assertTrue(rows[0]['Attachments'])
            self.assertEqual(rows[1]['STATUS'], 'CONCLUÍDO')
            self.assertEqual(module.initialize_status(store, Path(directory))['initialized'], 0)
            self.assertEqual(writes, [7])

    def test_etag_conflict_preserves_a_status_filled_after_preflight(self):
        store, rows, _ = self.store(conflict=True)
        with TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, '412'):
                module.initialize_status(store, Path(directory))
        self.assertEqual(rows[0]['STATUS'], 'REVISADO PELO USUÁRIO')

    def test_unknown_identity_or_missing_etag_blocks_all_writes(self):
        for change in ({'CHAVE': 'OUTRO'}, {'eTag': '*'}):
            store, rows, writes = self.store(); rows[0].update(change)
            with TemporaryDirectory() as directory:
                with self.assertRaises(ValueError): module.initialize_status(store, Path(directory))
            self.assertEqual(writes, [])


if __name__ == '__main__': unittest.main()
