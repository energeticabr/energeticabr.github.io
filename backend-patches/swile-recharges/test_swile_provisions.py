from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from swile_provisions import CHILD, PARENT, build_plan, process_provisions, queue_provision, sync_documents
from swile_recharges import Service, SwileError
from test_swile_recharges import Gateway


class SwileProvisionTests(TestCase):
    def test_plan_uses_each_suppliers_catalog_and_one_parent(self):
        people = [{'name':'Ána Silva','document':'12345678900','amountCents':22505},
                  {'name':'José Souza','document':'12345678901','amountCents':8000}]
        suppliers = [
            {'Id':12,'Title':'ANA DA SILVA','DOCUMENTOFORNECEDOR':'123.456.789-00','FILIAL':'OBRA A','PROFISSAO':'ENGENHEIRA'},
            {'Id':13,'Title':'JOSE SOUZA','DOCUMENTOFORNECEDOR':'','FILIAL':'OBRA B','PROFISSAO':'PEDREIRO'},
        ]
        plan = build_plan(people, suppliers, 'SWO123', '2026-11-29', date(2026,11,15))
        self.assertEqual(plan['parent']['VALORTOTAL'], '305,05')
        self.assertEqual(plan['parent']['FORNECEDOR'], 'SWILE')
        self.assertEqual(plan['parent']['FILIAL'], 'DIVERSOS')
        self.assertEqual([(r['FORNECEDOR'],r['PRODUTO'],r['FILIAL'],r['VALORTOTAL']) for r in plan['children']],
                         [('ANA DA SILVA','ENGENHEIRA','OBRA A','225,05'),('JOSE SOUZA','PEDREIRO','OBRA B','80,00')])
        for row in plan['children']:
            self.assertEqual((row['QTD'], row['IMOVEL'], row['FORMAPGTO'], row['OBS'], row['DATAPREVISTOPGTO']),
                             ('1', 'TODOS', '', 'VALE ALIMENTAÇÃO', '2026-11-29T03:00:00Z'))
        suppliers[1]['DOCUMENTOFORNECEDOR'] = '98765432100'
        with self.assertRaisesRegex(SwileError, 'José Souza'):
            build_plan(people, suppliers, 'SWO123', '2026-11-29', date(2026,11,15))

    def test_enrollment_requires_confirmed_owner_and_is_unique(self):
        with TemporaryDirectory() as directory:
            gateway = Gateway()
            gateway.summary_orders = [{'employees':[{'document':'12345678900','cardValue':{'v13':225.05}}]}]
            service = Service(gateway, Path(directory) / 'orders.sqlite', clock=lambda:1794500000)
            draft = {'items':[{'employeeId':10,'amountCents':22505}],'creditDate':'2026-12-01','paymentMethod':'PIX'}
            preview = service.preview('owner',draft)
            with self.assertRaises(SwileError):
                queue_provision(service,'owner',preview['id'])
            service.confirm('owner',preview['id'])
            with self.assertRaises(SwileError):
                queue_provision(service,'other',preview['id'])
            self.assertEqual(queue_provision(service,'owner',preview['id']), queue_provision(service,'owner',preview['id']))
            self.assertEqual(service.orders('owner')[0]['provision']['state'],'queued')

    def test_document_worker_waits_for_invoice_and_uses_only_the_exact_provider_order(self):
        uploads = []
        class Store:
            def attach(self, parent, name, data):
                uploads.append((parent,name,data))
        group = {'orderList':[{'code':'ABC','slipLink':'boleto'}]}
        saved = set()
        fetch = lambda kind, link: b'%PDF-' + link.encode()
        self.assertFalse(sync_documents(Store(), 44, group, 'BANK_SLIP', saved, fetch))
        group['orderList'][0]['invoiceLink'] = 'nota'
        self.assertTrue(sync_documents(Store(), 44, group, 'BANK_SLIP', saved, fetch))
        self.assertEqual(uploads, [(44,'Boleto Swile ABC.pdf',b'%PDF-boleto'),
                                   (44,'Nota fiscal Swile ABC.pdf',b'%PDF-nota')])

    def test_draft_receipt_can_queue_once_and_waits_for_provider_confirmation(self):
        with TemporaryDirectory() as directory:
            gateway = Gateway()
            gateway.summary_orders = [{'employees':[{'document':'12345678900','cardValue':{'v13':225.05}}]}]
            now = 1794500000
            service = Service(gateway, Path(directory) / 'orders.sqlite', clock=lambda:now)
            preview = service.preview('owner', {
                'items':[{'employeeId':10,'amountCents':22505}],
                'creditDate':'2026-12-01','paymentMethod':'PIX'})
            service.confirm('owner', preview['id'])
            with service.db() as db:
                db.execute("UPDATE orders SET status='DRAFT' WHERE id=?", (preview['id'],))
            first = queue_provision(service, 'owner', preview['id'])
            self.assertEqual(first['state'], 'queued')
            self.assertEqual(first, queue_provision(service, 'owner', preview['id']))
            group = {'statusCode':'DRAFT','orderList':[]}
            service.corporate_group = lambda code: group
            # No SharePoint method may be called while Swile still reports DRAFT.
            process_provisions(service, object())
            with service.db() as db:
                job = db.execute('SELECT * FROM swile_provisions').fetchone()
                self.assertEqual((job['state'], job['parent'], job['plan']), ('retry', None, None))
                self.assertEqual(db.execute('SELECT COUNT(*) FROM swile_provisions').fetchone()[0], 1)
            self.assertEqual(len([call for call in gateway.calls if call[0] == 'order/create']), 1)

    def test_terminal_orders_cannot_queue_provisions(self):
        with TemporaryDirectory() as directory:
            gateway = Gateway()
            gateway.summary_orders = [{'employees':[{'document':'12345678900','cardValue':{'v13':225.05}}]}]
            service = Service(gateway, Path(directory) / 'orders.sqlite', clock=lambda:1794500000)
            preview = service.preview('owner', {
                'items':[{'employeeId':10,'amountCents':22505}],
                'creditDate':'2026-12-01','paymentMethod':'PIX'})
            service.confirm('owner', preview['id'])
            for status in ('CANCELED', 'CREATION_ERROR', 'PROCESSING_CANCEL'):
                with self.subTest(status=status):
                    with service.db() as db:
                        db.execute('UPDATE orders SET status=? WHERE id=?', (status, preview['id']))
                    with self.assertRaises(SwileError):
                        queue_provision(service, 'owner', preview['id'])
            with service.db() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM swile_provisions').fetchone()[0], 0)

    def test_worker_resumes_after_partial_creation_and_attaches_late_pdfs_to_same_parent(self):
        class FakeStore:
            rows, uploads = {}, []
            fail = True
            def suppliers(self):
                return [{'Id': 44, 'Title':'Pessoa 0', 'DOCUMENTOFORNECEDOR':'12345678900',
                         'FILIAL':'OBRA A', 'PROFISSAO':'PEDREIRO'}]
            def verify_keys(self): pass
            def ensure(self, target, fields):
                key = target, fields['FOLHAOPERACAO']
                if key not in self.rows:
                    self.rows[key] = len(self.rows) + 101, fields
                if target == CHILD and self.fail:
                    self.fail = False
                    raise OSError('lost reply')
                return self.rows[key][0]
            def finish(self, target, ident): pass
            def verify_parent(self, parent, marker):
                assert self.rows[PARENT, marker][0] == parent
            def attach(self, parent, name, data):
                self.uploads.append((parent, name))

        with TemporaryDirectory() as directory:
            gateway = Gateway()
            gateway.summary_orders = [{'employees':[{'document':'12345678900','cardValue':{'v13':225.05}}]}]
            now = 1794500000
            service = Service(gateway, Path(directory) / 'orders.sqlite', clock=lambda:now)
            draft = {'items':[{'employeeId':10,'amountCents':22505}],'creditDate':'2026-12-01','paymentMethod':'BANK_SLIP'}
            preview = service.preview('owner',draft)
            service.confirm('owner',preview['id'])
            with service.db() as db:
                db.execute("UPDATE orders SET status='DRAFT' WHERE id=?", (preview['id'],))
            queue_provision(service,'owner',preview['id'])
            group = {'statusCode':'WAITING_PAYMENT','orderList':[{'code':'ABC','totalValue':225.05}]}
            service.corporate_group = lambda code: group
            store = FakeStore()
            with self.assertLogs(level='ERROR'):
                process_provisions(service, store)
            self.assertEqual(len(store.rows), 2)
            now += 600
            process_provisions(service, store)
            self.assertEqual(service.orders('owner')[0]['provision']['state'], 'documents')
            self.assertEqual(len(store.rows), 2)
            from unittest.mock import patch
            group['orderList'][0].update(slipLink='boleto', invoiceLink='nota')
            from swile_provisions import sync_documents as sync
            fetch = lambda kind, link: b'%PDF-' + link.encode()
            with patch('swile_provisions.sync_documents', side_effect=lambda *args: sync(*args,fetch=fetch)):
                now += 600
                process_provisions(service, store)
                now += 600
                process_provisions(service, store)
            self.assertEqual(service.orders('owner')[0]['provision']['state'], 'done')
            self.assertEqual(store.uploads, [(101,'Boleto Swile ABC.pdf'),(101,'Nota fiscal Swile ABC.pdf')])
