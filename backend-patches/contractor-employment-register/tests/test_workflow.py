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

def test_all_configured_supplier_answers_have_explicit_hr_columns():
    config = json.loads((ROOT / 'worker/workflow_config.json').read_text(encoding='utf-8'))
    flow = config['sharepoint']['supply_supplier_registration_flow']
    fields = {step['target_field'] for step in [*flow['steps'], *flow.get('fixed_fields', [])]
              if step.get('target_field')}
    mapping = workflow.contractor_employment.FIELD_MAP
    assert fields <= mapping.keys(), 'A registration answer would be omitted from the new HR schema'
    assert {mapping[name] for name in fields} <= workflow.contractor_employment.FIELD_TYPES.keys()

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
    def verify_item(self,item_id,fields,attachment_names,**kwargs):
        assert 'DATAADMISSAO' not in fields and 'DATADESLIGAMENTO' not in fields
        return {'fields':True,'attachments':True}
    def ensure_attachment(self,item_id,name,content,mime_type,**kwargs):
        self.uploaded=(item_id,name,content)
    def _internal_field(self,title,field): return field
    def _target_payload(self,fields,title): return copy.deepcopy(fields)
    def _list_endpoint(self,title): return "web/lists/getByTitle('"+title+"')"
    def _request(self,method,endpoint,**kwargs):
        if method=='GET':
            token=kwargs['params']['$filter'].split("'")[1]
            return {'value':[{'Id':self.tokens[token]}] if token in self.tokens else []}
        fields=kwargs['json']; token=fields['__PowerAppsId__']
        assert 'DATAADMISSAO' not in fields and 'DATADESLIGAMENTO' not in fields
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
        start=getattr(workflow.supplier_registration_checkpoint,'start_future_flow',None)
        if start:
            token=f"WA-supply_supplier_registration-{self.state['batch_id']}"
            self.state['supplier_hr_flow_id']=start(self.catalog,token,state_store=self.store)

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

    def test_hr_failure_is_not_reported_as_complete_and_retry_keeps_supplier_id(self):
        sync=SimpleNamespace(register_from_submission=lambda *a,**k: (_ for _ in ()).throw(RuntimeError('synthetic target failure')))
        with patch.object(workflow,'contractor_employment',sync,create=True):
            result=self.commit()
        self.assertEqual(result['status'],'submission_failed')
        self.assertEqual(self.catalog.post_count,1)
        sync.register_from_submission=lambda *a,**k: {'status':'registered','target_id':20,'verified':True}
        with patch.object(workflow,'contractor_employment',sync,create=True):
            self.assertEqual(self.commit()['status'],'completed')
        self.assertEqual(self.catalog.post_count,1)

    def test_hr_receives_private_answers_and_same_local_bytes_after_source_verification(self):
        content=b'LOCAL SYNTHETIC FILE'
        self.state['attachments']=[{'sharepoint_name':'test.pdf','mime_type':'application/pdf','size':len(content)}]
        self.engine.media_repository=SimpleNamespace(read=lambda attachment:content)
        received=[]
        def register(client,supplier_id,fields,files=(),*,state_store=None):
            self.assertEqual(self.catalog.rows[supplier_id]['fields']['CARGO'],'PEDREIRO I')
            self.assertNotIn('DATAADMISSAO',self.catalog.rows[supplier_id]['fields'])
            self.assertEqual(fields['DATAADMISSAO'],'2026-10-01T00:00:00Z')
            self.assertIs(files[0]['content'],self.catalog.uploaded[2])
            self.assertIs(files[0]['content'],content)
            received.append(supplier_id)
            return {'status':'registered','target_id':20,'verified':True}
        with patch.object(workflow,'contractor_employment',SimpleNamespace(register_from_submission=register)):
            self.assertEqual(self.commit()['status'],'completed')
        self.assertEqual(received,[10])

    def test_non_employee_registration_never_calls_hr(self):
        self.state['fields']['EMPREITEIRO']='NÃO'
        def forbidden(*args,**kwargs): raise AssertionError('NO must not call HR')
        with patch.object(workflow,'contractor_employment',SimpleNamespace(register_from_submission=forbidden)):
            self.assertEqual(self.commit()['status'],'completed')

    def test_unverified_hr_receipt_is_not_announced_complete(self):
        with patch.object(workflow,'contractor_employment',SimpleNamespace(register_from_submission=lambda *a,**k:{'status':'registered','verified':False})):
            self.assertEqual(self.commit()['status'],'submission_failed')

    def test_legacy_resumed_session_does_not_create_hr_even_with_all_answers(self):
        self.state.pop('supplier_hr_flow_id',None)
        with patch.object(workflow,'contractor_employment',SimpleNamespace(register_from_submission=lambda *a,**k: (_ for _ in ()).throw(AssertionError('legacy import')))):
            self.assertEqual(self.commit()['status'],'completed')
        self.assertEqual(self.catalog.post_count,1)

    def test_actual_new_flow_entry_persists_marker_but_migration_does_not(self):
        self.state.pop('supplier_hr_flow_id',None)
        self.engine._begin_action(self.state,None,{'flow':'supply_supplier_registration','title':'NOVO'})
        self.assertTrue(self.state.get('supplier_hr_flow_id'))
        self.assertTrue(list(Path(self.temp.name).rglob('flow-*.json')))
        self.state.pop('supplier_hr_flow_id',None)
        self.state.pop('supplier_employment_version',None)
        self.engine._migrate_supplier_employment_steps(self.state)
        self.assertNotIn('supplier_hr_flow_id',self.state)

    def test_retry_cannot_change_frozen_submission_answers(self):
        failing=SimpleNamespace(register_from_submission=lambda *a,**k: (_ for _ in ()).throw(RuntimeError('partial')))
        with patch.object(workflow,'contractor_employment',failing):
            self.assertEqual(self.commit()['status'],'submission_failed')
        self.state['fields']['CARGO']='PEDREIRO II'
        with patch.object(workflow,'contractor_employment',SimpleNamespace(register_from_submission=lambda *a,**k:{'status':'registered','verified':True})):
            self.assertEqual(self.commit()['status'],'submission_failed')
        self.assertEqual(self.catalog.post_count,1)

    def test_missing_local_file_requests_reattach_and_cannot_silently_complete_without_it(self):
        content=b'FROZEN LOCAL FILE'
        self.state['attachments']=[{'sharepoint_name':'test.pdf','original_name':'test.pdf','mime_type':'application/pdf','size':len(content)}]
        media=SimpleNamespace(read=lambda attachment:content)
        self.engine.media_repository=media
        with patch.object(workflow,'contractor_employment',SimpleNamespace(register_from_submission=lambda *a,**k: (_ for _ in ()).throw(RuntimeError('partial')))):
            self.assertEqual(self.commit()['status'],'submission_failed')
        frozen=copy.deepcopy(self.state['supplier_hr_submission'])
        media.read=lambda attachment: (_ for _ in ()).throw(FileNotFoundError('local file missing'))
        self.assertEqual(self.commit()['status'],'waiting_for_attachment_reupload')
        self.assertEqual(self.state['supplier_hr_submission'],frozen)
        self.assertIn('REENVIE',self.messenger.messages[-1]['prompt'] if isinstance(self.messenger.messages[-1],dict) else self.messenger.messages[-1])
        with patch.object(workflow,'contractor_employment',SimpleNamespace(register_from_submission=lambda *a,**k:{'status':'registered','verified':True})):
            self.assertEqual(self.commit()['status'],'submission_failed')
        self.assertEqual(self.catalog.post_count,1)

    def test_new_flow_with_preexisting_source_token_skips_hr(self):
        token=f"WA-supply_supplier_registration-{self.state['batch_id']}"
        self.catalog.ensure_item(token,{'CADASTRO':'OLD'},target_list='FORNECEDORES')
        with patch.object(workflow,'contractor_employment',SimpleNamespace(register_from_submission=lambda *a,**k: (_ for _ in ()).throw(AssertionError('old POST import')))):
            self.assertEqual(self.commit()['status'],'completed')
        self.assertEqual(self.catalog.post_count,1)

    def test_embedded_new_supplier_flow_also_gets_cutover_marker(self):
        self.state.update(flow='launch',supplier_hr_flow_id=None)
        self.engine._start_embedded_supplier_registration(self.state,None)
        self.assertTrue(self.state['supplier_hr_flow_id'])
        self.assertTrue(self.state['idempotency_token'].startswith('WA-supply_supplier_registration-'))

    def test_actual_store_restart_keeps_frozen_answers_and_source_id(self):
        from local_app import LocalStateStore
        store=LocalStateStore(Path(self.temp.name))
        engine=WorkflowEngine(self.config,store,None,self.messenger,self.catalog,summary_builder=Summary())
        self.state.update(stage='committing',step_index=len(self.steps))
        with patch.object(workflow,'contractor_employment',SimpleNamespace(register_from_submission=lambda *a,**k: (_ for _ in ()).throw(RuntimeError('partial')))):
            self.assertEqual(engine._commit(self.state,None)['status'],'submission_failed')
        state,etag=LocalStateStore(Path(self.temp.name)).load(self.state['key'])
        frozen=copy.deepcopy(state['supplier_hr_submission'])
        restarted=WorkflowEngine(self.config,LocalStateStore(Path(self.temp.name)),None,self.messenger,self.catalog,summary_builder=Summary())
        with patch.object(workflow,'contractor_employment',SimpleNamespace(register_from_submission=lambda *a,**k:{'status':'registered','verified':True})), patch.object(restarted,'_notify_completed',return_value={'status':'completed'}):
            self.assertEqual(restarted._commit(state,etag)['status'],'completed')
        self.assertEqual(state['supplier_hr_submission'],frozen)
        self.assertEqual(self.catalog.post_count,1)

if __name__=='__main__': unittest.main()
