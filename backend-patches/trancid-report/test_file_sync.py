"""Publication contracts; external SharePoint transport is the only fake."""
import hashlib
import json
from pathlib import Path
import re
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from file_sync import publish_database
from monitor import Monitor
from test_monitor import payload


class PrivateDrive:
    host = 'example-my.sharepoint.com'
    folder = '/personal/test/Documents/TRANCID'

    def __init__(self, corrupt=None):
        self.files = {}
        self.corrupt = corrupt

    def _request(self, method, endpoint, **kwargs):
        if (method, endpoint) == ('GET', 'v2.0/drive'):
            return {'webUrl': 'https://' + self.host + '/personal/test/Documents'}
        if method == 'GET' and endpoint == "web/GetFolderByServerRelativeUrl('" + self.folder + "')":
            return {'Name': 'TRANCID'}
        upload = re.search(r"/Files/add\(url='([^']+)',overwrite=true\)$", endpoint)
        if method == 'POST' and upload:
            self.files[upload[1]] = kwargs['data']
            return {}
        download = re.fullmatch(r"web/GetFileByServerRelativeUrl\('" + re.escape(self.folder) + r"/([^']+)'\)/\$value", endpoint)
        if method == 'GET' and download and kwargs.get('_return_response'):
            name = download[1]
            return SimpleNamespace(content=b'corrupted' if name == self.corrupt else self.files[name])
        raise AssertionError('Unexpected SharePoint operation: ' + method + ' ' + endpoint)


class FileSyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.monitor = Monitor(Path(self.tmp.name) / 'db.sqlite3')
        self.drive = PrivateDrive()
        initial = payload()
        for index, row in enumerate(initial['balances']):
            row['employee'] = 'PESSOA FICTÍCIA ' + str(index + 1)
        self.monitor.ingest(initial)

    def tearDown(self):
        self.monitor.close()
        self.tmp.cleanup()

    def publish(self):
        with patch('file_sync.client_from_environment', return_value=self.drive):
            return publish_database(self.monitor)

    def snapshot(self):
        self.assertIn('report_snapshot.json', self.drive.files.keys())
        return json.loads(self.drive.files['report_snapshot.json'])

    def test_combined_file_preserves_financial_rows_unchanged_days_and_errors(self):
        self.monitor.ingest(payload('2026-11-08'))
        self.monitor.ingest(payload('2026-11-09', {'06850000084216': '0,00'}))
        self.monitor.failure('2026-11-10', 'Consulta indisponível', '2026-11-10T18:02:00-03:00')
        self.monitor.mark_published('positions', 1, 71)
        result = self.publish()
        snapshot = self.snapshot()
        self.assertEqual(set(snapshot), {'schema_version', 'currency', 'money_unit', 'positions', 'runs'})
        self.assertEqual((snapshot['schema_version'], snapshot['currency'], snapshot['money_unit']), (1, 'BRL', 'centavos'))
        self.assertEqual(len(snapshot['positions']), 5)
        self.assertEqual(len(snapshot['runs']), 4)
        self.assertEqual(snapshot['positions'][0]['employee'], 'PESSOA FICTÍCIA 1')
        self.assertIsNone(snapshot['positions'][0]['previous_cents'])
        self.assertIsNone(snapshot['positions'][0]['delta_cents'])
        self.assertEqual([(p['balance_cents'], p['delta_cents']) for p in snapshot['positions']],
                         [(550, None), (2200, None), (2750, None), (3850, None), (0, -550)])
        self.assertEqual(snapshot['runs'][1]['inserted'], 0)
        self.assertEqual(json.loads(snapshot['runs'][1]['snapshot'])['checked_at'], '2026-11-08T18:02:00-03:00')
        self.assertEqual(snapshot['runs'][-1]['error'], 'Consulta indisponível')
        self.assertEqual(snapshot['runs'][-1]['status'], 'error')
        for row in snapshot['positions'] + snapshot['runs']:
            self.assertNotIn('sharepoint_id', row)
        expected_files = {'report_snapshot.json', 'posicoes.json', 'consultas.json', 'trancid.sqlite3', 'Relatorio_cartoes_Trancid.pdf'}
        self.assertEqual(set(self.drive.files), expected_files)
        self.assertEqual({f['file'] for f in result['files']}, expected_files)
        self.assertEqual((result['positions'], result['runs']), (5, 4))
        published_hash = next(f['sha256'] for f in result['files'] if f['file'] == 'report_snapshot.json')
        self.assertEqual(published_hash, hashlib.sha256(self.drive.files['report_snapshot.json']).hexdigest())

    def test_snapshot_keeps_one_database_revision_during_concurrent_writer(self):
        self.monitor.db.execute('PRAGMA journal_mode=WAL')
        writer = Monitor(self.monitor.path)
        committed = []

        def insert_between_reads(sql):
            if not committed and sql.upper().startswith('SELECT * FROM RUNS'):
                committed.append(writer.ingest(payload('2026-11-08', {'06850000084216': '0,00'})))

        self.monitor.db.set_trace_callback(insert_between_reads)
        try:
            self.publish()
            snapshot = self.snapshot()
            self.assertEqual(len(committed), 1)
            self.assertEqual(len(snapshot['positions']), 4)
            self.assertEqual(len(snapshot['runs']), 1)
            self.assertEqual(snapshot['runs'][0]['inserted'], 4)
            self.assertEqual(len(writer.positions()), 5)
            self.assertEqual(len(writer.runs()), 2)
            self.assertFalse(self.monitor.db.in_transaction)
        finally:
            self.monitor.db.set_trace_callback(None)
            writer.close()

    def test_combined_file_readback_mismatch_rejects_publication(self):
        self.drive.corrupt = 'report_snapshot.json'
        with self.assertRaisesRegex(ValueError, 'report_snapshot.json'):
            self.publish()


if __name__ == '__main__':
    unittest.main()
