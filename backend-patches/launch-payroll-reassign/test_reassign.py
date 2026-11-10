"""Launch edit contract against the real gallery and a simulated SharePoint boundary."""
import os
from pathlib import Path
import re
import sys
from types import SimpleNamespace
import unittest

import requests

source = Path(os.environ['GALLERY_SOURCE']).resolve()
fixture = Path(os.environ.get('GALLERY_FIXTURES', str(source / 'tests'))).resolve()
sys.path[:0] = [str(source / 'worker'), str(fixture)]
from launch_gallery import LaunchGalleryError, LaunchGalleryService
from test_launch_gallery import SharePoint, base_fields, field, mutation


class PayrollSharePoint(SharePoint):
    def __init__(self):
        super().__init__()
        self.schemas['LANCAMENTOS'].append(field('IDFOLHA', kind='Number'))
        self.schemas['FOLHAPGTO'] = base_fields() + [field(n) for n in
            ('FORNECEDOR', 'IDFOLHA', 'IDLANCAMENTO', 'QTD', 'VALORUNITARIO', 'TIPOPGTO')]
        self.schemas['IDFOLHA'] = base_fields() + [field(n) for n in
            ('FORNECEDOR', 'MESREFERENCIA', 'STATUS')]
        self.rows['FOLHAPGTO'] = [
            dict(Id=505, IDLANCAMENTO='1', FORNECEDOR="D'ÁGUA", IDFOLHA='41',
                 QTD='3', VALORUNITARIO='137', TIPOPGTO='SALÁRIO', Attachments=True),
            dict(Id=506, IDLANCAMENTO='11', FORNECEDOR="D'ÁGUA", IDFOLHA='41'),
        ]
        self.rows['IDFOLHA'] = [
            dict(Id=41, FORNECEDOR="D'ÁGUA", MESREFERENCIA='11/2025', STATUS='ATIVO'),
            dict(Id=62, FORNECEDOR='OUTRO', MESREFERENCIA='10/2025', STATUS='ATIVO'),
            dict(Id=73, FORNECEDOR='OUTRO', MESREFERENCIA='11/2025', STATUS='ATIVO'),
        ]
        self.files[505] = {'recibo.pdf': b'original'}
        self.tags = {}
        self.conflict = None
        self.lose_response = None
        self.concurrent_payroll_edit = False

    def _request(self, method, endpoint, **kw):
        name, item = re.search(r"GetByTitle\('([^']+)'\)(?:/items\((\d+)\))?", endpoint).groups()
        key = name, item
        tag = self.tags.get(key, 1)
        if method == 'POST' and item:
            if key == self.conflict == ('LANCAMENTOS', '1') and self.concurrent_payroll_edit:
                self.rows['FOLHAPGTO'][0]['QTD'] = '4'
                self.tags['FOLHAPGTO', '505'] += 1
            if key == self.conflict or kw['headers']['IF-MATCH'] != f'"{tag}"':
                self.error(412)
            kw['headers'] = kw['headers'] | {'IF-MATCH': '"1"'}
        result = super()._request(method, endpoint, **kw)
        if method == 'GET' and item:
            result['odata.etag'] = f'"{tag}"'
        if method == 'POST' and item:
            self.tags[key] = tag + 1
            if key == self.lose_response:
                raise requests.Timeout('ambiguous write')
        # Model SharePoint's exact indexed equality before list pagination for this fixture.
        query = (kw.get('params') or {}).get('$filter', '')
        match = re.fullmatch(r"IDLANCAMENTO eq '(\d+)'", query)
        if match:
            result['value'] = [r.copy() for r in self.rows[name] if r['IDLANCAMENTO'] == match[1]]
            result.pop('@odata.nextLink', None)
        return result


