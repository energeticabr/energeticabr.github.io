import importlib.util
import json
from pathlib import Path
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'rhid_badge_source.py'
spec = importlib.util.spec_from_file_location('rhid_badge_source', SOURCE) if SOURCE.exists() else None
module = importlib.util.module_from_spec(spec) if spec else None
if spec:
    spec.loader.exec_module(module)

DAY = '2026-10-05'
def punch(pis, time='07:00', day=DAY, nsr=1):
    return f'{nsr:09d}3{day}T{time}:00-0300{pis:012d}0000'
HEADER = ('0000000001' + ' ' * 196 + DAY + DAY).ljust(302)
def footer(records=()):
    return '999999999' + ''.join(f'{sum(line[9] == kind for line in records):09d}' for kind in '234567') + '9'
FOOTER = footer()
def afd(*records):
    return '\r\n'.join([HEADER, *records, footer(records), 'ASSINATURA_DIGITAL_EM_ARQUIVO_P7S'.ljust(100)])

class Response:
    def __init__(self, data=None, status=200, text=None):
        self.status_code = status
        self._data = data
        self.text = json.dumps(data) if text is None else text
    def json(self):
        if self._data is None:
            raise ValueError('not JSON')
        return self._data

class Transport:
    def __init__(self, pages=None, afd=None):
        self.calls = []
        self.pages = pages or [Response({'totalRecords': 1, 'records': [
            {'id': 1, 'name': 'ANA', 'pis': 123, 'cpf': 'private', 'password': 'private', 'templates': ['private']},
        ]})]
        self.afd = afd or Response(HEADER + '\n' + FOOTER)
    def post(self, url, **kwargs):
        self.calls.append(('POST', url, kwargs))
        return Response({'accessToken': 'test-token'})
    def get(self, url, **kwargs):
        self.calls.append(('GET', url, kwargs))
        return self.pages[min(sum(1 for method, path, _ in self.calls if path.endswith('/person')) - 1, len(self.pages) - 1)] if url.endswith('/person') else self.afd

