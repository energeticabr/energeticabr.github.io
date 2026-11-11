import unittest
import subprocess
import tempfile
from pathlib import Path
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

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
