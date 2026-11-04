"""Real workflow and attachment reader; in-memory external SharePoint boundary."""
import copy
import hashlib
from io import BytesIO
import re
import unittest
from urllib.parse import unquote

from workflow import WorkflowEngine


class Response(BytesIO):
    @property
    def content(self):
        return self.getvalue()

    def iter_content(self, size):
        while chunk := self.read(size):
            yield chunk


class SharePoint:
    site_url = 'https://synthetic.invalid/site'

    def __init__(self):
        self.files = {}
        self.items = {}
        self.tokens = {}
        self.versions = {}
        self.uploads = []
        self.fail_name = None
        self.lost_response = False
        self.on_upload = None
        self.invalid_target = False

    def _list_endpoint(self, kind):
        return 'lists/' + kind

    def _request(self, method, endpoint, **kwargs):
        assert method == 'GET'
        kind, number = re.search(r'lists/(.*)/items\((\d+)\)', endpoint).groups()
        files = self.files.setdefault((kind, int(number)), {})
        if '/getByFileName(' in endpoint:
            name = unquote(endpoint.split("getByFileName('")[1].split("')")[0]).replace("''", "'")
            return Response(files[name])
        names = sorted(files)
        # Two pages prove the real reader follows the complete collection.
        if len(names) > 2 and not kwargs.get('params') is None:
            return {'value': [{'FileName': n} for n in names[:2]], '@odata.nextLink': endpoint + '?page=2'}
        if '?page=2' in endpoint:
            names = names[2:]
        return {'value': [{'FileName': n} for n in names]}

    def get_item_fields_with_etag(self, number, fields, target_list):
        key = target_list, number
        return {n: self.items[key].get(n) for n in fields}, self.versions.get(key, '1')

    def ensure_item(self, token, fields, target_list, **kwargs):
        if token not in self.tokens:
            self.tokens[token] = 700 + len(self.tokens)
            self.items[target_list, self.tokens[token]] = copy.deepcopy(fields)
        return self.tokens[token]

    def verify_item(self, number, fields, attachments, target_list):
        actual = self.items[target_list, number]
        return {'fields': not self.invalid_target and all(str(actual.get(k)) == str(v) for k, v in fields.items()),
                'attachments': all(n in self.files.get((target_list, number), {}) for n in attachments)}

    def _ensure_attachment_local(self, number, name, content, target_list):
        if name == self.fail_name:
            self.fail_name = None
            raise RuntimeError('synthetic upload outage')
        self.files.setdefault((target_list, number), {}).setdefault(name, content)
        self.uploads.append((target_list, number, name))
        if self.on_upload:
            self.on_upload()
        if self.lost_response:
            self.lost_response = False
            raise RuntimeError('synthetic lost response after commit')


