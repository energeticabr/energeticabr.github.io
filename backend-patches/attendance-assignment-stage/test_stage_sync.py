"""Regress the real assignment field projection and editor stage handling."""
import unittest
from workflow import WorkflowEngine

class AssignmentStageTests(unittest.TestCase):
    def test_assignment_copies_full_pair_and_unchanged_stage(self):
        state={'attendance_original_fields':{'IDDESCRITIVOETAPA':'118','ATIVIDADEEXECUTADA':'MONTAGEM','ETAPA':'ALVENARIA E ESTRUTURAS','IMOVEL':'TODOS'}, 'fields':{'IDDESCRITIVOETAPA':'129','ATIVIDADEEXECUTADA':'CONCRETAGEM LAJE','ETAPA':'ALVENARIA E ESTRUTURAS','IMOVEL':'TODOS'}}
        fields=WorkflowEngine._attendance_supplier_presence_changed_fields(state)
        self.assertEqual(fields, {'IDDESCRITIVOETAPA':'129','ATIVIDADEEXECUTADA':'CONCRETAGEM LAJE','ETAPA':'ALVENARIA E ESTRUTURAS','IMOVEL':'TODOS'})

    def test_unrelated_edit_does_not_copy_pattern(self):
        state={'attendance_original_fields':{'IDDESCRITIVOETAPA':'129','ATIVIDADEEXECUTADA':'CONCRETAGEM','ETAPA':'ALVENARIA'},'fields':{'IDDESCRITIVOETAPA':'129','ATIVIDADEEXECUTADA':'CONCRETAGEM','ETAPA':'ALVENARIA'}}
        self.assertEqual(WorkflowEngine._attendance_supplier_presence_changed_fields(state),{})

    def test_assignment_rejects_missing_stage(self):
        state={'attendance_original_fields':{'IDDESCRITIVOETAPA':'118','ATIVIDADEEXECUTADA':'MONTAGEM'},'fields':{'IDDESCRITIVOETAPA':'129','ATIVIDADEEXECUTADA':'CONCRETAGEM'}}
        with self.assertRaises(RuntimeError): WorkflowEngine._attendance_supplier_presence_changed_fields(state)

class AssignmentEndToEndTests(unittest.TestCase):
    def setUp(self):
        import os,sys,copy
        from pathlib import Path
        sys.path.insert(0,str(Path(os.environ['ATTENDANCE_INLINE_SOURCE'])/'tests'))
        import test_workflow as fixtures
        self.c=fixtures.WorkflowTests('runTest'); self.c.setUp(); self.addCleanup(self.c.doCleanups)
        self.c.reply('OPA'); self.c.reply('RECURSOS HUMANOS'); self.c.reply('VALIDAR PRESENÇAS APONTADAS')
        self.c.reply(reply_id='choice:data_presenca_pendente:1814'); self.c.reply('1814')
        self.state,self.etag=next(iter(self.c.state.values.values()))
        original=self.state['fields']
        original.update({'IDDESCRITIVOETAPA':'119','ATIVIDADEEXECUTADA':'MONTAGEM DE FORMAS','ETAPA':'FUNDAÇÃO','IMOVEL':'TODOS','FILIAL':'001 - OURO PRETO'})
        self.state['attendance_original_fields']={**original,'IDDESCRITIVOETAPA':'118','ATIVIDADEEXECUTADA':'OUTRA'}
        target=copy.deepcopy(original); target.update({'Id':2398,'ETAPA':'ETAPA ANTIGA','FORNECEDOR':'TESTE BETA','PRESENCA':'PENDENTE'})
        self.c.sharepoint.items[2398]={'fields':target,'attachments':{},'target_list':'DESCRITIVOPRESENCA'}
        self.state.setdefault('selections',{})['sincronizar_atividade_fornecedor_presenca']=[{'value':'ID:2398','source_values':target}]

    def test_assignment_writes_correct_stage_even_when_source_stage_unchanged(self):
        self.c.engine._attendance_supplier_sync_bulk_updates(self.state,self.c.engine._flow_config(self.state),{},self.etag)
        target=self.c.sharepoint.items[2398]['fields']
        self.assertEqual((target['IDDESCRITIVOETAPA'],target['ATIVIDADEEXECUTADA'],target['ETAPA']),('119','MONTAGEM DE FORMAS','FUNDAÇÃO'))
        self.assertIsNone(self.c.engine._attendance_consistency_record(target,item_id=2398))

    def test_assignment_preflights_every_target_before_any_write(self):
        import copy
        target=copy.deepcopy(self.c.sharepoint.items[2398]['fields']);target.update(Id=2399,FILIAL='OUTRA FILIAL')
        self.c.sharepoint.items[2399]={'fields':target,'attachments':{},'target_list':'DESCRITIVOPRESENCA'}
        self.state['selections']['sincronizar_atividade_fornecedor_presenca'].append({'value':'ID:2399','source_values':target})
        with self.assertRaises(RuntimeError): self.c.engine._attendance_supplier_sync_bulk_updates(self.state,self.c.engine._flow_config(self.state),{},self.etag)
        self.assertEqual(self.c.sharepoint.update_calls,[])


    def test_activity_selection_keeps_stage_from_linked_descriptor(self):
        state={'fields':{'IDDESCRITIVOETAPA':'119','ETAPA':'FUNDAÇÃO'},'display_values':{}}
        self.c.engine._sync_attendance_stage_from_activity(state,{'source_values':{'ETAPA':'ETAPA ANTIGA'}})
        self.assertEqual(state['fields']['ETAPA'],'FUNDAÇÃO')

    def test_activity_selection_does_not_replace_stage_when_descriptor_lookup_fails(self):
        state={'fields':{'IDDESCRITIVOETAPA':'119','ETAPA':'FUNDAÇÃO'},'display_values':{}}
        original=self.c.sharepoint.get_item_fields
        def fail(item_id,fields,target_list=None):
            if target_list=='DEMONSTRATIVOETAPA': raise RuntimeError('offline')
            return original(item_id,fields,target_list)
        self.c.sharepoint.get_item_fields=fail
        self.c.engine._sync_attendance_stage_from_activity(state,{'source_values':{'ETAPA':'ETAPA ANTIGA'}})
        self.assertEqual(state['fields']['ETAPA'],'FUNDAÇÃO')
