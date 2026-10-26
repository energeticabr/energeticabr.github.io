"""Standard SharePoint WDL for the rolling RH benefit rule; no cloud writes."""
from datetime import date
import hashlib
import importlib.util
import json
from pathlib import Path
import re

_spec = importlib.util.spec_from_file_location('swile_builder_model', Path(__file__).with_name('model.py'))
model = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(model)
SITE = 'https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com'
RH = '8311a380-ee1e-42eb-a529-7452a47b0ae3'
PARENT = '514bf67a-9e76-4bfc-99b7-1f7297ae611a'
CHILD = '6e5c235e-797a-4a86-8c05-25e0ab6ad870'


def after(name):
    return {name: ['Succeeded']} if name else {}


def compose(value, previous=None):
    return {'type': 'Compose', 'inputs': value, 'runAfter': after(previous)}


def setvar(name, value, previous=None):
    return {'type': 'SetVariable', 'inputs': {'name': name, 'value': value}, 'runAfter': after(previous)}


def append(name, value, previous=None):
    return {'type': 'AppendToArrayVariable', 'inputs': {'name': name, 'value': value}, 'runAfter': after(previous)}


def select(source, value, previous=None):
    return {'type': 'Select', 'inputs': {'from': source, 'select': value}, 'runAfter': after(previous)}


def guard(expression, previous=None):
    tag = hashlib.sha256((expression + str(previous)).encode()).hexdigest()[:12]
    return {'type': 'If', 'expression': expression,
            'actions': {'OK_' + tag: compose('OK')},
            'else': {'actions': {'Bloquear_' + tag: {'type': 'ParseJson', 'inputs': {
                'content': {'error': 'Validação financeira não confirmada; não sobrescrever registros.'},
                'schema': {'type': 'object', 'required': ['__CONFIRMADO__']}}, 'runAfter': {}}}},
            'runAfter': after(previous)}


def http(uri, previous=None, body=None, etag=None):
    headers = {'Accept': 'application/json;odata=minimalmetadata'}
    params = {'dataset': SITE, 'parameters/method': 'POST' if body is not None else 'GET',
              'parameters/uri': uri, 'parameters/headers': headers}
    if body is not None:
        headers['Content-Type'] = 'application/json;odata=nometadata'
        params['parameters/body'] = body
    if etag is not None:
        headers.update({'X-HTTP-Method': 'MERGE', 'IF-MATCH': etag})
    action = {'type': 'OpenApiConnection', 'inputs': {'host': {
        'apiId': '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
        'connectionName': 'shared_sharepointonline', 'operationId': 'HttpRequest'},
        'parameters': params, 'authentication': "@parameters('$authentication')"}, 'runAfter': after(previous)}
    if body is not None:
        action['inputs']['retryPolicy'] = {'type': 'none'}
    return action


def parallel_one(actions, source, previous=None):
    return {'type': 'Foreach', 'foreach': source, 'actions': actions,
            'runtimeConfiguration': {'concurrency': {'repetitions': 1}}, 'runAfter': after(previous)}


def by_key(guid, expression):
    return ("@concat('_api/web/lists(guid''" + guid + "'')/items?$filter=FOLHAOPERACAO%20eq%20',"
            "decodeUriComponent('%27'),uriComponent(" + expression + "),decodeUriComponent('%27'),'&$top=2')")


def by_parent():
    return ("@concat('_api/web/lists(guid''" + CHILD + "'')/items?$filter=DESCRITIVOPROVISAO%20eq%20',"
            "decodeUriComponent('%27'),variables('ParentId'),decodeUriComponent('%27'),'&$top=500')")


def item_uri():
    return "@concat('_api/web/lists(guid''" + PARENT + "'')/items(',variables('ParentId'),')')"


