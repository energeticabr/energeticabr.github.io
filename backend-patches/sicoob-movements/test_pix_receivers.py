import unittest

from sync_pix_receivers import bank_match, extract_end_ids, pix_matches, pix_receiver_fields

END_ID = 'E12345678202611061530ABCDEFGHIJK'


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
