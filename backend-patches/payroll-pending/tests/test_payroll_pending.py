"""Exercise report, full/partial application, legacy exclusion and write recovery."""
import unittest
from decimal import Decimal
from types import SimpleNamespace
from tempfile import TemporaryDirectory
from pathlib import Path

import requests

from payroll_pending import handle, has_unresolved_application, origin_write_lock, assert_legacy_origin_available


def launch(n, **fields):
    return {
        'ID': n, 'IDFOLHA': None, 'FORNECEDOR': 'Fornecedor da origem',
        'PRODUTO': 'Frete e material', 'TIPO TRANSAÇÃO': 'DESPESA',
        'DATA PGTO EFETUADO': '2026-11-10T03:00:00Z', 'QUANTIDADE': 3,
        'VALOR UNITÁRIO': '33,33', 'FRETE': '0,01', 'Modificado': '2026-11-10T22:15:00Z',
        'IDPGTOAGENDADO': None, 'DATA': '2026-11-05T12:00:00Z', **fields,
    }


def sheet(n, who, reference='11/2026', status='ATIVO'):
    return {'ID': n, 'FORNECEDOR': who, 'MESREFERENCIA': reference, 'STATUS': status}


class GalleryFault(ValueError):
    def __init__(self, code, text, status=400):
        super().__init__(text)
        self.code = code
        self.status = status


class Store:
    def __init__(self):
        self.rows = {}

    def load(self, key):
        return self.rows.get(key, (None, None))

    def save(self, key, record, tag):
        if self.load(key)[1] != tag:
            raise RuntimeError('Stale tag')
        tag = (tag or 0) + 1
        self.rows[key] = record, tag
        return tag


class Gallery:
    def __init__(self):
        self.db = {
            'LANCAMENTOS': [launch(17)], 'PROVISÃO PGTOS': [],
            'FOLHAPGTO': [], 'IDFOLHA': [sheet(41, 'Ana'), sheet(42, 'Beto')],
        }
        self.engine = SimpleNamespace(state_store=Store())
        self.site = SimpleNamespace(site_url='https://example.test/sites/finance', _request=self.request)
        self.sharepoint = self.site
        self.posts = []
        self.failure = None
        self.late_row = None

    def _field(self, name, label):
        mapping = {'DATA PGTO EFETUADO': 'field_4', 'TIPO TRANSAÇÃO': 'field_1'}
        kinds = {'IDPROVISAO': 'Number', 'DATA': 'DateTime'}
        return {'InternalName': mapping.get(label, label), 'TypeAsString': kinds.get(label, 'Text'),
                'Indexed': label == 'IDLANCAMENTO'}

    def _writable(self, field):
        return True

    def _rows(self, name, labels, query=None):
        rows = self.db[name]
        if query and query.startswith('IDLANCAMENTO eq '):
            rows = [i for i in rows if i.get('IDLANCAMENTO') == query.split("'")[1]]
        return [{**{label: row.get(label) for label in labels}, 'ID': row['ID']} for row in rows]

    def _get(self, name, item_id, labels):
        try:
            return next(row.copy() for row in self.db[name] if str(row['ID']) == item_id)
        except StopIteration:
            response = requests.Response()
            response.status_code = 404
            raise requests.HTTPError(response=response)

    def _amount(self, row):
        def decimal(value):
            return Decimal(str(value or 0).replace(',', '.'))
        return decimal(row['QUANTIDADE']) * decimal(row['VALOR UNITÁRIO']) + decimal(row['FRETE'])

    def _payroll_month(self, value):
        try:
            month, year = map(int, value.split('/'))
            return (year, month) if 1 <= month <= 12 else None
        except (ValueError, AttributeError):
            return None

    def _list_endpoint(self, name):
        return name

    def _required(self, name, fields):
        pass

    def request(self, method, endpoint, *, json, headers):
        assert (method, endpoint) == ('POST', 'FOLHAPGTO/items')
        self.posts.append(json.copy())
        row = dict(json, ID=100 + len(self.posts))
        if self.failure == 'lag':
            self.late_row = row
            raise requests.Timeout()
        if self.failure == 'rejected':
            response = requests.Response()
            response.status_code = 400
            raise requests.HTTPError(response=response)
        self.db['FOLHAPGTO'].append(row)
        if self.failure == 'lost':
            raise requests.Timeout()
        return {'Id': row['ID']}


