import copy
from contextlib import nullcontext
from datetime import date
from decimal import Decimal
import unittest
from unittest.mock import patch
import tempfile
from pathlib import Path
import silva_novais as s

CHARGE='abcdefghijklmnop'
def email(kind='boleto',company='ENERGETICA CONSTRUCOES LTDA'):
    body=f'CONTABILIDADE SILVA NOVAIS LTDA 14.647.910/0001-75\nOlá, {company}\nR$ 123,45 '
    body+=f'vence em 10/11/2026 [cobrança](https://www.asaas.com/i/{CHARGE})'
    if kind=='nfse':body+=' [Visualizar Nota Fiscal](https://www.asaas.com/000/file/public/download/FAKE?preview=true)'
    return {'id':'fake-mail-'+kind,'from':s.BILL_SENDER if kind=='boleto' else s.NF_SENDER,'subject':'Aviso de cobrança' if kind=='boleto' else s.NF_SUBJECT,'body':body,'receivedDateTime':'2026-10-26T09:00:00Z'}

class MailTests(unittest.TestCase):
    def test_matches_charge_id_and_due_not_issue_month(self):
        bill=s.parse_email(email())
        nf=s.parse_email(email('nfse'))
        self.assertEqual(bill.charge,CHARGE)
        self.assertEqual(nf.charge,bill.charge)
        self.assertEqual(bill.due,date(2026,11,10))
        self.assertEqual(nf.kind,'nfse')
    def test_other_company_or_sender_is_rejected(self):
        for bad in [email(company='NB PARTICIPACOES E IMOVEIS LTDA'),{**email(),'from':'attacker@example.org'}]:
            with self.assertRaises(s.Review):s.parse_email(bad)
    def test_multiple_charge_ids_and_amounts_are_rejected(self):
        for extra in [' https://www.asaas.com/i/otherchargeid',' R$ 300,00']:
            with self.assertRaises(s.Review):s.parse_email({**email(),'body':email()['body']+extra})
    def test_html_email_is_supported(self):
        raw=email('nfse');raw['body']='<p>CONTABILIDADE SILVA NOVAIS LTDA 14.647.910/0001-75</p><p>Olá, ENERGETICA CONSTRUCOES LTDA</p><p>R$ 123,45</p><a href="https://www.asaas.com/i/'+CHARGE+'">cobrança</a><a href="https://www.asaas.com/000/file/public/download/FAKE">Visualizar Nota Fiscal</a>'
        self.assertEqual(s.parse_email(raw).charge,CHARGE)

def row():return {'Id':701,'IDRECORRENCIA':'28','FILIAL':s.BRANCH,'FORNECEDOR':s.SUPPLIER,'PRODUTO':'CONTABILIDADE','DATA':'2026-11-10T03:00:00Z','DATAPREVISTOPGTO':'2026-11-10T03:00:00Z','VALORTOTAL':'123,45','DESCRITIVOPROVISAO':'901','STATUS':'PAGAMENTO PREVISTO'}
class TargetTests(unittest.TestCase):
    def test_exact_due_and_amount(self):
        self.assertEqual(s.choose_target([row()],date(2026,11,10),Decimal('123.45'))['Id'],701)
        for change in [{'DATA':'2026-10-10'},{'DATAPREVISTOPGTO':'2026-11-11'},{'IDRECORRENCIA':'34'},{'VALORTOTAL':'300'},{'FILIAL':'Outra filial'}]:
            with self.subTest(change=change),self.assertRaises(s.Wait):s.choose_target([{**row(),**change}],date(2026,11,10),Decimal('123.45'))
    def test_duplicate_month_and_wrong_day_are_not_guessed(self):
        with self.assertRaises(s.Review):s.choose_target([row(),{**row(),'Id':334}],date(2026,11,10),Decimal('123.45'))
        with self.assertRaises(s.Wait):s.choose_target([row()],date(2026,11,11),Decimal('123.45'))

class DownloadTests(unittest.TestCase):
    def test_checkout_redirect_cannot_change_monthly_charge(self):
        with self.assertRaises(s.Review):s.validate_checkout_url('https://www.asaas.com/i/anothercharge',CHARGE)
        s.validate_checkout_url('https://www.asaas.com/i/'+CHARGE,CHARGE)
    def test_paid_charge_still_downloads_available_original_boleto(self):
        source=s.Source('boleto',CHARGE,Decimal('123.45'),date(2026,11,10))
        doc=s.Document('boleto',CHARGE,b'%PDF-original','charge:'+CHARGE)
        class Download:
            def pdf(self,*args):return b'%PDF-original'
        with patch.object(s,'validate_document',return_value=doc):
            self.assertEqual(s.download_boleto(Download(),source,date(2026,11,10),True),(doc,None))
    def test_cache_reuses_original_and_recovers_incomplete_metadata_commit(self):
        with tempfile.TemporaryDirectory() as temp:
            cache=s.Downloads(temp)
            path=Path(temp)/(CHARGE+'-boleto.pdf');path.write_bytes(b'%PDF-interrupted')
            with patch.object(cache,'fetch',return_value=('https://www.asaas.com/b/pdf/'+CHARGE,b'%PDF-recovered')):
                self.assertEqual(cache.pdf(CHARGE,'boleto','https://www.asaas.com/b/pdf/'+CHARGE),b'%PDF-recovered')
            with patch.object(cache,'fetch',side_effect=AssertionError('must reuse first confirmed original')):
                self.assertEqual(cache.pdf(CHARGE,'boleto','https://www.asaas.com/b/pdf/'+CHARGE),b'%PDF-recovered')
    def test_only_exact_public_asaas_hosts_and_paths(self):
        for url in ['http://www.asaas.com/i/'+CHARGE,'https://www.asaas.com.evil.test/i/'+CHARGE,'https://127.0.0.1/i/'+CHARGE,'https://www.asaas.com/admin','https://user:secret@www.asaas.com/i/'+CHARGE]:
            with self.subTest(url=url),self.assertRaises(s.Review):s.validate_url(url)
        s.validate_url('https://www.asaas.com/b/pdf/'+CHARGE)
        s.validate_url('https://www.asaas.com/file/public/download/FAKE')
        s.validate_url('https://url2064.asaas.com.br/ls/click?upn=fake')

