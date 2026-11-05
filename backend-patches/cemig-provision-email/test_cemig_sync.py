import copy
import io
import unittest
from contextlib import nullcontext
from decimal import Decimal
from datetime import datetime,timezone

import cemig_sync as c


TEXT = 'CEMIG DISTRIBUICAO S.A. RUA ANTONIO TORRES DOS SANTOS 134 CT XAVANTE\n13.170.665.018-99\nOUT/2026 04/11/2026 275,33\n'


class MemoryStore:
    def __init__(self, paid=False):
        self.rows = {(c.CHILD, 326): {'Id': 326, 'IDRECORRENCIA': '33', 'FILIAL': c.BRANCH,
            'FORNECEDOR': 'CEMIG', 'DATA': '2026-11-04T03:00:00Z', 'DESCRITIVOPROVISAO': '13',
            'VALORTOTAL': '275,33' if paid else '0', 'STATUS': 'PAGAMENTO EFETUADO' if paid else 'PAGAMENTO PREVISTO'},
            (c.PARENT, 13): {'Id': 13, 'FILIAL': c.BRANCH, 'FORNECEDOR': 'CEMIG', 'VALORTOTAL': '275.33' if paid else '0'}}
        self.versions = {k: 1 for k in self.rows}
        self.files = {k: [] for k in self.rows}
        self.writes = []
        self.fail_put = None
        self.fail_write = None

    def children(self): return [copy.deepcopy(v) for (kind, _), v in self.rows.items() if kind == c.CHILD]
    def read(self, kind, ident):
        key = (kind, ident)
        return copy.deepcopy(self.rows[key]), str(self.versions[key])
    def attachments(self, kind, ident): return copy.deepcopy(self.files[(kind, ident)])
    def lock(self, parent): return nullcontext()
    def put(self, kind, ident, name, content):
        if self.fail_put == kind: raise RuntimeError('upload interrupted')
        self.files[(kind, ident)].append({'filename': name, 'content': content})
        self.versions[(kind, ident)] += 1
    def write(self, kind, ident, fields, etag):
        if self.fail_write == kind: raise RuntimeError('write interrupted')
        if etag != str(self.versions[(kind, ident)]): raise RuntimeError('412')
        self.rows[(kind, ident)].update(fields)
        self.versions[(kind, ident)] += 1
        self.writes.append((kind, ident, fields))


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.bill = c.parse_bill_text(TEXT)
        self.files = [{'filename': 'original.pdf', 'content': b'%PDF-original'}]
        self.store = MemoryStore()

    def test_parse_real_shape(self):
        self.assertEqual(self.bill.amount, Decimal('275.33'))
        self.assertEqual(self.bill.reference, '2026-10')
        self.assertEqual(self.bill.due.isoformat(), '2026-11-04')

    def test_reject_other_unit_even_same_address(self):
        with self.assertRaises(c.Review): c.parse_bill_text(TEXT.replace('13.170.665.018-99', '13.170.665.111-99'))

    def test_reject_bad_header_date_and_nonpositive_total(self):
        for text in [TEXT.replace('04/11/2026', '31/11/2026'), TEXT.replace('275,33', '0,00')]:
            with self.subTest(text=text), self.assertRaises(c.Review): c.parse_bill_text(text)

    def test_due_month_instead_of_reference_month(self):
        row = c.choose_target(self.store.children(), self.bill)
        self.assertEqual(row['Id'], 326)

    def test_year_rollover(self):
        bill = c.parse_bill_text(TEXT.replace('OUT/2026', 'DEZ/2026').replace('04/11/2026', '04/01/2027'))
        self.store.rows[(c.CHILD,326)]['DATA'] = '2027-01-04T03:00:00Z'
        self.assertEqual(c.choose_target(self.store.children(), bill)['Id'],326)

    def test_missing_target_waits(self):
        with self.assertRaises(c.Wait): c.choose_target([], self.bill)

    def test_duplicate_targets_review(self):
        rows = self.store.children()
        with self.assertRaises(c.Review): c.choose_target(rows + rows, self.bill)

    def test_wrong_recurrence_does_not_match(self):
        self.store.rows[(c.CHILD,326)]['IDRECORRENCIA'] = '34'
        with self.assertRaises(c.Wait): c.choose_target(self.store.children(), self.bill)

    def test_missing_parent_waits_without_writes(self):
        self.store.rows[(c.CHILD,326)]['DESCRITIVOPROVISAO'] = None
        with self.assertRaises(c.Wait): c.reconcile(self.store,self.bill,self.files)
        self.assertEqual(self.store.writes, [])

    def test_payment_month_changed_between_selection_and_lock_is_rejected(self):
        original=self.store.children
        def race():
            rows=original()
            self.store.rows[(c.CHILD,326)]['DATA']='2026-12-04T03:00:00Z'
            self.store.children=original
            return rows
        self.store.children=race
        with self.assertRaises(c.Review):c.reconcile(self.store,self.bill,self.files)
        self.assertEqual(sum(map(len,self.store.files.values())),0)

    def test_updates_both_totals_and_preserves_status(self):
        result = c.reconcile(self.store,self.bill,self.files)
        self.assertEqual(result['added'],2)
        for key,row in self.store.rows.items(): self.assertEqual(c.money(row['VALORTOTAL']),self.bill.amount)
        self.assertEqual(self.store.rows[(c.CHILD,326)]['STATUS'],'PAGAMENTO PREVISTO')

    def test_replay_is_noop_and_hash_dedupes_existing_names(self):
        self.store.files[(c.CHILD,326)] = [{'filename':'different-name.pdf','content':b'%PDF-original'}]
        first = c.reconcile(self.store,self.bill,self.files)
        second = c.reconcile(self.store,self.bill,self.files)
        self.assertEqual(first['added'],1)
        self.assertEqual(second['added'],0)
        self.assertEqual(second['updated'],0)

    def test_all_pdf_attachments_and_duplicate_payloads(self):
        self.files += [{'filename':'support.pdf','content':b'%PDF-support'},copy.deepcopy(self.files[0])]
        self.assertEqual(c.reconcile(self.store,self.bill,self.files)['added'],4)

    def test_paid_matching_bill_only_adds_missing_files(self):
        s=MemoryStore(paid=True)
        c.reconcile(s,self.bill,self.files)
        self.assertEqual(s.writes,[])

    def test_paid_conflicting_amount_blocks_all_writes_and_uploads(self):
        self.store.rows[(c.CHILD,326)]['PGTOAGENDADO']='PAGO'
        with self.assertRaises(c.Review): c.reconcile(self.store,self.bill,self.files)
        self.assertEqual(sum(map(len,self.store.files.values())),0)

    def test_parent_wrong_supplier_or_grouped_rejected(self):
        self.store.rows[(c.PARENT,13)]['FORNECEDOR']='OTHER'
        with self.assertRaises(c.Review): c.reconcile(self.store,self.bill,self.files)
        self.store.rows[(c.PARENT,13)]['FORNECEDOR']='CEMIG'
        row=copy.deepcopy(self.store.rows[(c.CHILD,326)]); row['Id']=327
        self.store.rows[(c.CHILD,327)]=row
        with self.assertRaises(c.Review): c.reconcile(self.store,self.bill,self.files)

    def test_interrupted_copy_retries_without_duplicate(self):
        self.store.fail_put=c.PARENT
        with self.assertRaises(RuntimeError): c.reconcile(self.store,self.bill,self.files)
        self.store.fail_put=None
        self.assertEqual(c.reconcile(self.store,self.bill,self.files)['added'],1)

    def test_partial_value_write_compensates_parent(self):
        self.store.fail_write=c.CHILD
        with self.assertRaises(RuntimeError): c.reconcile(self.store,self.bill,self.files)
        self.assertEqual(c.money(self.store.rows[(c.PARENT,13)]['VALORTOTAL']),Decimal('0'))
        self.store.fail_write=None
        c.reconcile(self.store,self.bill,self.files)
        self.assertEqual(c.money(self.store.rows[(c.PARENT,13)]['VALORTOTAL']),self.bill.amount)

    def test_committed_child_write_with_lost_response_does_not_revert_parent(self):
        original=self.store.write
        def lost_response(kind,ident,fields,etag):
            original(kind,ident,fields,etag)
            if kind==c.CHILD: raise RuntimeError('response lost after commit')
        self.store.write=lost_response
        c.reconcile(self.store,self.bill,self.files)
        self.assertEqual(c.money(self.store.rows[(c.PARENT,13)]['VALORTOTAL']),self.bill.amount)
        self.assertEqual(c.money(self.store.rows[(c.CHILD,326)]['VALORTOTAL']),self.bill.amount)

    def test_dry_run_does_not_write_or_upload(self):
        r=c.reconcile(self.store,self.bill,self.files,dry_run=True)
        self.assertEqual(r['plannedFiles'],2)
        self.assertEqual(self.store.writes,[])
        self.assertEqual(sum(map(len,self.store.files.values())),0)

    def test_email_scope_is_strict(self):
        for sender,body in [('other@example.com','XAVANTE ANTONIO TORRES'),('fatura@cemig.com.br','ALAMEDA OSCAR NIEMEYER')]:
            with self.subTest(sender=sender),self.assertRaises(c.Review): c.validate_email({'from':sender,'subject':'CEMIG FATURA ONLINE','body':body})

    def test_address_aliases_accepted(self):
        for number in ['130','134']:
            c.validate_email({'from':'fatura@cemig.com.br','subject':'CEMIG FATURA ONLINE','body':f'RUA ANTONIO TORRES DOS SANTOS {number} XAVANTE'})

    def test_older_replay_cannot_replace_newer_completed_invoice(self):
        rows=[{'State':'DONE','Result':'{"reference":"2026-10","due":"2026-11-04","emailReceived":"2026-10-21T13:00:00Z"}'}]
        self.assertTrue(c.superseded(rows,self.bill,'2026-10-20T13:00:00Z'))
        self.assertFalse(c.superseded(rows,self.bill,'2026-10-22T13:00:00Z'))
        self.assertFalse(c.superseded(rows,c.parse_bill_text(TEXT.replace('OUT/2026','NOV/2026').replace('04/11/2026','04/12/2026')),'2026-10-20T13:00:00Z'))

    def test_durable_receiving_item_recovers_after_grace_period(self):
        now=datetime(2026,11,5,4,0,tzinfo=timezone.utc)
        self.assertTrue(c.queue_ready({'State':'RECEIVING','Created':'2026-11-05T03:00:00Z'},now))
        self.assertFalse(c.queue_ready({'State':'RECEIVING','Created':'2026-11-05T03:59:00Z'},now))


if __name__ == '__main__': unittest.main()
