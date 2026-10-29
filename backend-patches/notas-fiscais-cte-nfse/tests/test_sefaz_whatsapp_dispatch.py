import base64
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
import json
import sqlite3
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from pathlib import Path
from fiscal_fixtures import CTE_KEY, NFSE_KEY, cte_xml, nfse_xml, notification_envelope

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
try:
    import sefaz_whatsapp_dispatch as notify
except ImportError:
    notify = None

KEY = '31261012345678000123550010000001231000001234'
OLD = '31261012345678000123550010000001231000001235'
GROUP = '120000000000000001@g.us'


def envelope(key=KEY):
    raw = (Path(__file__).parent / 'fixtures/nfe-danfe-homologacao.xml').read_bytes()
    raw = raw.replace(KEY.encode(), key.encode()).replace(b'<tpAmb>2</tpAmb>', b'<tpAmb>1</tpAmb>')
    digest = hashlib.sha256(raw).hexdigest()
    pdf = b'%PDF-1.4\nSYNTHETIC UNIT TEST ONLY\n%%EOF\n'
    return {'source': 'SEFAZ', 'receipt': {'source': 'SEFAZ', 'acknowledgedIds': ['000000000000001-' + digest[:16]]},
            'document': {'key': key, 'kind': 'nfeProc', 'id': '000000000000001-' + digest[:16],
                         'sha256': digest, 'xmlBase64': base64.b64encode(raw).decode(),
                         'danfe': {'fileName': f'DANFE-{key}-{digest[:16]}.pdf',
                                   'pdfBase64': base64.b64encode(pdf).decode(), 'sha256': hashlib.sha256(pdf).hexdigest()}}}


def with_xml_replacement(request, before, after):
    raw = base64.b64decode(request['document']['xmlBase64']).replace(before.encode(), after.encode())
    digest = hashlib.sha256(raw).hexdigest()
    request['document'].update(xmlBase64=base64.b64encode(raw).decode(), sha256=digest,
                               id='000000000000001-' + digest[:16])
    request['receipt']['acknowledgedIds'] = [request['document']['id']]
    request['document']['danfe']['fileName'] = f'DANFE-{request["document"]["key"]}-{digest[:16]}.pdf'
    return request


