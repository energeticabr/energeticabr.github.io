"""Group settlement regressions using real workflow code and an in-memory REST boundary."""
import copy
import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if not (ROOT / 'worker').exists():
    ROOT = ROOT.parent
ROOT = Path(os.getenv('ENERGETICA_BACKEND_TEST_ROOT',str(ROOT)))
sys.path.insert(0, str(ROOT / 'worker'))
from workflow import WorkflowEngine
from provision_description_settlement import CHILD_FIELDS, PARENT_FIELDS, _same
from logic import condition_matches


def source():
    rows = [{'Id':i, 'DESCRITIVOPROVISAO':'7', 'STATUS':'PAGAMENTO PREVISTO',
             'PGTOAGENDADO':None, 'DATA PGTO EFETUADO':None, 'FORMAPGTO':None,
             'QTD':'2', 'VALOR TOTAL':'10.5', 'FRETE':'3', 'FORNECEDOR':'Fornecedor ficticio',
             'FILIAL':'Filial ficticia', 'IMOVEL':'Imovel ficticio', 'PRODUTO':f'Produto {i}',
             'DATA PREVISTO PGTO':'2026-10-19', 'IDPEDIDO':None, 'IDLANCAMENTOS':None,
             'OBS':None} for i in (11,12,13,14)]
    return {'Id':7, 'CHILDREN':rows, 'PENDING CHILD IDS':['11','12','13','14'],
            'FORNECEDOR':'Fornecedor ficticio', 'FILIAL':'Filial ficticia',
            'DATA PREVISTO PGTO':'2026-10-19', 'DATA PGTO EFETUADO':None,
            'PGTOAGENDADO':None, 'VALORTOTAL':'96', 'FORMAPGTO':None, 'OBS':None,
            'VALOR TOTAL DESCRITIVO':'96', 'totalDisplay':'R$ 96,00'}


class Connector:
    def __init__(self):
        group = source()
        self.items = {('DESCRITIVOPROVISAO',7):copy.deepcopy(group)}
        self.items.update({('PROVISÃO PGTOS',r['Id']):copy.deepcopy(r) for r in group['CHILDREN']})
        self.tokens, self.writes, self.option_calls = {}, [], []
        self.fail_before_child = self.lose_after_child = None
        self.lose_after_order = False
        self.bad_order_verification = False

    def get_provision_description_for_settlement(self, item_id):
        parent = copy.deepcopy(self.items[('DESCRITIVOPROVISAO',int(item_id))])
        parent['CHILDREN'] = [copy.deepcopy(self.items[('PROVISÃO PGTOS',i)]) for i in (11,12,13,14)]
        return parent

    def get_item_fields_with_etag(self, item_id, fields, target_list=None):
        row = self.items[(target_list,int(item_id))]
        return {k:copy.deepcopy(row.get(k)) for k in fields}, 'specific-etag'

    def update_item_with_etag(self, item_id, fields, etag, target_list=None):
        assert etag == 'specific-etag'
        if target_list == 'PROVISÃO PGTOS' and item_id == self.fail_before_child:
            self.fail_before_child = None
            raise RuntimeError('synthetic failure before child write')
        self.items[(target_list,int(item_id))].update(copy.deepcopy(fields))
        self.writes.append(('update',target_list,int(item_id),copy.deepcopy(fields)))
        if target_list == 'PROVISÃO PGTOS' and item_id == self.lose_after_child:
            self.lose_after_child = None
            raise RuntimeError('synthetic lost child response')

    def ensure_item(self, token, fields, target_list=None, **kwargs):
        key = (target_list,token)
        if key not in self.tokens:
            item_id = 500 + len(self.tokens)
            self.tokens[key] = item_id
            self.items[(target_list,item_id)] = copy.deepcopy(fields)
            self.writes.append(('create',target_list,item_id,copy.deepcopy(fields)))
            if target_list == 'NOTASPENDENTES' and self.lose_after_order:
                self.lose_after_order = False
                raise RuntimeError('synthetic lost order response')
        return self.tokens[key]

    def verify_item(self, item_id, fields, names, target_list=None):
        row = self.items[(target_list,int(item_id))]
        ok = all(_same(k,row.get(k),v) for k,v in fields.items())
        if target_list == 'NOTASPENDENTES' and self.bad_order_verification:
            ok = False
        return {'fields':ok,'attachments':not names}

    def get_options(self, step, context):
        self.option_calls.append((step['key'],copy.deepcopy(context)))
        return [{'id':'expense','value':'MATERIAL','title':'MATERIAL'}]