def paged(prefix, query, previous=None):
    rows, nextvar, seen = prefix + 'Rows', prefix + 'Next', prefix + 'Seen'
    a = {prefix + '_Reset': setvar(rows, [], previous),
         prefix + '_Next': setvar(nextvar, query, prefix + '_Reset'),
         prefix + '_Seen': setvar(seen, [], prefix + '_Next')}
    body = {prefix + '_Page_Allowed': guard("@or(startsWith(variables('" + nextvar + "'),'_api/'),startsWith(variables('" + nextvar + "'),'" + SITE + "/_api/'))")}
    body[prefix + '_Page_Not_Repeated'] = guard("@not(contains(variables('" + seen + "'),variables('" + nextvar + "')))", prefix + '_Page_Allowed')
    body[prefix + '_Remember'] = append(seen, "@variables('" + nextvar + "')", prefix + '_Page_Not_Repeated')
    body[prefix + '_Read'] = http("@replace(variables('" + nextvar + "'),'" + SITE + "/','')", prefix + '_Remember')
    body[prefix + '_Append'] = parallel_one({prefix + '_Add_Row': append(rows, '@item()')}, "@body('" + prefix + "_Read')?['value']", prefix + '_Read')
    body[prefix + '_Advance'] = setvar(nextvar, "@coalesce(body('" + prefix + "_Read')?['odata.nextLink'],body('" + prefix + "_Read')?['@odata.nextLink'],'')", prefix + '_Append')
    a[prefix + '_All'] = {'type': 'Until', 'expression': "@equals(variables('" + nextvar + "'),'')",
        'limit': {'count': 200, 'timeout': 'PT1H'}, 'actions': body, 'runAfter': after(prefix + '_Seen')}
    a[prefix + '_Complete'] = guard("@equals(variables('" + nextvar + "'),'')", prefix + '_All')
    return a


def norm(value):
    value = 'toUpper(trim(string(coalesce(' + value + ",''))))"
    for original, replacement in [(' ', ''), ('-', ''), ('.', ''), ('Á', 'A'), ('À', 'A'), ('Ã', 'A'),
                                  ('Â', 'A'), ('É', 'E'), ('Ê', 'E'), ('Í', 'I'), ('Ó', 'O'), ('Ô', 'O'),
                                  ('Õ', 'O'), ('Ú', 'U'), ('Ç', 'C')]:
        value = 'replace(' + value + ",'" + original + "','" + replacement + "')"
    return value


def blank(value):
    return "contains(createArray('','0','EMBRANCO')," + norm(value) + ')'


def unpaid(row):
    values = ["contains(createArray('PENDENTE','PAGAMENTOPREVISTO')," + norm(row + "?['STATUS']") + ')',
              "contains(createArray('','0','EMBRANCO','PENDENTE')," + norm(row + "?['PGTOAGENDADO']") + ')']
    values += [blank(row + "?['" + field + "']") for field in ['DATAPGTOEFETUADO', 'DATAPGTOAGENDADO', 'DATAEXECUCAOAGENDAMENTO', 'IDLANCAMENTOS', 'IDPEDIDO']]
    return 'and(' + ','.join(values) + ')'


def default_business(row):
    return 'and(' + blank(row + "?['FORMAPGTO']") + ",equals(" + row + "?['OBS'],'VALE ALIMENTAÇÃO'))"


def number(value):
    raw = "replace(string(coalesce(" + value + ",'')),',','.')"
    return 'if(isFloat(' + raw + '),float(' + raw + '),-999999)'


def etag(row):
    return 'coalesce(' + row + "?['odata.etag']," + row + "?['@odata.etag']," + row + "?['__metadata']?['etag'],'')"


def check_children(prefix, previous):
    row = "items('Checar_" + prefix + "')"
    match = prefix + '_RH_Match'
    matched = "first(body('" + match + "'))"
    identity_ok = "if(equals(length(body('" + match + "')),0),true,and(" + ','.join(
        "equals(string(coalesce(" + row + "?['" + field + "'],''))," + matched + "?['" + prop + "'])"
        for field, prop in [('FORNECEDOR', 'name'), ('FILIAL', 'branch'), ('IMOVEL', 'property')]) + '))'
    key = "string(coalesce(" + row + "?['FOLHAOPERACAO'],''))"
    suffix = 'last(split(' + key + ",':'))"
    checks = [unpaid(row), default_business(row), 'startsWith(' + key + ",concat(outputs('Chave'),':'))",
              'if(isInt(' + suffix + '),greater(int(' + suffix + '),0),false)', identity_ok,
              "equals(" + row + "?['PRODUTO'],'VALE ALIMENTAÇÃO')",
              "equals(substring(coalesce(" + row + "?['DATAPREVISTOPGTO'],'0000-00-00'),0,10),outputs('Data_Quarta'))"]
    checks += ['equals(' + number(row + "?['" + field + "']") + ',' + value + ')' for field, value in [('QTD', '5'), ('VALORTOTAL', '45'), ('FRETE', '0')]]
    child = {match: {'type': 'Query', 'inputs': {'from': "@body('Linhas')", 'where': "@equals(concat(outputs('Chave'),':',string(item()?['supplierId']))," + row + "?['FOLHAOPERACAO'])"}, 'runAfter': {}},
             prefix + '_Invalida': {'type': 'If', 'expression': '@not(and(' + ','.join(checks) + '))',
                'actions': {prefix + '_Marcar': append(prefix + 'Invalid', '@' + row + "?['Id']")},
                'else': {'actions': {}}, 'runAfter': after(match)}}
    return {prefix + '_Reset_Invalid': setvar(prefix + 'Invalid', [], previous),
            'Checar_' + prefix: parallel_one(child, "@variables('" + prefix + "Rows')", prefix + '_Reset_Invalid'),
            'Chaves_' + prefix: select("@variables('" + prefix + "Rows')", "@item()?['FOLHAOPERACAO']", 'Checar_' + prefix)}


