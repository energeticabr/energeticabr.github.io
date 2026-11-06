"""Behavioral regression tests: real workflow, synthetic catalog and storage."""
import copy, os, sys, tempfile, unittest
from pathlib import Path
ROOT=Path(os.environ['PAYMENT_TYPE_SOURCE'])
FIXTURES=Path(os.environ.get('PAYMENT_TYPE_FIXTURES',str(ROOT)))
sys.path[:0]=[str(ROOT/'worker'),str(ROOT),str(FIXTURES/'tests')]
import workflow
import test_workflow as fixtures
sys.path[:0]=[str(ROOT/'worker'),str(ROOT)]
assert Path(workflow.__file__).resolve().parent == (ROOT/'worker').resolve()

CREATE='launch_payroll_type_create'
CONFIRM='launch_payroll_type_create_confirm'
CANCEL='launch_payroll_type_create_cancel'

class PaymentTypeTests(unittest.TestCase):
 def setUp(self):
  fixtures.WorkflowTests.setUp(self)
  self.config['limits']['inactivity_expiration_enabled']=False
  t=tempfile.TemporaryDirectory(); self.addCleanup(t.cleanup); self.state.directory=t.name
  initial=fixtures.event('seed','text')
  self.current=self.engine._new_state(initial,fixtures.conversation_key(initial))
  self.current.update(flow='launch',stage=workflow.LAUNCH_PAYROLL_TYPE_STAGE,
   fields={'PRODUTO':'SERVIÇO FICTÍCIO'},answers={'modo_lancamento':'MÚLTIPLOS LANÇAMENTOS'},
   idempotency_token='preserved-token',attachments=[{'object_name':'qa/receipt','sharepoint_name':'teste.pdf'}],
   pending_launch_payroll={'selected_entries':[{'item_id':901,'IDFOLHA':31,'fields':{'FORNECEDOR':'FORNECEDOR FICTÍCIO','VALOR UNITÁRIO':'10','QUANTIDADE':'2'}}], 'type_index':0,'sheet_entry_index':1})
  self.base=copy.deepcopy(self.current)
  self.counter=0
  self.catalog=[{'id':i+1,'title':name,'value':name,'source_values':{'Id':i+1,'TIPOPGTO':name}} for i,(_,name) in enumerate(workflow.LAUNCH_PAYROLL_TYPE_OPTIONS)]
  original=self.sharepoint.get_options
  def get_options(step, context=None):
   if step['key']=='launch_payroll_types':
    created=[{'id':i,'title':r['fields']['TIPOPGTO'],'value':r['fields']['TIPOPGTO'],'source_values':r['fields']} for i,r in self.sharepoint.items.items() if r['target_list']=='CADASTROTIPOPAGAMENTO']
    return copy.deepcopy(self.catalog+created)
   return original(step,context)
  self.sharepoint.get_options=get_options
  self.applied=[]
  self.engine._apply_launch_payroll_type=lambda state,etag,name: self.applied.append(name) or {'status':'applied'}
 def prompt(self):
  return self.engine._prompt_launch_payroll_type(self.current,self.state.load(self.current['key'])[1])
 def send(self,reply='',text='',message=None):
  if reply in {CONFIRM,CANCEL}:
   reply=next((o['id'] for o in self.options() if str(o['id']).startswith(reply+':')),reply)
  self.counter+=1
  self.engine._save(self.current,self.state.load(self.current['key'])[1])
  result=self.engine.handle(fixtures.event(message or f'payment-{self.counter}','text',reply_id=reply,text=text))
  self.current=self.state.load(self.current['key'])[0]
  return result
 def options(self):
  return next(m['actions'] for m in reversed(self.messenger.sent) if m.get('type')=='actions')
 def created(self):
  return [r for r in self.sharepoint.items.values() if r['target_list']=='CADASTROTIPOPAGAMENTO']
 def preserved(self):
  for key in ['fields','answers','idempotency_token','attachments']:
   self.assertEqual(self.current[key],self.base[key])
  self.assertEqual(self.current['pending_launch_payroll']['selected_entries'],self.base['pending_launch_payroll']['selected_entries'])
 def test_first_button_and_sharepoint_custom_type(self):
  self.catalog.append({'id':99,'title':'FGTS','value':'FGTS'})
  self.prompt(); self.assertEqual(self.options()[0]['id'],CREATE)
  self.assertIn('FGTS',[o['title'] for o in self.options()])
 def test_confirm_writes_only_catalog_and_preserves_launch(self):
  self.prompt(); self.send(CREATE); self.send(text=' Reembolso   médico ')
  self.assertEqual(self.created(),[]); self.assertFalse(self.applied)
  self.send(CONFIRM)
  self.assertEqual(len(self.created()),1)
  self.assertEqual(self.created()[0]['fields']['TIPOPGTO'],'REEMBOLSO MÉDICO')
  self.assertEqual(self.created()[0]['idempotency_field'],'CHAVE')
  self.assertFalse(self.applied); self.preserved()
 def test_cancel_and_back_preserve_launch(self):
  for control in [CANCEL,'navigation_back','cancelar']:
   self.prompt(); self.send(CREATE); self.send(text='TIPO FICTÍCIO'); self.send(control)
   self.assertEqual(self.created(),[]); self.assertFalse(self.applied); self.preserved()
   self.assertEqual(self.options()[0]['id'],CREATE)
 def test_blank_duplicate_and_control_are_not_names(self):
  self.prompt(); self.send(CREATE)
  for text in ['  ','salario','PREMIACAO']:
   self.send(text=text); self.assertEqual(self.created(),[])
   self.assertFalse(any(str(o.get('id','')).startswith(CONFIRM+':') for o in self.options()))
  self.send(CREATE); self.send('launch_payroll_type_salary'); self.send('choice:old:abc')
  self.assertFalse(any(str(o.get('id','')).startswith(CONFIRM+':') for o in self.options()))
 def test_repeat_confirm_cannot_create_or_apply_twice(self):
  self.prompt(); self.send(CREATE); self.send(text='TIPO FICTÍCIO'); self.send(CONFIRM,message='confirm-once')
  self.send(CONFIRM,message='confirm-once'); self.send(CONFIRM)
  self.assertEqual(len(self.created()),1); self.assertFalse(self.applied)
 def test_catalog_empty_still_has_create(self):
  self.catalog=[]; self.prompt(); self.assertEqual(self.options()[0]['id'],CREATE); self.assertFalse(self.applied)
 def test_custom_selection_is_validated_in_catalog(self):
  self.catalog.append({'id':99,'title':'FGTS','value':'FGTS'})
  self.prompt(); self.send('launch_payroll_type_catalog_99'); self.assertEqual(self.applied,['FGTS'])
 def test_individual_scope_rejects_stale_payment_button(self):
  self.current['pending_launch_payroll']['type_assignment_mode']='individual'
  self.catalog.append({'id':99,'title':'FGTS','value':'FGTS'})
  self.prompt(); self.send('launch_payroll_type_for_900:launch_payroll_type_catalog_99'); self.assertEqual(self.applied,[])
  self.send('launch_payroll_type_for_901:launch_payroll_type_catalog_99'); self.assertEqual(self.applied,['FGTS'])
 def test_pagination_keeps_create_and_catalog_reaches_last_page(self):
  self.catalog += [{'id':100+i,'title':f'TIPO FICTÍCIO {i:02d}','value':f'TIPO FICTÍCIO {i:02d}'} for i in range(20)]
  self.prompt(); seen=set()
  for _ in range(5):
   self.assertEqual(self.options()[0]['id'],CREATE)
   seen.update(o['title'] for o in self.options())
   nexts=[o for o in self.options() if str(o.get('id','')).startswith('launch_payroll_type_page_') and 'PRÓXIM' in o['title']]
   if not nexts: break
   self.send(nexts[0]['id'])
  self.assertIn('TIPO FICTÍCIO 19',seen)
 def test_catalog_failure_does_not_apply_or_lose_draft(self):
  self.prompt(); self.send(CREATE); self.send(text='TIPO FICTÍCIO')
  self.sharepoint.fail_ensure_item_once=True
  self.send(CONFIRM); self.assertFalse(self.applied); self.preserved()
  self.send(CONFIRM); self.assertEqual(len(self.created()),1)
 def test_stale_confirmation_cannot_register_another_draft_or_revision(self):
  self.prompt(); self.send(CREATE); self.send(text='TIPO A')
  old=next(o['id'] for o in self.options() if str(o['id']).startswith(CONFIRM))
  self.send(CANCEL); self.send(CREATE); self.send(text='TIPO B'); self.send(old)
  self.assertEqual(self.created(),[])
  revised=next(o['id'] for o in self.options() if str(o['id']).startswith(CONFIRM))
  self.send(text='TIPO C'); self.send(revised); self.assertEqual(self.created(),[])
  self.send(CONFIRM); self.assertEqual(self.created()[0]['fields']['TIPOPGTO'],'TIPO C')
 def test_stale_cancel_cannot_discard_a_new_draft(self):
  self.prompt(); self.send(CREATE); self.send(text='TIPO A')
  old=next(o['id'] for o in self.options() if str(o['id']).startswith(CANCEL))
  self.send(CANCEL); self.send(CREATE); self.send(text='TIPO B'); self.send(old)
  self.assertEqual(self.current['pending_launch_payroll']['catalog_registration']['name'],'TIPO B')
  self.send(CONFIRM); self.assertEqual(self.created()[0]['fields']['TIPOPGTO'],'TIPO B')
 def test_real_payroll_writer_receives_custom_type_once(self):
  self.catalog.append({'id':99,'title':'FGTS','value':'FGTS'})
  self.current['pending_launch_payroll']['selected_entries'][0]['fields'].update(DATA='2026-11-06')
  self.engine._apply_launch_payroll_type=workflow.WorkflowEngine._apply_launch_payroll_type.__get__(self.engine)
  self.engine._continue_launch_after_payroll=lambda state,etag: {'status':'completed'}
  self.engine._save(self.current,self.state.load(self.current['key'])[1])
  self.prompt(); self.send('launch_payroll_type_catalog_99')
  financial=[r for r in self.sharepoint.items.values() if r['target_list']=='FOLHAPGTO']
  self.assertEqual(len(financial),1); self.assertEqual(financial[0]['fields']['TIPOPGTO'],'FGTS')
  self.assertEqual(financial[0]['fields']['IDLANCAMENTO'],901)
 def test_shared_registration_preserves_assignment(self):
  self.current['pending_launch_payroll']['type_assignment_mode']='shared'
  self.prompt(); self.send(CREATE); self.send(text='TIPO FICTÍCIO'); self.send(CONFIRM)
  self.assertEqual(self.current['pending_launch_payroll']['type_assignment_mode'],'shared'); self.preserved()

if __name__=='__main__': unittest.main()
