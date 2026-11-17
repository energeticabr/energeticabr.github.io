import copy
import json
import unittest
from unittest.mock import patch

from dda_fiscal_worker import FiscalBridge, reconcile
from test_dda_fiscal_reconcile import FakeStore,bill,note

PDF=b'%PDF-1.4\n'+b'x'*150+b'\n%%EOF\n'


class Store(FakeStore):
    def __init__(self,rows):super().__init__();self.rows=rows
    def inventory(self):return copy.deepcopy(self.rows)


class Bridge:
    def __init__(self,notes):self.notes=notes;self.downloaded=None
    def inventory(self):return copy.deepcopy(self.notes)
    def pdf(self,item_id):return 'DANFE-123.pdf',PDF,copy.deepcopy(self.downloaded or self.notes[0])


class WorkerTests(unittest.TestCase):
    def test_conflicting_existing_pdf_is_review_and_never_overwritten(self):
        store=Store([bill()]);store.files['FISCAL-old.pdf']=b'old'
        result=reconcile(store,Bridge([note()]),True)
        self.assertFalse(result['errors']);self.assertEqual(result['reviews'][0]['code'],'CONFLICTING_FISCAL_ATTACHMENT')
        self.assertEqual(store.writes,0);self.assertEqual(store.files['FISCAL-old.pdf'],b'old')

    def test_rerun_is_idempotent_and_does_not_mutate_fields(self):
        store=Store([bill()]);bridge=Bridge([note()]);before=copy.deepcopy(store.rows)
        self.assertEqual(reconcile(store,bridge,True)['receipts'][0]['status'],'linked')
        self.assertEqual(reconcile(store,bridge,True)['receipts'][0]['status'],'already_linked')
        self.assertEqual(store.writes,1);self.assertEqual(store.rows,before)

    def test_changed_fatura_during_download_prevents_write(self):
        store=Store([bill()]);bridge=Bridge([note(VALOR_LIQUIDO=None,VALOR_LIQUIDO_FATURA='10')])
        bridge.downloaded=note(VALOR_LIQUIDO=None,VALOR_LIQUIDO_FATURA='20')
        result=reconcile(store,bridge,True)
        self.assertEqual(store.writes,0)
        self.assertEqual(result['errors'][0]['code'],'FISCAL_CHANGED_DURING_DOWNLOAD')

    def test_dryrun_does_not_download_or_write(self):
        store=Store([bill()]);bridge=Bridge([note()])
        with patch.object(bridge,'pdf',side_effect=AssertionError('must not download')):
            self.assertTrue(reconcile(store,bridge)['plan']['links'])
        self.assertEqual(store.writes,0)

    def test_new_competing_bill_before_write_prevents_attachment(self):
        store=Store([bill()]);bridge=Bridge([note()])
        old=bridge.pdf
        def download(item_id):
            store.rows.append(bill(2))
            return old(item_id)
        bridge.pdf=download
        result=reconcile(store,bridge,True)
        self.assertEqual(store.writes,0)
        self.assertEqual(result['errors'][0]['code'],'MATCH_CHANGED_BEFORE_WRITE')

    def test_fiscal_pagination_continues_after_short_page_and_rejects_repeat(self):
        bridge=FiscalBridge({'uri':'https://test.api.powerplatform.com/workflows/123abc/triggers/manual?sig=secret'})
        with patch.object(bridge,'call',side_effect=[{'page':{'value':[{'Id':3}]}},{'page':{'value':[{'Id':9}]}},{'page':{'value':[]}}]) as call:
            self.assertEqual([r['Id'] for r in bridge.inventory()],[3,9])
            self.assertEqual(call.call_count,3)
        with patch.object(bridge,'call',side_effect=[{'page':{'value':[{'Id':3}]}},{'page':{'value':[{'Id':3}]}}]):
            with self.assertRaises(ValueError):bridge.inventory()


if __name__=='__main__':unittest.main()