class PayrollTransferTests(unittest.TestCase):
    def setUp(self):
        self.sp = PayrollSharePoint()
        self.service = LaunchGalleryService(SimpleNamespace(sharepoint=self.sp))
        self.launch, self.line = self.sp.rows['LANCAMENTOS'][0], self.sp.rows['FOLHAPGTO'][0]

    def transfer(self):
        return self.service.handle('update', mutation(fields={'FORNECEDOR': 'OUTRO'}))

    def test_moves_existing_line_to_destination_in_same_reference_month(self):
        assert self.transfer()['ok']
        assert (self.launch['field_5'], self.launch.get('IDFOLHA')) == ('OUTRO', 73)
        assert self.line == dict(Id=505, IDLANCAMENTO='1', FORNECEDOR='OUTRO', IDFOLHA='73',
                                 QTD='3', VALORUNITARIO='137', TIPOPGTO='SALÁRIO', Attachments=True,
                                 Modified='2026-09-19T11:00:00Z')
        assert self.sp.files[505] == {'recibo.pdf': b'original'}
        assert self.sp.rows['FOLHAPGTO'][1]['IDFOLHA'] == '41'

    def test_no_link_saves_normally_without_assigning_payroll(self):
        self.sp.rows['FOLHAPGTO'].remove(self.line)
        assert self.transfer()['ok']
        assert self.launch['field_5'] == 'OUTRO' and self.launch.get('IDFOLHA') is None

    def test_an_unrelated_launch_edit_does_not_access_payroll(self):
        assert self.service.handle('update', mutation(fields={'NOTA': '123'}))['ok']
        assert not any('FOLHAPGTO' in endpoint or 'IDFOLHA' in endpoint for _, endpoint, _ in self.sp.calls)

    def test_missing_destination_blocks_both_writes(self):
        self.sp.rows['IDFOLHA'].pop()
        with self.assertRaises(LaunchGalleryError):
            self.transfer()
        assert not self.sp.mutations

    def test_duplicate_destination_blocks_both_writes(self):
        self.sp.rows['IDFOLHA'].append(self.sp.rows['IDFOLHA'][-1] | {'Id': 74})
        with self.assertRaises(LaunchGalleryError):
            self.transfer()
        assert not self.sp.mutations

    def test_stale_launch_during_write_restores_payroll_line(self):
        self.sp.conflict = 'LANCAMENTOS', '1'
        with self.assertRaises(LaunchGalleryError):
            self.transfer()
        assert self.launch['field_5'] == "D'ÁGUA"
        assert (self.line['FORNECEDOR'], self.line['IDFOLHA']) == ("D'ÁGUA", '41')
        assert self.sp.tags.get(('FOLHAPGTO', '505')) == 3  # Applied, then restored using the new ETag.

    def test_payroll_version_conflict_leaves_both_records_unchanged(self):
        self.sp.conflict = 'FOLHAPGTO', '505'
        with self.assertRaises(LaunchGalleryError) as error:
            self.transfer()
        assert error.exception.code == 'conflict'
        assert not self.sp.mutations

    def test_compensation_does_not_overwrite_a_concurrent_payroll_edit(self):
        self.sp.conflict = 'LANCAMENTOS', '1'
        self.sp.concurrent_payroll_edit = True
        with self.assertRaises(LaunchGalleryError) as error:
            self.transfer()
        assert error.exception.code == 'payroll_reassignment_unverified'
        assert (self.line['FORNECEDOR'], self.line['IDFOLHA'], self.line['QTD']) == ('OUTRO', '73', '4')
        assert self.launch['field_5'] == "D'ÁGUA"

    def test_two_payroll_competencies_keep_their_separate_months(self):
        self.sp.rows['IDFOLHA'].append(dict(Id=40, FORNECEDOR="D'ÁGUA", MESREFERENCIA='10/2025'))
        second = dict(Id=507, FORNECEDOR="D'ÁGUA", IDLANCAMENTO='1', IDFOLHA='40')
        self.sp.rows['FOLHAPGTO'].append(second)
        assert self.transfer()['ok']
        assert (self.line['IDFOLHA'], second['IDFOLHA']) == ('73', '62')
        assert self.launch.get('IDFOLHA') is None

    def test_response_lost_after_launch_commit_does_not_undo_payroll(self):
        self.sp.lose_response = 'LANCAMENTOS', '1'
        assert self.transfer()['ok']
        assert self.launch['field_5'] == self.line['FORNECEDOR'] == 'OUTRO'
        assert self.line['IDFOLHA'] == '73'

    def test_response_lost_after_payroll_commit_is_read_back(self):
        self.sp.lose_response = 'FOLHAPGTO', '505'
        assert self.transfer()['ok']
        assert self.launch['field_5'] == self.line['FORNECEDOR'] == 'OUTRO'

    def test_resume_when_payroll_already_moved(self):
        self.line.update(FORNECEDOR='OUTRO', IDFOLHA='73')
        assert self.transfer()['ok']
        assert self.launch.get('IDFOLHA') == 73
        assert ('FOLHAPGTO', '505') not in self.sp.tags

    def test_disagreement_in_payroll_owner_blocks_write(self):
        self.line['FORNECEDOR'] = 'TERCEIRA PESSOA'
        with self.assertRaises(LaunchGalleryError):
            self.transfer()
        assert not self.sp.mutations

    def test_launch_with_direct_sheet_and_no_payroll_line_moves_sheet(self):
        self.sp.rows['FOLHAPGTO'].remove(self.line)
        self.launch['IDFOLHA'] = 41
        assert self.transfer()['ok']
        assert (self.launch['field_5'], self.launch['IDFOLHA']) == ('OUTRO', 73)


if __name__ == '__main__':
    unittest.main()