class RhidSourceTests(unittest.TestCase):
    def source(self, transport=None, now=None):
        self.assertIsNotNone(module, 'the read-only RHID badge source is missing')
        self.assertTrue(hasattr(module, 'RhidBadgeSource'), 'RHID source API is missing')
        self.transport = transport or Transport()
        return module.RhidBadgeSource({'email': 'test@example.com', 'password': 'test-secret', 'system': 'rhid'},
                                      transport=self.transport, clock=now or (lambda: 1000.0))

    def test_complete_registration_exposes_only_id_and_name(self):
        report = self.source().get_report(DAY)
        self.assertEqual(report['date'], DAY)
        self.assertEqual(report['registration']['people'], [{'id': '1', 'name': 'ANA'}])
        self.assertTrue(report['registration']['complete'])
        self.assertNotIn('private', json.dumps(report))
        self.assertNotIn('test-secret', json.dumps(report))
        self.assertNotIn('test-token', json.dumps(report))
        self.assertEqual(report['rows'][0]['BATIDAS_RHID'], [])
        self.assertEqual(report['rows'][0]['STATUS_RHID'], 'SEM BATIDAS')

    def test_same_read_only_source_and_day_are_used_without_resync_or_sharepoint_writes(self):
        self.source().get_report(DAY)
        self.assertEqual([method for method, _, _ in self.transport.calls], ['POST', 'GET', 'GET'])
        self.assertTrue(self.transport.calls[0][1].endswith('/login'))
        self.assertTrue(self.transport.calls[1][1].endswith('/person'))
        self.assertEqual(self.transport.calls[1][2]['params'], {'start': 0, 'length': 100})
        self.assertEqual(self.transport.calls[2][2]['params'], {'idEquipamento': 1, 'dataIni': DAY, 'dataFinal': DAY, 'limit': 50000})
        self.assertTrue(all(call[2].get('allow_redirects') is False for call in self.transport.calls))

    def test_afd_records_are_joined_by_pis_and_filtered_to_the_selected_day(self):
        raw = afd(punch(123, '07:00'), punch(123, '12:00', nsr=2),
                          punch(123, '13:00', nsr=3), punch(123, '16:30', nsr=4),
                          punch(123, '19:00', '2026-10-06', nsr=5))
        report = self.source(Transport(afd=Response(raw))).get_report(DAY)
        row = report['rows'][0]
        self.assertEqual(row['BATIDAS_RHID'], ['07:00', '12:00', '13:00', '16:30'])
        self.assertEqual(row['DATA_REFERENCIA'], DAY)
        self.assertEqual(row['ID_PESSOA_RHID'], '1')
        self.assertNotIn('pis', row)

    def test_duplicate_and_invalid_times_are_not_silently_removed(self):
        raw = afd(punch(123), punch(123, nsr=2), punch(123, '24:99', nsr=3))
        row = self.source(Transport(afd=Response(raw))).get_report(DAY)['rows'][0]
        self.assertEqual(row['BATIDAS_RHID'], ['07:00', '07:00', '24:99'])

    def test_directory_pagination_is_complete_before_missing_registration_can_be_claimed(self):
        transport = Transport(pages=[Response({'totalRecords': 2, 'records': [{'id': 1, 'name': 'ANA', 'pis': 123}]}),
                                      Response({'totalRecords': 2, 'records': [{'id': 2, 'name': 'BIA', 'pis': 456}]})])
        report = self.source(transport).get_report(DAY)
        self.assertEqual(len(report['registration']['people']), 2)
        self.assertEqual(transport.calls[2][2]['params']['start'], 1)

    def test_incomplete_or_invalid_directory_never_returns_complete(self):
        for data in [
            {'totalRecords': 2, 'records': [{'id': 1, 'name': 'ANA', 'pis': 123}]},
            {'totalRecords': 1, 'records': []},
            {'totalRecords': 1, 'records': [{'name': 'ANA'}]},
            {'totalRecords': 1, 'records': [{'id': 1, 'name': ''}]},
            {'records': []},
        ]:
            with self.subTest(data=data):
                source = self.source(Transport(pages=[Response(data)]))
                with self.assertRaisesRegex(module.RhidBadgeUnavailable, 'RHID'):
                    source.get_report(DAY)

    def test_afd_failure_empty_or_truncated_results_do_not_invent_absence(self):
        for response in [Response(status=500, data={'error': 'private'}), Response(''), Response('not an AFD'),
                         Response('\n'.join([HEADER] + [punch(123)] * 50000 + [FOOTER]))]:
            with self.subTest(status=response.status_code):
                source = self.source(Transport(afd=response))
                with self.assertRaisesRegex(module.RhidBadgeUnavailable, 'RHID'):
                    source.get_report(DAY)

    def test_header_only_or_partially_downloaded_afd_is_not_proof_of_absence(self):
        for raw in [HEADER, '\n'.join([HEADER, punch(123)]), '\n'.join([HEADER, punch(123), FOOTER[:24]])]:
            with self.subTest(length=len(raw)):
                with self.assertRaises(module.RhidBadgeUnavailable):
                    self.source(Transport(afd=Response(raw))).get_report(DAY)

    def test_trailer_counts_and_selected_header_range_must_confirm_completeness(self):
        valid = afd(punch(123), punch(123, '12:00', nsr=2))
        cases = [valid.replace(punch(123, '12:00', nsr=2) + '\r\n', ''),
                 valid.replace(footer([punch(123), punch(123)]), footer()),
                 valid.replace(HEADER, HEADER.replace(DAY, '2026-10-06')),
                 valid.replace(punch(123), punch(123)[:40]),
                 valid + '\r\n' + punch(123),
                 valid.replace(footer([punch(123), punch(123)]), footer([punch(123), punch(123)])[:-1] + '0')]
        for raw in cases:
            with self.subTest(length=len(raw)):
                with self.assertRaises(module.RhidBadgeUnavailable):
                    self.source(Transport(afd=Response(raw))).get_report(DAY)

    def test_plain_text_afd_is_supported_without_json_decoding(self):
        raw = afd(punch(123))
        row = self.source(Transport(afd=Response(text=raw))).get_report(DAY)['rows'][0]
        self.assertEqual(row['BATIDAS_RHID'], ['07:00'])

    def test_known_duplicate_pis_does_not_assign_one_workers_punch_to_a_namesake(self):
        transport = Transport(pages=[Response({'totalRecords': 2, 'records': [
            {'id': 1, 'name': 'ANA', 'pis': 123}, {'id': 2, 'name': 'ANA', 'pis': 123},
        ]})], afd=Response(afd(punch(123))))
        source = self.source(transport)
        with self.assertRaises(module.RhidBadgeUnavailable): source.get_report(DAY)

    def test_daily_query_is_cached_and_not_returned_by_mutable_reference(self):
        source = self.source()
        first = source.get_report(DAY)
        first['rows'][0]['BATIDAS_RHID'].append('11:11')
        second = source.get_report(DAY)
        self.assertEqual(second['rows'][0]['BATIDAS_RHID'], [])
        self.assertEqual(len(self.transport.calls), 3)

    def test_invalid_dates_do_not_authenticate_or_consult_the_clock(self):
        source = self.source()
        for value in ['', '2026-02-30', '2026-10-5']:
            with self.assertRaises(ValueError): source.get_report(value)
        self.assertEqual(self.transport.calls, [])

if __name__ == '__main__':
    unittest.main()