class LaunchPayrollAttachmentTests(unittest.TestCase):
    def setUp(self):
        self.client = SharePoint()
        self.engine = WorkflowEngine.__new__(WorkflowEngine)
        self.engine.sharepoint = self.client
        self.state = {'batch_id': 'synthetic-attachments', 'sharepoint': {}}
        self.entry = self.launch(901, {'a.pdf': b'alpha', 'b.jpg': b'beta', 'c.txt': b'gamma'})

    def launch(self, identifier, files):
        entry = {'item_id': identifier, 'IDFOLHA': 31,
                 'fields': {'FORNECEDOR': 'FORNECEDOR TESTE', 'FILIAL': 'FILIAL TESTE',
                            'VALOR UNITÁRIO': '10', 'QUANTIDADE': '2', 'DATA': '2026-11-04'}}
        self.client.items['LANCAMENTOS', identifier] = copy.deepcopy(entry['fields'])
        self.client.files['LANCAMENTOS', identifier] = dict(files)
        return entry

    def submit(self, entry=None):
        self.engine._record_launch_payroll_type(self.state, entry or self.entry, 'SALÁRIO')
        return (entry or self.entry)['FOLHAPGTO_ID']

    def destination(self, identifier):
        return self.client.files.get(('FOLHAPGTO', identifier), {})

    def test_three_and_four_files_keep_exact_one_per_source_on_own_row(self):
        second = self.launch(902, {'d.pdf': b'd', 'e.pdf': b'e', 'f.jpg': b'f', 'g.txt': b'g'})
        first_id, second_id = self.submit(), self.submit(second)
        self.assertNotEqual(first_id, second_id)
        self.assertEqual(self.destination(first_id), {'a.pdf': b'alpha', 'b.jpg': b'beta', 'c.txt': b'gamma'})
        self.assertEqual(self.destination(second_id), {'d.pdf': b'd', 'e.pdf': b'e', 'f.jpg': b'f', 'g.txt': b'g'})
        self.assertEqual(len(self.client.uploads), 7)

    def test_equal_bytes_with_different_names_remain_two_attachments(self):
        self.client.files['LANCAMENTOS', 901] = {'one.pdf': b'same', 'two.pdf': b'same'}
        self.assertEqual(self.destination(self.submit()), {'one.pdf': b'same', 'two.pdf': b'same'})

    def test_partial_failure_retries_same_row_without_duplicate_uploads(self):
        self.client.fail_name = 'b.jpg'
        with self.assertRaises(RuntimeError):
            self.submit()
        self.assertNotIn('FOLHAPGTO_ID', self.entry)
        self.assertFalse(self.state['sharepoint'].get('folhapgto_rows'))
        self.assertEqual(self.destination(700), {'a.pdf': b'alpha'})
        self.assertEqual(len(self.client.tokens), 1)
        self.assertEqual(len(self.destination(self.submit())), 3)
        self.assertEqual(len(self.client.uploads), 3)
        self.assertEqual(len(self.client.tokens), 1)

    def test_lost_upload_response_is_recovered_by_readback(self):
        self.client.lost_response = True
        self.assertEqual(len(self.destination(self.submit())), 3)
        self.assertEqual(len(self.client.uploads), 3)

    def test_collision_preserves_existing_file_and_retries_stably(self):
        self.client.files['FOLHAPGTO', 700] = {'a.pdf': b'unrelated'}
        identifier = self.submit()
        self.submit()
        files = self.destination(identifier)
        self.assertEqual(files['a.pdf'], b'unrelated')
        self.assertEqual(sorted(files.values()), sorted([b'unrelated', b'alpha', b'beta', b'gamma']))
        self.assertEqual(len(self.client.uploads), 3)

    def test_source_name_cannot_claim_another_source_reserved_destination(self):
        name_hash = hashlib.sha256(b'a.pdf').hexdigest()[:16]
        content_hash = hashlib.sha256(b'alpha').hexdigest()
        reserved = f'LANC-901-{name_hash}-{content_hash}-a.pdf'
        self.client.files['LANCAMENTOS', 901] = {'a.pdf': b'alpha', reserved: b'alpha'}
        self.client.files['FOLHAPGTO', 700] = {'a.pdf': b'unrelated'}
        identifier = self.submit()
        self.submit()
        files = self.destination(identifier)
        self.assertEqual(sorted(files.values()), [b'alpha', b'alpha', b'unrelated'])
        self.assertEqual(files[reserved], b'alpha')
        self.assertEqual(len(self.client.uploads), 2)
        receipt = self.state['sharepoint']['folhapgto_rows'][-1]['attachments']
        self.assertEqual(len({row['name'] for row in receipt}), 2)

    def test_empty_source_still_verifies_and_completes(self):
        self.client.files['LANCAMENTOS', 901] = {}
        self.assertEqual(self.destination(self.submit()), {})
        self.assertEqual(len(self.client.tokens), 1)

    def test_target_link_mismatch_does_not_upload_or_checkpoint(self):
        self.client.invalid_target = True
        with self.assertRaises(RuntimeError):
            self.submit()
        self.assertFalse(self.client.uploads)
        self.assertNotIn('FOLHAPGTO_ID', self.entry)

    def test_wrong_source_supplier_does_not_upload_or_checkpoint(self):
        self.client.items['LANCAMENTOS', 901]['FORNECEDOR'] = 'OUTRO FORNECEDOR'
        with self.assertRaises(RuntimeError):
            self.submit()
        self.assertFalse(self.client.uploads)
        self.assertNotIn('FOLHAPGTO_ID', self.entry)

    def test_source_collection_changed_during_copy_cannot_complete(self):
        self.client.on_upload = lambda: self.client.files['LANCAMENTOS', 901].update({'new.pdf': b'new'})
        with self.assertRaises(RuntimeError):
            self.submit()
        self.assertNotIn('FOLHAPGTO_ID', self.entry)
        self.client.on_upload = None
        self.assertEqual(len(self.destination(self.submit())), 4)

    def test_settlement_uses_actual_launch_not_provision_id(self):
        self.entry.update(item_id=11, provision_id=11, launch_id=901)
        self.client.files['LANCAMENTOS', 11] = {'wrong.pdf': b'wrong'}
        self.assertEqual(len(self.destination(self.submit())), 3)
        self.assertNotIn('wrong.pdf', self.destination(700))
        self.assertEqual(self.client.items['FOLHAPGTO', 700]['IDLANCAMENTO'], 901)

    def test_settlement_without_launch_does_not_read_provision_number_as_launch(self):
        self.entry.update(item_id=11, provision_id=11)
        self.assertEqual(self.destination(self.submit()), {})
        self.assertNotIn('IDLANCAMENTO', self.client.items['FOLHAPGTO', 700])


if __name__ == '__main__':
    unittest.main(verbosity=2)