def validate_definition(definition):
    """Lint the emitted WDL subset; the service still performs final validation."""
    def actions_in(actions):
        for name, action in actions.items():
            yield name, action
            yield from actions_in(action.get('actions', {}))
            yield from actions_in(action.get('else', {}).get('actions', {}))
    all_actions = list(actions_in(definition['actions']))
    names = {name for name, _ in all_actions}
    if len(names) != len(all_actions):
        raise ValueError('Duplicate WDL action names')
    variables = {v['name'] for _, a in all_actions if a['type'] == 'InitializeVariable'
                 for v in a['inputs']['variables']}
    functions = set(('if and or not equals empty length greater lessOrEquals isFloat float isInt int range '
                     'dayOfWeek addDays formatDateTime convertTimeZone utcNow coalesce trim string replace '
                     'item items body outputs variables union contains startsWith substring first last split '
                     'json mul addProperty parameters actions concat toUpper uriComponent decodeUriComponent createArray').split())
    def inspect(value):
        if isinstance(value, dict):
            for child in value.values(): inspect(child)
        elif isinstance(value, list):
            for child in value: inspect(child)
        elif isinstance(value, str) and value.startswith('@'):
            stripped = re.sub(r"'(?:''|[^'])*'", "''", value[1:])
            calls = set(re.findall(r'\b([A-Za-z_]\w*)\s*\(', stripped))
            if calls - functions:
                raise ValueError('Unknown WDL functions: ' + ','.join(sorted(calls - functions)))
            balance = 0
            for char in stripped:
                balance += (char == '(') - (char == ')')
                if balance < 0: raise ValueError('Unbalanced WDL expression')
            if balance: raise ValueError('Unbalanced WDL expression')
            for kind, ref in re.findall(r"\b(variables|body|outputs|actions|items)\('([^']+)'\)", value):
                if ref not in (variables if kind == 'variables' else names):
                    raise ValueError('Unknown WDL reference: ' + ref)
    inspect(definition)


