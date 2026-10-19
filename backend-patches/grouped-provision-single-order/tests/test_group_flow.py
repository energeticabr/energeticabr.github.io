"""Exercise the full conversation with synthetic SharePoint and real current configuration."""
import copy
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if not (ROOT / 'worker').exists():
    ROOT = ROOT.parent
ROOT = Path(os.getenv('ENERGETICA_BACKEND_TEST_ROOT',str(ROOT)))
sys.path[:0] = [str(ROOT/'worker'),str(ROOT/'tests'),str(ROOT)]
from test_single_order import source


class GroupConversationTests(unittest.TestCase):
    def setUp(self):
        from test_workflow import WorkflowTests
        self.h = WorkflowTests('runTest')
        self.h.setUp()
        group = source()
        self.h.sharepoint.items[7] = {'fields':{k:v for k,v in group.items() if k!='CHILDREN'},
                                     'attachments':{},'target_list':'DESCRITIVOPROVISAO'}
        for row in group['CHILDREN']:
            self.h.sharepoint.items[row['Id']] = {'fields':copy.deepcopy(row),'attachments':{},'target_list':'PROVISÃO PGTOS'}
        def fresh(item_id=7):
            parent = copy.deepcopy(self.h.sharepoint.items[int(item_id)]['fields'])
            parent['CHILDREN'] = [copy.deepcopy(self.h.sharepoint.items[i]['fields']) for i in (11,12,13,14)]
            return parent
        self.h.sharepoint.get_provision_description_for_settlement = fresh
        self.h.sharepoint.get_provision_description = fresh
        self.h.sharepoint.get_pending_provision_descriptions = lambda:[fresh()]

    def state(self):
        return next(s for s,e in self.h.state.values.values() if s.get('flow')=='payment_settlement')

    def choose(self,value):
        option = next(o for o in self.state()['options'] if o.get('value')==value)
        return self.h.reply(reply_id=str(option['id']))

    def prepare(self,yes=True):
        self.h.reply('OPA')
        self.h.open_supply_provision_action('BAIXAR PAGAMENTO AGENDADO')
        result = self.h.reply(reply_id='provision_description:7')
        for attempt in range(40):
            state = self.state()
            step = self.h.engine._current_step(copy.deepcopy(state))
            key = (step or {}).get('key')
            if key == 'submeter_lancamentos':
                self.assertEqual(len(state['provision_description']['entries']),4)
                break
            if key in {'validar_qtd_baixa','validar_valor_total_baixa'}:
                result = self.h.reply(reply_id=key+'_keep')
            elif key == 'data_pgto_efetuado_baixa':
                result = self.h.reply(reply_id='date_today')
            elif key == 'forma_pgto_baixa':
                result = self.choose('ENERGÉTICA - CAIXA')
            elif key == 'observacao_grupo_baixa':
                result = self.h.reply(reply_id='description_observation_blank')
            else:
                self.fail(f'Unexpected pre-group question/stage: {key}/{state.get("stage")}/{result}')
        else:
            self.fail('The group decision was never reached')
        self.assertEqual(self.h.sharepoint.update_calls,[])
        self.assertEqual(len(self.h.sharepoint.items),5)
        result = self.choose('SIM' if yes else 'NÃO')
        if yes:
            self.assertEqual(result.get('field'),'etapa_baixa')
            result = self.choose('FUNDAÇÃO')
        if result.get('status')=='awaiting_attachment_decision':
            result = self.h.reply('NÃO')
        self.assertEqual(result.get('status'),'awaiting_confirmation',result)
        return result

    def test_full_flow_asks_group_and_stage_once_then_creates_one_order_four_lines(self):
        self.prepare()
        self.assertEqual(sum(key=='etapa_baixa' for key,ctx in self.h.sharepoint.option_calls),1)
        self.assertEqual(self.h.reply('SIM')['status'],'completed')
        orders = [i for i in self.h.sharepoint.items.values() if i['target_list']=='NOTASPENDENTES']
        launches = [i for i in self.h.sharepoint.items.values() if i['target_list']=='LANCAMENTOS']
        self.assertEqual(len(orders),1)
        self.assertEqual(len(launches),4)
        self.assertEqual(len({i['fields']['AGRUPAR'] for i in launches}),1)

    def test_group_no_skips_stage_and_creates_no_order_or_launch(self):
        self.prepare(yes=False)
        self.assertFalse(any(key=='etapa_baixa' for key,ctx in self.h.sharepoint.option_calls))
        self.assertEqual(self.h.reply('SIM')['status'],'completed')
        self.assertEqual(len(self.h.sharepoint.items),5)

    def test_summary_common_stage_edit_is_available_and_changes_all_four_lines(self):
        self.prepare()
        self.h.reply('EDITAR')
        self.h.reply(reply_id='description_edit_common')
        steps = self.h.engine._flow_config(self.state())['steps']
        stage_index = next(i for i,s in enumerate(steps) if s['key']=='etapa_baixa')
        self.assertIn(stage_index,[o.get('value') for o in self.state()['options']])
        self.h.sharepoint.options_by_key['etapa_baixa'] = [{'id':'new-stage','title':'ESTRUTURA','value':'ESTRUTURA'}]
        self.choose(stage_index)
        result = self.choose('ESTRUTURA')
        self.assertEqual(result['status'],'awaiting_confirmation')
        self.assertEqual(self.h.reply('SIM')['status'],'completed')
        launches = [i for i in self.h.sharepoint.items.values() if i['target_list']=='LANCAMENTOS']
        self.assertEqual({i['fields']['ETAPA'] for i in launches},{'ESTRUTURA'})

    def test_summary_change_no_to_yes_asks_stage_then_converts_all(self):
        self.prepare(yes=False)
        self.h.reply('EDITAR')
        self.h.reply(reply_id='description_edit_common')
        steps = self.h.engine._flow_config(self.state())['steps']
        decision_index = next(i for i,s in enumerate(steps) if s['key']=='submeter_lancamentos')
        self.choose(decision_index)
        result = self.choose('SIM')
        self.assertEqual(result.get('field'),'etapa_baixa')
        result = self.choose('FUNDAÇÃO')
        self.assertEqual(result['status'],'awaiting_confirmation')
        self.assertEqual(self.h.reply('SIM')['status'],'completed')
        self.assertEqual(sum(i['target_list']=='NOTASPENDENTES' for i in self.h.sharepoint.items.values()),1)
        self.assertEqual(sum(i['target_list']=='LANCAMENTOS' for i in self.h.sharepoint.items.values()),4)

    def test_adding_attachment_after_group_summary_preserves_every_provision(self):
        self.prepare()
        self.h.reply('EDITAR')
        self.h.reply(reply_id='description_edit_attachments')
        self.h.reply(reply_id='attachment_edit_add')
        self.h.attachment('synthetic-proof','comprovante-ficticio.pdf',b'synthetic proof')
        result = self.h.reply('FINALIZAR')
        self.assertEqual(result['status'],'awaiting_confirmation')
        group = self.state()['provision_description']
        self.assertEqual([e['fields']['ID PROVISÃO'] for e in group['entries']],['11','12','13','14'])
        self.assertEqual(self.h.reply('SIM')['status'],'completed')
        self.assertEqual(sum(i['target_list']=='NOTASPENDENTES' for i in self.h.sharepoint.items.values()),1)
        self.assertEqual(sum(i['target_list']=='LANCAMENTOS' for i in self.h.sharepoint.items.values()),4)
        self.assertTrue(all(self.h.sharepoint.items[i]['fields']['PGTOAGENDADO']=='PAGO' for i in (11,12,13,14)))


if __name__=='__main__':
    unittest.main()