class Notifications(unittest.TestCase):
    def test_nfe_iss_retention_alone_and_with_federal_components(self):
        for federal, expected in [('', '25,00'), ('<retTrib><vIRRF>15.00</vIRRF></retTrib>', '40,00')]:
            req = with_xml_replacement(envelope(), '</total>', federal+'<ISSQNtot><vISSRet>25.00</vISSRet></ISSQNtot></total>')
            fiscal = notify.parse_fiscal_xml(base64.b64decode(req['document']['xmlBase64']), KEY, notify.COMPANY, required_environment='1')
            self.assertEqual(format(notify.buyer_retention(fiscal), '.2f').replace('.', ','), expected)

    def test_retention_is_after_own_pdf_and_before_next_note_with_retry_dedup(self):
        req = with_xml_replacement(envelope(), '</total>', '<retTrib><vRetPIS>12.34</vRetPIS><vRetCOFINS>20.00</vRetCOFINS><vRetCSLL>5.00</vRetCSLL><vIRRF>1.00</vIRRF><vRetPrev>2.00</vRetPrev></retTrib></total>')
        self.stage(req)
        second = KEY[:-4]+'0999'
        self.stage(envelope(second))
        for phase in ('text', 'pdf', 'retention'):
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(lambda _: self.drain(), range(4)))
            messages = [m for _, m in self.queued()]
            self.assertEqual([m['completionId'] for m in messages], ['sefaz-new-'+KEY+'-'+phase])
            if phase == 'retention':
                self.assertEqual(messages[0]['type'], 'text')
                self.assertEqual(messages[0]['text'], '*ATENÇÃO : ESSA NOTA GEROU RETENÇÕES NO VALOR DE R$ 40,34*')
                self.assertEqual(self.stage(req)['status'], 'retention_queued')
            self.acknowledge(phase)
        self.drain()
        self.assertEqual(notify.status(KEY, self.db)['status'], 'sent')
        self.assertEqual([m['completionId'] for _, m in self.queued()], ['sefaz-new-'+second+'-text'])

    def test_nfse_warning_sums_only_buyer_components_and_not_own_pis_cofins(self):
        raw = nfse_xml().replace(b'<tpRetISSQN>2', b'<tpRetISSQN>3').replace(b'</trib>', b'<tribFed><piscofins><vPis>100.00</vPis><vCofins>200.00</vCofins><tpRetPisCofins>3</tpRetPisCofins></piscofins><vRetCSLL>13.02</vRetCSLL><vRetIRRF>1.50</vRetIRRF><vRetCP>2.00</vRetCP></tribFed></trib>')
        req = notification_envelope(raw, NFSE_KEY, 'NFSe', 'DANFSe')
        req['document']['fields'] = {'TOTAL_RETIDO': 999999, 'ISS_RETIDO': 999999}
        self.stage(req)
        for phase in ('text', 'pdf'):
            self.drain(); self.acknowledge(phase, key=NFSE_KEY)
        self.drain()
        self.assertEqual(self.queued()[0][1]['text'], '*ATENÇÃO : ESSA NOTA GEROU RETENÇÕES NO VALOR DE R$ 16,52*')

    def test_non_buyer_or_only_total_or_own_tax_never_generates_warning(self):
        variants = [nfse_xml().replace(b'<tpRetISSQN>2', b'<tpRetISSQN>1').replace(b'<vLiq>', b'<vTotalRet>78.50</vTotalRet><vLiq>'),
                    nfse_xml().replace(b'<toma><CNPJ>38626750000146', b'<toma><CNPJ>44444444000144').replace(b'<interm><CNPJ>99999999000199', b'<interm><CNPJ>38626750000146')]
        for i, raw in enumerate(variants):
            key = NFSE_KEY[:-1]+str(i+5)
            raw = raw.replace(NFSE_KEY.encode(), key.encode())
            self.stage(notification_envelope(raw, key, 'NFSe', 'DANFSe'))
            for phase in ('text', 'pdf'):
                self.drain(); self.acknowledge(phase, key=key)
            self.drain()
            self.assertEqual(self.queued(), [])
            self.assertEqual(notify.status(key, self.db)['status'], 'sent')

    def test_inconsistent_retention_total_is_rejected(self):
        raw = nfse_xml().replace(b'<vLiq>', b'<vTotalRet>1.00</vTotalRet><vLiq>')
        with self.assertRaisesRegex(ValueError, 'INVALID_RETENTION_TOTAL'):
            self.stage(notification_envelope(raw, NFSE_KEY, 'NFSe', 'DANFSe'))

    def test_missing_warning_ack_blocks_next_invoice_without_reenqueuing(self):
        self.stage(notification_envelope(nfse_xml(), NFSE_KEY, 'NFSe', 'DANFSe'))
        self.stage()
        for phase in ('text', 'pdf'):
            self.drain(); self.acknowledge(phase, key=NFSE_KEY)
        self.drain()
        with self.connection() as db:
            db.execute('DELETE FROM gateway_outbox')
        self.drain(); self.drain()
        self.assertEqual(self.queued(), [])
        self.assertEqual(notify.status(NFSE_KEY, self.db)['status'], 'unconfirmed')
        self.assertEqual(notify.status(KEY, self.db)['status'], 'staged')
        self.acknowledge('retention', key=NFSE_KEY)
        self.drain()
        self.assertEqual([m['completionId'] for _, m in self.queued()], ['sefaz-new-'+KEY+'-text'])

    def test_legacy_sent_history_is_not_reopened_by_retention_migration(self):
        self.stage()
        for phase in ('text', 'pdf'):
            self.drain(); self.acknowledge(phase)
        self.drain()
        with self.connection() as db:
            before = db.execute('SELECT * FROM sefaz_notification_dispatch ORDER BY rowid').fetchall()
            db.execute('DROP TABLE sefaz_notification_retention')
        self.drain()
        with self.connection() as db:
            self.assertEqual(before, db.execute('SELECT * FROM sefaz_notification_dispatch ORDER BY rowid').fetchall())
        self.assertEqual(self.queued(), [])

    def test_cte_os_and_simplified_metadata_come_from_xml_without_using_net_as_total(self):
        for kind, key in [('cteOSProc', CTE_KEY[:20]+'67'+CTE_KEY[22:]), ('cteSimpProc', CTE_KEY)]:
            with self.subTest(kind=kind):
                req = notification_envelope(cte_xml(kind), key, kind, 'DACTE')
                result = notify.validate(req)
                self.assertEqual(result[0], key)
                self.assertIn('*R$ 1.000,00*', result[3])
                self.assertNotIn('*R$ 975,00*', result[3])

    def test_cte_nfse_and_long_nsu_revalidate_xml_and_include_fiscal_type(self):
        cases = [(cte_xml(), CTE_KEY, 'cteProc', 'DACTE', 'CT-e', 'Transportadora Ficticia'),
                 (nfse_xml(), NFSE_KEY, 'NFSe', 'DANFSe', 'NFS-e', 'Prestador Ficticio')]
        for raw, key, kind, prefix, fiscal_type, supplier in cases:
            with self.subTest(kind=kind):
                req = notification_envelope(raw, key, kind, prefix, nsu='9223372036854775807')
                req['document']['fields'] = {'Title': 'FORGED', 'VALOR_TOTAL_NOTA': 999999, 'DATA_EMISSAO': '2000-01-01'}
                self.assertEqual(self.stage(req)['status'], 'staged')
                self.assertTrue(self.stage(req)['duplicate'])
                with self.connection() as db:
                    text = db.execute('SELECT text FROM sefaz_notification_dispatch WHERE key=?', (key,)).fetchone()[0]
                self.assertIn(fiscal_type, text)
                self.assertIn('*'+supplier+'*', text)
                self.assertIn('*R$ 1.000,00*', text)
                self.assertIn('*01/10/2026 às 23:45:59*', text)
                self.assertNotIn('FORGED', text)

    def test_mixed_fiscal_documents_keep_global_text_pdf_order_and_cutoff(self):
        self.config['minimumIssueDate'] = '2026-10-01'
        cte = notification_envelope(cte_xml(), CTE_KEY, 'cteProc', 'DACTE')
        nfse = notification_envelope(nfse_xml(), NFSE_KEY, 'NFSe', 'DANFSe')
        self.stage(cte)
        self.stage(nfse)
        for key in [CTE_KEY, NFSE_KEY]:
            for phase in (['text', 'pdf', 'retention'] if key == NFSE_KEY else ['text', 'pdf']):
                self.drain()
                self.assertEqual([m['completionId'] for _, m in self.queued()], ['sefaz-new-'+key+'-'+phase])
                self.acknowledge(phase, key=key)
        self.drain()
        self.assertEqual(self.queued(), [])
        before = nfse_xml().replace(b'2026-10-01T23:45:59-03:00', b'2026-09-30T23:45:59-03:00')
        other_key = NFSE_KEY[:-1]+'2'
        before = before.replace(NFSE_KEY.encode(), other_key.encode())
        req = notification_envelope(before, other_key, 'NFSe', 'DANFSe')
        self.assertEqual(self.stage(req)['status'], 'scope_excluded')

    def test_service_notification_rejects_test_environment_event_wrong_kind_and_cancelled(self):
        variants = [notification_envelope(nfse_xml('2'), NFSE_KEY, 'NFSe', 'DANFSe'),
                    notification_envelope(nfse_xml(), NFSE_KEY, 'evento', 'DANFSe'),
                    notification_envelope(nfse_xml(), NFSE_KEY, 'nfeProc', 'DANFE')]
        cancelled = notification_envelope(nfse_xml(), NFSE_KEY, 'NFSe', 'DANFSe')
        cancelled['document']['fields'] = {'SITUACAO': 'CANCELADA'}
        variants.append(cancelled)
        substituted = notification_envelope(nfse_xml(), NFSE_KEY, 'NFSe', 'DANFSe')
        substituted['document']['fields'] = {'SITUACAO': 'SUBSTITUIDA'}
        variants.append(substituted)
        for req in variants:
            with self.subTest(kind=req['document']['kind']), self.assertRaises(ValueError):
                self.stage(req)
        self.assertEqual(self.queued(), [])

    def setUp(self):
        self.assertIsNotNone(notify, 'NF-e WhatsApp dispatcher is not implemented')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = Path(self.temp.name) / 'gateway.db'
        self.files = Path(self.temp.name) / 'pdfs'
        self.config = {'enabled': True, 'companyCnpj': '38626750000146', 'groupName': 'NOVO DDA',
                       'groupId': GROUP, 'baselineKeys': [OLD]}
        self.dda = {'enabled': True, 'payerId': '38626750000146', 'groupName': 'NOVO DDA', 'groupId': GROUP}
        with self.connection() as db:
            db.executescript('''CREATE TABLE gateway_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,message BLOB NOT NULL,
                created_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '');
                CREATE TABLE gateway_completion_messages(completion_id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,
                message_id TEXT NOT NULL,updated_at INTEGER NOT NULL);''')
        notify.initialize(self.config, self.dda, self.db)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.db)
        try:
            with db:
                yield db
        finally:
            db.close()

    def stage(self, request=None):
        return notify.stage(request or envelope(), self.config, self.dda, self.db, self.files)

    def drain(self):
        return notify.drain(self.config, self.dda, self.db)

    def queued(self):
        with self.connection() as db:
            return [(r[0], json.loads(r[1])) for r in db.execute('SELECT id,message FROM gateway_outbox ORDER BY id')]

    def acknowledge(self, phase, group=GROUP, key=KEY):
        with self.connection() as db:
            db.execute('INSERT INTO gateway_completion_messages VALUES(?,?,?,0)',
                       ('sefaz-new-' + key + '-' + phase, group, 'WHATSAPP-' + phase))
            db.execute('DELETE FROM gateway_outbox WHERE json_extract(message, ?) = ?', ('$.completionId', 'sefaz-new-' + key + '-' + phase))

    def test_cutoff_uses_original_emission_day_and_preserves_baseline(self):
        self.config['minimumIssueDate'] = '2026-10-01'
        req = envelope()
        raw = base64.b64decode(req['document']['xmlBase64']).replace(b'2026-10-20T12:00:00-03:00', b'2026-09-30T23:30:00-03:00')
        digest = hashlib.sha256(raw).hexdigest()
        req['document'].update(xmlBase64=base64.b64encode(raw).decode(), sha256=digest, id='000000000000001-' + digest[:16])
        req['receipt']['acknowledgedIds'] = [req['document']['id']]
        req['document']['danfe']['fileName'] = f'DANFE-{KEY}-{digest[:16]}.pdf'
        self.assertEqual(self.stage(req)['status'], 'scope_excluded')
        self.assertEqual(self.stage(req)['status'], 'scope_excluded')
        self.assertFalse(self.files.exists())
        self.drain()
        self.assertEqual(self.queued(), [])
        self.assertEqual(self.stage(envelope(OLD))['status'], 'baseline')
        self.assertEqual(self.stage()['status'], 'staged')

    def test_three_notes_are_globally_serialized_across_concurrent_drains(self):
        keys = [KEY[:-4] + tail for tail in ('0301', '0302', '0303')]
        for key in keys:
            self.stage(envelope(key))
        observed = []
        for key in keys:
            for phase, kind in [('text', 'text'), ('pdf', 'document')]:
                # Each real SQLite writer sees the same unfinished head after
                # acquiring BEGIN IMMEDIATE; concurrent calls must not overtake.
                with ThreadPoolExecutor(max_workers=4) as pool:
                    list(pool.map(lambda _: self.drain(), range(4)))
                messages = [message for _, message in self.queued()]
                self.assertEqual([(m['completionId'], m['type']) for m in messages],
                                 [('sefaz-new-' + key + '-' + phase, kind)])
                observed.append((key, phase))
                self.acknowledge(phase, key=key)
        self.drain()
        self.assertEqual(observed, [(keys[0], 'text'), (keys[0], 'pdf'),
                                    (keys[1], 'text'), (keys[1], 'pdf'),
                                    (keys[2], 'text'), (keys[2], 'pdf')])
        self.assertEqual(self.queued(), [])
        self.assertTrue(all(notify.status(key, self.db)['status'] == 'sent' for key in keys))

    def test_missing_pdf_blocks_later_note_until_same_bytes_are_restored(self):
        second = KEY[:-4] + '0402'
        self.stage()
        self.stage(envelope(second))
        self.drain()
        self.acknowledge('text')
        path = self.files / envelope()['document']['danfe']['fileName']
        original = path.read_bytes()
        path.unlink()
        self.drain()
        self.drain()
        self.assertEqual(self.queued(), [])
        self.assertEqual(notify.status(KEY, self.db)['status'], 'pdf_blocked')
        self.assertEqual(notify.status(second, self.db)['status'], 'staged')
        with self.connection() as db:
            self.assertEqual(db.execute('SELECT code FROM sefaz_notification_audit').fetchall(),
                             [('PDF_CONTENT_MISSING_OR_CHANGED',)])
        path.write_bytes(original)
        self.drain()
        self.assertEqual([m['completionId'] for _, m in self.queued()], ['sefaz-new-' + KEY + '-pdf'])
        self.acknowledge('pdf')
        self.drain()
        self.assertEqual([m['completionId'] for _, m in self.queued()], ['sefaz-new-' + second + '-text'])

    def test_new_note_text_then_exact_pdf_only_after_text_ack(self):
        self.assertEqual(self.stage()['status'], 'staged')
        self.drain()
        first = self.queued()
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0][1]['text'], 'NOVA NOTA IDENTIFICADA DA EMPRESA *FORNECEDOR FICTICIO - HOMOLOGACAO* NO VALOR DE *R$ 164.746,81*\nEmissão: *20/10/2026 às 12:00:00*')
        self.assertEqual(first[0][1]['group_id'], GROUP)
        self.assertTrue(first[0][1]['trackCompletionSuccess'])
        self.drain()
        self.assertEqual(self.queued(), first)
        self.acknowledge('text')
        self.drain()
        second = self.queued()
        self.assertEqual([m['type'] for _, m in second], ['document'])
        self.assertEqual(Path(second[0][1]['path']).read_bytes(), base64.b64decode(envelope()['document']['danfe']['pdfBase64']))
        self.acknowledge('pdf')
        self.drain()
        self.assertEqual(notify.status(KEY, self.db)['status'], 'sent')

    def test_posix_pdf_permissions_grant_only_gateway_group_read(self):
        path = self.files / 'test.pdf'
        self.assertTrue(callable(getattr(notify, 'grant_gateway_read', None)))
        with patch.object(notify.os, 'name', 'posix'), \
                patch.object(type(path), 'stat', return_value=SimpleNamespace(st_gid=54321)), \
                patch.object(notify.os, 'chown', create=True) as chown, \
                patch.object(notify.os, 'chmod') as chmod:
            notify.grant_gateway_read(path)
        self.assertEqual(chown.call_args_list, [unittest.mock.call(path.parent, -1, 54321),
                                                unittest.mock.call(path, -1, 54321)])
        self.assertEqual(chmod.call_args_list, [unittest.mock.call(path.parent, 0o750),
                                                unittest.mock.call(path, 0o640)])

    def test_stage_grants_gateway_access_before_persisting_notification(self):
        with patch.object(notify, 'grant_gateway_read', create=True) as grant:
            self.stage()
        grant.assert_called_once_with(self.files / envelope()['document']['danfe']['fileName'])

    def test_pdf_phase_repairs_legacy_file_permissions_before_queueing(self):
        self.stage()
        self.drain()
        self.acknowledge('text')
        with patch.object(notify, 'grant_gateway_read', create=True) as grant:
            self.drain()
        grant.assert_called_once_with(self.files / envelope()['document']['danfe']['fileName'])
        self.assertEqual([message['type'] for _, message in self.queued()], ['document'])

    def test_repeated_stage_and_partial_pdf_retry_never_repeat_text(self):
        self.stage()
        self.drain()
        self.acknowledge('text')
        self.drain()
        before = self.queued()
        self.assertTrue(self.stage()['duplicate'])
        self.drain()
        self.assertEqual(self.queued(), before)
        self.assertEqual(notify.status(KEY, self.db)['status'], 'pdf_queued')

    def test_known_baseline_key_never_queues_retrospective_notification(self):
        self.assertEqual(self.stage(envelope(OLD))['status'], 'baseline')
        self.drain()
        self.assertEqual(self.queued(), [])
        self.assertFalse(self.files.exists())

    def test_missing_queue_without_ack_is_audited_and_never_blindly_requeued(self):
        self.stage()
        self.drain()
        with self.connection() as db:
            db.execute('DELETE FROM gateway_outbox')
        self.drain()
        self.drain()
        self.assertEqual(self.queued(), [])
        self.assertEqual(notify.status(KEY, self.db)['status'], 'unconfirmed')
        with self.connection() as db:
            self.assertEqual(db.execute('SELECT code FROM sefaz_notification_audit').fetchall(), [('TEXT_UNCONFIRMED',)])

    def test_completion_from_another_chat_does_not_release_pdf(self):
        self.stage()
        self.drain()
        self.acknowledge('text', '120000000000000002@g.us')
        self.drain()
        self.assertEqual(self.queued(), [])
        self.assertEqual(notify.status(KEY, self.db)['status'], 'unconfirmed')

    def test_unconfirmed_head_blocks_all_later_notes_and_late_ack_resumes_same_pair(self):
        old_keys = [KEY[:-4] + f'{index:04d}' for index in range(100)]
        with patch.object(notify.time, 'time', return_value=1_700_000_000):
            for key in old_keys:
                self.stage(envelope(key))
            self.drain()
            self.assertEqual([m['completionId'] for _, m in self.queued()],
                             ['sefaz-new-' + old_keys[0] + '-text'])
            with self.connection() as db:
                db.execute('DELETE FROM gateway_outbox')
            self.drain()
            self.assertEqual(notify.status(old_keys[0], self.db)['status'], 'unconfirmed')
            self.assertTrue(all(notify.status(key, self.db)['status'] == 'staged' for key in old_keys[1:]))

            self.stage()
            for _ in range(2):
                self.drain()
            self.assertEqual(self.queued(), [])
            self.assertEqual(notify.status(KEY, self.db)['status'], 'staged')
            with self.connection() as db:
                self.assertEqual(db.execute('SELECT code FROM sefaz_notification_audit').fetchall(),
                                 [('TEXT_UNCONFIRMED',)])

            # The first old record remains eligible when its delayed ACK arrives;
            # revisiting it must release only its PDF, without repeating its text.
            with self.connection() as db:
                db.execute('INSERT INTO gateway_completion_messages VALUES(?,?,?,0)',
                           ('sefaz-new-' + old_keys[0] + '-text', GROUP, 'LATE-TEXT-ACK'))
            for _ in range(2):
                self.drain()
            self.assertEqual(notify.status(old_keys[0], self.db)['status'], 'pdf_queued')
            self.assertEqual([message['completionId'] for _, message in self.queued()],
                             ['sefaz-new-' + old_keys[0] + '-pdf'])
            self.drain()
            self.assertEqual(len(self.queued()), 1)
            self.acknowledge('pdf', key=old_keys[0])
            self.drain()
            self.assertEqual([message['completionId'] for _, message in self.queued()],
                             ['sefaz-new-' + old_keys[1] + '-text'])

    def test_pdf_hash_or_missing_sharepoint_receipt_prevents_any_staging(self):
        for mutate in [lambda r: r['document']['danfe'].update(sha256='0' * 64),
                       lambda r: r['receipt'].update(acknowledgedIds=[]),
                       lambda r: r['document'].update(sha256='0' * 64)]:
            request = envelope()
            mutate(request)
            with self.assertRaises(ValueError):
                self.stage(request)
        self.assertEqual(self.queued(), [])
        self.assertEqual(notify.status(KEY, self.db)['status'], 'missing')

    def test_wrong_or_changed_group_and_disabled_integration_fail_closed(self):
        for name, value in [('groupName', 'OUTRO'), ('groupId', '120000000000000002@g.us'), ('enabled', False)]:
            config = copy.deepcopy(self.config)
            config[name] = value
            with self.assertRaises(ValueError):
                notify.stage(envelope(), config, self.dda, self.db, self.files)
        self.stage()
        changed = {**self.config, 'groupId': '120000000000000002@g.us'}
        dda = {**self.dda, 'groupId': changed['groupId']}
        with self.assertRaisesRegex(ValueError, 'DESTINATION_CHANGED'):
            notify.drain(changed, dda, self.db)
        self.assertEqual(self.queued(), [])

    def test_replay_same_key_with_conflicting_pdf_is_rejected(self):
        self.stage()
        request = envelope()
        pdf = b'%PDF-1.4\nDIFFERENT UNIT TEST PDF\n%%EOF\n'
        request['document']['danfe'].update(pdfBase64=base64.b64encode(pdf).decode(), sha256=hashlib.sha256(pdf).hexdigest())
        with self.assertRaisesRegex(ValueError, 'CONTENT_CHANGED'):
            self.stage(request)

    def test_zero_value_is_formatted_without_becoming_missing(self):
        request = envelope()
        raw = base64.b64decode(request['document']['xmlBase64']).replace(b'<vNF>164746.81</vNF>', b'<vNF>0.00</vNF>')
        digest = hashlib.sha256(raw).hexdigest()
        request['document'].update(sha256=digest, xmlBase64=base64.b64encode(raw).decode(), id='000000000000001-' + digest[:16])
        request['document']['danfe']['fileName'] = f'DANFE-{KEY}-{digest[:16]}.pdf'
        request['receipt']['acknowledgedIds'] = [request['document']['id']]
        self.stage(request)
        self.drain()
        self.assertIn('NO VALOR DE *R$ 0,00*\nEmissão: *20/10/2026 às 12:00:00*', self.queued()[0][1]['text'])

    def test_emission_uses_original_offset_day_and_sanitizes_supplier_markup(self):
        request = with_xml_replacement(envelope(), '2026-10-20T12:00:00-03:00', '2026-10-01T23:45:59-03:00')
        request = with_xml_replacement(request, 'FORNECEDOR FICTICIO - HOMOLOGACAO', '*EMPRESA*\n_COM_ ~MARCAS~ `TESTE`')
        self.stage(request)
        self.drain()
        self.assertEqual(self.queued()[0][1]['text'],
                         'NOVA NOTA IDENTIFICADA DA EMPRESA *EMPRESA COM MARCAS TESTE* NO VALOR DE *R$ 164.746,81*\nEmissão: *01/10/2026 às 23:45:59*')

    def test_date_only_emission_never_invents_midnight(self):
        request = with_xml_replacement(envelope(), '<dhEmi>2026-10-20T12:00:00-03:00</dhEmi>', '<dEmi>2026-10-20</dEmi>')
        self.stage(request)
        self.drain()
        self.assertEqual(self.queued()[0][1]['text'],
                         'NOVA NOTA IDENTIFICADA DA EMPRESA *FORNECEDOR FICTICIO - HOMOLOGACAO* NO VALOR DE *R$ 164.746,81*\nEmissão: *20/10/2026* — horário não informado')

    def test_invalid_emission_never_uses_collection_time(self):
        request = with_xml_replacement(envelope(), '2026-10-20T12:00:00-03:00', '2026-10-20')
        with self.assertRaisesRegex(ValueError, 'INVALID_ISSUE_DATE'):
            self.stage(request)
        self.assertEqual(self.queued(), [])

    def test_initialization_is_required_and_baseline_cannot_be_reset(self):
        config = {**self.config, 'baselineKeys': [KEY]}
        with self.assertRaisesRegex(ValueError, 'BASELINE_CHANGED'):
            notify.initialize(config, self.dda, self.db)
        with self.connection() as db:
            db.execute('DELETE FROM sefaz_notification_meta')
        with self.assertRaisesRegex(ValueError, 'NOT_INITIALIZED'):
            self.stage()


if __name__ == '__main__':
    unittest.main()
