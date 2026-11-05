"""Ensure a bill reaches exactly its monthly pair, never a recurrence's history."""
import copy
import base64
import unittest
from types import SimpleNamespace
from datetime import date
from decimal import Decimal
from unittest.mock import Mock,patch

import cemig_sync as c
from test_cemig_sync import MemoryStore, TEXT

OFFICE_UNIT='1003321701890'
OFFICE_BRANCH='000 - ESCRITÓRIO CENTRAL'
OFFICE_TEXT=('CEMIG DISTRIBUICAO S.A. TITULAR FICTICIO\n'
             'ALM OSCAR NIEMEYER 1033 SA 904. VILA DA SERRA\n'
             '10.033.217.018-90\nOUT/2026 11/12/2026 64,84\n')


def multiple_months():
    store=MemoryStore()
    store.rows={};store.versions={};store.files={}
    for recurrence,branch in [('4',OFFICE_BRANCH),('33',c.BRANCH)]:
        for month in [10,11,12]:
            child=int(recurrence)*100+month
            parent=child+10000
            store.rows[(c.CHILD,child)]={'Id':child,'IDRECORRENCIA':recurrence,'FILIAL':branch,
                'FORNECEDOR':'CEMIG','DATA':f'2026-{month:02}-11T03:00:00Z',
                'DESCRITIVOPROVISAO':str(parent),'VALORTOTAL':'0','STATUS':'PAGAMENTO PREVISTO'}
            store.rows[(c.PARENT,parent)]={'Id':parent,'FILIAL':branch,'FORNECEDOR':'CEMIG','VALORTOTAL':'0'}
            for key in [(c.CHILD,child),(c.PARENT,parent)]:
                store.versions[key]=1;store.files[key]=[]
    return store


class MonthlyScopeTests(unittest.TestCase):
    def test_office_pdf_resolves_recurrence_four(self):
        bill=c.parse_bill_text(OFFICE_TEXT)
        self.assertEqual(bill.unit,OFFICE_UNIT)
        self.assertEqual(bill.reference,'2026-10')
        self.assertEqual(bill.due,date(2026,12,11))
        self.assertEqual(bill.amount,Decimal('64.84'))
        self.assertEqual(c.profile_for_unit(bill.unit).recurrence,'4')

    def test_office_email_accepts_only_exact_building_and_room(self):
        email={'from':'fatura@cemig.com.br','subject':'CEMIG FATURA ONLINE','body':OFFICE_TEXT}
        self.assertEqual(c.validate_email(email).recurrence,'4')
        for body in [OFFICE_TEXT.replace('1033','1034'),OFFICE_TEXT.replace('904','905')]:
            with self.subTest(body=body),self.assertRaises(c.Review):c.validate_email({**email,'body':body})

    def test_email_and_pdf_property_must_match(self):
        office=c.profile_for_unit(OFFICE_UNIT)
        with self.assertRaises(c.Review):c.parse_bill_text(TEXT,profile=office)

    def test_each_property_changes_only_its_own_monthly_pair(self):
        for text,recurrence,month in [(TEXT,33,11),(OFFICE_TEXT,4,12)]:
            with self.subTest(recurrence=recurrence):
                store=multiple_months()
                before_rows=copy.deepcopy(store.rows)
                before_files=copy.deepcopy(store.files)
                bill=c.parse_bill_text(text)
                result=c.reconcile(store,bill,[{'filename':'fatura.pdf','content':b'%PDF-source'}])
                target=recurrence*100+month
                self.assertEqual((result['child'],result['parent']),(target,target+10000))
                touched={(c.CHILD,target),(c.PARENT,target+10000)}
                for key in set(store.rows)-touched:
                    self.assertEqual(store.rows[key],before_rows[key],key)
                    self.assertEqual(store.files[key],before_files[key],key)
                self.assertEqual(result['added'],2)
                self.assertEqual(result['updated'],2)

    def test_missing_office_month_never_falls_back_to_another_month(self):
        store=multiple_months()
        del store.rows[(c.CHILD,412)]
        with self.assertRaises(c.Wait):c.choose_target(store.children(),c.parse_bill_text(OFFICE_TEXT))
        self.assertEqual(store.writes,[])

    def test_same_recurrence_other_branch_cannot_receive_invoice(self):
        store=multiple_months()
        store.rows[(c.CHILD,412)]['FILIAL']=c.BRANCH
        with self.assertRaises(c.Wait):c.choose_target(store.children(),c.parse_bill_text(OFFICE_TEXT))

    def test_shared_parent_across_months_blocks_entire_operation(self):
        for text,recurrence,month in [(TEXT,33,11),(OFFICE_TEXT,4,12)]:
            store=multiple_months();target=recurrence*100+month
            other=recurrence*100+(10 if month!=10 else 11)
            store.rows[(c.CHILD,other)]['DESCRITIVOPROVISAO']=str(target+10000)
            with self.subTest(recurrence=recurrence),self.assertRaises(c.Review):
                c.reconcile(store,c.parse_bill_text(text),[{'filename':'fatura.pdf','content':b'%PDF-source'}])
            self.assertEqual(store.writes,[])
            self.assertFalse(any(store.files.values()))

    def test_freshness_isolated_by_consumer_unit(self):
        bill=c.parse_bill_text(OFFICE_TEXT)
        rows=[{'State':'DONE','Result':'{"unit":"1317066501899","reference":"2026-10","due":"2026-12-04","emailReceived":"2026-11-10T13:00:00Z"}'}]
        self.assertFalse(c.superseded(rows,bill,'2026-11-04T12:27:01Z'))

    def test_office_password_prefix_comes_from_existing_supplier_in_memory(self):
        client=Mock()
        client.get_item_fields.return_value={'Title':'BERNARDO','DOCUMENTOFORNECEDOR':'123.456.789-00'}
        self.assertEqual(c.pdf_password(c.profile_for_unit(OFFICE_UNIT),client),'1234')
        client.get_item_fields.assert_called_once_with(11,['Title','DOCUMENTOFORNECEDOR'],target_list='FORNECEDORES')

    def test_office_password_lookup_rejects_other_supplier_identity(self):
        client=Mock()
        client.get_item_fields.return_value={'Title':'OTHER','DOCUMENTOFORNECEDOR':'123.456.789-00'}
        with self.assertRaises(c.Review):c.pdf_password(c.profile_for_unit(OFFICE_UNIT),client)

    def test_transient_document_lookup_failure_remains_retryable(self):
        reader=Mock(is_encrypted=True)
        email={'from':'fatura@cemig.com.br','subject':'CEMIG FATURA ONLINE','body':OFFICE_TEXT,
               'attachments':[{'name':'fatura.pdf','contentBytes':base64.b64encode(b'%PDF-source').decode()}]}
        resolver=Mock(side_effect=TimeoutError('temporary SharePoint timeout'))
        with patch.dict('sys.modules',{'pypdf':SimpleNamespace(PdfReader=lambda _:reader)}):
            with self.assertRaises(TimeoutError):c.extract_email(email,password_resolver=resolver)


if __name__=='__main__':unittest.main()
