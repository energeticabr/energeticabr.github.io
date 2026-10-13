"""Extend the existing financial menu using the verified SharePoint columns."""
import copy
import hashlib
import json
from pathlib import Path
import sys

BASE_CONFIG = '838eeb162202def424ca5dfb2bd5883f2dcba55c884cb5800d8a8de683746740'

def movement_flow():
    return {
        'target_list':'MOVIMENTACOESFINANCEIRAS', 'idempotency_field':'Title',
        'attachments_after_fields':False, 'attachments_required':False, 'fixed_fields':[],
        'confirmation_prompt':'CONFIRMA ESTA MOVIMENTAÇÃO FINANCEIRA?',
        'completion_subject':'Movimentação financeira','completion_verb':'registrada',
        'summary_fields':[{'field':field,'label':label} for field,label in [
            ('INSTITUICAO','INSTITUIÇÃO'),('DESCRICAO','DESCRIÇÃO'),('OPERACAO','OPERAÇÃO'),('VALOR','VALOR')]],
        'steps':[
            {'key':'instituicao_movimentacao','kind':'selection','target_field':'INSTITUICAO',
             'prompt':'🏦 SELECIONE A INSTITUIÇÃO DA MOVIMENTAÇÃO.','edit_label':'INSTITUIÇÃO',
             'source':{'type':'sharepoint_list','list':'INSTITUICAOEMISSORA','id_field':'Id',
                       'label_field':'INSTITUICAOEMISSORA','value_field':'INSTITUICAOEMISSORA','distinct':True,'top':5000}},
            {'key':'descricao_movimentacao','kind':'selection','target_field':'DESCRICAO',
             'prompt':'📝 SELECIONE A DESCRIÇÃO CADASTRADA PARA ESTA INSTITUIÇÃO.','edit_label':'DESCRIÇÃO',
             'source':{'type':'sharepoint_list','list':'CADASTRO INVESTIMENTO','id_field':'Id',
                       'label_field':'DESCRICAO','value_field':'DESCRICAO','distinct':True,'top':5000,
                       'filters':[{'field':'INSTITUICAO','value_from':'INSTITUICAO'}]}},
            {'key':'operacao_movimentacao','kind':'text','target_field':'OPERACAO',
             'prompt':'🔄 INFORME A OPERAÇÃO DA MOVIMENTAÇÃO.','edit_label':'OPERAÇÃO'},
            {'key':'valor_movimentacao','kind':'number','target_field':'VALOR','number_style':'currency',
             'prompt':'💵 INFORME O VALOR DA MOVIMENTAÇÃO.','edit_label':'VALOR',
             'invalid_message':'INFORME UM VALOR VÁLIDO MAIOR QUE ZERO.'},
        ],
    }

def apply_config(original):
    candidate=copy.deepcopy(original)
    assert 'financial_movement_flow' not in candidate['sharepoint']
    actions=candidate['whatsapp']['start_actions']
    index=next(i for i,a in enumerate(actions) if a['id']=='action_financial_registrations')+1
    actions.insert(index,{'id':'action_financial_movement','title':'💸 APONTAR MOVIMENTAÇÃO',
        'aliases':['APONTAR MOVIMENTAÇÃO','MOVIMENTAÇÃO FINANCEIRA'],'group':'group_financial','flow':'financial_movement'})
    candidate['sharepoint']['financial_movement_flow']=movement_flow()
    recovered=copy.deepcopy(candidate)
    recovered['whatsapp']['start_actions'].pop(index)
    recovered['sharepoint'].pop('financial_movement_flow')
    assert recovered==original
    return candidate

if __name__=='__main__':
    source,destination=map(Path,sys.argv[1:3])
    assert hashlib.sha256(source.read_bytes()).hexdigest()==BASE_CONFIG,'Config source drift'
    from config import validate_workflow_config
    result=apply_config(json.loads(source.read_text(encoding='utf-8')))
    validate_workflow_config(result)
    destination.write_bytes((json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
    destination.chmod(0o600)
    print(hashlib.sha256(destination.read_bytes()).hexdigest())
