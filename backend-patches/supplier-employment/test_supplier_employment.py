"""Exercise supplier registration using the real engine and in-memory services."""
import copy
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(os.environ['SUPPLIER_EMPLOYMENT_SOURCE']).resolve()
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT), str(ROOT / 'tests')]
import test_workflow as fixtures

ROLES = ['SERVENTE DE PEDREIRO I', 'SERVENTE DE PEDREIRO II', 'SERVENTE DE PEDREIRO III',
         'PEDREIRO I', 'PEDREIRO II', 'PEDREIRO III', 'MESTRE DE OBRAS']
LINK = 'vinculo_fornecedor_suprimentos'
ROLE = 'cargo_fornecedor_suprimentos'
CONTRACTOR = 'empreiteiro_fornecedor_suprimentos'

class SupplierEmploymentTests(unittest.TestCase):
    setUp = fixtures.WorkflowTests.setUp

    def flow(self):
        return self.config['sharepoint']['supply_supplier_registration_flow']

    def make_state(self, key=CONTRACTOR, fields=None, embedded=None):
        steps = self.flow()['steps']
        self.case_number = getattr(self, 'case_number', 0) + 1
        state = {'key': f'supplier-employment-test-{self.case_number}', 'batch_id': f'employment-test-{self.case_number}',
                 'conversation_id': '5531999999999', 'flow': 'supply_supplier_registration',
                 'stage': 'selecting_fields', 'step_index': next(i for i,s in enumerate(steps) if s['key'] == key),
                 'supplier_employment_version': 1, 'fields': {'TIPO': 'MÃO DE OBRA', **(fields or {})},
                 'answers': {}, 'display_values': {}, 'selections': {}, 'attachments': []}
        if embedded:
            state['embedded_flow'] = {'type': embedded, 'state': {'flow': 'launch'}}
        return state

    def choose(self, state, result, option_id):
        step = self.engine._current_step(state)
        return self.engine._handle_selection_reply(
            {'kind': 'text', 'reply_id': f"choice:{step['key']}:{option_id}", 'text': '', 'message_id': 'test'},
            state, result.get('etag'), step)

    def test_yes_asks_exact_links_and_clt_asks_seven_roles_for_every_entry(self):
        for embedded in [None, 'launch_supplier_registration', 'new_quotation_supplier_registration', 'payment_supplier_registration']:
            with self.subTest(entry=embedded):
                state = self.make_state(embedded=embedded)
                result = self.engine._prompt_next_or_summary(state, None)
                result = self.choose(state, result, 1)
                self.assertEqual(result['field'], LINK)
                self.assertEqual([o['value'] for o in state['options'] if isinstance(o['id'], int)], ['CLT','TERCEIRIZADO','INFORMAL'])
                result = self.choose(state, result, 1)
                self.assertEqual(result['field'], ROLE)
                self.assertEqual([o['value'] for o in state['options'] if isinstance(o['id'], int)], ROLES)
                for index, cargo in enumerate(ROLES, 1):
                    candidate = self.make_state(ROLE, {'EMPREITEIRO':'SIM', 'VINCULO':'CLT'})
                    prompt = self.engine._prompt_next_or_summary(candidate, None)
                    self.choose(candidate, prompt, index)
                    self.assertEqual(candidate['fields']['CARGO'], cargo)
                self.assertEqual(self.sharepoint.items, {})

    def test_third_party_and_informal_skip_role_and_clear_previous_role(self):
        for option, link in [(2,'TERCEIRIZADO'),(3,'INFORMAL')]:
            state = self.make_state(LINK, {'EMPREITEIRO':'SIM','VINCULO':'CLT','CARGO':'PEDREIRO III'})
            result = self.engine._prompt_next_or_summary(state, None)
            result = self.choose(state, result, option)
            self.assertEqual(state['fields']['VINCULO'], link)
            self.assertNotEqual(result.get('field'), ROLE)
            self.assertFalse(state['fields'].get('CARGO'))
            self.assertEqual(self.sharepoint.items, {})

    def test_no_skips_both_questions_and_clears_previous_answers(self):
        state = self.make_state(fields={'EMPREITEIRO':'SIM','VINCULO':'CLT','CARGO':'PEDREIRO III'})
        result = self.engine._prompt_next_or_summary(state, None)
        result = self.choose(state, result, 2)
        self.assertNotIn(result.get('field'), [LINK,ROLE])
        self.assertFalse(state['fields'].get('VINCULO'))
        self.assertFalse(state['fields'].get('CARGO'))
        self.assertEqual(self.sharepoint.items, {})

    def test_unlisted_choice_cannot_advance_link_or_role(self):
        for key, fields in [(LINK,{'EMPREITEIRO':'SIM'}),(ROLE,{'EMPREITEIRO':'SIM','VINCULO':'CLT'})]:
            state=self.make_state(key, fields)
            result=self.engine._prompt_next_or_summary(state,None)
            before=state['step_index']
            rejected=self.choose(state,result,99)
            self.assertEqual(rejected['status'],'invalid_option')
            self.assertEqual(state['step_index'],before)
            self.assertEqual(self.sharepoint.items,{})

    def test_legacy_in_progress_step_retains_its_original_meaning(self):
        state=self.make_state('telefone_fornecedor_suprimentos', {'EMPREITEIRO':'SIM'})
        state.pop('supplier_employment_version')
        old=[s for s in self.flow()['steps'] if s['key'] not in [LINK,ROLE]]
        state['step_index']=next(i for i,s in enumerate(old) if s['key']=='telefone_fornecedor_suprimentos')
        step=self.engine._current_step(state)
        self.assertEqual(step['key'],'telefone_fornecedor_suprimentos')
        self.assertEqual(state['supplier_employment_version'],1)

    def test_legacy_confirmation_is_reviewed_before_any_sharepoint_write(self):
        for fields, expected in [
            ({'EMPREITEIRO':'SIM'},LINK),
            ({'EMPREITEIRO':'SIM','VINCULO':'CLT'},ROLE),
            ({'EMPREITEIRO':'SIM','VINCULO':'OUTRO'},LINK),
            ({'EMPREITEIRO':'SIM','VINCULO':'CLT','CARGO':'OUTRO'},ROLE),
        ]:
            with self.subTest(fields=fields):
                state=self.make_state(fields=fields)
                state['stage']='committing'
                state['step_index']=len(self.flow()['steps'])
                result=self.engine._commit(state,None)
                self.assertEqual(result['field'],expected)
                self.assertEqual(self.sharepoint.items,{})

    def test_review_clears_non_applicable_fields_and_dependencies_cover_edit(self):
        for fields in [{'EMPREITEIRO':'NÃO','VINCULO':'CLT','CARGO':'PEDREIRO I'},
                       {'EMPREITEIRO':'SIM','VINCULO':'INFORMAL','CARGO':'PEDREIRO I'}]:
            state=self.make_state(fields=fields)
            self.assertIsNone(self.engine._supplier_employment_review(state,None))
            self.assertFalse(state['fields'].get('CARGO'))
            if fields['EMPREITEIRO']=='NÃO':
                self.assertFalse(state['fields'].get('VINCULO'))
        steps=self.flow()['steps']
        index=next(i for i,s in enumerate(steps) if s['key']==CONTRACTOR)
        keys=[steps[i]['key'] for i in self.engine._related_edit_step_indices(steps,index)]
        self.assertIn(LINK,keys)
        self.assertIn(ROLE,keys)

    def test_legacy_summary_edit_preserves_selected_field(self):
        state=self.make_state(fields={'EMPREITEIRO':'NÃO','TELEFONECONTATO':'5531999999999'})
        state.pop('supplier_employment_version')
        legacy=[s for s in self.flow()['steps'] if s['key'] not in [LINK,ROLE]]
        state['step_index']=len(legacy)
        state['stage']='summarizing'
        self.engine._prompt_edit_field(state,None)
        _, etag=self.state.load(state['key'])
        index=next(i for i,s in enumerate(self.flow()['steps']) if s['key']=='telefone_fornecedor_suprimentos')
        option=next(o for o in state['options'] if o.get('value')==index)
        result=self.engine._handle_edit_field_reply({'message_id':'test','reply_id':f"choice:edit_field:{option['id']}"},state,etag)
        self.assertEqual(result['field'],'telefone_fornecedor_suprimentos')

    def test_legacy_already_open_edit_menu_preserves_selected_field(self):
        state=self.make_state(fields={'EMPREITEIRO':'NÃO','TELEFONECONTATO':'5531999999999','TIPODOCUMENTO':'CPF'})
        legacy=[s for s in self.flow()['steps'] if s['key'] not in [LINK,ROLE]]
        index=next(i for i,s in enumerate(legacy) if s['key']=='telefone_fornecedor_suprimentos')
        state.pop('supplier_employment_version')
        state['stage']='editing_field_choice'
        state['step_index']=len(legacy)
        state['options']=[{'id':index+1,'title':'TELEFONE','value':index}]
        result=self.engine._handle_edit_field_reply({'message_id':'test','reply_id':f'choice:edit_field:{index+1}'},state,None)
        self.assertEqual(result['field'],'telefone_fornecedor_suprimentos')
        self.assertEqual(state['fields']['TIPODOCUMENTO'],'CPF')

    def test_complete_registration_persists_only_applicable_employment_fields(self):
        for contractor, link, cargo in [(1,1,7),(1,2,None),(1,3,None),(2,None,None)]:
            with self.subTest(contractor=contractor,link=link):
                f=fixtures.WorkflowTests()
                f.setUp()
                f._start_supply_registration('CADASTRAR FORNECEDOR')
                for answer in ['FORNECEDOR TESTE','380','392','400',str(contractor)]:
                    result=f.reply(answer)
                if link is not None:
                    self.assertEqual(result['field'],LINK)
                    result=f.reply(str(link))
                if cargo is not None:
                    self.assertEqual(result['field'],ROLE)
                    result=f.reply(str(cargo))
                self.assertEqual(result['field'],'homologacao_fornecedor_suprimentos')
                for answer in ['1','410','123456789','5537998300516','1','contato@fornecedor.com','rua das flores 10','1']:
                    result=f.reply(answer)
                if contractor==1:
                    for answer in ['412','nascimento_em_branco','2','250,50','8','413','414','416']:
                        result=f.reply(answer)
                else:
                    result=f.reply('nascimento_em_branco')
                self.assertEqual(result['status'],'awaiting_attachment_decision')
                self.assertEqual(f.reply('NÃO')['status'],'awaiting_confirmation')
                completed=f.reply('SIM')
                item=f.sharepoint.items[completed['sharepoint_item_id']]
                self.assertEqual(item['target_list'],'FORNECEDORES')
                fields=item['fields']
                if link is None:
                    self.assertFalse(fields.get('VINCULO'))
                else:
                    self.assertEqual(fields['VINCULO'],['CLT','TERCEIRIZADO','INFORMAL'][link-1])
                if cargo is None:
                    self.assertFalse(fields.get('CARGO'))
                else:
                    self.assertEqual(fields['CARGO'],ROLES[cargo-1])

if __name__ == '__main__':
    unittest.main(verbosity=2)
