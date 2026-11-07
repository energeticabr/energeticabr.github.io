import copy
import os
from pathlib import Path
import sys
import unittest

STAGE = Path('/home/opc/provision-variation-changes-20261106')
sys.path[:0] = ['/opt/energetica-whatsapp/worker', '/opt/energetica-whatsapp', str(STAGE/'tests')]
os.environ['ENERGETICA_BACKEND_TEST_ROOT'] = '/opt/energetica-whatsapp'
if os.getenv('CANDIDATE'):
    for name, relative in [('payment_provision_flow', 'worker/payment_provision_flow.py'),
                           ('workflow', 'worker/workflow.py'), ('channel_bridge', 'channel_bridge.py')]:
        module = __import__(name)
        data = (STAGE/'candidate'/relative).read_bytes()
        exec(compile(data, str(STAGE/'candidate'/relative), 'exec'), module.__dict__)
import test_first_freight as fixture
from channel_bridge import ChannelMessenger

class VariationTests(unittest.TestCase):
    def setUp(self):
        self.qa=fixture.FirstFreightTests()
        self.qa.setUp()
        self.engine,self.state=self.qa.engine,self.qa.state
        self.previous=copy.deepcopy(self.state)
        self.previous['fields'].update({'DATA PREVISTO PGTO':'2026-11-06','OBS':''})
        for key in ['fields','answers','selections','display_values']:
            self.state[key]=copy.deepcopy(self.previous[key])
        self.state.update(stage='choosing_provision_variation',provision_current_saved=False,
            provision_lines=[{key:copy.deepcopy(self.previous[key]) for key in ['fields','answers','display_values','selections']}])
        self.state['attachments']=[{'filename':'qa.pdf','id':'qa-file'}]
        self.engine.messenger=ChannelMessenger()

    def table(self):
        return self.engine._provision_question(self.state).get('change_table')

    def test_no_changes_no_table(self):
        self.assertIsNone(self.table())

    def test_all_variation_fields_are_separate_three_column_rows(self):
        self.state['fields'].update({'DATA PREVISTO PGTO':'2026-11-20','FORNECEDOR':'OUTRO FORNECEDOR QA',
            'FILIAL':'000 - CENTRAL QA','IMOVEL':'CASA QA','FORMA PGTO':'BOLETO','OBS':'NOVA OBSERVAÇÃO'})
        table=self.table()
        self.assertIsNotNone(table)
        self.assertEqual(table['kind'],'provision_variation_changes')
        rows=table['rows']
        self.assertEqual(len(rows),6)
        self.assertTrue(all(set(row)=={'field','before','after'} for row in rows))
        self.assertEqual(rows[0],{'field':'DATA DE VENCIMENTO','before':'06/11/2026','after':'20/11/2026'})
        self.assertEqual(rows[-1],{'field':'OBSERVAÇÃO','before':'EM BRANCO','after':'NOVA OBSERVAÇÃO'})

    def test_repeated_changes_update_same_row_and_revert_removes_it(self):
        self.state['fields']['FILIAL']='000 - CENTRAL QA'
        self.assertEqual(self.table()['rows'][0]['after'],'000 - CENTRAL QA')
        self.state['fields']['FILIAL']='004 - OUTRA QA'
        self.assertEqual(len(self.table()['rows']),1)
        self.assertEqual(self.table()['rows'][0]['before'],'004 - OBRA QA')
        self.state['fields']['FILIAL']='004 - OBRA QA'
        self.assertIsNone(self.table())

    def test_actual_prompt_and_bridge_deliver_table_and_preserve_state(self):
        self.state['fields']['FILIAL']='000 - CENTRAL QA'
        before=copy.deepcopy(self.state['provision_lines'])
        self.engine._prompt_provision_question(self.state,self.qa.etag())
        poll=self.engine.messenger.drain()[-1]
        self.assertEqual(poll.get('change_table'),self.table())
        self.assertEqual(poll['change_table']['rows'][0]['field'],'FILIAL')
        self.assertTrue(any('PROSSEGUIR' in row['label'] for row in poll['options']))
        self.assertEqual(self.state['provision_lines'],before)
        self.assertEqual(self.state['attachments'],[{'filename':'qa.pdf','id':'qa-file'}])
        self.assertEqual(self.qa.catalog.creates,[])

    def test_draft_reissue_keeps_table_and_next_line_uses_immediate_predecessor(self):
        self.state['fields']['IMOVEL']='IMÓVEL NOVO QA'
        self.engine._resend_current_prompt(self.state,self.qa.etag())
        self.assertEqual(self.engine.messenger.drain()[-1]['change_table']['rows'][0]['after'],'IMÓVEL NOVO QA')
        self.state['provision_lines'].append({key:copy.deepcopy(self.state[key]) for key in ['fields','answers','display_values','selections']})
        self.assertIsNone(self.table())

    def test_transport_discards_metadata_on_unrelated_or_empty_poll(self):
        for updates,rows,question in [({'flow':'launch'},[{'field':'FILIAL'}],'HÁ ALGUMA VARIAÇÃO EM RELAÇÃO À LINHA ANTERIOR?'),
            ({'stage':'selecting_fields'},[{'field':'FILIAL'}],'QUAL É A FILIAL?'),
            ({},[],'HÁ ALGUMA VARIAÇÃO EM RELAÇÃO À LINHA ANTERIOR?'), ({},[{'field':'FILIAL'}],'MENU PRINCIPAL'),
            ({'flow':'attendance_validation'},[{'field':'FILIAL'}],'ALTERAÇÕES NO CADASTRO DO FORNECEDOR')]:
            state={**copy.deepcopy(self.state),**updates,'_outbound_change_table':{'kind':'provision_variation_changes','rows':rows}}
            self.engine.messenger._send_poll(state,question,[])
            self.assertNotIn('change_table',self.engine.messenger.drain()[-1])
            self.assertNotIn('_outbound_change_table',state)

    def test_automatic_product_quantity_and_freight_differences_are_not_variations(self):
        self.state['fields'].update({'PRODUTO':'PRODUTO B QA','QTD':'15','VALOR TOTAL':'28','FRETE':'0'})
        self.assertIsNone(self.table())

    def test_same_calendar_date_is_not_a_change(self):
        self.state['fields']['DATA PREVISTO PGTO']='06/11/2026'
        self.assertIsNone(self.table())

    def test_actual_branch_edit_returns_to_variations_with_before_and_after(self):
        original=self.qa.catalog.get_options
        self.qa.catalog.get_options=lambda step,context: ([
            {'id':5,'title':'004 - OBRA QA','value':'004 - OBRA QA'},
            {'id':1,'title':'000 - CENTRAL QA','value':'000 - CENTRAL QA'}]
            if step.get('target_field')=='FILIAL' else original(step,context))
        self.engine._prompt_provision_question(self.state,self.qa.etag())
        self.engine._handle_provision_choice({'kind':'text','text':'4','reply_id':'4','message_id':'qa-edit-branch'},self.state,self.qa.etag())
        self.assertEqual(self.state['stage'],'selecting_fields')
        step=self.engine._current_step(self.state)
        self.assertEqual(step['key'],'filial_pagamento')
        self.engine._handle_text({'kind':'text','text':'1','reply_id':'1','message_id':'qa-central'},self.state,self.qa.etag())
        self.assertEqual(self.engine._current_step(self.state)['key'],'imovel_pagamento')
        self.engine._handle_text({'kind':'text','text':'1','reply_id':'1','message_id':'qa-property'},self.state,self.qa.etag())
        self.assertEqual(self.state['stage'],'choosing_provision_variation')
        self.assertEqual(self.engine.messenger.drain()[-1]['change_table']['rows'],[
            {'field':'FILIAL','before':'004 - OBRA QA','after':'000 - CENTRAL QA'}])
        self.assertEqual(self.qa.catalog.creates,[])

if __name__=='__main__':
    unittest.main(verbosity=2)
