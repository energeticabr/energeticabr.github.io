import unittest

from sync_boleto_receipts import missing_receiver_fields, receipt_candidate, receipt_matches, receipt_order, receiver_fields


class ReceiptTest(unittest.TestCase):
    def setUp(self):
        self.movement = {
            'ORIGEMMOVIMENTACAO': 'SICOOB', 'OPERACAO': 'DÉBITO',
            'DESCRICAO': 'DEB.TIT.COMPE EFETIVADO', 'REFERENCIABANCARIA': '1234567',
            'CONTAPAGADORA': '12345', 'DATAPAGAMENTO': '2026-11-06T12:00:00Z', 'VALOR': '1.200,20',
        }
        self.receipt = {
            'numeroConta': 12345, 'dataPagamento': '2026-11-06',
            'valorPagamento': 1200.20, 'situacaoPagamento': 'Efetivado',
            'numeroAutenticacaoPagamento': 'BANCO-EXEMPLO',
            'nomeRazaoSocialBeneficiario': 'Exemplo Ltda.',
            'nomeFantasiaBeneficiario': 'Loja Exemplo',
        }

    def test_only_bank_boleto_can_supply_a_receipt_reference(self):
        self.assertEqual(receipt_candidate(self.movement), '1234567')
        self.assertIsNone(receipt_candidate({**self.movement, 'DESCRICAO': 'PIX EMITIDO'}))
        self.assertIsNone(receipt_candidate({**self.movement, 'ORIGEMMOVIMENTACAO': 'MANUAL'}))

    def test_receipt_requires_exact_account_date_amount_and_authentication(self):
        self.assertTrue(receipt_matches(self.movement, self.receipt))
        for field, value in [('numeroConta', 12346), ('dataPagamento', '2026-11-07'),
                             ('valorPagamento', 1200.21), ('situacaoPagamento', 'Agendado'),
                             ('numeroAutenticacaoPagamento', None)]:
            with self.subTest(field=field):
                self.assertFalse(receipt_matches(self.movement, {**self.receipt, field: value}))

    def test_final_beneficiary_does_not_inherit_the_intermediary_document(self):
        self.assertEqual(receiver_fields(self.receipt)['RAZAOSOCIALRECEBEDOR'], 'Exemplo Ltda. (Loja Exemplo)')
        fields = receiver_fields({**self.receipt, 'nomeRazaoSocialBeneficiarioFinal': 'Recebedor final',
                                  'numeroCpfCnpjBeneficiario': '11.222.333/0001-81'})
        self.assertEqual(fields, {'RAZAOSOCIALRECEBEDOR': 'Recebedor final'})

    def test_rate_limited_batch_can_resume_beyond_earlier_references(self):
        pending = {str(i): {'Id': i} for i in (40, 39, 38, 35, 18)}
        self.assertEqual(receipt_order(pending, 38), ['35', '18', '40', '39', '38'])

    def test_missing_fields_do_not_mix_incompatible_identities(self):
        receipt = {**self.receipt, 'numeroCpfCnpjBeneficiario': '11.222.333/0001-81'}
        self.assertEqual(missing_receiver_fields({'RAZAOSOCIALRECEBEDOR': 'Outro'}, receipt), {})
        self.assertEqual(missing_receiver_fields({'DOCUMENTORECEBEDOR': '11222333000181'}, self.receipt), {})
        self.assertEqual(missing_receiver_fields({'DOCUMENTORECEBEDOR': '11.222.333/0001-81'}, receipt),
                         {'RAZAOSOCIALRECEBEDOR': 'Exemplo Ltda. (Loja Exemplo)'})
