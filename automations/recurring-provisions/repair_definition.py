"""Guard an existing recurring-payment WDL definition before numeric conversion.

Blank variable bills remain pending with their original date. This transformer
does not supply a price, advance a pending bill, or change financial write actions.
"""
from copy import deepcopy
import json
from pathlib import Path


def repair_definition(definition):
    result = deepcopy(definition)
    actions = result['actions']
    iteration = actions['For_each']
    source = "@outputs('Get_items')?['body/value']"
    if iteration['foreach'] not in (source, "@body('Recorrencias_com_valor')"):
        raise ValueError('Unexpected recurring-payment source; inspect before repair')
    missing = "empty(trim(replace(string(item()?['VALORMENSAL']),'R$','')))"
    for name, condition in [('Recorrencias_com_valor', 'not('+missing+')'),
                            ('Recorrencias_aguardando_valor', missing)]:
        actions[name] = {'type':'Query', 'runAfter':{'Get_items':['Succeeded']},
                         'inputs':{'from':source, 'where':'@'+condition}}
    actions['Contas_aguardando_fatura'] = {
        'type':'Select', 'runAfter':{'Recorrencias_aguardando_valor':['Succeeded']},
        'inputs':{'from':"@body('Recorrencias_aguardando_valor')", 'select':{
            'ID':"@item()?['ID']", 'FORNECEDOR':"@item()?['FORNECEDOR']",
            'DATAFIM':"@item()?['DATAFIM']",
            'motivo':'Aguardando valor da fatura; nenhuma provisao criada ou data avancada.'}}}
    iteration['foreach'] = "@body('Recorrencias_com_valor')"
    iteration['runAfter'] = {'Recorrencias_com_valor':['Succeeded']}
    return result


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    original = json.loads(args.input.read_text(encoding='utf-8-sig'))
    args.output.write_text(json.dumps(repair_definition(original),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