class PendingPayrollTests(unittest.TestCase):
    def setUp(self):
        state_dir = TemporaryDirectory()
        self.addCleanup(state_dir.cleanup)
        self.g = Gallery()
        self.g.engine.state_store.directory = Path(state_dir.name)
        self.call = lambda op, payload=None: handle(self.g, op, payload if payload is not None else {})

    def row(self, origin='17'):
        return self.call('payroll_detail', {'id': origin})['item']

    def body(self, **changes):
        return dict(id='17', sheetId='41', mode='partial', amountCents=2011, revision=self.row()['revision'],
                    paymentType='SALÁRIO', requestId='0123456789abcde', confirm=True,
                    supplier='Ana', reference='11/2026') | changes

    def error(self, code, operation, payload):
        with self.assertRaises(ValueError) as error:
            self.call(operation, payload)
        self.assertEqual(getattr(error.exception, 'code', None), code)

    def test_paid_only_and_each_historical_link_path(self):
        self.g.db['LANCAMENTOS'].extend([
            launch(18, IDFOLHA=41), launch(19), launch(20), launch(21, IDPGTOAGENDADO='91'),
            launch(22, **{'DATA PGTO EFETUADO': None}),
            launch(23, **{'TIPO TRANSAÇÃO': 'RECEITA'}),
            launch(24, **{'QUANTIDADE': 0, 'FRETE': None}), launch(25), launch(26),
        ])
        self.g.db['PROVISÃO PGTOS'].extend([
            {'ID': 90, 'IDLANCAMENTOS': '20; 25', 'IDFOLHA': None},
            {'ID': 91, 'IDLANCAMENTOS': None, 'IDFOLHA': '41'},
            {'ID': 92, 'IDLANCAMENTOS': '26', 'IDFOLHA': '42'},
        ])
        self.g.db['FOLHAPGTO'].extend([
            {'ID': 51, 'IDLANCAMENTO': '19', 'IDFOLHA': '41', 'Title': 'old-posting'},
            {'ID': 52, 'IDPROVISAO': 90.0, 'IDFOLHA': '41', 'Title': 'old-provision'},
        ])
        page = self.call('payroll_pending')
        self.assertEqual([(i['id'], i['totalCents'], i['paidAt']) for i in page['items']], [('17', 10000, '2026-11-10')])
        self.assertEqual(page['total'], 1)
        self.assertEqual(self.g.posts, [])

    def test_partial_then_total_different_supplier(self):
        original = self.g.db['LANCAMENTOS'][0].copy()
        body = self.body()
        part = self.call('payroll_apply', body)['item']
        self.assertEqual(part['remainingCents'], 7989)
        self.assertEqual(self.row()['allocations'][0]['amountCents'], 2011)
        self.assertEqual(self.g.posts[0]['VALORUNITARIO'], '20.11')
        self.assertEqual(self.g.posts[0]['QTD'], '1')
        self.assertEqual(self.g.posts[0]['IDLANCAMENTO'], '17')
        done = self.call('payroll_apply', self.body(sheetId='42', supplier='Beto', mode='total', amountCents=None,
                                                     requestId='0123456789next1', paymentType='PREMIAÇÃO'))['item']
        self.assertEqual(done['remainingCents'], 0)
        self.assertEqual([(a['supplier'], a['sheetId'], a['amountCents']) for a in done['allocations']],
                         [('Ana', '41', 2011), ('Beto', '42', 7989)])
        self.assertEqual(self.row(), done)
        self.assertEqual(self.call('payroll_pending')['items'], [])
        self.assertEqual(self.call('payroll_apply', body)['item'], done)
        self.assertEqual(self.g.db['LANCAMENTOS'][0], original)
        self.assertEqual(len(self.g.posts), 2)

    def test_stale_confirmation_and_wrong_amount_do_not_write(self):
        stale = self.body(sheetId='42', supplier='Beto', requestId='0123456789next1')
        self.error('invalid_amount', 'payroll_apply', self.body(amountCents=10001))
        self.error('invalid_amount', 'payroll_apply', self.body(amountCents=True))
        self.error('confirmation_required', 'payroll_apply', self.body(confirm=False))
        self.error('invalid_payload', 'payroll_apply', self.body(paymentType='INVALID'))
        self.assertEqual(len(self.g.posts), 0)
        self.call('payroll_apply', self.body())
        self.error('conflict', 'payroll_apply', stale)
        self.assertEqual(len(self.g.posts), 1)

    def test_lists_only_valid_sheet_options_and_validates_again_on_write(self):
        self.g.db['IDFOLHA'].extend([sheet(43, 'Ana', '08/2026', ''), sheet(44, 'Cris', '11/2026', 'INATIVO'),
                                     sheet(45, 'Dani', 'sem referência'), sheet(46, '', '11/2026')])
        targets = self.call('payroll_targets')
        self.assertEqual(targets['items'], [{'supplier': 'Ana', 'sheets': [{'id': '41', 'reference': '11/2026'}, {'id': '43', 'reference': '08/2026'}]},
                                           {'supplier': 'Beto', 'sheets': [{'id': '42', 'reference': '11/2026'}]}])
        self.assertIn('SALÁRIO', targets['paymentTypes'])
        self.error('payroll_sheet_unavailable', 'payroll_apply', self.body(sheetId='44'))
        self.assertEqual(self.g.posts, [])

    def test_late_commit_blocks_other_request_and_replay_never_posts_twice(self):
        self.g.failure = 'lag'
        body = self.body()
        self.error('payroll_apply_uncertain', 'payroll_apply', body)
        self.assertTrue(has_unresolved_application(self.g, '17'))
        self.error('payroll_apply_uncertain', 'payroll_apply', self.body(requestId='another-request'))
        self.error('request_id_conflict', 'payroll_apply', body | {'amountCents': 3011})
        self.error('payroll_apply_uncertain', 'payroll_apply', body)
        self.assertEqual(len(self.g.posts), 1)
        self.g.db['FOLHAPGTO'].append(self.g.late_row)
        self.assertEqual(self.call('payroll_apply', body)['item']['remainingCents'], 7989)
        self.assertFalse(has_unresolved_application(self.g, '17'))
        self.assertEqual(len(self.g.posts), 1)

    def test_lost_response_is_confirmed_via_the_exact_linked_row(self):
        self.g.failure = 'lost'
        self.assertEqual(self.call('payroll_apply', self.body())['item']['remainingCents'], 7989)
        self.assertFalse(has_unresolved_application(self.g, '17'))
        self.assertEqual(len(self.g.posts), 1)

    def test_stale_collection_and_temporarily_invisible_committed_row_cannot_overallocate(self):
        old = self.body(mode='total', amountCents=None, requestId='switched-request')
        self.call('payroll_apply', self.body())
        original = self.g._rows
        suppress_exact = False
        def lagging_sharepoint(name, labels, query=None):
            if name == 'FOLHAPGTO' and (not query or suppress_exact):
                return []
            return original(name, labels, query)
        self.g._rows = lagging_sharepoint
        self.assertEqual(self.row()['remainingCents'],7989)
        self.error('conflict', 'payroll_apply', old)
        suppress_exact = True
        self.error('payroll_apply_uncertain', 'payroll_apply', old)
        self.assertEqual(len(self.g.posts),1)

    def test_selected_sheet_changed_owner_or_reference(self):
        data = self.body()
        self.g.db['IDFOLHA'][0]['FORNECEDOR'] = 'Outro fornecedor'
        self.error('payroll_sheet_unavailable', 'payroll_apply', data)
        self.g.db['IDFOLHA'][0].update({'FORNECEDOR': 'Ana', 'MESREFERENCIA': '12/2026'})
        self.error('payroll_sheet_unavailable', 'payroll_apply', data)
        self.assertEqual(self.g.posts, [])

    def test_worker_lock_and_existing_allocations_prevent_legacy_full_payment(self):
        data = self.body()
        with origin_write_lock(self.g, '17'):
            self.error('conflict', 'payroll_apply', data)
        self.assertEqual(self.g.posts, [])
        assert_legacy_origin_available(self.g, '17')
        self.call('payroll_apply', data)
        with self.assertRaisesRegex(ValueError, 'aplicações'):
            assert_legacy_origin_available(self.g, '17')

    def test_known_rejection_releases_reservation(self):
        self.g.failure = 'rejected'
        self.error('payroll_write_rejected', 'payroll_apply', self.body())
        self.assertFalse(has_unresolved_application(self.g, '17'))
        self.g.failure = None
        self.assertEqual(self.call('payroll_apply', self.body())['item']['remainingCents'], 7989)

    def test_legacy_gallery_write_reads_amount_and_shares_the_origin_reservation(self):
        request = dict(Title='APP-folha-vinculo-operation1', IDLANCAMENTO='17', IDFOLHA='41',
                       FORNECEDOR='Ana', TIPOPGTO='SALÁRIO', VALORUNITARIO='33,33',
                       QTD=3, DATA='2026-11-05')
        self.g.db['LANCAMENTOS'][0]['FORNECEDOR'] = 'Ana'
        self.error('conflict', 'payroll_legacy_link', {'fields': request | {'QTD': 4}})
        self.assertFalse(has_unresolved_application(self.g,'17'))
        self.assertEqual(len(self.g.posts), 0)
        self.assertEqual(self.call('payroll_legacy_link', {'fields': request}), {'id':'101'})
        self.assertEqual(self.call('payroll_legacy_link', {'fields': request}), {'id':'101'})
        self.assertEqual(len(self.g.posts), 1)
        self.assertEqual(self.call('payroll_pending')['total'], 0)

    def test_legacy_gallery_write_cannot_double_count_after_report_allocation(self):
        self.call('payroll_apply', self.body())
        request = dict(Title='APP-folha-vinculo-operation1', IDLANCAMENTO='17', IDFOLHA='41',
                       FORNECEDOR='Ana', TIPOPGTO='SALÁRIO', VALORUNITARIO='33,33',
                       QTD=3, DATA='2026-11-05')
        self.error('payroll_allocation_locked', 'payroll_legacy_link', {'fields':request})
        self.assertEqual(len(self.g.posts), 1)

    def test_range_and_single_item_sharepoint_numeric_representations_match(self):
        original_rows = self.g._rows
        def rest_collection(name, fields, query=None):
            rows = original_rows(name, fields, query)
            if name == 'LANCAMENTOS':
                for row in rows:
                    row['QUANTIDADE'] = 3.0
                    row['VALOR UNITÁRIO'] = 33.33
            return rows
        self.g._rows = rest_collection
        self.assertEqual(self.call('payroll_pending')['items'][0]['revision'], self.row()['revision'])

    def test_uncertain_legacy_write_prevents_new_partial_until_confirmed(self):
        from payroll_pending import legacy_origin_write
        data = self.body()
        with self.assertRaises(requests.Timeout):
            with legacy_origin_write(self.g, '17', 'legacy-payroll'):
                raise requests.Timeout()
        self.error('payroll_apply_uncertain', 'payroll_apply', data)
        with self.assertRaisesRegex(ValueError, 'confer'):
            with legacy_origin_write(self.g, '17', 'legacy-payroll'):
                self.fail('must not POST again before visibility')
        self.g.db['FOLHAPGTO'].append({'ID': 88, 'Title':'legacy-payroll','IDLANCAMENTO':'17','IDFOLHA':'41'})
        with legacy_origin_write(self.g, '17', 'legacy-payroll'):
            pass
        self.error('payroll_not_pending', 'payroll_apply', data)
        self.assertFalse(has_unresolved_application(self.g,'17'))

    def test_pagination_is_complete_and_clamps_when_last_page_finishes(self):
        self.g.db['LANCAMENTOS'] = [launch(n) for n in range(1, 41)]
        first = self.call('payroll_pending', {'page': 1})
        last = self.call('payroll_pending', {'page': 99})
        self.assertEqual(first['page'], 1)
        self.assertEqual(last['page'], 2)
        self.assertEqual(first['total'], 40)
        self.assertEqual([int(i['id']) for i in first['items'] + last['items']], list(range(40, 0, -1)))


if __name__ == '__main__':
    unittest.main()
