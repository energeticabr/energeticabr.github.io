import importlib
from io import BytesIO
import unittest
from unittest.mock import patch
from pathlib import Path
from pypdf import PdfReader
from reportlab.pdfgen.canvas import Canvas

HERE=Path(__file__).parent

def row(**changes):
    result={'Id':101,'CHAVEIMPORTACAO':'a'*64,'ORIGEMMOVIMENTACAO':'SICOOB','OPERACAO':'DÉBITO',
            'CONTAPAGADORA':'123456','DATAPAGAMENTO':'2026-11-19T12:00:00Z','VALOR':'23,50',
            'DESCRICAO':'PIX EMITIDO OUTRA IF | Pix enviado|@Pessoa Exemplo|@***.123.456-**|@',
            'REFERENCIABANCARIA':'Pix','RAZAOSOCIALRECEBEDOR':'Pessoa Exemplo',
            'DOCUMENTORECEBEDOR':None,'Attachments':False}
    result.update(changes);return result

PAYER={'nome':'EMPRESA EXEMPLO LTDA','cpfCnpj':'12345678000190','conta':'123456','ispb':'25536764'}

class Client:
    def __init__(self,rows):
        self.rows={r['Id']:dict(r) for r in rows};self.files={};self.writes=[];self.uncertain=False
    def get_item_fields(self,item,fields,target):return {k:self.rows[item].get(k) for k in fields}
    def get_item_attachments(self,item,target):return list(self.files.get(item,[]))
    def get_attachment_names(self,item,target):return {f['filename'] for f in self.files.get(item,[])}
    def ensure_attachment(self,item,name,content,mime,target_list):
        self.writes.append((item,name));self.files.setdefault(item,[]).append({'filename':name,'content':content})
        if self.uncertain:raise RuntimeError('upload result unknown')
    def _list_endpoint(self,target):
        return 'web/lists/TestMovements'
    def _request(self,method,endpoint,**kwargs):
        item='items(101)'
        name='Demonstrativo-Energetico-Sicoob-101.pdf'
        url='/movements/Attachments/101/'+name
        attachment=f"{self._list_endpoint(None)}/{item}/AttachmentFiles('{name}')"
        if method=='GET' and endpoint==attachment:
            return {'ServerRelativeUrl':url}
        if method=='GET' and endpoint==f"web/GetFileByServerRelativeUrl('{url}')":
            return {'ETag':'"generated-v1"'}
        if method=='POST' and endpoint==attachment+'/$value':
            assert kwargs['headers']['X-HTTP-Method']=='PUT'
            assert kwargs['headers']['If-Match']=='"generated-v1"'
            self.writes.append((101,name))
            next(f for f in self.files[101] if f['filename']==name)['content']=kwargs['data']
            if self.uncertain:raise RuntimeError('upload result unknown')
            return {}
        raise AssertionError((method,endpoint))

class GeneratedReceiptTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((HERE/'sync_generated_receipts.py').exists(),'generated receipt stage is missing')
        self.sync=importlib.import_module('sync_generated_receipts')
        self.render=importlib.import_module('generated_receipt')
    def reconcile(self,client,rows,bank=None,**kwargs):
        return self.sync.reconcile(client,rows,bank if bank is not None else rows,PAYER,**kwargs)
    def test_cutoff_excludes_all_old_dates_and_manual_rows(self):
        for r in [row(DATAPAGAMENTO='2026-11-18T12:00:00Z'),row(ORIGEMMOVIMENTACAO='MANUAL'),row(OPERACAO='CRÉDITO')]:
            with self.subTest(r=r):self.assertFalse(self.sync.eligible(r))
        self.assertTrue(self.sync.eligible(row()))
        self.assertTrue(self.sync.eligible(row(DATAPAGAMENTO='2026-11-20T12:00:00Z')))
    def test_statement_identity_must_match_before_any_upload(self):
        for changes in [{'VALOR':'23,51'},{'CONTAPAGADORA':'999999'},{'CHAVEIMPORTACAO':'b'*64},
                        {'DATAPAGAMENTO':'2026-11-20T12:00:00Z'},{'DESCRICAO':'PIX OUTRO'}, {'REFERENCIABANCARIA':'Outra'}]:
            c=Client([row()]);result=self.reconcile(c,[row()],[row(**changes)])
            self.assertEqual(result['failed'],1);self.assertEqual(c.writes,[])
    def test_upload_readback_and_retry_keep_one_pdf_and_originals(self):
        old=row(Id=99,CHAVEIMPORTACAO='c'*64,DATAPAGAMENTO='2026-11-18T12:00:00Z');c=Client([old,row()])
        original={'filename':'comprovante-bancario.pdf','content':b'original'};c.files[101]=[original]
        first=self.reconcile(c,[old,row()]);again=self.reconcile(c,[old,row()])
        self.assertEqual(first,{'eligible':1,'attached':1,'already_attached':0,'failed':0})
        self.assertEqual(again,{'eligible':1,'attached':0,'already_attached':1,'failed':0})
        self.assertEqual(len(c.writes),1);self.assertEqual(c.files[101][0],original);self.assertNotIn(99,c.files)
    def test_uncertain_accepted_upload_is_reconciled_without_duplicate(self):
        c=Client([row()]);c.uncertain=True
        self.assertEqual(self.reconcile(c,[row()])['attached'],1)
        self.assertEqual(self.reconcile(c,[row()])['already_attached'],1)
        self.assertEqual(len(c.writes),1)
    def test_concurrent_financial_change_refuses_attachment(self):
        c=Client([row(VALOR='99,99')]);self.assertEqual(self.reconcile(c,[row()])['failed'],1)
        self.assertEqual(c.writes,[])
    def test_invalid_existing_same_filename_is_not_overwritten(self):
        c=Client([row()]);c.files[101]=[{'filename':self.sync.filename(101),'content':b'%PDF-invalid'}]
        self.assertEqual(self.reconcile(c,[row()])['failed'],1);self.assertEqual(c.writes,[])
    def test_duplicate_bank_key_and_receiver_conflict_are_rejected(self):
        c=Client([row()]);self.assertEqual(self.reconcile(c,[row()],[row(),row()])['failed'],1)
        self.assertEqual(self.reconcile(c,[row()],[row(RAZAOSOCIALRECEBEDOR='Outra pessoa')])['failed'],1)
        self.assertEqual(c.writes,[])
    def test_one_failed_row_does_not_drop_other_eligible_rows(self):
        other=row(Id=102,CHAVEIMPORTACAO='b'*64);c=Client([row(),other])
        result=self.reconcile(c,[row(),other],[other])
        self.assertEqual(result['failed'],1);self.assertEqual(result['attached'],1)
    def test_statement_pdf_does_not_invent_hour_or_end_to_end_or_final_status(self):
        content=self.render.render_receipt(row(),PAYER)
        reader=PdfReader(BytesIO(content));text=reader.pages[0].extract_text()
        self.assertEqual(len(reader.pages),1);self.assertGreater(len(reader.pages[0].images),0)
        for expected in ['23,50','19/11/2026','PESSOA EXEMPLO','***.123.456-**','Gerado pelo Energético','Não emitido pelo banco']:
            self.assertIn(expected,text)
        for invented in ['12:00:00','FINALIZADO','às 09:00','FINALIZADO_SUCESSO']:
            self.assertNotIn(invented,text)
        self.assertEqual(content,self.render.render_receipt(row(),PAYER))
    def test_real_pix_details_are_displayed_only_for_unique_matching_payment(self):
        eid='E'+'25536764'+'20261119'+'1223'+'ABCDEFGHIJK'
        pix={'endToEndId':eid,'valor':'23.50','estado':'FINALIZADO','horario':'2026-11-19T12:23:00Z',
             'origem':PAYER,'destino':{'nome':'Pessoa Exemplo','cpfCnpj':'98712345612','ispb':'18236120','conta':'123'}}
        text=PdfReader(BytesIO(self.render.render_receipt(row(),PAYER,pix=pix))).pages[0].extract_text()
        self.assertIn('09:23:00',text);self.assertIn(eid,text);self.assertIn('NU PAGAMENTOS',text)
    def test_long_names_are_wrapped_and_missing_fields_remain_explicit(self):
        content=self.render.render_receipt(row(RAZAOSOCIALRECEBEDOR='NOME MUITO EXTENSO '*18),PAYER)
        reader=PdfReader(BytesIO(content));self.assertEqual(len(reader.pages),1)
        self.assertIn('Não disponibilizado',reader.pages[0].extract_text())

    def test_transfer_sender_document_is_not_presented_as_the_recipient_document(self):
        transfer=row(DESCRICAO='DÉB.TRANSF.CONTAS DIF.TIT. INTERCREDIS | Transferência Pix',DOCUMENTORECEBEDOR=PAYER['cpfCnpj'])
        content=self.render.render_receipt(transfer,PAYER)
        text=PdfReader(BytesIO(content)).pages[0].extract_text()
        recipient=text.split('Recebedor',1)[1].split('Pagador',1)[0]
        self.assertNotIn('12.345.678/0001-90',recipient)
        self.assertIn('Não disponibilizado',recipient)

    def test_generated_file_does_not_block_existing_late_pix_enrichment(self):
        import sync_pix_receivers as p
        c=Client([row()]);c.files[101]=[{'filename':self.sync.filename(101),'content':b'generated'}]
        r=row(Attachments=True)
        p.mark_generated_only(c,[r])
        self.assertTrue(r.get('_generated_only'))
        c.files[101].append({'filename':'original.pdf','content':b'original'})
        p.mark_generated_only(c,[r]);self.assertFalse(r.get('_generated_only'))

    def test_changed_receiver_is_not_accepted_as_the_existing_pdf(self):
        first=row(DOCUMENTORECEBEDOR='98712345612')
        for changes in [{'RAZAOSOCIALRECEBEDOR':'OUTRO RECEBEDOR'},{'DOCUMENTORECEBEDOR':'98712345699'}]:
            c=Client([first]);self.reconcile(c,[first])
            changed={**first,**changes};c.rows[101]=changed
            self.assertEqual(self.reconcile(c,[changed],[changed])['failed'],1)
            self.assertEqual(len(c.writes),1)

    def test_run_repairs_provisional_pdf_after_receiver_enrichment(self):
        provisional=row(RAZAOSOCIALRECEBEDOR='N/A',DOCUMENTORECEBEDOR=None)
        current=row(DOCUMENTORECEBEDOR='98712345612',Attachments=True)
        bank=row(RAZAOSOCIALRECEBEDOR='N/A',DOCUMENTORECEBEDOR=None)
        c=Client([current])
        old=self.render.render_receipt(provisional,PAYER)
        original={'filename':'original.pdf','content':b'original'}
        c.files[101]=[original,{'filename':self.sync.filename(101),'content':old}]
        day=self.sync.FIRST_DAY
        with (patch.object(self.sync.m,'sharepoint_client',return_value=c),
              patch.object(self.sync.m,'assert_destination'),
              patch.object(self.sync.boleto_stage,'list_movements',return_value=[current]),
              patch.object(self.sync.m,'read_bank',return_value=(PAYER['conta'],{(day,day):{}})),
              patch.object(self.sync.m,'payment_rows',return_value=[bank]),
              patch.object(self.sync,'bank_context',return_value=(PAYER,{}))):
            self.assertEqual(self.sync.run(check=True)['attached'],1)
            self.assertEqual(c.files[101][1]['content'],old)
            self.assertEqual(c.writes,[])
            c.uncertain=True
            self.assertEqual(self.sync.run()['attached'],1)
            self.assertEqual(self.sync.run()['already_attached'],1)
        self.assertEqual(c.files[101][0],original)
        self.assertEqual(len(c.files[101]),2)
        self.assertEqual(len(c.writes),1)
        updated=c.files[101][1]['content']
        self.sync.valid_existing(updated,current)
        self.assertIn('PESSOA EXEMPLO',PdfReader(BytesIO(updated)).pages[0].extract_text())

    def test_existing_pdf_can_have_unknown_receiver_document_sentinel(self):
        previous=row(DOCUMENTORECEBEDOR=self.sync.m.UNKNOWN)
        current=row(DOCUMENTORECEBEDOR='98712345612')
        content=self.render.render_receipt(previous,PAYER)
        self.assertTrue(self.sync.needs_receiver_refresh(content,current))

    def test_refresh_refuses_pdf_with_copied_fingerprint_but_no_generated_footer(self):
        previous=row(RAZAOSOCIALRECEBEDOR=self.sync.m.UNKNOWN)
        current=row()
        c=Client([current])
        output=BytesIO()
        pdf=Canvas(output)
        pdf.setAuthor('Energético')
        pdf.setKeywords(self.render.VERSION+':'+self.render.fingerprint(previous))
        pdf.drawString(20,100,'Não emitido pelo banco.')
        pdf.save()
        c.files[101]=[{'filename':self.sync.filename(101),'content':output.getvalue()}]
        self.assertEqual(self.reconcile(c,[current])['failed'],1)
        self.assertEqual(c.writes,[])

    def test_refresh_refuses_movement_changed_during_file_preflight(self):
        previous=row(RAZAOSOCIALRECEBEDOR=self.sync.m.UNKNOWN)
        current=row()
        c=Client([current])
        content=self.render.render_receipt(previous,PAYER)
        c.files[101]=[{'filename':self.sync.filename(101),'content':content}]
        request=c._request

        def change_movement_after_file_metadata(method,endpoint,**kwargs):
            result=request(method,endpoint,**kwargs)
            if endpoint.startswith('web/GetFileByServerRelativeUrl'):
                c.rows[101]['RAZAOSOCIALRECEBEDOR']='OUTRO RECEBEDOR'
            return result

        with patch.object(c,'_request',side_effect=change_movement_after_file_metadata):
            self.assertEqual(self.reconcile(c,[current])['failed'],1)
        self.assertEqual(c.writes,[])
        self.assertEqual(c.files[101][0]['content'],content)

    def test_pix_enrichment_rejects_competing_unidentified_rows_and_claimed_ids(self):
        eid='E'+'25536764'+'20261119'+'1223'+'ABCDEFGHIJK'
        pix={'endToEndId':eid,'valor':'23.50','estado':'FINALIZADO','horario':'2026-11-19T12:23:00Z',
             'origem':PAYER,'destino':{'nome':'Pessoa Exemplo','cpfCnpj':'98712345612'}}
        answers={eid:{'status':200,'result':pix}}
        self.assertEqual(self.sync.choose_pix_details([row()],answers,PAYER['cpfCnpj'],{}),{101:pix})
        unknown=row(Id=102,CHAVEIMPORTACAO='b'*64,DOCUMENTORECEBEDOR=None,DESCRICAO='PIX SEM IDENTIFICACAO')
        self.assertEqual(self.sync.choose_pix_details([row(),unknown],answers,PAYER['cpfCnpj'],{}),{})
        self.assertEqual(self.sync.choose_pix_details([row()],answers,PAYER['cpfCnpj'],{102:{eid}}),{})
        unknown_id=eid[:-1]+'Z'
        self.assertEqual(self.sync.choose_pix_details([row()],answers,PAYER['cpfCnpj'],{},[unknown_id]),{})

    def test_duplicate_boleto_reference_is_never_used_for_enrichment(self):
        first=row(DESCRICAO='DÉB.TIT.COMPE EFETIVADO',REFERENCIABANCARIA='1234567')
        second=row(Id=102,CHAVEIMPORTACAO='b'*64,DESCRICAO=first['DESCRICAO'],REFERENCIABANCARIA='1234567')
        self.assertEqual(self.sync.unique_boleto_references([first]),{'1234567':first})
        for attached in (False,True):
            other={**second,'Attachments':attached}
            self.assertEqual(self.sync.unique_boleto_references([first,other]),{})

if __name__=='__main__':unittest.main()