class Fixture:
    def __init__(self):
        self.engine = WorkflowEngine.__new__(WorkflowEngine)
        self.engine.config = json.loads((ROOT/'worker/workflow_config.json').read_text(encoding='utf-8'))
        self.client = self.engine.sharepoint = Connector()
        self.messages, self.snapshots = [], []
        self.engine._send_text = lambda state,text:self.messages.append(text)
        def save(state,etag):
            self.snapshots.append(copy.deepcopy(state))
            return 'state-etag'
        self.engine._save = save
        self.engine._submission_failed = lambda state,etag,error:{'status':'submission_failed','error':str(error)}
        self.engine._notify_completed = lambda state,etag:{'status':'completed'}
        self.engine._prompt_next_or_summary = lambda state,etag:{'field':(self.engine._current_step(state) or {}).get('key')}
        self.state = {'flow':'payment_settlement','batch_id':'synthetic-batch', 'key':'synthetic',
                      'fields':{},'answers':{},'selections':{},'display_values':{},
                      'attachments':[],'step_index':0,'options':[]}
        self.engine._description_start(self.state, source())

    def ready(self, decision='SIM'):
        group = self.state['provision_description']
        group['entries'] = [{'fields':{**copy.deepcopy(r),'ID PROVISÃO':str(r['Id']),
                            'ETAPA':'FUNDAÇÃO','TIPO DESPESA':'MATERIAL'},
                            'answers':{'submeter_lancamentos':decision},'display_values':{},
                            'relink_authorized':False} for r in group['children']]
        group['common'] = {'DATA PGTO EFETUADO':'2026-10-19','FORMAPGTO':'Conta ficticia','OBS':''}
        group['launch_settings'] = {'submeter_lancamentos':decision,'ETAPA':'FUNDAÇÃO','relink_authorized':False}
        group['prepared'] = True
        return self.state

    def commit(self):
        return self.engine._description_commit(self.state,None,self.engine.config['sharepoint']['payment_settlement_flow'])

    def created(self,title):
        return [(i,f) for (t,i),f in self.client.items.items() if t == title]


