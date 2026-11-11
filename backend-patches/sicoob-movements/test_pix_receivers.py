import unittest
import importlib.util
import subprocess
import tempfile
from pathlib import Path
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch
from pix_events import Inbox

import sync_pix_receivers as collector
from sync_pix_receivers import bank_match, extract_end_ids, pix_matches, pix_receiver_fields, receipt_ids

END_ID = 'E12345678202611061530ABCDEFGHIJK'
RECEIPT = f'''SICOOB
Comprovante de envio Pix
R$ 23,50
Transferido em 06/11/2026 às 15:30:00
Recebedor
Nome
RECEBEDOR EXEMPLO
CPF/CNPJ
*** 123.456-**
Instituição
BANCO EXEMPLO
Pagador
Nome
EMPRESA EXEMPLO LTDA
CPF/CNPJ
** **5.678/0001-**
Instituição
SICOOB
ID da Transação:
{END_ID[:13]} {END_ID[13:]}
'''


class PixTest(unittest.TestCase):
    def setUp(self):
        self.row = {'DATAPAGAMENTO': '2026-11-06T12:00:00Z', 'CONTAPAGADORA': '12345',
                    'VALOR': '23,50', 'DESCRICAO': 'PIX | ***.123.456-**'}
        self.pix = {
            'endToEndId': END_ID, 'estado': 'FINALIZADO', 'horario': '2026-11-06T18:30:00Z',
            'valor': 23.50, 'origem': {'conta': '12345', 'cpfCnpj': '12345678000190'},
            'destino': {'nome': 'Recebedor Exemplo', 'cpfCnpj': '98712345612', 'conta': '7654321'},
        }

    def test_uses_only_complete_identifiers(self):
        self.assertEqual(extract_end_ids(f'ID da transação:\n{END_ID}\n'), {END_ID})
        self.assertFalse(extract_end_ids(END_ID[:-4]))

    def test_worker_accepts_empty_and_pending_webhook_results(self):
        path = Path(__file__).resolve().parents[1] / 'sicoob-manual-sync' / 'sicoob_worker.py'
        spec = importlib.util.spec_from_file_location('pix_worker_contract', path)
        worker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(worker)
        row = {**self.row, 'Id': 1, 'RAZAOSOCIALRECEBEDOR': '',
               'ORIGEMMOVIMENTACAO': 'SICOOB', 'OPERACAO': 'DÉBITO'}
        for queued in (False, True):
            with self.subTest(queued=queued), tempfile.TemporaryDirectory() as directory:
                inbox = Inbox(Path(directory), create=True)
                if queued:
                    inbox.accept({'id': END_ID, 'status': 'FINALIZADO_SUCESSO'})
                with patch.object(collector, 'Inbox', return_value=inbox), \
                     patch.object(collector.movements, 'sharepoint_client', return_value=None), \
                     patch.object(collector.movements, 'assert_destination'), \
                     patch.object(collector, 'list_movements', return_value=[row] if queued else []), \
                     patch.object(collector, 'read_pix', return_value={'payer_document': '12345678000190', 'results': {END_ID: {'status': 404}}}):
                    result = worker.parse_stage('pix', collector.json.dumps(collector.run(False)), 0)
                self.assertEqual(result['pendingDetails'], int(queued))

    def test_webhook_waits_for_statement_and_uses_only_api_name_once(self):
        class Client:
            def __init__(self, row):
                self.row = dict(row)
                self.updates = 0
            def get_item_fields_with_etag(self, item, fields, target):
                return self.get_item_fields(item, fields, target), 'etag'
            def get_item_fields(self, item, fields, target):
                return {field: self.row[field] for field in fields}
            def update_item_with_etag(self, item, fields, etag, target):
                self.row.update(fields)
                self.updates += bool(fields)
        row = {field: '' for field in (*collector.IDENTITY, *collector.EXTRA)}
        row.update(self.row, Id=29, ORIGEMMOVIMENTACAO='SICOOB', OPERACAO='DÉBITO')
        client = Client(row)
        data = {'payer_document': '12345678000190', 'results': {END_ID: {'status': 200, 'result': self.pix}}}
        with tempfile.TemporaryDirectory() as directory:
            inbox = Inbox(Path(directory), create=True)
            notification = {'id': END_ID, 'status': 'FINALIZADO_SUCESSO', 'nome': 'FALSE NAME'}
            inbox.accept(notification)
            with patch.object(collector, 'read_pix', return_value=data) as read:
                collector.resolve_inbox(client, [], False, inbox)
                read.assert_not_called()
                self.assertEqual(inbox.pending(), [END_ID])
                stats = collector.resolve_inbox(client, [row], False, inbox)
                self.assertEqual(stats['nomes_gravados'], 1)
                self.assertEqual(client.row['RAZAOSOCIALRECEBEDOR'], 'Recebedor Exemplo')
                self.assertFalse(inbox.pending())
                inbox.accept(notification)
                collector.resolve_inbox(client, [row], False, inbox)
                self.assertEqual(read.call_count, 1)
                self.assertEqual(client.updates, 1)

    def test_webhook_failures_and_ambiguous_movements_remain_retryable(self):
        row = {**self.row, 'Id': 1, 'RAZAOSOCIALRECEBEDOR': ''}
        for answers, rows in [
            ({END_ID: {'status': 403}}, [row]),
            ({END_ID: {'status': 200, 'result': {**self.pix, 'valor': 900}}}, [row]),
            ({END_ID: {'status': 200, 'result': self.pix}}, [row, {**row, 'Id': 2}]),
        ]:
            with tempfile.TemporaryDirectory() as directory:
                inbox = Inbox(Path(directory), create=True)
                inbox.accept({'id': END_ID, 'estado': 'FINALIZADO_SUCESSO'})
                with patch.object(collector, 'read_pix', return_value={'payer_document': '12345678000190', 'results': answers}):
                    with patch.object(collector, 'save_pix', side_effect=AssertionError('Unsafe write')):
                        collector.resolve_inbox(None, rows, False, inbox)
                self.assertEqual(inbox.pending(), [END_ID])

    def test_webhook_checks_ambiguity_across_api_batches(self):
        row = {**self.row, 'Id': 1, 'RAZAOSOCIALRECEBEDOR': ''}
        identifiers = [END_ID[:21] + f'{index:011d}' for index in range(101)]
        def read(account, ids):
            answers = {identifier: {'status': 404} for identifier in ids}
            for identifier, document in [(identifiers[0], '98712345612'), (identifiers[-1], '11112345699')]:
                if identifier in ids:
                    answers[identifier] = {'status': 200, 'result': {
                        **self.pix, 'endToEndId': identifier,
                        'destino': {'nome': 'API receiver ' + document, 'cpfCnpj': document}}}
            return {'payer_document': '12345678000190', 'results': answers}
        with tempfile.TemporaryDirectory() as directory:
            inbox = Inbox(Path(directory), create=True)
            for identifier in identifiers:
                inbox.accept({'id': identifier, 'status': 'FINALIZADO_SUCESSO'})
            with patch.object(collector, 'read_pix', side_effect=read) as reader:
                with patch.object(collector, 'save_pix', side_effect=AssertionError('Ambiguous receiver')):
                    # A bounded run must not choose from an incomplete snapshot.
                    collector.resolve_inbox(None, [row], False, inbox)
                    collector.resolve_inbox(None, [row], False, inbox)
            self.assertLessEqual(max(len(call.args[1]) for call in reader.call_args_list), 25)
            self.assertEqual(len(inbox.pending(limit=200)), 101)

    def test_webhook_positive_api_evidence_survives_interruption(self):
        row = {**self.row, 'Id': 1, 'RAZAOSOCIALRECEBEDOR': ''}
        ids = [END_ID[:21] + f'{index:011d}' for index in range(101)]
        def read(account, batch):
            return {'payer_document': '12345678000190', 'results': {
                identifier: {'status': 200, 'result': {**self.pix, 'endToEndId': identifier}}
                for identifier in batch}}
        with tempfile.TemporaryDirectory() as directory:
            inbox = Inbox(Path(directory), create=True)
            for identifier in ids:
                inbox.accept({'id': identifier, 'status': 'FINALIZADO_SUCESSO'})
            with patch.object(collector, 'read_pix', side_effect=[read('12345', ids[:25]), RuntimeError('interrupted')]):
                with self.assertRaises(RuntimeError):
                    collector.resolve_inbox(None, [row], False, inbox)
            reopened = Inbox(Path(directory))
            with patch.object(collector, 'read_pix', side_effect=read) as reader:
                with patch.object(collector, 'save_pix', side_effect=AssertionError('Ambiguous receiver')):
                    collector.resolve_inbox(None, [row], False, reopened)
            queried = {identifier for call in reader.call_args_list for identifier in call.args[1]}
            self.assertFalse(queried.intersection(ids[:25]))
            self.assertEqual(queried, set(ids[25:]))

    def test_unresolved_webhook_prevents_archival_fallback(self):
        row = {**self.row, 'Id': 1, 'RAZAOSOCIALRECEBEDOR': '',
               'ORIGEMMOVIMENTACAO': 'SICOOB', 'OPERACAO': 'DÉBITO'}
        with tempfile.TemporaryDirectory() as directory:
            inbox = Inbox(Path(directory), create=True)
            inbox.accept({'id': END_ID, 'status': 'FINALIZADO_SUCESSO'})
            with patch.object(collector, 'Inbox', return_value=inbox), \
                 patch.object(collector.movements, 'sharepoint_client', return_value=None), \
                 patch.object(collector.movements, 'assert_destination'), \
                 patch.object(collector, 'list_movements', return_value=[row]), \
                 patch.object(collector, 'read_pix', return_value={'payer_document': '12345678000190', 'results': {END_ID: {'status': 403}}}), \
                 patch.object(collector, 'launch_dates_and_values', side_effect=AssertionError('Unsafe archive bypass')):
                self.assertEqual(collector.run(False)['pendentes'], 1)

    def test_webhook_completes_existing_name_with_missing_supplemental_fields(self):
        row = {field: '' for field in (*collector.IDENTITY, *collector.EXTRA)}
        row.update(self.row, Id=29, RAZAOSOCIALRECEBEDOR='Recebedor Exemplo')
        stored = dict(row)
        get = lambda item, fields, target: {field: stored[field] for field in fields}
        client = SimpleNamespace(get_item_fields=get,
            get_item_fields_with_etag=lambda *args: (get(*args), 'etag'),
            update_item_with_etag=lambda item, fields, etag, target: stored.update(fields))
        data = {'payer_document': '12345678000190', 'results': {END_ID: {'status': 200, 'result': self.pix}}}
        with tempfile.TemporaryDirectory() as directory:
            inbox = Inbox(Path(directory), create=True)
            inbox.accept({'id': END_ID, 'status': 'FINALIZADO_SUCESSO'})
            with patch.object(collector, 'read_pix', return_value=data):
                collector.resolve_inbox(client, [row], False, inbox)
            self.assertEqual(stored['DOCUMENTORECEBEDOR'], self.pix['destino']['cpfCnpj'])
            self.assertEqual(inbox.pending(), [])

    def test_matches_bank_response_by_transaction_and_counterparty(self):
        self.assertTrue(pix_matches(self.row, self.pix, END_ID, '12345678000190'))
        for field, value in [
            ('valor', 23.51), ('estado', 'REJEITADO'), ('horario', '2026-11-07T18:30:00Z'),
            ('origem', {'conta': '4321', 'cpfCnpj': '12345678000190'}),
            ('destino', {'nome': 'Outra pessoa', 'cpfCnpj': '98765432112'}),
        ]:
            self.assertFalse(pix_matches(self.row, {**self.pix, field: value}, END_ID, '12345678000190'))
        self.assertFalse(pix_matches(self.row, self.pix, END_ID[:-1] + 'Z', '12345678000190'))
        self.assertTrue(pix_matches({**self.row, 'DESCRICAO': 'PIX', 'REFERENCIABANCARIA': END_ID},
                                    self.pix, END_ID, '12345678000190'))

    def test_receiver_fields_come_from_the_bank(self):
        self.assertEqual(pix_receiver_fields(self.pix), {
            'RAZAOSOCIALRECEBEDOR': 'Recebedor Exemplo',
            'DOCUMENTORECEBEDOR': '98712345612',
            'CONTARECEBEDOR': '7654321',
        })

    def test_requires_unique_movement_and_no_unresolved_candidate(self):
        movement = {**self.row, 'Id': 1}
        other = {**self.row, 'Id': 2, 'DOCUMENTORECEBEDOR': '98712345612'}
        answers = {END_ID: {'status': 200, 'result': self.pix}}
        self.assertIsNone(bank_match(movement, {END_ID: None}, answers, [movement, other], '12345678000190'))
        self.assertIsNone(bank_match(movement, {END_ID: None, 'other': None}, answers, [movement], '12345678000190'))
        self.assertEqual(bank_match(movement, {END_ID: None}, answers, [movement], '12345678000190'),
                         (self.pix, END_ID, None))

    def test_accepts_bank_canonical_id_when_receipt_ocr_changes_letter_case(self):
        movement = {**self.row, 'Id': 1}
        other = {**movement, 'Id': 2, 'DESCRICAO': 'PIX | ***.654.321-**'}
        scanned_id = END_ID[:21] + END_ID[21:].lower()
        answers = {scanned_id: {'status': 200, 'result': self.pix}}
        self.assertEqual(bank_match(movement, {scanned_id: None}, answers, [movement, other], '12345678000190'),
                         (self.pix, END_ID, None))
        self.assertIsNone(bank_match(other, {scanned_id: None}, answers, [movement, other], '12345678000190'))

    def test_bank_statement_id_must_match_the_canonical_bank_id(self):
        scanned_id = END_ID[:21] + END_ID[21:].lower()
        movement = {**self.row, 'Id': 1, 'REFERENCIABANCARIA': scanned_id}
        answers = {scanned_id: {'status': 200, 'result': self.pix}}
        self.assertIsNone(bank_match(movement, {scanned_id: None}, answers, [movement], '12345678000190'))

    def test_duplicate_ocr_spellings_of_the_same_bank_id_are_one_match(self):
        movement = {**self.row, 'Id': 1}
        scanned = END_ID[:21] + END_ID[21:].lower()
        answers = {key: {'status': 200, 'result': self.pix} for key in (END_ID, scanned)}
        self.assertEqual(bank_match(movement, {END_ID: None, scanned: None}, answers,
                                    [movement], '12345678000190'), (self.pix, END_ID, None))

    def test_day_archive_includes_receipts_with_unparseable_accounting_amount(self):
        from datetime import date
        client = SimpleNamespace(_list_endpoint=lambda _: '/list', _values=lambda value: value,
                                 _request=lambda *args, **kwargs: [
                                     {'Id': 42, 'Attachments': True, 'field_4': '2026-11-06',
                                      'field_8': 'invalid', 'field_9': '23,50'}])
        day = date(2026, 11, 6)
        self.assertEqual(collector.launch_dates_and_values(client, day, day)[(day, None)], [42])

    def test_extracts_split_ids_from_sicoob_receipt(self):
        self.assertEqual(collector.receipt_end_ids(RECEIPT), {END_ID})

    def test_text_identifier_does_not_depend_on_ocr(self):
        from reportlab.pdfgen.canvas import Canvas
        output = BytesIO()
        pdf = Canvas(output)
        pdf.drawString(20, 700, 'SICOOB Comprovante de Pix')
        pdf.drawString(20, 680, END_ID)
        pdf.save()
        with patch('sync_pix_receivers.subprocess.run', side_effect=AssertionError('Unexpected OCR')):
            self.assertEqual(receipt_ids(output.getvalue()), {END_ID})

    def test_ocr_timeout_is_retried_on_future_collections(self):
        from PIL import Image
        output = BytesIO()
        Image.new('RGB', (200, 300), 'white').save(output, format='PDF')
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(collector, 'CACHE', Path(directory)):
                with patch('sync_pix_receivers.subprocess.run', side_effect=subprocess.TimeoutExpired('ocr', 30)):
                    self.assertFalse(collector.cached_receipt_ids(output.getvalue()))
                self.assertEqual(list(Path(directory).iterdir()), [])

    def test_scanned_pdf_can_be_rendered_before_ocr(self):
        from PIL import Image
        output = BytesIO()
        Image.new('RGB', (200, 300), 'white').save(output, format='PDF')
        result = SimpleNamespace(stdout=f'SICOOB Comprovante de Pix\n{END_ID}'.encode())
        with patch('sync_pix_receivers.subprocess.run', return_value=result) as ocr:
            self.assertEqual(receipt_ids(output.getvalue()), {END_ID})
        self.assertTrue(ocr.call_args.kwargs['input'].startswith(b'\x89PNG'))

    def test_oversized_pdf_is_rendered_at_a_bounded_size(self):
        from PIL import Image
        from reportlab.pdfgen.canvas import Canvas
        from pypdfium2 import PdfPage
        output = BytesIO()
        pdf = Canvas(output, pagesize=(2400, 3600))
        pdf.showPage()
        pdf.save()
        render = PdfPage.render
        scales = []
        def observe(page, **options):
            scales.append(options['scale'])
            return render(page, **options)
        with patch.object(PdfPage, 'render', observe):
            with patch('sync_pix_receivers.subprocess.run', return_value=SimpleNamespace(stdout=b'')) as ocr:
                self.assertEqual(receipt_ids(output.getvalue()), set())
        self.assertLessEqual(scales[0], 1400 / 2400)
        with Image.open(BytesIO(ocr.call_args.kwargs['input'])) as bitmap:
            self.assertLessEqual(bitmap.width, 1400)
            self.assertLessEqual(bitmap.height, 2600)
