"""Settlement copies must coexist with the original-name SharePoint copier."""
import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'payroll-row-attachments' / 'tests'))
from test_propagation import Fixture, CHILD


class OriginalNameTests(unittest.TestCase):
    def test_three_and_four_files_stay_unique_after_original_name_copy(self):
        for count in (3, 4):
            with self.subTest(count=count):
                f = Fixture(grouped=False)
                originals = {f'document-{i}.pdf': f'content-{i}'.encode() for i in range(count)}
                f.client.files[CHILD, 11] = originals.copy()
                self.assertEqual(f.commit()['status'], 'completed')
                for kind, ident in (('LANCAMENTOS', f.launch(11)), ('NOTASPENDENTES', f.order())):
                    # The second integration uses SharePoint source filenames.
                    for name, content in originals.items():
                        f.client._ensure_attachment_local(int(ident), name, content, target_list=kind)
                    files = f.files_for(kind, ident)
                    self.assertEqual(len(files), count)
                    self.assertEqual(files, originals)
                self.assertEqual(f.commit()['status'], 'completed')
                self.assertEqual(len(f.files_for('LANCAMENTOS', f.launch(11))), count)

    def test_same_name_different_child_content_is_preserved(self):
        from payroll_row_attachments import propagate
        f = Fixture(grouped=False)
        f.existing(11, 501, 500)
        f.existing(12, 502, 500)
        for child in (11, 12):
            propagate(f.client, child, f.client.items[CHILD, child], {})
        order = f.files_for('NOTASPENDENTES', f.order())
        self.assertEqual(order['proof.pdf'], b'11')
        self.assertEqual(len(order), 2)
        self.assertEqual(set(order.values()), {b'11', b'12'})
        self.assertEqual(f.files_for('LANCAMENTOS', f.launch(12)), {'proof.pdf': b'12'})

    def test_parent_receipt_keeps_carrier_name_at_settlement(self):
        f = Fixture(grouped=False)
        f.client.files[CHILD, 11] = {'DESC-7-existing-receipt.pdf': b'receipt'}
        self.assertEqual(f.commit()['status'], 'completed')
        self.assertEqual(f.files_for('LANCAMENTOS', f.launch(11)),
                         {'DESC-7-existing-receipt.pdf': b'receipt'})

    def test_legacy_hashed_copy_is_reused_without_an_extra_upload(self):
        f = Fixture(grouped=False)
        f.client.files['LANCAMENTOS', 501] = {'PROV-11-legacy.pdf': b'11'}
        self.assertEqual(f.commit()['status'], 'completed')
        self.assertEqual(f.files_for('LANCAMENTOS', f.launch(11)), {'PROV-11-legacy.pdf': b'11'})

    def test_source_filename_survives_real_upload_url_preparation(self):
        import re
        from urllib.parse import unquote, urlsplit
        import requests
        from clients import SharePointClient
        client = SharePointClient.__new__(SharePointClient)
        client.target_list = 'LANCAMENTOS'
        client._list_endpoint = lambda kind: "https://synthetic.invalid/_api/list"
        files = {}
        client._attachment_names_with_retry = lambda *a, **kw: set(files)
        def request(method, endpoint, **kwargs):
            prepared = requests.Request(method, endpoint, data=kwargs['data']).prepare()
            path = unquote(urlsplit(prepared.url).path)
            match = re.search(r"AttachmentFiles/add\(FileName='(.*)'\)$", path)
            self.assertIsNotNone(match, prepared.url)
            files[match[1].replace("''", "'")] = kwargs['data']
        client._request = request
        name = "nota #1%? d'agua.pdf"
        client._ensure_attachment_local(1, name, b'proof')
        self.assertEqual(files, {name: b'proof'})


if __name__ == '__main__':
    unittest.main()
