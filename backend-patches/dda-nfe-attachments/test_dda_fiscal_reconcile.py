import copy
import unittest
from dda_fiscal_reconcile import build_plan, ensure_pdf, cents


def bill(i=1, amount='10.00', **changes):
    row = dict(Id=i, CHAVE_DDA=('%064x' % i), CNPJ_FORNECEDOR='17469701000177',
               CNPJ_PAGADOR='38626750000146', EMISSAO='2026-11-06T12:00:00Z',
               VALOR=amount, SITUACAO='Em aberto', STATUS_DDA='Em aberto',
               PGTO_CONFIRMADO=False)
    row.update(changes)
    return row


def note(i=70, amount='10.00', **changes):
    row = dict(Id=i, CNPJ_FORNECEDOR='17469701005640',
               CNPJ_DESTINATARIO='38626750000146', DATA_EMISSAO='2026-11-06T10:21:00Z',
               VALOR_LIQUIDO=amount, VALOR_TOTAL_NOTA=amount, SITUACAO='AUTORIZADA',
               STATUS_IMPORTACAO='XML_COMPLETO', STATUS_DANFE='DISPONIVEL',
               CHAVE_ACESSO='3'*44, TIPO_FISCAL='NF-e')
    row.update(changes)
    return row


class MatchingTests(unittest.TestCase):
    def test_arrival_order_does_not_matter_and_matrix_branch_match(self):
        self.assertEqual(build_plan([bill()], [note()])['links'][0]['dda_ids'], [1])
        self.assertFalse(build_plan([], [note()])['links'])
        self.assertFalse(build_plan([bill()], [])['links'])

    def test_three_installments_exact_cents(self):
        rows = [bill(37, '5516.67'), bill(38, '5516.67'), bill(39, '5516.66')]
        plan = build_plan(rows, [note(amount='16550.00')])
        self.assertEqual(plan['links'][0]['dda_ids'], [37, 38, 39])
        self.assertEqual(plan['links'][0]['amount_cents'], 1655000)
        self.assertFalse(build_plan(rows[:2], [note(amount='16550.00')])['links'])

    def test_four_installments_and_unique_subset(self):
        rows = [bill(1,'10'),bill(2,'20'),bill(3,'30'),bill(4,'40'),bill(5,'101')]
        self.assertEqual(build_plan(rows,[note(amount='100')])['links'][0]['dda_ids'],[1,2,3,4])

    def test_ambiguous_subsets_do_not_link(self):
        self.assertFalse(build_plan([bill(1,'10'),bill(2,'10')],[note()])['links'])
        self.assertFalse(build_plan([bill(1,'10'),bill(2,'20'),bill(3,'30')],[note(amount='30')])['links'])

    def test_overlapping_notes_block_both(self):
        self.assertFalse(build_plan([bill()], [note(70), note(71)])['links'])
        self.assertFalse(build_plan([bill(1,'10'), bill(2,'20')], [note(70), note(71,'30')])['links'])

    def test_cancelled_pending_pdf_and_incomplete_xml(self):
        for changes in ({'SITUACAO':'CANCELADA'}, {'STATUS_IMPORTACAO':'RESUMO_AGUARDANDO_XML'}, {'STATUS_DANFE':'PENDENTE'}):
            self.assertFalse(build_plan([bill()], [note(**changes)])['links'])

    def test_pdf_pending_competitor_still_blocks(self):
        self.assertFalse(build_plan([bill()], [note(70),note(71,STATUS_DANFE='PENDENTE')])['links'])

    def test_supplier_payer_and_calendar_day_must_match(self):
        for changes in ({'CNPJ_FORNECEDOR':'55456510000160'}, {'CNPJ_PAGADOR':'00000000000100'}, {'EMISSAO':'2026-11-07T12:00:00Z'}, {'EMISSAO':None}):
            self.assertFalse(build_plan([bill(**changes)], [note()])['links'])
        self.assertTrue(build_plan([bill(EMISSAO='2026-11-05T12:00:00Z')], [note(DATA_EMISSAO='2026-11-06T01:00:00Z')])['links'])

    def test_deduplicate_bank_identity_blocks_uncertain_group(self):
        self.assertFalse(build_plan([bill(), bill(2, CHAVE_DDA=bill()['CHAVE_DDA'])], [note()])['links'])

    def test_paid_installments_contribute_but_unconfirmed_do_not(self):
        rows=[bill(1,'5',SITUACAO='Pago (liquidado)',STATUS_DDA='Liquidado'),bill(2,'5')]
        self.assertTrue(build_plan(rows,[note()])['links'])
        rows[0]['SITUACAO']='Não confirmado';rows[0]['STATUS_DDA']='Não confirmado'
        self.assertFalse(build_plan(rows,[note()])['links'])

    def test_net_amount_preferred_over_gross(self):
        self.assertFalse(build_plan([bill(amount='12')],[note(VALOR_TOTAL_NOTA='12')])['links'])

    def test_invalid_money_and_excessive_search(self):
        for amount in ('NaN','Infinity','10.001','-1','abc'):
            with self.assertRaises(ValueError): cents(amount)
        self.assertFalse(build_plan([bill(i+1,'1') for i in range(21)],[note(amount='21')])['links'])

    def test_invalid_amount_blocks_whole_known_group(self):
        self.assertFalse(build_plan([bill(),bill(2,'NaN')],[note()])['links'])
        self.assertFalse(build_plan([bill()],[note(),note(71,'NaN')])['links'])

    def test_unknown_day_and_contradictory_state_block_matching_pair(self):
        self.assertFalse(build_plan([bill(),bill(2,EMISSAO=None)],[note()])['links'])
        self.assertFalse(build_plan([bill()],[note(),note(71,DATA_EMISSAO=None)])['links'])
        self.assertFalse(build_plan([bill(SITUACAO='Cancelado')],[note()])['links'])
        self.assertFalse(build_plan([bill(),bill(2,SITUACAO='Não confirmado',STATUS_DDA='Não confirmado')],[note()])['links'])


