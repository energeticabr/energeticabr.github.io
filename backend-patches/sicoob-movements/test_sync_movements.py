import tempfile
import unittest
from datetime import date
from pathlib import Path

from sync_movements import (BACKFILL_START, BACKFILL_END, NEW_START, import_movements,
                            monthly_windows, payment_rows, public_receiver_name, receiver_names, save_movement, scheduled_start)


class MovementImportTests(unittest.TestCase):
    def transaction(self, **changes):
        return {"transactionId": "bank-1", "tipo": "D", "valor": "1.234,56",
                "data": "2026-10-02T21:55:00-03:00", "dataLote": "2026-10-02",
                "descricao": "PIX ENVIADO", "numeroDocumento": "A1",
                "cpfCnpj": "123.456.789-00", "descInfComplementar": "Pagamento",
                **changes}

    def test_historical_and_scheduled_windows_do_not_cross_cutoff(self):
        self.assertEqual(list(monthly_windows(BACKFILL_START, BACKFILL_END)), [
            (date(2026, 10, 1), date(2026, 10, 31)), (date(2026, 11, 1), date(2026, 11, 7)),
        ])
        with tempfile.TemporaryDirectory() as directory:
            cursor = Path(directory) / 'cursor'
            self.assertEqual(scheduled_start(cursor, date(2026, 11, 8)), NEW_START)
            cursor.write_text('2026-11-08')
            self.assertEqual(scheduled_start(cursor, date(2026, 11, 10)), NEW_START)
            cursor.write_text('2026-11-10')
            self.assertEqual(scheduled_start(cursor, date(2026, 11, 10)), date(2026, 11, 9))
            cursor.write_text('2026-11-07')
            with self.assertRaises(ValueError):
                scheduled_start(cursor, date(2026, 11, 10))

    def test_resolves_only_unambiguous_nominal_matches(self):
        names = receiver_names([
            {'Title': 'Recebedor Fictício LTDA', 'DOCUMENTOFORNECEDOR': '123.456.789-00'},
            {'Title': 'RECEBEDOR FICTÍCIO LTDA', 'DOCUMENTOFORNECEDOR': '12345678900'},
            {'Title': 'Primeiro', 'DOCUMENTOFORNECEDOR': '11111111111'},
            {'Title': 'Segundo', 'DOCUMENTOFORNECEDOR': '11111111111'},
            {'Title': 'Inválido', 'DOCUMENTOFORNECEDOR': '***.456.789-**'},
        ])
        self.assertEqual(names, {'12345678900': 'Recebedor Fictício LTDA'})

    def test_map_posted_debits_keep_name_and_account_separate(self):
        bank_rows = [self.transaction(), self.transaction(transactionId='bank-credit', tipo='C'),
                     self.transaction(transactionId='bank-old', data='2026-09-30')]
        payload = {'resultado': {'transacoes': bank_rows}}
        rows = payment_rows(payload, BACKFILL_START, BACKFILL_END, '001234',
                            {'12345678900': 'Recebedor Fictício LTDA'})
        self.assertEqual(len(rows), 1)
        record = rows[0]
        self.assertEqual(record['DATAPAGAMENTO'], '2026-10-02T12:00:00Z')
        self.assertEqual(record['CONTAPAGADORA'], '001234')
        self.assertEqual(record['RAZAOSOCIALRECEBEDOR'], 'N/A')
        self.assertEqual(record['VALOR'], '1234,56')
        self.assertEqual(record['REFERENCIABANCARIA'], 'A1')
        self.assertNotIn('CONTARECEBEDOR', record)
        self.assertEqual(len(record['CHAVEIMPORTACAO']), 64)
        unconfirmed = payment_rows(payload, BACKFILL_START, BACKFILL_END, '001234', {})[0]
        self.assertEqual(unconfirmed['RAZAOSOCIALRECEBEDOR'], 'N/A')
        self.assertEqual(unconfirmed['CHAVEIMPORTACAO'], record['CHAVEIMPORTACAO'])

    def test_missing_transaction_id_or_unrecognized_response_fails(self):
        with self.assertRaises(ValueError):
            payment_rows({'transacoes': [self.transaction(transactionId='')]}, BACKFILL_START, BACKFILL_END, '12', {})
        with self.assertRaises(ValueError):
            payment_rows({'resultado': {}}, BACKFILL_START, BACKFILL_END, '12', {})

    def test_acquires_entire_window_then_inserts_distinct_records(self):
        durable = {}
        def save(row):
            key = row['CHAVEIMPORTACAO']
            existed = key in durable
            durable.setdefault(key, row)
            return not existed
        def fetch(first, last):
            if first.month == 11:
                raise ValueError('failed November')
            return {'transacoes': [self.transaction()]}
        with self.assertRaises(ValueError):
            import_movements(fetch, save, BACKFILL_START, BACKFILL_END, '12', {})
        self.assertFalse(durable)
        def good_fetch(first, last):
            return {'transacoes': [self.transaction(), self.transaction()] if first.month == 10 else []}
        self.assertEqual(import_movements(good_fetch, save, BACKFILL_START, BACKFILL_END, '12', {}), {
            'debits': 1, 'excludedDebits': 0, 'inserted': 1, 'existing': 0, 'unidentified': 1,
        })
        self.assertEqual(import_movements(good_fetch, save, BACKFILL_START, BACKFILL_END, '12', {})['existing'], 1)

    def test_public_lookup_requires_matching_cnpj_and_never_sends_cpf(self):
        document = '00394460000141'
        requests = []
        def lookup(value):
            requests.append(value)
            return {'cnpj': '00.394.460/0001-41', 'razao_social': 'Razão QA', 'nome_fantasia': 'Fantasia QA'}
        self.assertEqual(public_receiver_name(document, lookup), 'Razão QA (Fantasia QA)')
        self.assertEqual(public_receiver_name('12345678900', lookup), '')
        self.assertEqual(requests, [document])
        self.assertEqual(public_receiver_name(document, lambda _: {'cnpj': '12345678000195', 'razao_social': 'Outro'}), '')
        self.assertEqual(public_receiver_name(document, lambda _: {'cnpj': document, 'nome_fantasia': 'Fantasia QA'}), 'Fantasia QA')
        self.assertEqual(public_receiver_name(document, lambda _: {'cnpj': document, 'razao_social': 'Nome', 'nome_fantasia': 'NOME'}), 'Nome')

    def test_excludes_non_payment_debits(self):
        payload = {'transacoes': [self.transaction(descricao='TARIFA PIX'),
                                 self.transaction(descricao='SAQUE EM TERMINAL'),
                                 self.transaction(descricao='APLICAÇÃO DE INVESTIMENTO')]}
        self.assertEqual(payment_rows(payload, BACKFILL_START, BACKFILL_END, '12', {}), [])

    def test_transaction_date_uses_sao_paulo_at_cutoff(self):
        payload = {'transacoes': [self.transaction(data='2026-11-08T02:55:00Z')]}
        self.assertEqual(payment_rows(payload, NEW_START, NEW_START, '12', {}), [])
        historical = payment_rows(payload, BACKFILL_START, BACKFILL_END, '12', {})
        self.assertEqual(historical[0]['DATAPAGAMENTO'], '2026-11-07T12:00:00Z')

    def test_retry_verifies_existing_payment_and_preserves_its_name(self):
        row = payment_rows({'transacoes': [self.transaction()]}, BACKFILL_START, BACKFILL_END, '12', {})[0]
        stored = dict(row, VALOR='50,00', RAZAOSOCIALRECEBEDOR='Recebedor confirmado')
        class Existing:
            def _find_item(self, key, target, field):
                return {'Id': 8}
            def get_item_fields(self, item_id, fields, target):
                return {field: stored[field] for field in fields}
        with self.assertRaises(ValueError):
            save_movement(Existing(), row)
        stored['VALOR'] = row['VALOR']
        self.assertFalse(save_movement(Existing(), row))
        self.assertEqual(row['RAZAOSOCIALRECEBEDOR'], 'Recebedor confirmado')

    def test_reads_sicoob_favoured_party_and_structured_document(self):
        payload = {'transacoes': [
            self.transaction(cpfCnpj=None, descInfComplementar='FAV.: Empresa Fictícia LTDA|@Transferência Pix|@12.345.678 0001-95|@'),
            self.transaction(transactionId='bank-2', cpfCnpj=None, descInfComplementar='Pagamento Pix|@***.456.789-**|@'),
        ]}
        rows = payment_rows(payload, BACKFILL_START, BACKFILL_END, '12', {})
        self.assertEqual(rows[0]['RAZAOSOCIALRECEBEDOR'], 'Empresa Fictícia LTDA')
        self.assertEqual(rows[0]['DOCUMENTORECEBEDOR'], '12345678000195')
        self.assertEqual(rows[1]['RAZAOSOCIALRECEBEDOR'], 'N/A')
        self.assertNotIn('DOCUMENTORECEBEDOR', rows[1])

    def test_includes_settled_interbank_boleto_and_excludes_service_package(self):
        payload = {'transacoes': [
            self.transaction(descricao='DÉB.TIT.COMPE EFETIVADO'),
            self.transaction(transactionId='bank-2', descricao='DÉBITO PACOTE SERVIÇOS'),
        ]}
        rows = payment_rows(payload, BACKFILL_START, BACKFILL_END, '12', {})
        self.assertEqual(len(rows), 1)
        self.assertIn('DÉB.TIT.COMPE EFETIVADO', rows[0]['DESCRICAO'])
