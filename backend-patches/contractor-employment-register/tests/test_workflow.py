"""Contracts of the real registration engine; all external state is synthetic."""
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT)]
import workflow
from workflow import WorkflowEngine

LINK='vinculo_fornecedor_suprimentos'
ROLE='cargo_fornecedor_suprimentos'
ADMISSION='admissao_fornecedor_suprimentos'
ROLES=['SERVENTE DE PEDREIRO I','SERVENTE DE PEDREIRO II','SERVENTE DE PEDREIRO III',
       'PEDREIRO I','PEDREIRO II','PEDREIRO III','MESTRE DE OBRAS','SUPERVISOR DE OBRAS']

class Store:
    def __init__(self): self.values={}
    def load(self,key): return copy.deepcopy(self.values.get(key)),None
    def save(self,key,value,etag): self.values[key]=copy.deepcopy(value); return 'memory'

class Messenger:
    def __init__(self): self.messages=[]
    def send_text(self,state,body): self.messages.append(body)
    def send_options(self,state,step,options,maximum): self.messages.append(copy.deepcopy(step))
    send_filtered_options=send_options
    def send_actions(self,state,body,actions): self.messages.append(body)
    def send_image(self,*args,**kwargs): pass

class Catalog:
    site_url='https://synthetic.invalid/sites/qa'
    def __init__(self): self.rows={}; self.tokens={}; self.post_count=0
    def get_options(self,step,context): return copy.deepcopy(step['source'].get('options',[]))
    def ensure_item(self,token,fields,*,target_list,**kwargs):
        if token in self.tokens: return self.tokens[token]
        item_id=len(self.rows)+10; self.post_count+=1
        self.tokens[token]=item_id; self.rows[item_id]={'fields':copy.deepcopy(fields),'list':target_list}
        return item_id
    def verify_item(self,*args,**kwargs): return {'fields':True,'attachments':True}
    def _internal_field(self,title,field): return field
    def _target_payload(self,fields,title): return copy.deepcopy(fields)
    def _list_endpoint(self,title): return "web/lists/getByTitle('"+title+"')"
    def _request(self,method,endpoint,**kwargs):
        if method=='GET':
            token=kwargs['params']['$filter'].split("'")[1]
            return {'value':[{'Id':self.tokens[token]}] if token in self.tokens else []}
        fields=kwargs['json']; token=fields['__PowerAppsId__']
        return {'Id':self.ensure_item(token,fields,target_list='FORNECEDORES')}

class Summary:
    def build(self,*args,**kwargs): return {'path':'qa-only.png','filename':'qa-only.png'}

class EmploymentWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.config=json.loads((ROOT/'worker/workflow_config.json').read_text(encoding='utf-8'))
        self.catalog=Catalog(); self.store=Store(); self.messenger=Messenger()
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.store.directory=Path(self.temp.name)
        self.engine=WorkflowEngine(self.config,self.store,None,self.messenger,self.catalog,summary_builder=Summary())
        self.steps=self.config['sharepoint']['supply_supplier_registration_flow']['steps']
        self.state=self.engine._new_state({'message_id':'qa','sender':'qa','conversation_id':'qa','phone_number_id':'portal-admin'},'qa')
        self.state.update(flow='supply_supplier_registration',stage='selecting_fields',supplier_employment_version=2,
            fields={'CADASTRO':'FUNCIONÁRIO SINTÉTICO','TIPO':'MÃO DE OBRA','EMPREITEIRO':'SIM','STATUS':'ATIVO',
                    'VINCULO':'CLT','CARGO':'PEDREIRO I','DATAADMISSAO':'2026-10-01T00:00:00Z'})

    def index(self,key): return next(i for i,s in enumerate(self.steps) if s['key']==key)
    def event(self,text): return {'kind':'text','message_id':'qa-reply','text':text}
    def commit(self):
        self.state.update(stage='committing',step_index=len(self.steps))
        with patch.object(self.engine,'_notify_completed',return_value={'status':'completed'}):
            return self.engine._commit(self.state,None)

    def test_every_link_reaches_role_question_not_only_clt(self):
        for link in ['CLT','TERCEIRIZADO','INFORMAL']:
            with self.subTest(link=link):
                self.state['fields']['VINCULO']=link; self.state['step_index']=self.index(ROLE)
                result=self.engine._prompt_next_or_summary(self.state,None)
                self.assertEqual(result.get('field'),ROLE)
                self.assertEqual([x['value'] for x in self.state['options'] if isinstance(x['id'],int)],ROLES)
        self.assertEqual(self.catalog.rows,{})

    def test_supervisor_choice_advances_to_required_admission(self):
        self.state['step_index']=self.index(ROLE)
        self.engine._prompt_next_or_summary(self.state,None)
        result=self.engine._handle_step_reply({**self.event(''),'reply_id':f'choice:{ROLE}:8'},self.state,None)
        self.assertEqual(result.get('field'),ADMISSION)
        self.assertEqual(self.state['fields']['CARGO'],'SUPERVISOR DE OBRAS')
        self.assertEqual(self.catalog.rows,{})

    def test_admission_rejects_impossible_and_blank_dates_then_keeps_calendar_day(self):
        self.assertIn(ADMISSION,[s['key'] for s in self.steps])
        self.state['step_index']=self.index(ADMISSION); self.state['fields'].pop('DATAADMISSAO')
        for invalid in ['31/02/2026','','EM BRANCO']:
            self.assertEqual(self.engine._handle_step_reply(self.event(invalid),self.state,None)['status'],'invalid_date')
            self.assertNotIn('DATAADMISSAO',self.state['fields'])
        self.engine._handle_step_reply(self.event('14/10/2026'),self.state,None)
        self.assertEqual(str(self.state['fields']['DATAADMISSAO'])[:10],'2026-10-14')
        self.assertEqual(self.catalog.rows,{})

    def test_old_confirmation_cannot_write_without_admission_or_any_link_role(self):
        for link in ['CLT','TERCEIRIZADO','INFORMAL']:
            with self.subTest(link=link):
                self.state['fields']['VINCULO']=link; self.state['fields'].pop('DATAADMISSAO',None)
                result=self.commit()
                self.assertEqual(result.get('field'),ADMISSION)
                self.assertEqual(self.catalog.rows,{})

    def test_no_clears_role_and_admission_and_does_not_prompt_them(self):
        self.state['fields']['EMPREITEIRO']='NÃO'; self.state['step_index']=self.index(ROLE)
        self.engine._supplier_employment_review(self.state,None)
        self.assertFalse(self.state['fields'].get('CARGO'))
        self.assertFalse(self.state['fields'].get('DATAADMISSAO'))
        result=self.engine._prompt_next_or_summary(self.state,None)
        self.assertNotIn(result.get('field'),[ROLE,ADMISSION])
        self.assertEqual(self.catalog.rows,{})

    def test_version_one_in_progress_and_edit_menu_retain_original_step(self):
        self.assertIn(ADMISSION,[s['key'] for s in self.steps])
        previous=[s for s in self.steps if s['key']!=ADMISSION]
        old=next(i for i,s in enumerate(previous) if s['key']=='telefone_fornecedor_suprimentos')
        self.state.update(supplier_employment_version=1,step_index=old,edit_step_indices=[old],
            stage='editing_field_choice',options=[{'id':old+1,'title':'TELEFONE','value':old}])
        self.engine._migrate_supplier_employment_steps(self.state)
        self.assertEqual(self.steps[self.state['step_index']]['key'],'telefone_fornecedor_suprimentos')
        self.assertEqual(self.steps[self.state['options'][0]['value']]['key'],'telefone_fornecedor_suprimentos')
        self.assertEqual(self.state['supplier_employment_version'],2)
        self.assertEqual(self.state['edit_step_indices'],[self.state['step_index']])
        before=copy.deepcopy(self.state); self.engine._migrate_supplier_employment_steps(self.state)
        self.assertEqual(self.state,before)

    def test_pre_employment_session_preserves_legacy_question(self):
        legacy=[s for s in self.steps if s['key'] not in {LINK,ROLE,ADMISSION}]
        self.state.pop('supplier_employment_version')
        self.state['step_index']=next(i for i,s in enumerate(legacy) if s['key']=='telefone_fornecedor_suprimentos')
        step=self.engine._current_step(self.state)
        self.assertEqual(step['key'],'telefone_fornecedor_suprimentos')
        self.assertEqual(self.state['supplier_employment_version'],2)

    def test_sync_failure_is_not_reported_as_complete_and_retry_keeps_supplier_id(self):
        sync=SimpleNamespace(sync_supplier=lambda *a,**k: (_ for _ in ()).throw(RuntimeError('synthetic mirror failure')))
        with patch.object(workflow,'contractor_employment',sync,create=True):
            result=self.commit()
        self.assertEqual(result['status'],'submission_failed')
        self.assertEqual(self.catalog.post_count,1)
        sync.sync_supplier=lambda *a,**k: {'status':'synced','item_id':20}
        with patch.object(workflow,'contractor_employment',sync,create=True):
            self.assertEqual(self.commit()['status'],'completed')
        self.assertEqual(self.catalog.post_count,1)

if __name__=='__main__': unittest.main()
