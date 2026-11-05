import base64
import copy
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import cemig_sync as c
from flow_definition import definition
from test_cemig_sync import MemoryStore
from test_month_scope import multiple_months

LINE='75691.31134 01210.372908 00620.290015 4 16210000009980'
BODY=('Lembrete da Conta Petranet OLÁ, BERNARDO NOTINI MOREIRA BAHIA '
      'Número da Fatura: 6202 Mês de Referência: 10/2026 '
      'Data de Vencimento: 05/11/2026 Valor: R$ 99,80 '+LINE)
PDF=('Petranet Internet Cprnet LP Ltda - 60.777.188/0001-00\n'
     'Recibo do Pagador\n'+LINE+'\nCarteira / Nosso número\n0006202-9\n'
     'Número do documento\nCPF/CNPJ\nVencimento\nValor documento\n'
     '261019073516090\n60.777.188/0001-00\n05/11/2026\nR$ 99,80\n'
     'Pagador\n11721 - Bernardo Notini Moreira Bahia - CPF: 123.456.789-00\n'
     'Rua Antonio Torres Dos Santos 134 Loja\nComunidade do Xavante - Divinopolis/MG\n')


def envelope(text=PDF,body=BODY):
    return {'from':'boleto@grupopetranet.com.br','subject':'Boleto da Petranet internet','body':body,
            'attachments':[{'name':'boleto.pdf','contentBytes':base64.b64encode(b'%PDF-original').decode()}]}


def extract(text=PDF,body=BODY):
    reader=Mock(is_encrypted=False,pages=[Mock(extract_text=lambda:text)])
    with patch.dict('sys.modules',{'pypdf':SimpleNamespace(PdfReader=lambda _:reader)}):
        return c.extract_email(envelope(text,body))


def history(paid=False):
    store=multiple_months()
    for month in [9,10,11,12]:
        child=1400+month;parent=child+10000
        store.rows[(c.CHILD,child)]={'Id':child,'IDRECORRENCIA':'14','FILIAL':c.BRANCH,'FORNECEDOR':'PETRANET',
            'DATA':f'2026-{month:02}-05T03:00:00Z','DESCRITIVOPROVISAO':str(parent),
            'VALORTOTAL':'99,80' if paid else '0','DATAPGTOEFETUADO':'2026-11-04T12:00:00Z' if paid else None}
        store.rows[(c.PARENT,parent)]={'Id':parent,'FILIAL':c.BRANCH,'FORNECEDOR':'PETRANET',
                                     'VALORTOTAL':'99.80' if paid else '0'}
        for key in [(c.CHILD,child),(c.PARENT,parent)]:
            store.versions[key]=1;store.files[key]=[]
    return store