class MemoryStore:
    def __init__(self,parent=True,paid=False):
        child=row()
        if not parent:child.pop('DESCRITIVOPROVISAO')
        if paid:child.update(STATUS='PAGAMENTO EFETUADO',DATAPGTOEFETUADO='2026-11-10',IDLANCAMENTOS='999')
        self.rows={(s.CHILD,701):child,(s.PARENT,901):{'Id':901,'FORNECEDOR':s.SUPPLIER,'FILIAL':s.BRANCH,'VALORTOTAL':'123.45','DATAPREVISTOPGTO':'2026-11-10'}}
        self.files={key:[] for key in self.rows};self.puts=[]
    def children(self):return [copy.deepcopy(self.rows[(s.CHILD,701)])]
    def read(self,kind,ident):return copy.deepcopy(self.rows[(kind,ident)]),'1'
    def attachments(self,kind,ident):return copy.deepcopy(self.files[(kind,ident)])
    def lock(self,parent):return nullcontext()
    def put(self,kind,ident,name,content):self.files[(kind,ident)].append({'filename':name,'content':content});self.puts.append((kind,ident,name))

class ReconcileTests(unittest.TestCase):
    def test_existing_child_boleto_is_forwarded_to_finish_missing_parent_copy(self):
        source=s.Source('boleto',CHARGE,Decimal('123.45'),date(2026,11,10))
        original=s.Document('boleto',CHARGE,b'%PDF-existing-boleto','charge:'+CHARGE)
        files=[{'filename':'existing-boleto.pdf','content':original.content}]
        with patch.object(s,'document_identity',return_value=('boleto','charge:'+CHARGE)),patch.object(s,'validate_document',return_value=original):
            found=s.existing_boleto(files,source,date(2026,11,10))
        self.assertEqual(found,original)
        store=MemoryStore();store.files[(s.CHILD,701)]=files
        result=s.attach_documents(store,date(2026,11,10),Decimal('123.45'),[found],identity_reader=lambda b:('boleto','charge:'+CHARGE))
        self.assertEqual(result['added'],1)
        self.assertEqual(store.puts[0][0],s.PARENT)
    def test_mirrors_with_provenance_preserves_financials_and_replay(self):
        store=MemoryStore(paid=True);before=copy.deepcopy(store.rows)
        files=[s.Document('nfse',CHARGE,b'%PDF-fake',identity='NF-123')]
        result=s.attach_documents(store,date(2026,11,10),Decimal('123.45'),files,identity_reader=lambda b:None)
        self.assertEqual(result['added'],2)
        self.assertTrue(store.puts[1][2].startswith('PROV-701-'))
        self.assertEqual(store.rows,before)
        self.assertEqual(s.attach_documents(store,date(2026,11,10),Decimal('123.45'),files,identity_reader=lambda b:None)['added'],0)
    def test_historical_child_without_parent_does_not_create_a_link(self):
        store=MemoryStore(parent=False);before=copy.deepcopy(store.rows)
        result=s.attach_documents(store,date(2026,11,10),Decimal('123.45'),[s.Document('nfse',CHARGE,b'%PDF-fake',identity='NF-123')],identity_reader=lambda b:None)
        self.assertEqual(result['added'],1);self.assertEqual(store.rows,before)
    def test_same_invoice_with_different_bytes_is_not_duplicated(self):
        store=MemoryStore(parent=False);store.files[(s.CHILD,701)]=[{'filename':'existing.pdf','content':b'%PDF-old'}]
        result=s.attach_documents(store,date(2026,11,10),Decimal('123.45'),[s.Document('nfse',CHARGE,b'%PDF-new',identity='NF-123')],identity_reader=lambda b:('nfse','NF-123'))
        self.assertEqual(result['added'],0)
    def test_dry_run_does_not_upload(self):
        store=MemoryStore();result=s.attach_documents(store,date(2026,11,10),Decimal('123.45'),[s.Document('nfse',CHARGE,b'%PDF-fake',identity='NF-123')],dry_run=True,identity_reader=lambda b:None)
        self.assertEqual(result['planned'],2);self.assertEqual(store.puts,[])

if __name__=='__main__':unittest.main()