def build_definition(excluded_supplier_ids, start_date):
    excluded = sorted({model.identity(x) for x in excluded_supplier_ids})
    if type(start_date) is not date:
        raise ValueError('Start date must be a local calendar date')
    rh_uri = "_api/web/lists(guid'" + RH + "')/items?$select=Id,Title,IDFORNECEDORORIGEM,FILIAL,IMOVEL&$orderby=Id&$top=500"
    a = {'Agora_Brasilia': compose("@convertTimeZone(utcNow(),'UTC','E. South America Standard Time')")}
    variables = [('Excluidos', 'array', excluded), ('ParentId', 'string', ''), ('Resumo', 'array', [])]
    for prefix in ('RH', 'Antes', 'Depois'):
        variables += [(prefix + 'Rows', 'array', []), (prefix + 'Next', 'string', rh_uri if prefix == 'RH' else ''), (prefix + 'Seen', 'array', [])]
    variables += [('AntesInvalid', 'array', []), ('DepoisInvalid', 'array', [])]
    prev = 'Agora_Brasilia'
    for name, kind, value in variables:
        label = 'Inicializar_' + name
        a[label] = {'type': 'InitializeVariable', 'inputs': {'variables': [{'name': name, 'type': kind, 'value': value}]}, 'runAfter': after(prev)}
        prev = label
    for label, guid in [('Parent', PARENT), ('Child', CHILD)]:
        a[label + 'Field'] = http("_api/web/lists(guid'" + guid + "')/fields/getbyinternalnameortitle('FOLHAOPERACAO')?$select=InternalName,EnforceUniqueValues,Indexed", prev)
        a[label + 'UniqueIndex'] = guard("@and(equals(body('" + label + "Field')?['EnforceUniqueValues'],true),equals(body('" + label + "Field')?['Indexed'],true))", label + 'Field')
        prev = label + 'UniqueIndex'
    a.update(paged('RH', rh_uri, prev))
    a['RH_Origins'] = {'type': 'ParseJson', 'inputs': {'content': "@variables('RHRows')", 'schema': {'type': 'array', 'items': {
        'type': 'object', 'required': ['Id', 'IDFORNECEDORORIGEM'], 'properties': {'Id': {'type': 'integer', 'minimum': 1},
        'IDFORNECEDORORIGEM': {'type': 'string'}}}}}, 'runAfter': after('RH_Complete')}
    origin = "item()?['IDFORNECEDORORIGEM']"
    a['RH_Origens_Invalidas'] = {'type': 'Query', 'inputs': {'from': "@variables('RHRows')", 'where':
        '@not(if(isInt(' + origin + '),and(greater(int(' + origin + '),0),equals(string(int(' + origin + ')),' + origin + ')),false))'}, 'runAfter': after('RH_Origins')}
    a['Validar_Origens'] = guard("@equals(length(body('RH_Origens_Invalidas')),0)", 'RH_Origens_Invalidas')
    a['Elegiveis'] = {'type': 'Query', 'inputs': {'from': "@variables('RHRows')", 'where': "@not(contains(variables('Excluidos'), int(item()?['IDFORNECEDORORIGEM'])))"}, 'runAfter': after('Validar_Origens')}
    prop = "trim(coalesce(item()?['IMOVEL'],''))"
    a['Linhas'] = select("@body('Elegiveis')", {'supplierId': "@int(item()?['IDFORNECEDORORIGEM'])", 'name': "@trim(coalesce(item()?['Title'],''))",
        'branch': "@trim(coalesce(item()?['FILIAL'],''))", 'property': "@if(empty(" + prop + "),'TODOS'," + prop + ')'}, 'Elegiveis')
    a['RH_Invalid'] = {'type': 'Query', 'inputs': {'from': "@body('Linhas')", 'where': "@or(lessOrEquals(item()?['supplierId'],0),empty(item()?['name']),empty(item()?['branch']))"}, 'runAfter': after('Linhas')}
    a['RH_IDs'] = select("@body('Linhas')", "@item()?['supplierId']", 'RH_Invalid')
    a['RH_Nomes'] = select("@body('Linhas')", '@' + norm("item()?['name']"), 'RH_IDs')
    a['RH_Filiais'] = select("@body('Linhas')", "@item()?['branch']", 'RH_Nomes')
    a['Validar_Destinatarios'] = guard("@and(equals(length(body('RH_Invalid')),0),equals(length(union(body('RH_IDs'),body('RH_IDs'))),length(body('Linhas'))),equals(length(union(body('RH_Nomes'),body('RH_Nomes'))),length(body('Linhas'))))", 'RH_Filiais')
    a['Quartas'] = {'type': 'Query', 'inputs': {'from': '@range(0, 15)', 'where': "@equals(dayOfWeek(addDays(outputs('Agora_Brasilia'), item())), 3)"}, 'runAfter': after('Validar_Destinatarios')}
    week = {'Data_Quarta': compose("@formatDateTime(addDays(outputs('Agora_Brasilia'),items('Cada_Quarta')),'yyyy-MM-dd')")}
    week['Chave'] = compose("@concat('SWILE-RH:',outputs('Data_Quarta'))", 'Data_Quarta')
    parent_fields = {'Title': "@concat(outputs('Chave'),'|PREPARANDO')", 'FOLHAOPERACAO': "@outputs('Chave')", 'FORNECEDOR': 'SWILE',
        'FILIAL': "@if(equals(length(union(body('RH_Filiais'),body('RH_Filiais'))),1),first(body('RH_Filiais')),'DIVERSAS')",
        'VALORTOTAL': '0', 'OBS': model.LABEL, 'FORMAPGTO': '', 'STATUS': 'PAGAMENTO PREVISTO',
        'DATAPREVISTOPGTO': "@concat(outputs('Data_Quarta'),'T12:00:00Z')"}
    week['Campos_Pai'] = compose(parent_fields, 'Chave')
    week['Buscar_Pai'] = http(by_key(PARENT, "outputs('Chave')"), 'Campos_Pai')
    week['Pai_Ausente_Ou_Unico'] = guard("@lessOrEquals(length(body('Buscar_Pai')?['value']),1)", 'Buscar_Pai')
    week['Criar_Pai_Se_Ausente'] = {'type': 'If', 'expression': "@equals(length(body('Buscar_Pai')?['value']),0)",
        'actions': {'Criar_Pai': http("_api/web/lists(guid'" + PARENT + "')/items", body="@string(outputs('Campos_Pai'))")},
        'else': {'actions': {}}, 'runAfter': after('Pai_Ausente_Ou_Unico')}
    week['Reler_Pai'] = http(by_key(PARENT, "outputs('Chave')"))
    week['Reler_Pai']['runAfter'] = {'Criar_Pai_Se_Ausente': ['Succeeded', 'Failed', 'TimedOut']}
    week['Pai_Confirmado'] = guard("@equals(length(body('Reler_Pai')?['value']),1)", 'Reler_Pai')
    parent = "first(body('Reler_Pai')?['value'])"
    week['Usar_ParentId'] = setvar('ParentId', '@string(' + parent + "?['Id'])", 'Pai_Confirmado')
    week.update(paged('Antes', by_parent(), 'Usar_ParentId'))
    week.update(check_children('Antes', 'Antes_Complete'))
    week['Faltantes'] = {'type': 'Query', 'inputs': {'from': "@body('Linhas')", 'where': "@not(contains(body('Chaves_Antes'),concat(outputs('Chave'),':',string(item()?['supplierId']))))"}, 'runAfter': after('Chaves_Antes')}
    mutable = [unpaid(parent), default_business(parent), "equals(" + parent + "?['FORNECEDOR'],'SWILE')",
        "equals(substring(coalesce(" + parent + "?['DATAPREVISTOPGTO'],'0000-00-00'),0,10),outputs('Data_Quarta'))",
        "contains(createArray(outputs('Chave'),concat(outputs('Chave'),'|PREPARANDO'))," + parent + "?['Title'])",
        "equals(length(variables('AntesInvalid')),0)",
        "equals(length(union(body('Chaves_Antes'),body('Chaves_Antes'))),length(variables('AntesRows')))",
        "or(equals(" + parent + "?['Title'],concat(outputs('Chave'),'|PREPARANDO')),equals(" + number(parent + "?['VALORTOTAL']") + ",mul(length(variables('AntesRows')),225)))"]
    work = {'ETag_Preparar': guard('@not(empty(' + etag(parent) + '))')}
    work['Preparar_Se_Preciso'] = {'type': 'If', 'expression': "@equals(" + parent + "?['Title'],outputs('Chave'))",
        'actions': {'Patch_Preparar': http(item_uri(), body="@string(addProperty(json('{}'),'Title',concat(outputs('Chave'),'|PREPARANDO')))", etag='@' + etag(parent))},
        'else': {'actions': {}}, 'runAfter': after('ETag_Preparar')}
    child_key = "concat(outputs('Chave'),':',string(items('Cada_Novo_Funcionario')?['supplierId']))"
    child_fields = {'Title': '@' + child_key, 'FOLHAOPERACAO': '@' + child_key, 'DESCRITIVOPROVISAO': "@variables('ParentId')",
        'FORNECEDOR': "@items('Cada_Novo_Funcionario')?['name']", 'FILIAL': "@items('Cada_Novo_Funcionario')?['branch']",
        'IMOVEL': "@items('Cada_Novo_Funcionario')?['property']", 'PRODUTO': model.LABEL, 'OBS': model.LABEL, 'FORMAPGTO': '',
        'QTD': '5', 'VALORTOTAL': '45', 'FRETE': '0', 'STATUS': 'PAGAMENTO PREVISTO', 'PGTOAGENDADO': 'PENDENTE',
        'DATA': "@concat(formatDateTime(outputs('Agora_Brasilia'),'yyyy-MM-dd'),'T12:00:00Z')",
        'DATAPREVISTOPGTO': "@concat(outputs('Data_Quarta'),'T12:00:00Z')"}
    child = {'Pai_Antes_De_Criar': http(item_uri())}
    current = "body('Pai_Antes_De_Criar')"
    child['Pai_Ainda_Preparando'] = guard('@and(' + unpaid(current) + ',' + default_business(current) + ",equals(" + current + "?['Title'],concat(outputs('Chave'),'|PREPARANDO')),equals(" + current + "?['FORNECEDOR'],'SWILE'),equals(substring(coalesce(" + current + "?['DATAPREVISTOPGTO'],'0000-00-00'),0,10),outputs('Data_Quarta')))", 'Pai_Antes_De_Criar')
    child['Campos_Filho'] = compose(child_fields, 'Pai_Ainda_Preparando')
    child['Buscar_Filho'] = http(by_key(CHILD, child_key), 'Campos_Filho')
    child['Filho_Ausente_Ou_Unico'] = guard("@lessOrEquals(length(body('Buscar_Filho')?['value']),1)", 'Buscar_Filho')
    child['Criar_Filho_Se_Ausente'] = {'type': 'If', 'expression': "@equals(length(body('Buscar_Filho')?['value']),0)",
        'actions': {'Criar_Filho': http("_api/web/lists(guid'" + CHILD + "')/items", body="@string(outputs('Campos_Filho'))")},
        'else': {'actions': {}}, 'runAfter': after('Filho_Ausente_Ou_Unico')}
    child['Reler_Filho'] = http(by_key(CHILD, child_key))
    child['Reler_Filho']['runAfter'] = {'Criar_Filho_Se_Ausente': ['Succeeded', 'Failed', 'TimedOut']}
    child['Filho_Confirmado_Unico'] = guard("@equals(length(body('Reler_Filho')?['value']),1)", 'Reler_Filho')
    observed = "first(body('Reler_Filho')?['value'])"
    checks = [unpaid(observed)]
    for field in ['FOLHAOPERACAO', 'DESCRITIVOPROVISAO', 'FORNECEDOR', 'FILIAL', 'IMOVEL', 'PRODUTO']:
        checks.append("equals(string(" + observed + "?['" + field + "']),string(outputs('Campos_Filho')?['" + field + "']))")
    checks += ['equals(' + number(observed + "?['" + field + "']") + ',' + value + ')' for field, value in [('QTD', '5'), ('VALORTOTAL', '45'), ('FRETE', '0')]]
    checks.append("equals(substring(coalesce(" + observed + "?['DATAPREVISTOPGTO'],'0000-00-00'),0,10),outputs('Data_Quarta'))")
    child['Filho_Conferido'] = guard('@and(' + ','.join(checks) + ')', 'Filho_Confirmado_Unico')
    work['Cada_Novo_Funcionario'] = parallel_one(child, "@body('Faltantes')")
    work['Cada_Novo_Funcionario']['runAfter'] = {'Preparar_Se_Preciso': ['Succeeded', 'Failed', 'TimedOut']}
    work.update(paged('Depois', by_parent(), 'Cada_Novo_Funcionario'))
    work.update(check_children('Depois', 'Depois_Complete'))
    work['Ainda_Faltantes'] = {'type': 'Query', 'inputs': {'from': "@body('Linhas')", 'where': "@not(contains(body('Chaves_Depois'),concat(outputs('Chave'),':',string(item()?['supplierId']))))"}, 'runAfter': after('Chaves_Depois')}
    work['Conferir_Todas_As_Linhas'] = guard("@and(equals(length(variables('DepoisInvalid')),0),equals(length(body('Ainda_Faltantes')),0),equals(length(union(body('Chaves_Depois'),body('Chaves_Depois'))),length(variables('DepoisRows'))))", 'Ainda_Faltantes')
    work['Pai_Atual_Final'] = http(item_uri(), 'Conferir_Todas_As_Linhas')
    final_parent = "body('Pai_Atual_Final')"
    work['Pai_Final_Mutavel'] = guard('@and(' + unpaid(final_parent) + ',' + default_business(final_parent) + ',not(empty(' + etag(final_parent) + ")),equals(" + final_parent + "?['Title'],concat(outputs('Chave'),'|PREPARANDO')),equals(" + final_parent + "?['FORNECEDOR'],'SWILE'),equals(substring(coalesce(" + final_parent + "?['DATAPREVISTOPGTO'],'0000-00-00'),0,10),outputs('Data_Quarta')))", 'Pai_Atual_Final')
    work['Campos_Finais'] = compose({'Title': "@outputs('Chave')", 'VALORTOTAL': "@string(mul(length(variables('DepoisRows')),225))"}, 'Pai_Final_Mutavel')
    work['Patch_Final'] = http(item_uri(), 'Campos_Finais', body="@string(outputs('Campos_Finais'))", etag='@' + etag(final_parent))
    work['Readback_Final'] = http(item_uri())
    work['Readback_Final']['runAfter'] = {'Patch_Final': ['Succeeded', 'Failed', 'TimedOut']}
    work['Conferir_Final'] = guard("@and(equals(body('Readback_Final')?['Title'],outputs('Chave')),equals(body('Readback_Final')?['FOLHAOPERACAO'],outputs('Chave')),equals(" + number("body('Readback_Final')?['VALORTOTAL']") + ",mul(length(variables('DepoisRows')),225)))", 'Readback_Final')
    work['IDs_Confirmados'] = select("@variables('DepoisRows')", "@item()?['Id']", 'Conferir_Final')
    work['Resumo_Confirmado'] = append('Resumo', {'status': 'confirmed', 'parentId': "@variables('ParentId')", 'dueDate': "@outputs('Data_Quarta')",
        'provisionIds': "@body('IDs_Confirmados')", 'total': "@mul(length(variables('DepoisRows')),225)", 'createdChildren': "@length(body('Faltantes'))"}, 'IDs_Confirmados')
    ready = {'IDs_Ja_Existentes': select("@variables('AntesRows')", "@item()?['Id']")}
    ready['Resumo_Sem_Trabalho'] = append('Resumo', {'status': 'confirmed', 'parentId': "@variables('ParentId')", 'dueDate': "@outputs('Data_Quarta')",
        'provisionIds': "@body('IDs_Ja_Existentes')", 'total': "@mul(length(variables('AntesRows')),225)", 'createdChildren': 0}, 'IDs_Ja_Existentes')
    needs_work = {'Precisa_Trabalhar': {'type': 'If', 'expression': "@or(greater(length(body('Faltantes')),0),equals(" + parent + "?['Title'],concat(outputs('Chave'),'|PREPARANDO')))",
        'actions': work, 'else': {'actions': ready}, 'runAfter': {}}}
    preserved = {'Preservar_Semana': compose({'status': 'preserved', 'parentId': "@variables('ParentId')", 'dueDate': "@outputs('Data_Quarta')",
                                            'reason': 'Pagamento, agendamento ou alteração manual preservados.'})}
    preserved['Resumo_Preservado'] = append('Resumo', "@outputs('Preservar_Semana')", 'Preservar_Semana')
    week['Semana_Mutavel'] = {'type': 'If', 'expression': '@and(' + ','.join(mutable) + ')', 'actions': needs_work,
                             'else': {'actions': preserved}, 'runAfter': after('Faltantes')}
    a['Cada_Quarta'] = parallel_one(week, "@if(greater(length(body('Linhas')),0),body('Quartas'),json('[]'))", 'Quartas')
    a['Resultado'] = compose({'source': 'FUNCIONARIOSRH', 'weeks': "@variables('Resumo')", 'recipients': "@length(body('Linhas'))"}, 'Cada_Quarta')
    return {'$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        'contentVersion': '1.0.0.0', 'parameters': {'$connections': {'defaultValue': {}, 'type': 'Object'},
            '$authentication': {'defaultValue': {}, 'type': 'SecureObject'}},
        'triggers': {'Diariamente_06h': {'type': 'Recurrence', 'recurrence': {'frequency': 'Day', 'interval': 1,
            'timeZone': 'E. South America Standard Time', 'startTime': start_date.isoformat() + 'T06:00:00',
            'schedule': {'hours': [6], 'minutes': [0]}}, 'runtimeConfiguration': {'concurrency': {'runs': 1}}}},
        'actions': a, 'outputs': {}}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding='utf-8'))
    definition = build_definition(config['excludedSupplierIds'], date.fromisoformat(config['startDate']))
    validate_definition(definition)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(definition, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'definition': str(args.output), 'cloudUpdateVerified': False}))
