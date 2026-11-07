"""Enable the existing supplier recommendation only in new payment provisions."""
import json

RECOMMENDED = {
    'list': 'FORNECEDORES', 'match_field': 'CADASTRO',
    'match_value_from': 'FORNECEDOR', 'value_field': 'FILIAL',
    'marker': 'PADRÃO DO FORNECEDOR', 'ensure_option': False,
}


def change(data):
    text = data.decode('utf-8')
    before = json.loads(text)
    steps = before['sharepoint']['payment_flow']['steps']
    step = next(item for item in steps if item['key'] == 'filial_pagamento')
    if 'recommended' in step['source']:
        raise RuntimeError('Recommendation already configured; re-review baseline')
    start = text.index('"key": "filial_pagamento"')
    end = text.index('"key": "imovel_pagamento"', start)
    block = text[start:end]
    needle = '            "sort_field": "Title"\n'
    if block.count(needle) != 1:
        raise RuntimeError('Branch source anchor drift')
    replacement = '            "sort_field": "Title",\n            "recommended": ' + json.dumps(RECOMMENDED, ensure_ascii=False, indent=2).replace('\n', '\n            ') + '\n'
    result = text[:start] + block.replace(needle, replacement) + text[end:]
    expected = json.loads(data)
    next(item for item in expected['sharepoint']['payment_flow']['steps'] if item['key'] == 'filial_pagamento')['source']['recommended'] = RECOMMENDED
    if json.loads(result) != expected:
        raise RuntimeError('Unexpected config mutation')
    return result.encode('utf-8')
