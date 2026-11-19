import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from sync_movements import (BACKFILL_START, BACKFILL_END, NEW_START, import_movements,
                            monthly_windows, payment_rows, public_receiver_name, receiver_names, save_movement, scheduled_start)


class MovementImportTests(unittest.TestCase):
    def test_existing_masked_pix_gets_bank_name_without_inventing_document(self):
        from types import SimpleNamespace
        source = payment_rows({'transacoes': [self.transaction(cpfCnpj='',
                              descInfComplementar='Pix enviado|@Nome Exemplo|@***.292.306-**|@')]},
                              BACKFILL_START, BACKFILL_END, '001234', {})[0]
        stored = {**source, 'RAZAOSOCIALRECEBEDOR': None, 'DOCUMENTORECEBEDOR': None}
        def get_fields(item, fields, target):
            return {field: stored.get(field) for field in fields}
        client = SimpleNamespace(_find_item=lambda *args: {'Id': 72}, get_item_fields=get_fields,
            get_item_fields_with_etag=lambda *args: (get_fields(*args), 'snapshot'),
            update_item_with_etag=lambda item, fields, etag, target: stored.update(fields))
        self.assertFalse(save_movement(client, source))
        self.assertEqual(stored['RAZAOSOCIALRECEBEDOR'], 'Nome Exemplo')
        self.assertIsNone(stored['DOCUMENTORECEBEDOR'])

    def test_pix_enviado_bank_name_is_available_before_first_save(self):
        entry = self.transaction(cpfCnpj='', descInfComplementar='Pix enviado|@Mauricio Honorato de Sousa|@***.292.306-**|@')
        saved = []
        import_movements(lambda *_: {'transacoes': [entry]}, lambda row: saved.append(dict(row)) or True,
                         BACKFILL_START, BACKFILL_END, '001234', {})
        self.assertEqual(saved[0].get('RAZAOSOCIALRECEBEDOR'), 'Mauricio Honorato de Sousa')

    def test_pix_enviado_rejects_unlabelled_or_conflicting_names(self):
        for description, expected in [('Pagamento Pix|@***.292.306-**|@', None),
                                      ('Pix enviado|@123456|@***.292.306-**|@', None),
                                      ('Pix enviado|@Nome Um|@Nome Dois|@***.292.306-**|@', None),
                                      ('Pix enviado|@Nome Exemplo|@***.292.306-**|@', 'Nome Exemplo')]:
            row = payment_rows({'transacoes': [self.transaction(cpfCnpj='', descInfComplementar=description)]},
                               BACKFILL_START, BACKFILL_END, '001234', {})[0]
            self.assertEqual(row.get('RAZAOSOCIALRECEBEDOR'), expected)

    def test_pix_preparation_failure_prevents_partial_import(self):
        saved = []
        def prepare(rows):
            raise RuntimeError('bank lookup unavailable')
        with self.assertRaisesRegex(RuntimeError, 'bank lookup unavailable'):
            import_movements(lambda *_: {'transacoes': [self.transaction()]}, lambda row: saved.append(row),
                             BACKFILL_START, BACKFILL_END, '001234', {}, prepare=prepare)
        self.assertEqual(saved, [])

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
            self.assertEqual(scheduled_start(cursor, date(2026, 11, 10)), NEW_START)
            cursor.write_text('2026-11-07')
            with self.assertRaises(ValueError):
                scheduled_start(cursor, date(2026, 11, 10))

    def test_rechecks_saturday_after_a_successful_monday_run(self):
        with tempfile.TemporaryDirectory() as directory:
            cursor = Path(directory) / 'cursor'
            cursor.write_text('2026-11-16')
            self.assertEqual(scheduled_start(cursor, date(2026, 11, 17)), date(2026, 11, 14))
            cursor.write_text('2026-11-12')
            self.assertEqual(scheduled_start(cursor, date(2026, 11, 17)), date(2026, 11, 12))

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
        self.assertNotIn('RAZAOSOCIALRECEBEDOR', record)
        self.assertEqual(record['VALOR'], '1234,56')
        self.assertEqual(record['REFERENCIABANCARIA'], 'A1')
        self.assertNotIn('CONTARECEBEDOR', record)
        self.assertEqual(len(record['CHAVEIMPORTACAO']), 64)
        unconfirmed = payment_rows(payload, BACKFILL_START, BACKFILL_END, '001234', {})[0]
        self.assertNotIn('RAZAOSOCIALRECEBEDOR', unconfirmed)
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

    def test_pix_names_new_and_existing_debits_from_the_bank_cnpj(self):
        from types import SimpleNamespace
        document = '18189352000100'
        payload = {'transacoes': [self.transaction(
            cpfCnpj=None, descInfComplementar='Pagamento Pix|@18.189.352 0001-00|@')]}
        source = payment_rows(payload, BACKFILL_START, BACKFILL_END, '12', {})[0]
        name = 'Empresa do CNPJ'
        company = {'cnpj': document, 'razao_social': name}
        for existing in (False, True):
            with self.subTest(existing=existing):
                stored = dict(source, RAZAOSOCIALRECEBEDOR=None)
                def get_fields(item, fields, target):
                    return {field: stored.get(field) for field in fields}
                def insert(_, values, **options):
                    stored.update(values)
                    return 8
                def update(item, values, etag, target):
                    self.assertEqual(etag, 'snapshot')
                    stored.update(values)
                client = SimpleNamespace(
                    _find_item=lambda *args: {'Id': 8} if existing else None,
                    get_item_fields=get_fields, ensure_item=insert,
                    get_item_fields_with_etag=lambda *args: (get_fields(*args), 'snapshot'),
                    update_item_with_etag=update)
                with patch('sync_movements.fetch_pix_company', return_value=company) as lookup:
                    self.assertEqual(save_movement(client, dict(source)), not existing)
                lookup.assert_called_once_with(document)
                self.assertEqual(stored['RAZAOSOCIALRECEBEDOR'], name)
                self.assertEqual(stored['VALOR'], source['VALOR'])

    def test_pix_cnpj_lookup_never_uses_cpf_or_replaces_bank_statement_name(self):
        from types import SimpleNamespace
        document = '18189352000100'
        wrong = {'cnpj': '00394460000141', 'razao_social': 'Outro CNPJ'}
        for doc, supplied, expected in ((document, 'Nome do banco', 'Nome do banco'),
                                        ('12345678900', '', None), (document, '', None)):
            with self.subTest(doc=doc, supplied=supplied):
                raw = self.transaction(cpfCnpj=doc, descInfComplementar=f'FAV.: {supplied}' if supplied else 'Pix')
                row = payment_rows({'transacoes': [raw]}, BACKFILL_START, BACKFILL_END, '12', {})[0]
                saved = {}
                def insert(_, values, **options):
                    saved.update(values)
                    return 1
                client = SimpleNamespace(_find_item=lambda *args: None, ensure_item=insert,
                                         get_item_fields=lambda *args: saved)
                with patch('sync_movements.fetch_pix_company', return_value=wrong) as lookup:
                    self.assertTrue(save_movement(client, row))
                self.assertEqual(saved.get('RAZAOSOCIALRECEBEDOR'), expected)
                self.assertEqual(lookup.call_count, int(doc == document and not supplied))

    def test_existing_pix_cnpj_keeps_name_saved_after_its_snapshot(self):
        from requests import HTTPError, Response
        from types import SimpleNamespace
        document = '18189352000100'
        raw = self.transaction(cpfCnpj=document)
        row = payment_rows({'transacoes': [raw]}, BACKFILL_START, BACKFILL_END, '12', {})[0]
        stored = dict(row, RAZAOSOCIALRECEBEDOR='')
        def get_fields(item, fields, target):
            return {field: stored.get(field) for field in fields}
        def update(item, values, etag, target):
            stored['RAZAOSOCIALRECEBEDOR'] = 'Nome confirmado em paralelo'
            response = Response()
            response.status_code = 412
            raise HTTPError(response=response)
        client = SimpleNamespace(_find_item=lambda *args: {'Id': 8},
            get_item_fields=get_fields, get_item_fields_with_etag=lambda *args: (get_fields(*args), 'snapshot'),
            update_item_with_etag=update)
        with patch('sync_movements.fetch_pix_company', return_value={'cnpj': document, 'razao_social': 'Nome do cadastro'}):
            self.assertFalse(save_movement(client, row))
        self.assertEqual(row['RAZAOSOCIALRECEBEDOR'], 'Nome confirmado em paralelo')

    def test_reads_sicoob_favoured_party_and_structured_document(self):
        payload = {'transacoes': [
            self.transaction(cpfCnpj=None, descInfComplementar='FAV.: Empresa Fictícia LTDA|@Transferência Pix|@12.345.678 0001-95|@'),
            self.transaction(transactionId='bank-2', cpfCnpj=None, descInfComplementar='Pagamento Pix|@***.456.789-**|@'),
        ]}
        rows = payment_rows(payload, BACKFILL_START, BACKFILL_END, '12', {})
        self.assertEqual(rows[0]['RAZAOSOCIALRECEBEDOR'], 'Empresa Fictícia LTDA')
        self.assertEqual(rows[0]['DOCUMENTORECEBEDOR'], '12345678000195')
        self.assertNotIn('RAZAOSOCIALRECEBEDOR', rows[1])
        self.assertNotIn('DOCUMENTORECEBEDOR', rows[1])

    def test_keeps_pix_end_to_end_when_bank_statement_also_uses_a_generic_reference(self):
        end_id = 'E12345678202611061530ABCDEFGHIJK'
        mask = '*** . 123 . 456 - **'
        entry = self.transaction(transactionId=end_id, numeroDocumento='Pix',
                                 descInfComplementar='x' * 219 + ' | ' + mask)
        row = payment_rows({'transacoes': [entry]}, BACKFILL_START, BACKFILL_END, '12', {})[0]
        self.assertEqual(row['REFERENCIABANCARIA'], 'Pix')
        self.assertIn(end_id, row['DESCRICAO'])
        self.assertIn(mask, row['DESCRICAO'])
        self.assertLessEqual(len(row['DESCRICAO']), 255)

    def test_keeps_conflicting_bank_ids_so_resolution_can_reject_them(self):
        first = 'E12345678202611061530ABCDEFGHIJK'
        second = first[:-1] + 'Z'
        entry = self.transaction(transactionId=first, endToEndId=second, numeroDocumento='Pix')
        row = payment_rows({'transacoes': [entry]}, BACKFILL_START, BACKFILL_END, '12', {})[0]
        self.assertIn(first, row['DESCRICAO'])
        self.assertIn(second, row['DESCRICAO'])

    def test_includes_settled_interbank_boleto_and_excludes_service_package(self):
        payload = {'transacoes': [
            self.transaction(descricao='DÉB.TIT.COMPE EFETIVADO'),
            self.transaction(transactionId='bank-2', descricao='DÉBITO PACOTE SERVIÇOS'),
        ]}
        rows = payment_rows(payload, BACKFILL_START, BACKFILL_END, '12', {})
        self.assertEqual(len(rows), 1)
        self.assertIn('DÉB.TIT.COMPE EFETIVADO', rows[0]['DESCRICAO'])
