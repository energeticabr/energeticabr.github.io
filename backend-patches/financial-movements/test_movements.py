"""Real workflow tests with isolated SharePoint adapters; no production writes."""
import copy
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, '/home/opc/financial-inline-20261013')
sys.path.insert(0, '/opt/energetica-whatsapp/worker')
sys.path.insert(0, os.getenv('FINANCIAL_CANDIDATE', '/opt/energetica-whatsapp/worker'))
from test_financial_catalog import Engine
from config import load_workflow_config
from clients import SharePointClient

class Movements(unittest.TestCase):
    def setUp(self):
        self.config = load_workflow_config(os.getenv('MOVEMENTS_CONFIG', '/opt/energetica-whatsapp/worker/workflow_config.json'))
        self.sp = MagicMock()
        self.sp.ensure_item.side_effect = AssertionError('No live records')
        self.sp.get_options.side_effect = self.options
        self.engine = Engine(self.config, MagicMock(), MagicMock(), MagicMock(), self.sp)
        self.event = {'conversation_id':'isolated-movement', 'sender':'test-only', 'message_id':'m', 'kind':'text'}
        self.state = self.engine._new_state(self.event, 'isolated-movement')

    def options(self, step, context):
        source = step['source']
        if source['type'] == 'static': return copy.deepcopy(source['options'])
        if source['list'] == 'INSTITUICAOEMISSORA':
            return [{'id':1,'title':'BANCO A','value':'BANCO A'}, {'id':2,'title':'BANCO B','value':'BANCO B'}]
        if source['list'] == 'CADASTRO INVESTIMENTO':
            institution = context.get('INSTITUICAO')
            return [{'id':10 if institution=='BANCO A' else 20, 'title':'CDB '+institution, 'value':'CDB '+institution,
                     'source_values': {'INSTITUICAO':institution, 'DESCRICAO':'CDB '+institution}}] if institution else []
        return []

    def send(self, reply):
        self.event = {**self.event,'message_id': self.event['message_id']+'x','text':reply,'reply_id':reply}
        return self.engine._handle_text(self.event, self.state, 'isolated')

    def open(self):
        self.send('group_financial')
        self.send('action_financial_movement')
        self.assertEqual(self.state['flow'],'financial_movement')

    def fill(self):
        self.open()
        self.send('choice:instituicao_movimentacao:1')
        self.send('choice:descricao_movimentacao:10')
        self.send('APLICAÇÃO')
        return self.send('1.234,56')

    def test_flow_order_and_confirmation_before_single_write(self):
        result = self.fill()
        self.assertEqual(result['status'],'awaiting_confirmation')
        self.assertEqual(self.state['fields'],{'INSTITUICAO':'BANCO A','DESCRICAO':'CDB BANCO A','OPERACAO':'APLICAÇÃO','VALOR':'1234,56'})
        self.sp.ensure_item.assert_not_called()
        self.sp.ensure_item.side_effect = None
        self.sp.ensure_item.return_value = 99
        self.send('confirm_yes')
        self.sp.ensure_item.assert_called_once()
        self.assertEqual(self.sp.ensure_item.call_args.kwargs['target_list'],'MOVIMENTACOESFINANCEIRAS')

    def test_foreign_description_and_arbitrary_text_cannot_be_selected(self):
        self.open(); self.send('choice:instituicao_movimentacao:1')
        self.send('choice:descricao_movimentacao:20')
        self.assertNotIn('DESCRICAO',self.state['fields'])
        self.send('NÃO CADASTRADO')
        self.assertNotIn('DESCRICAO',self.state['fields'])

    def test_institution_edit_invalidates_and_reasks_description(self):
        self.fill()
        steps = self.engine._flow_config(self.state)['steps']
        self.assertEqual(self.engine._related_edit_step_indices(steps,0),[0,1])

    def test_invalid_amount_never_advances(self):
        self.open(); self.send('choice:instituicao_movimentacao:1'); self.send('choice:descricao_movimentacao:10'); self.send('APLICAÇÃO')
        for value in ['abc','0','-1']:
            self.assertEqual(self.send(value)['status'],'invalid_number')
            self.assertNotIn('VALOR',self.state['fields'])

    def test_inline_institution_and_investment_registration_available(self):
        self.open()
        self.assertIn('financial_catalog_create',[o['id'] for o in self.state['options']])
        self.send('choice:instituicao_movimentacao:1')
        self.assertIn('financial_catalog_create',[o['id'] for o in self.state['options']])
        self.send('choice:descricao_movimentacao:financial_catalog_create')
        self.assertEqual(self.state['flow'],'investment_registration')

    def test_real_sharepoint_filter_uses_selected_institution_and_escapes_quotes(self):
        step = self.config['sharepoint']['financial_movement_flow']['steps'][1]
        sp = SharePointClient.__new__(SharePointClient)
        sp._internal_field = lambda _list, field: field
        sp._request = MagicMock(return_value={'value':[]})
        sp.get_options(step, {'INSTITUICAO':"BANCO D'ÁGUA"})
        self.assertIn("INSTITUICAO eq 'BANCO D''ÁGUA'",sp._request.call_args.kwargs['params']['$filter'])
        sp._request.reset_mock()
        self.assertEqual(sp.get_options(step, {}),[])
        sp._request.assert_not_called()

    def test_new_investment_selects_only_when_its_institution_matches_parent(self):
        for institution in ['BANCO A', 'BANCO B']:
            with self.subTest(institution=institution):
                self.setUp(); self.open(); self.send('choice:instituicao_movimentacao:1')
                self.send('choice:descricao_movimentacao:financial_catalog_create')
                self.state['fields'] = {'INSTITUICAO':institution, 'DESCRICAO':'NOVO CDB'}
                self.state['sharepoint'] = {'item_id':42, 'recorded_at':'2026-10-13T15:00:00Z'}
                self.state['stage'] = 'completed'
                self.engine._notify_completed(self.state, 'isolated')
                self.assertEqual(self.state['flow'],'financial_movement')
                self.assertEqual(self.state['fields']['INSTITUICAO'],'BANCO A')
                if institution == 'BANCO A':
                    self.assertEqual(self.state['fields']['DESCRICAO'],'NOVO CDB')
                    self.assertEqual(self.state['step_index'],2)
                else:
                    self.assertNotIn('DESCRICAO',self.state['fields'])
                    self.assertEqual(self.state['step_index'],1)
                self.sp.ensure_item.assert_not_called()

if __name__ == '__main__': unittest.main()