class PetranetTests(unittest.TestCase):
    def test_extract_original_provider_bill(self):
        bill,files=extract()
        self.assertEqual((bill.reference,bill.due,bill.amount),('2026-10',date(2026,11,5),Decimal('99.80')))
        self.assertEqual(c.profile_for_unit(bill.unit).recurrence,'14')
        self.assertEqual(files[0]['content'],b'%PDF-original')

    def test_bank_code_after_receipt_heading_is_not_a_customer(self):
        bill,_=extract(PDF.replace('Recibo do Pagador\n','Recibo do Pagador\n756-0\n'))
        self.assertEqual(bill.amount,Decimal('99.80'))

    def test_screenshot_september_legacy_beneficiary_is_still_same_customer(self):
        oldline='75691.31134 01181.223809 00425.480019 1 15600000009980'
        text=(PDF.replace('Petranet Internet Cprnet LP Ltda','Petranet Internet LP Servicos e Instalacoes Ltda')
              .replace('60.777.188/0001-00','57.145.714/0001-05').replace(LINE,oldline)
              .replace('6202','4254').replace('05/11/2026','05/09/2026'))
        body=BODY.replace(LINE,oldline).replace('6202','4254').replace('05/11/2026','05/09/2026').replace('10/2026','08/2026')
        bill,_=extract(text,body)
        self.assertEqual((bill.reference,bill.due),('2026-08',date(2026,9,5)))

    def test_multiple_beneficiary_documents_are_not_accepted(self):
        text=PDF+'\nPetranet Internet LP Servicos e Instalacoes Ltda - 57.145.714/0001-05'
        with self.assertRaises(c.Review):extract(text)

    def test_sender_subject_and_recipient_name_are_exact(self):
        for change in [{'from':'rdstation@petranet.com.br'},{'subject':'Re: Boleto da Petranet internet'},
                       {'body':BODY.replace('BERNARDO NOTINI MOREIRA BAHIA','OUTRO CLIENTE')}]:
            with self.subTest(change=change),self.assertRaises(c.Review):c.validate_email({**envelope(),**change})

    def test_email_pdf_mismatches_require_review(self):
        for text in [PDF.replace('6202','6203'),PDF.replace('11721','11722'),PDF.replace('134 Loja','135 Loja'),
                     PDF.replace('Xavante','Outro'),PDF.replace('05/11/2026','05/12/2026'),
                     PDF.replace('R$ 99,80','R$ 100,00'),PDF.replace('60.777.188/0001-00','60.777.188/0002-00'),
                     PDF.replace('16210000009980','16210000009981')]:
            with self.subTest(text=text),self.assertRaises(c.Review):extract(text)

    def test_ambiguous_or_invalid_email_totals_dates_and_references_require_review(self):
        for body in [BODY+' Valor: R$ 100,00',BODY.replace('05/11/2026','31/11/2026'),
                     BODY.replace('10/2026','13/2026'),BODY.replace('R$ 99,80','R$ 0,00'),
                     BODY.replace('16210000009980','16210000009981')]:
            with self.subTest(body=body),self.assertRaises(c.Review):extract(body=body)

    def test_only_due_month_pair_receives_files_and_total(self):
        bill,files=extract();store=history();rows=copy.deepcopy(store.rows);oldfiles=copy.deepcopy(store.files)
        report=c.reconcile(store,bill,files)
        self.assertEqual((report['child'],report['parent']),(1411,11411))
        self.assertEqual((report['added'],report['updated']),(2,2))
        for key in rows.keys()-{(c.CHILD,1411),(c.PARENT,11411)}:
            self.assertEqual(store.rows[key],rows[key]);self.assertEqual(store.files[key],oldfiles[key])
        self.assertTrue(store.files[(c.CHILD,1411)][0]['filename'].startswith('PETRANET-'))
        replay=c.reconcile(store,bill,files)
        self.assertEqual((replay['added'],replay['updated']),(0,0))

    def test_paid_matching_pair_only_gets_missing_originals(self):
        bill,files=extract();store=history(True);rows=copy.deepcopy(store.rows)
        report=c.reconcile(store,bill,files)
        self.assertEqual((report['added'],report['updated']),(2,0))
        self.assertEqual(store.rows,rows)

    def test_paid_amount_mismatch_blocks_all_writes(self):
        bill,files=extract();store=history(True);store.rows[(c.PARENT,11411)]['VALORTOTAL']='100'
        with self.assertRaises(c.Review):c.reconcile(store,bill,files)
        self.assertFalse(any(store.files.values()));self.assertEqual(store.writes,[])

    def test_missing_month_parent_and_grouped_parent_never_borrow_another_pair(self):
        bill,files=extract()
        for mode in ['month','parent','grouped']:
            store=history()
            if mode=='month':del store.rows[(c.CHILD,1411)]
            if mode=='parent':store.rows[(c.CHILD,1411)]['DESCRITIVOPROVISAO']=None
            if mode=='grouped':store.rows[(c.CHILD,1410)]['DESCRITIVOPROVISAO']='11411'
            with self.subTest(mode=mode),self.assertRaises(c.Review if mode=='grouped' else c.Wait):
                c.reconcile(store,bill,files)
            self.assertFalse(any(store.files.values()));self.assertEqual(store.writes,[])

    def test_freshness_isolated_from_legacy_cemig_results(self):
        bill,_=extract()
        row={'State':'DONE','Result':'{"reference":"2026-10","due":"2026-11-04","emailReceived":"2026-11-05T01:00:00Z"}'}
        self.assertFalse(c.superseded([row],bill,'2026-11-04T03:52:55Z'))

    def test_newer_petranet_delivery_blocks_stale_overwrite(self):
        import json
        bill,_=extract()
        row={'State':'DONE','Result':json.dumps({'unit':bill.unit,'reference':bill.reference,
            'due':bill.due.isoformat(),'emailReceived':'2026-11-05T01:00:00Z'})}
        self.assertTrue(c.superseded([row],bill,'2026-11-04T03:52:55Z'))

    def test_every_pdf_must_belong_to_the_same_invoice(self):
        email=envelope()
        email['attachments']*=2
        readers=[Mock(is_encrypted=False,pages=[Mock(extract_text=lambda:PDF)]),
                 Mock(is_encrypted=False,pages=[Mock(extract_text=lambda:PDF.replace('6202','9999'))])]
        with patch.dict('sys.modules',{'pypdf':SimpleNamespace(PdfReader=lambda _:readers.pop(0))}):
            with self.assertRaises(c.Review):c.extract_email(email)

    def test_petranet_event_filter_and_queue_preserve_cemig(self):
        before=definition('queue-guid')
        d=definition('queue-guid',provider='petranet')
        trigger=d['triggers']['email']['inputs']['parameters']
        self.assertEqual(trigger['from'],'boleto@grupopetranet.com.br')
        self.assertEqual(trigger['subjectFilter'],'Boleto da Petranet internet')
        condition=str(d['actions']['Only_configured_properties']['expression'])
        self.assertIn('BERNARDO NOTINI MOREIRA BAHIA',condition)
        self.assertNotIn('ANTONIO TORRES',condition)
        self.assertEqual(definition('queue-guid'),before)


if __name__=='__main__':unittest.main()