class SingleOrderTests(unittest.TestCase):
    def test_child_review_does_not_ask_add_launch_or_stage(self):
        f = Fixture()
        flow = f.engine._flow_config(f.state)
        active = [s['key'] for s in flow['steps'] if not s.get('edit_only')
                  and condition_matches(s.get('when'),f.engine._context(f.state))]
        self.assertNotIn('submeter_lancamentos',active)
        self.assertNotIn('etapa_baixa',active)

    def test_after_four_reviews_group_question_lists_every_line_then_stage_once(self):
        f = Fixture()
        for n in range(4):
            f.state['fields'].update({'DATA PGTO EFETUADO':'2026-10-19','FORMAPGTO':'Conta ficticia','OBS':''})
            result = f.engine._description_after_fields(f.state,None)
            if n < 3:
                self.assertEqual(result['field'],'validar_qtd_baixa')
        self.assertIsNotNone(result, 'All reviewed lines must lead to the group question')
        self.assertEqual(result['field'],'submeter_lancamentos')
        flow = f.engine._flow_config(f.state)
        step = f.engine._current_step(f.state)
        for i in (11,12,13,14):
            self.assertIn(f'Produto {i}',step['prompt'])
        self.assertIn('TODAS',step['prompt'].upper())
        self.assertEqual(f.client.writes,[])
        f.engine._apply_selected_option(f.state,step,{'id':1,'value':'SIM','title':'SIM'})
        f.state['step_index'] += 1
        self.assertEqual(f.engine._current_step(f.state)['key'],'etapa_baixa')

    def test_four_launches_share_one_aggregate_order(self):
        f = Fixture(); f.ready()
        self.assertEqual(f.commit()['status'],'completed')
        orders,launches = f.created('NOTASPENDENTES'),f.created('LANCAMENTOS')
        self.assertEqual(len(orders),1)
        self.assertEqual(len(launches),4)
        order_id,order = orders[0]
        self.assertEqual(order['VALORTOTAL'].replace(',','.'),'96')
        self.assertEqual({r['AGRUPAR'] for _,r in launches},{str(order_id)})
        self.assertEqual({r['IDPGTOAGENDADO'] for _,r in launches},{'11','12','13','14'})
        self.assertEqual({r['ETAPA'] for _,r in launches},{'FUNDAÇÃO'})
        self.assertEqual({f.client.items[('PROVISÃO PGTOS',i)]['IDPEDIDO'] for i in (11,12,13,14)},{str(order_id)})

    def test_no_answer_settles_without_orders_or_launches(self):
        f = Fixture(); f.ready('NÃO')
        self.assertEqual(f.commit()['status'],'completed')
        self.assertEqual(f.created('NOTASPENDENTES'),[])
        self.assertEqual(f.created('LANCAMENTOS'),[])

    def test_child_failure_retry_reuses_order_and_each_launch(self):
        f = Fixture(); f.ready(); f.client.fail_before_child = 12
        self.assertEqual(f.commit()['status'],'submission_failed')
        self.assertEqual(f.commit()['status'],'completed')
        self.assertEqual(len(f.created('NOTASPENDENTES')),1)
        self.assertEqual(len(f.created('LANCAMENTOS')),4)

    def test_lost_child_response_is_verified_without_duplicate_order_or_launch(self):
        f = Fixture(); f.ready(); f.client.lose_after_child = 12
        self.assertEqual(f.commit()['status'],'submission_failed')
        self.assertEqual(f.commit()['status'],'completed')
        self.assertEqual(len(f.created('NOTASPENDENTES')),1)
        self.assertEqual(len(f.created('LANCAMENTOS')),4)

    def test_lost_order_response_retry_uses_one_durable_group_key(self):
        f = Fixture(); f.ready(); f.client.lose_after_order = True
        self.assertEqual(f.commit()['status'],'submission_failed')
        self.assertEqual(f.commit()['status'],'completed')
        self.assertEqual(len(f.created('NOTASPENDENTES')),1)
        self.assertEqual(len(f.created('LANCAMENTOS')),4)

    def test_unverified_order_blocks_launches(self):
        f = Fixture(); f.ready(); f.client.bad_order_verification = True
        self.assertEqual(f.commit()['status'],'submission_failed')
        self.assertEqual(f.created('LANCAMENTOS'),[])

    def test_mixed_supplier_group_is_rejected_before_financial_writes(self):
        f = Fixture(); f.ready()
        f.state['provision_description']['entries'][1]['fields']['FORNECEDOR'] = 'Outro fornecedor'
        self.assertEqual(f.commit()['status'],'submission_failed')
        self.assertEqual(f.client.writes,[])

    def test_resumed_legacy_yes_draft_requires_one_group_decision_before_writing(self):
        f = Fixture(); f.ready()
        f.state['provision_description'].pop('launch_settings')
        result = f.commit()
        self.assertEqual(result.get('field'),'submeter_lancamentos')
        self.assertEqual(f.client.writes,[])

    def test_group_stage_edited_from_summary_applies_to_every_launch(self):
        f = Fixture(); f.ready()
        group = f.state['provision_description']
        group.update({'editing_common':True,'editing_phase':'field','index':0})
        f.state['fields'] = {**copy.deepcopy(group['entries'][0]['fields']),**group['common'],'ETAPA':'ESTRUTURA'}
        f.state['answers'] = {'submeter_lancamentos':'SIM'}
        f.engine._description_after_fields(f.state,None)
        self.assertEqual(f.commit()['status'],'completed')
        self.assertEqual({row['ETAPA'] for _,row in f.created('LANCAMENTOS')},{'ESTRUTURA'})

    def test_group_no_edited_from_summary_disables_all_launches(self):
        f = Fixture(); f.ready()
        group = f.state['provision_description']
        group.update({'editing_common':True,'editing_phase':'field','index':0})
        f.state['fields'] = {**copy.deepcopy(group['entries'][0]['fields']),**group['common']}
        f.state['answers'] = {'submeter_lancamentos':'NÃO'}
        f.engine._description_after_fields(f.state,None)
        self.assertEqual(f.commit()['status'],'completed')
        self.assertEqual(f.created('NOTASPENDENTES'),[])
        self.assertEqual(f.created('LANCAMENTOS'),[])

    def test_existing_order_reference_blocks_new_order_before_any_write(self):
        f = Fixture(); f.ready()
        f.state['provision_description']['original_children'][0]['IDPEDIDO']='99'
        f.state['provision_description']['children'][0]['IDPEDIDO']='99'
        f.client.items[('PROVISÃO PGTOS',11)]['IDPEDIDO']='99'
        self.assertEqual(f.commit()['status'],'submission_failed')
        self.assertEqual(f.client.writes,[])

    def test_replacing_existing_launch_requires_password_before_any_write(self):
        f = Fixture(); f.ready()
        group = f.state['provision_description']
        group['original_children'][0]['IDLANCAMENTOS']='99'
        group['children'][0]['IDLANCAMENTOS']='99'
        group['entries'][0]['fields']['IDLANCAMENTOS']='99'
        f.client.items[('PROVISÃO PGTOS',11)]['IDLANCAMENTOS']='99'
        self.assertEqual(f.commit()['status'],'submission_failed')
        self.assertEqual(f.client.writes,[])

    def test_attachment_return_cannot_replace_last_line_with_group_question_line(self):
        f = Fixture(); f.ready()
        group = f.state['provision_description']
        group.update({'index':3,'launch_phase':'done','editing_phase':'choose'})
        f.state['fields'] = {**copy.deepcopy(group['entries'][0]['fields']),**group['common']}
        f.state['answers'] = {'submeter_lancamentos':'SIM'}
        f.engine._description_after_fields(f.state,None)
        self.assertEqual([e['fields']['ID PROVISÃO'] for e in group['entries']],['11','12','13','14'])

    def test_duplicate_entry_ids_are_rejected_before_any_financial_write(self):
        f = Fixture(); f.ready()
        f.state['provision_description']['entries'][3] = copy.deepcopy(f.state['provision_description']['entries'][0])
        self.assertEqual(f.commit()['status'],'submission_failed')
        self.assertEqual(f.client.writes,[])

    def test_legacy_common_edit_does_not_promote_one_child_answer_to_group_consent(self):
        f = Fixture(); f.ready()
        group = f.state['provision_description']
        group.pop('launch_settings')
        group.update({'editing_common':True,'editing_phase':'field','index':0})
        f.state['fields'] = {**copy.deepcopy(group['entries'][0]['fields']),**group['common'],'OBS':'Nova obs'}
        f.state['answers'] = {'submeter_lancamentos':'SIM'}
        result = f.engine._description_after_fields(f.state,None)
        self.assertEqual(result.get('field'),'submeter_lancamentos')
        self.assertNotIn('launch_settings',group)
        self.assertEqual(f.client.writes,[])

    def test_changed_product_resolves_its_own_expense_again(self):
        f = Fixture(); f.ready()
        group = f.state['provision_description']
        group['entries'][0]['fields']['TIPO DESPESA']='ENERGIA'
        group.update({'editing_common':False,'editing_phase':'field','index':0})
        f.state['fields'] = {**copy.deepcopy(group['entries'][0]['fields']),**group['common'],'PRODUTO':'Novo produto'}
        f.state['answers'] = {'submeter_lancamentos':'SIM'}
        f.client.get_options = lambda step,ctx:[{'value':'SERVIÇO','title':'SERVIÇO','id':'service'}]
        f.engine._description_after_fields(f.state,None)
        self.assertEqual(group['entries'][0]['fields']['TIPO DESPESA'],'SERVIÇO')


if __name__ == '__main__':
    unittest.main()