class FakeStore:
    def __init__(self): self.files={};self.writes=0
    def attachments(self, item_id): return [{'FileName':k} for k in self.files]
    def read_pdf(self, item_id, name): return self.files[name]
    def add_pdf(self, item_id, name, content): self.writes+=1;self.files[name]=content


class AttachmentTests(unittest.TestCase):
    def test_existing_fiscal_under_legacy_name_same_bytes_is_reused(self):
        store=FakeStore();pdf=b'%PDF-1.4\n'+b'x'*150+b'\n%%EOF\n'
        store.files['FISCAL-DANFE-legacy.pdf']=pdf
        self.assertEqual(ensure_pdf(store,36,'DANFE-123.pdf',pdf)['status'],'already_linked')
        self.assertEqual(store.writes,0)

    def test_bytes_verified_and_rerun_writes_nothing(self):
        store=FakeStore(); pdf=b'%PDF-1.4\n'+b'x'*150+b'\n%%EOF\n'
        self.assertEqual(ensure_pdf(store,36,'DANFE-123.pdf',pdf)['status'],'linked')
        self.assertEqual(ensure_pdf(store,36,'DANFE-123.pdf',pdf)['status'],'already_linked')
        self.assertEqual(store.writes,1)

    def test_conflicting_fiscal_pdf_is_preserved(self):
        store=FakeStore();store.files['FISCAL-other.pdf']=b'old'
        pdf=b'%PDF-1.4\n'+b'x'*150+b'\n%%EOF\n'
        with self.assertRaises(ValueError): ensure_pdf(store,36,'DANFE-123.pdf',pdf)
        self.assertEqual(store.writes,0)

    def test_invalid_pdf_or_same_name_different_bytes_is_not_overwritten(self):
        store=FakeStore()
        with self.assertRaises(ValueError):ensure_pdf(store,36,'DANFE-123.pdf',b'bad')
        store.files['FISCAL-DANFE-123.pdf']=b'other'
        with self.assertRaises(ValueError):ensure_pdf(store,36,'DANFE-123.pdf',b'%PDF-1.4\n'+b'x'*150+b'\n%%EOF\n')
        self.assertEqual(store.writes,0)


if __name__=='__main__': unittest.main()
