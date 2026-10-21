"""Build a credential-free, standard-connectors Power Automate import package.

No cloud writes occur in this builder. Import and verify the resulting package
with the user's existing Power Automate connections.
"""
from datetime import date, datetime, timedelta, timezone
from html import escape
import json
from pathlib import Path
import unicodedata
import uuid
import zipfile

SITE = 'https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com'
SUPPLIERS = 'eb179360-ebda-4693-852f-f3aed3eb50b7'
PARENT = '514bf67a-9e76-4bfc-99b7-1f7297ae611a'
CHILD = '6e5c235e-797a-4a86-8c05-25e0ab6ad870'
LABEL = 'VALE ALIMENTAÇÃO'
APIS = {'shared_sharepointonline': 'SharePoint', 'shared_onedriveforbusiness': 'OneDrive for Business'}
NS = uuid.UUID('0451b457-3406-4445-a536-9a2f569628db')


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFD', str(value or '').strip()).upper() if c.isascii() and c.isalnum())


def plan_week(suppliers, reference_date):
    sunday = reference_date - timedelta(days=(reference_date.weekday() + 1) % 7)
    rows, ids, names = [], set(), set()
    for source in suppliers:
        if normalized(source.get('STATUS')) != 'ATIVO' or normalized(source.get('EMPREITEIRO')) != 'SIM':
            continue
        if normalized(source.get('CARGO')) in {'', '0', 'EMBRANCO', 'NAOINFORMADO', 'NAODEFINIDO'}:
            continue
        sid, name, branch = source.get('Id'), str(source.get('Title') or '').strip(), str(source.get('FILIAL') or '').strip()
        if type(sid) is not int or sid <= 0 or sid in ids or not name or normalized(name) in names or not branch:
            raise ValueError('Supplier identity/name/branch is missing or duplicated')
        ids.add(sid)
        names.add(normalized(name))
        rows.append({'id': sid, 'name': name, 'branch': branch, 'cargo': str(source['CARGO']).strip(),
                     'quantity': 5, 'unitValue': 45, 'total': 225})
    rows.sort(key=lambda row: normalized(row['name']))
    return {'sunday': sunday.isoformat(), 'friday': (sunday + timedelta(days=5)).isoformat(),
            'key': 'VA-SEMANAL:' + sunday.isoformat(), 'rows': rows, 'total': 225 * len(rows)}


def parent_payload(plan, title):
    branches = list(dict.fromkeys(row['branch'] for row in plan['rows']))
    return {'Title': title, 'FOLHAOPERACAO': plan['key'], 'FILIAL': branches[0] if len(branches) == 1 else 'DIVERSAS',
            'FORNECEDOR': plan['rows'][0]['name'] if len(plan['rows']) == 1 else 'DIVERSOS',
            'VALORTOTAL': str(plan['total']), 'OBS': LABEL, 'FORMAPGTO': '', 'STATUS': 'PAGAMENTO PREVISTO',
            'DATAPREVISTOPGTO': plan['friday'] + 'T12:00:00Z'}


def child_payload(plan, row, parent_id):
    return {'Title': plan['key'] + ':' + str(row['id']), 'FOLHAOPERACAO': plan['key'] + ':' + str(row['id']),
            'FILIAL': row['branch'], 'FORNECEDOR': row['name'], 'PRODUTO': LABEL, 'OBS': LABEL, 'IMOVEL': 'TODOS',
            'FORMAPGTO': '', 'QTD': '5', 'VALORTOTAL': '45', 'FRETE': '0', 'STATUS': 'PAGAMENTO PREVISTO',
            'PGTOAGENDADO': 'PENDENTE', 'DATA': plan['sunday'] + 'T12:00:00Z',
            'DATAPREVISTOPGTO': plan['friday'] + 'T12:00:00Z', 'DESCRITIVOPROVISAO': str(parent_id)}


def preview_html(plan):
    rows = ''.join(f'<tr><td>{escape(row["name"])}</td><td>{row["quantity"]}</td><td>R$ 45,00</td><td>R$ 225,00</td></tr>' for row in plan['rows'])
    br = lambda value: date.fromisoformat(value).strftime('%d/%m/%Y')
    return ('<!doctype html><html><head><meta charset="utf-8"><style>body{font:12px Arial;color:#143746;padding:30px}'
            'h1{color:#075367}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #b8ccd4}'
            'th{background:#075367;color:white}tfoot{font-weight:bold;background:#e4f3ed}</style></head><body>'
            f'<h1>{LABEL}</h1><p>Criação: {br(plan["sunday"])} | Pagamento previsto: {br(plan["friday"])}</p>'
            f'<table><thead><tr><th>Nome</th><th>Qtd.</th><th>Valor unitário</th><th>Total</th></tr></thead><tbody>{rows}</tbody>'
            f'<tfoot><tr><td colspan="3">TOTAL GERAL ({len(plan["rows"])} fornecedores)</td><td>R$ {plan["total"]:,.2f}</td></tr></tfoot></table>'
            '<p>Quantidade fixa: 5 dias por fornecedor. Valores previstos, ainda não pagos.</p></body></html>').replace(f'{plan["total"]:,.2f}', f'{plan["total"]:,.2f}'.replace(',', '_').replace('.', ',').replace('_', '.'))


def after(name):
    return {name: ['Succeeded']} if name else {}


def compose(value, prev=None):
    return {'type': 'Compose', 'inputs': value, 'runAfter': after(prev)}


def api(conn, operation, parameters, prev=None):
    return {'type': 'OpenApiConnection', 'inputs': {'host': {
        'apiId': '/providers/Microsoft.PowerApps/apis/' + conn, 'connectionName': conn, 'operationId': operation},
        'parameters': parameters, 'authentication': "@parameters('$authentication')"}, 'runAfter': after(prev)}


def http(uri, prev=None, method='GET', body=None):
    params = {'dataset': SITE, 'parameters/method': method, 'parameters/uri': uri,
              'parameters/headers': {'Accept': 'application/json;odata=nometadata'}}
    if body is not None:
        params['parameters/body'] = body
        params['parameters/headers']['Content-Type'] = 'application/json;odata=nometadata'
    action = api('shared_sharepointonline', 'HttpRequest', params, prev)
    if method == 'POST':
        action['inputs']['retryPolicy'] = {'type': 'none'}
    return action


def listing(guid, key_expr):
    return ("@concat('_api/web/lists(guid''" + guid + "'')/items?$filter=FOLHAOPERACAO%20eq%20', "
            "decodeUriComponent('%27'), uriComponent(" + key_expr + "), decodeUriComponent('%27'), '&$top=2')")


def variable(name, value, prev=None):
    return {'type': 'SetVariable', 'inputs': {'name': name, 'value': value}, 'runAfter': after(prev)}


def fail(code, message):
    # Terminate is forbidden inside Foreach. A schema guard fails the current
    # branch and its enclosing run without a write or an invalid template.
    return {'type': 'ParseJson', 'inputs': {'content': {'code': code, 'message': message},
            'schema': {'type': 'object', 'required': ['__VALIDACAO_APROVADA__']}}, 'runAfter': {}}


def require(expression, prev=None, message='Dados inválidos. Nenhum registro existente foi alterado.'):
    tag = uuid.uuid5(NS, str(prev) + expression).hex[:14]
    return {'type': 'If', 'expression': expression,
            'actions': {'Conferido_' + tag: compose('OK')},
            'else': {'actions': {'Interromper_' + tag: fail('VA_VALIDATION', message)}}, 'runAfter': after(prev)}


def ensure(guid, label, fields, key_expr, prev=None):
    """POST exactly once, then authoritative GET even after timeout/validation error."""
    query, branch, reread, check, valid = (prefix + label for prefix in ['Buscar_Criacao_', 'Criar_Se_Ausente_', 'Reler_', 'Unico_', 'Verificar_'])
    create = 'Criar_' + label
    fields_name = 'Campos_' + label
    actions = {fields_name: compose(fields, prev), query: http(listing(guid, key_expr), fields_name)}
    actions[branch] = {'type': 'If', 'expression': f"@equals(length(body('{query}')?['value']), 0)",
        'actions': {create: http(f"_api/web/lists(guid'{guid}')/items", method='POST', body=f"@string(outputs('{fields_name}'))")},
        'else': {'actions': {'Reutilizar_' + label: compose('Reutilizar sem editar')}}, 'runAfter': after(query)}
    actions[reread] = http(listing(guid, key_expr))
    actions[reread]['runAfter'] = {branch: ['Succeeded', 'Failed', 'TimedOut']}
    actions[check] = require(f"@equals(length(body('{reread}')?['value']), 1)", reread)
    comparisons = []
    for name, expected in fields.items():
        value = f"first(body('{reread}')?['value'])?['{name}']"
        right = expected[1:] if isinstance(expected, str) and expected.startswith('@') else "'" + str(expected).replace("'", "''") + "'"
        if name in {'DATA', 'DATAPREVISTOPGTO'}:
            comparisons.append(f"equals(substring(coalesce({value}, '0000-00-00'), 0, 10), substring({right}, 0, 10))")
        elif name in {'VALORTOTAL', 'QTD', 'FRETE'}:
            comparisons.append(f"equals(float(coalesce({value}, '-1')), float({right}))")
        else:
            comparisons.append(f"equals(string(coalesce({value}, '')), string({right}))")
    actions[valid] = require('@and(' + ', '.join(comparisons) + ')', check,
                             'Registro semanal divergente. Confira o descritivo/provisão; não foi sobrescrito.')
    return actions, valid, f"@first(body('{reread}')?['value'])?['Id']"


def attachments(guid, label, item_id, prev=None):
    listing_name, selected, gate, reread, select_again, checked = (
        prefix + label for prefix in ['Anexos_', 'Anexo_Deste_Lote_', 'Anexar_Se_Ausente_', 'Reler_Anexos_', 'Anexo_Confirmado_', 'Conferir_Anexo_'])
    params = {'dataset': SITE, 'table': guid, 'itemId': item_id}
    acts = {listing_name: api('shared_sharepointonline', 'GetItemAttachments', params, prev)}
    def select(source, preceding):
        return {'type': 'Query', 'inputs': {'from': "@body('" + source + "')", 'where': "@equals(item()?['DisplayName'], variables('Manifesto')?['pdfName'])"}, 'runAfter': after(preceding)}
    acts[selected] = select(listing_name, listing_name)
    acts[gate] = {'type': 'If', 'expression': f"@equals(length(body('{selected}')), 0)",
        'actions': {'Anexar_' + label: api('shared_sharepointonline', 'CreateAttachment', {**params,
            'displayName': "@variables('Manifesto')?['pdfName']", 'body': "@base64ToBinary(variables('PDFBase64'))"})},
        'else': {'actions': {'Manter_Anexo_' + label: compose('Não duplicar anexo')}}, 'runAfter': after(selected)}
    acts[reread] = api('shared_sharepointonline', 'GetItemAttachments', params)
    acts[reread]['runAfter'] = {gate: ['Succeeded', 'Failed', 'TimedOut']}
    acts[select_again] = select(reread, reread)
    unique = 'Anexo_Unico_' + label
    acts[unique] = require(f"@equals(length(body('{select_again}')), 1)", select_again)
    content = 'Conteudo_Anexo_' + label
    acts[content] = api('shared_sharepointonline', 'GetAttachmentContent', {**params,
        'attachmentId': f"@first(body('{select_again}'))?['Id']"}, unique)
    acts[checked] = require(f"@equals(base64(body('{content}')), variables('PDFBase64'))", content,
                            'O anexo existente não corresponde ao PDF original do lote. Não foi substituído.')
    return acts, checked


def build_definition():
    key_expr = "concat('VA-SEMANAL:', outputs('Domingo'))"
    supplier_uri = f"_api/web/lists(guid'{SUPPLIERS}')/items?$select=Id,Title,CARGO,STATUS,EMPREITEIRO,FILIAL&$filter=EMPREITEIRO%20eq%20'SIM'%20and%20STATUS%20eq%20'ATIVO'&$orderby=Id&$top=500"
    a = {'Agora_Brasilia': compose("@convertTimeZone(utcNow(), 'UTC', 'E. South America Standard Time')")}
    a['Domingo'] = compose("@formatDateTime(addDays(outputs('Agora_Brasilia'), sub(0, dayOfWeek(outputs('Agora_Brasilia')))), 'yyyy-MM-dd')", 'Agora_Brasilia')
    a['Sexta'] = compose("@formatDateTime(addDays(outputs('Domingo'), 5), 'yyyy-MM-dd')", 'Domingo')
    a['Inicializar'] = {'type': 'InitializeVariable', 'inputs': {'variables': [
        {'name': 'Manifesto', 'type': 'object', 'value': {}}, {'name': 'Fornecedores', 'type': 'array', 'value': []},
        {'name': 'PaginaSeguinte', 'type': 'string', 'value': supplier_uri}, {'name': 'HTMLRows', 'type': 'string', 'value': ''},
        {'name': 'PDFBase64', 'type': 'string', 'value': ''}]}, 'runAfter': after('Sexta')}
    a['Procurar_Descritivo'] = http(listing(PARENT, key_expr), 'Inicializar')
    a['Descritivo_Unico'] = require("@lessOrEquals(length(body('Procurar_Descritivo')?['value']), 1)", 'Procurar_Descritivo')

    page = {'Ler_Fornecedores': http("@replace(variables('PaginaSeguinte'), '" + SITE + "/', '')")}
    page['Acumular'] = {'type': 'Foreach', 'foreach': "@body('Ler_Fornecedores')?['value']", 'actions': {
        'Adicionar': {'type': 'AppendToArrayVariable', 'inputs': {'name': 'Fornecedores', 'value': '@item()'}, 'runAfter': {}}},
        'runtimeConfiguration': {'concurrency': {'repetitions': 1}}, 'runAfter': after('Ler_Fornecedores')}
    page['Proxima_Pagina'] = variable('PaginaSeguinte', "@coalesce(body('Ler_Fornecedores')?['odata.nextLink'], body('Ler_Fornecedores')?['@odata.nextLink'], '')", 'Acumular')
    fresh = {'Todas_As_Paginas': {'type': 'Until', 'expression': "@equals(variables('PaginaSeguinte'), '')", 'limit': {'count': 200, 'timeout': 'PT1H'}, 'actions': page, 'runAfter': {}}}
    fresh['Leitura_Completa'] = require("@equals(variables('PaginaSeguinte'), '')", 'Todas_As_Paginas', 'Paginação incompleta. Nenhuma provisão foi criada.')
    cargo = "toUpper(trim(coalesce(item()?['CARGO'], '')))"
    fresh['Elegiveis'] = {'type': 'Query', 'inputs': {'from': "@variables('Fornecedores')", 'where':
        "@and(equals(toUpper(trim(coalesce(item()?['EMPREITEIRO'], ''))), 'SIM'), equals(toUpper(trim(coalesce(item()?['STATUS'], ''))), 'ATIVO'), not(contains(createArray('', '0', 'EM BRANCO', 'NÃO INFORMADO', 'NAO INFORMADO', 'NÃO DEFINIDO', 'NAO DEFINIDO'), " + cargo + ")))"}, 'runAfter': after('Leitura_Completa')}
    fresh['Linhas'] = {'type': 'Select', 'inputs': {'from': "@body('Elegiveis')", 'select': {
        'id': "@item()?['Id']", 'name': "@trim(coalesce(item()?['Title'], ''))", 'branch': "@trim(coalesce(item()?['FILIAL'], ''))", 'cargo': "@trim(item()?['CARGO'])", 'quantity': 5, 'unitValue': 45, 'total': 225}}, 'runAfter': after('Elegiveis')}
    fresh['Novo_Manifesto'] = compose({'version': 1, 'sunday': "@outputs('Domingo')", 'friday': "@outputs('Sexta')", 'key': '@' + key_expr,
        'title': "@concat('VA-', outputs('Domingo'), '-', workflow()?['run']?['name'])", 'pdfName': "@concat('VALE-ALIMENTACAO-', outputs('Domingo'), '.pdf')",
        'rows': "@body('Linhas')", 'total': "@mul(length(body('Linhas')), 225)"}, 'Linhas')
    fresh['Usar_Cadastro'] = variable('Manifesto', "@outputs('Novo_Manifesto')", 'Novo_Manifesto')
    recovery = {'Ler_Manifesto': api('shared_onedriveforbusiness', 'GetFileContentByPath', {
        'path': "@concat('/', first(body('Procurar_Descritivo')?['value'])?['Title'], '.json')", 'inferContentType': True}),
        'Usar_Manifesto_Original': variable('Manifesto', "@json(base64ToString(body('Ler_Manifesto')?['$content']))", 'Ler_Manifesto')}
    a['Recuperar_Ou_Ler_Cadastro'] = {'type': 'If', 'expression': "@equals(length(body('Procurar_Descritivo')?['value']), 1)",
        'actions': recovery, 'else': {'actions': fresh}, 'runAfter': after('Descritivo_Unico')}
    a['Validar_Estrutura'] = {'type': 'ParseJson', 'inputs': {'content': "@variables('Manifesto')", 'schema': {
        'type': 'object', 'required': ['version', 'sunday', 'friday', 'key', 'title', 'pdfName', 'rows', 'total'],
        'properties': {**{k: {'type': 'string'} for k in ['sunday', 'friday', 'key', 'title', 'pdfName']}, 'version': {'type': 'integer'}, 'total': {'type': 'integer'},
            'rows': {'type': 'array', 'items': {'type': 'object', 'required': ['id', 'name', 'branch', 'cargo', 'quantity', 'unitValue', 'total'],
                'properties': {**{k: {'type': 'integer'} for k in ['id', 'quantity', 'unitValue', 'total']}, **{k: {'type': 'string'} for k in ['name', 'branch', 'cargo']}}}}}}}, 'runAfter': after('Recuperar_Ou_Ler_Cadastro')}
    a['Linhas_Invalidas'] = {'type': 'Query', 'inputs': {'from': "@variables('Manifesto')?['rows']", 'where':
        "@or(lessOrEquals(item()?['id'], 0), empty(trim(item()?['name'])), empty(trim(item()?['branch'])), empty(trim(item()?['cargo'])), not(equals(item()?['quantity'], 5)), not(equals(item()?['unitValue'], 45)), not(equals(item()?['total'], 225)))"}, 'runAfter': after('Validar_Estrutura')}
    for name, value, prev in [('IDs', "@item()?['id']", 'Linhas_Invalidas'), ('Nomes', "@toUpper(trim(item()?['name']))", 'IDs'), ('Filiais', "@item()?['branch']", 'Nomes')]:
        a[name] = {'type': 'Select', 'inputs': {'from': "@variables('Manifesto')?['rows']", 'select': value}, 'runAfter': after(prev)}
    a['Conferir_Manifesto'] = require("@and(equals(variables('Manifesto')?['version'], 1), equals(variables('Manifesto')?['sunday'], outputs('Domingo')), equals(variables('Manifesto')?['friday'], outputs('Sexta')), equals(variables('Manifesto')?['key'], " + key_expr + "), startsWith(variables('Manifesto')?['title'], concat('VA-', outputs('Domingo'), '-')), equals(variables('Manifesto')?['pdfName'], concat('VALE-ALIMENTACAO-', outputs('Domingo'), '.pdf')), equals(length(body('Linhas_Invalidas')), 0), equals(length(union(body('IDs'), body('IDs'))), length(variables('Manifesto')?['rows'])), equals(length(union(body('Nomes'), body('Nomes'))), length(variables('Manifesto')?['rows'])), equals(variables('Manifesto')?['total'], mul(length(variables('Manifesto')?['rows']), 225)))", 'Filiais')
    html_name = "replace(replace(replace(item()?['name'], '&', '&amp;'), '<', '&lt;'), '>', '&gt;')"
    a['Montar_Linhas_PDF'] = {'type': 'Foreach', 'foreach': "@variables('Manifesto')?['rows']", 'actions': {
        'Linha_HTML': {'type': 'AppendToStringVariable', 'inputs': {'name': 'HTMLRows', 'value': "@concat('<tr><td>', " + html_name + ", '</td><td>5</td><td>R$ 45,00</td><td>R$ 225,00</td></tr>')"}, 'runAfter': {}}},
        'runtimeConfiguration': {'concurrency': {'repetitions': 1}}, 'runAfter': after('Conferir_Manifesto')}
    a['HTML'] = compose("@concat('<!doctype html><html><head><meta charset=\"utf-8\"><style>body{font:12px Arial;color:#143746;margin:35px}h1{color:#075367}table{width:100%;border-collapse:collapse}td,th{padding:9px;border:1px solid #b8ccd4}th{background:#075367;color:white}tfoot{font-weight:bold;background:#e4f3ed}</style></head><body><h1>VALE ALIMENTAÇÃO</h1><p>Criação: ', formatDateTime(variables('Manifesto')?['sunday'], 'dd/MM/yyyy'), ' | Pagamento previsto: ', formatDateTime(variables('Manifesto')?['friday'], 'dd/MM/yyyy'), '</p><table><thead><tr><th>Nome</th><th>Qtd.</th><th>Valor unitário</th><th>Total</th></tr></thead><tbody>', variables('HTMLRows'), '</tbody><tfoot><tr><td colspan=\"3\">TOTAL GERAL (', string(length(variables('Manifesto')?['rows'])), ' fornecedores)</td><td>R$ ', formatNumber(variables('Manifesto')?['total'], 'N2', 'pt-BR'), '</td></tr></tfoot></table><p>Quantidade fixa: 5 dias por fornecedor. Valores previstos, ainda não pagos.</p></body></html>')", 'Montar_Linhas_PDF')
    a['Salvar_HTML'] = api('shared_onedriveforbusiness', 'CreateFile', {'folderPath': '/', 'name': "@concat(variables('Manifesto')?['title'], '-', workflow()?['run']?['name'], '.html')", 'body': "@outputs('HTML')"}, 'HTML')
    a['Aguardar_Conversao'] = {'type': 'Wait', 'inputs': {'interval': {'count': 5, 'unit': 'Second'}}, 'runAfter': after('Salvar_HTML')}
    a['Converter_PDF'] = api('shared_onedriveforbusiness', 'ConvertFile', {'id': "@body('Salvar_HTML')?['Id']", 'type': 'PDF'}, 'Aguardar_Conversao')
    a['Preservar_PDF_Original'] = {'type': 'If', 'expression': "@equals(length(body('Procurar_Descritivo')?['value']), 1)", 'actions': {
        'Ler_PDF_Original': api('shared_onedriveforbusiness', 'GetFileContentByPath', {'path': "@concat('/', variables('Manifesto')?['title'], '.pdf')", 'inferContentType': True}),
        'Usar_PDF_Original': variable('PDFBase64', "@base64(body('Ler_PDF_Original'))", 'Ler_PDF_Original')},
        'else': {'actions': {
            'Salvar_Manifesto': api('shared_onedriveforbusiness', 'CreateFile', {'folderPath': '/', 'name': "@concat(variables('Manifesto')?['title'], '.json')", 'body': "@string(variables('Manifesto'))"}),
            'Salvar_PDF': api('shared_onedriveforbusiness', 'CreateFile', {'folderPath': '/', 'name': "@concat(variables('Manifesto')?['title'], '.pdf')", 'body': "@body('Converter_PDF')"}, 'Salvar_Manifesto'),
            'Usar_PDF_Novo': variable('PDFBase64', "@base64(body('Converter_PDF'))", 'Salvar_PDF')}}, 'runAfter': after('Converter_PDF')}
    a['Conferir_PDF'] = require("@and(greater(length(variables('PDFBase64')), 100), startsWith(variables('PDFBase64'), 'JVBER'))", 'Preservar_PDF_Original', 'Conversão PDF não confirmada; nenhuma provisão criada.')

    parent_fields = {'Title': "@variables('Manifesto')?['title']", 'FOLHAOPERACAO': "@variables('Manifesto')?['key']", 'FILIAL': "@if(equals(length(union(body('Filiais'), body('Filiais'))), 1), first(body('Filiais')), 'DIVERSAS')",
        'FORNECEDOR': "@if(equals(length(variables('Manifesto')?['rows']), 1), first(variables('Manifesto')?['rows'])?['name'], 'DIVERSOS')",
        'VALORTOTAL': "@string(variables('Manifesto')?['total'])", 'OBS': LABEL, 'FORMAPGTO': '', 'STATUS': 'PAGAMENTO PREVISTO', 'DATAPREVISTOPGTO': "@concat(variables('Manifesto')?['friday'], 'T12:00:00Z')"}
    financial, prev, parent_id = ensure(PARENT, 'Descritivo', parent_fields, "variables('Manifesto')?['key']")
    atts, prev = attachments(PARENT, 'Descritivo', parent_id, prev)
    financial.update(atts)
    child_key = "concat(variables('Manifesto')?['key'], ':', string(items('Cada_Fornecedor')?['id']))"
    child_fields = {'Title': '@' + child_key, 'FOLHAOPERACAO': '@' + child_key, 'FILIAL': "@items('Cada_Fornecedor')?['branch']", 'FORNECEDOR': "@items('Cada_Fornecedor')?['name']",
        'PRODUTO': LABEL, 'OBS': LABEL, 'IMOVEL': 'TODOS', 'FORMAPGTO': '', 'QTD': '5', 'VALORTOTAL': '45', 'FRETE': '0', 'STATUS': 'PAGAMENTO PREVISTO', 'PGTOAGENDADO': 'PENDENTE',
        'DATA': "@concat(variables('Manifesto')?['sunday'], 'T12:00:00Z')", 'DATAPREVISTOPGTO': "@concat(variables('Manifesto')?['friday'], 'T12:00:00Z')", 'DESCRITIVOPROVISAO': '@string(' + parent_id[1:] + ')'}
    children, child_prev, child_id = ensure(CHILD, 'Provisao', child_fields, child_key)
    child_atts, child_prev = attachments(CHILD, 'Provisao', child_id, child_prev)
    children.update(child_atts)
    financial['Cada_Fornecedor'] = {'type': 'Foreach', 'foreach': "@variables('Manifesto')?['rows']", 'actions': children, 'runtimeConfiguration': {'concurrency': {'repetitions': 1}}, 'runAfter': after(prev)}
    financial['Resumo_Criacao'] = compose({'descritivo': parent_id, 'fornecedores': "@length(variables('Manifesto')?['rows'])", 'total': "@variables('Manifesto')?['total']", 'vencimento': "@variables('Manifesto')?['friday']"}, 'Cada_Fornecedor')
    a['Somente_Domingo'] = {'type': 'If', 'expression': "@and(equals(dayOfWeek(outputs('Agora_Brasilia')), 0), greater(length(variables('Manifesto')?['rows']), 0))", 'actions': financial,
        'else': {'actions': {'Previa_Sem_Provisoes': compose({'modo': 'PRÉVIA - sem criação de provisões', 'pdf': "@concat('/', variables('Manifesto')?['title'], '.pdf')", 'fornecedores': "@length(variables('Manifesto')?['rows'])", 'total': "@variables('Manifesto')?['total']", 'vencimento': "@variables('Manifesto')?['friday']"})}}, 'runAfter': after('Conferir_PDF')}
    return {'$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#', 'contentVersion': '1.0.0.0',
        'parameters': {'$connections': {'defaultValue': {}, 'type': 'Object'}, '$authentication': {'defaultValue': {}, 'type': 'SecureObject'}},
        'triggers': {'Domingo_06h': {'type': 'Recurrence', 'recurrence': {'frequency': 'Week', 'interval': 1, 'timeZone': 'E. South America Standard Time', 'startTime': '2026-10-25T06:00:00',
            'schedule': {'weekDays': ['Sunday'], 'hours': [6], 'minutes': [0]}}, 'runtimeConfiguration': {'concurrency': {'runs': 1}}}}, 'actions': a, 'outputs': {}}


def build_package(output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    guid = lambda value: str(uuid.uuid5(NS, value))
    fid = guid('flow')
    display = 'VALE ALIMENTAÇÃO — domingo — provisão semanal'
    manifest = {'schema': '1.0', 'details': {'displayName': display, 'description': 'Domingo 06h Brasília. Um descritivo, uma provisão por empreiteiro ativo com cargo. Sexta-feira, 5 x R$45. PDF detalhado. Testes fora de domingo geram somente prévia.', 'createdTime': datetime.now(timezone.utc).isoformat(), 'packageTelemetryId': guid('telemetry'), 'creator': 'N/A', 'sourceEnvironment': ''}, 'resources': {}}
    refs = {conn: {'connectionName': '__VINCULAR_CONEXAO__', 'source': 'Embedded', 'id': '/providers/Microsoft.PowerApps/apis/' + conn, 'tier': 'NotSpecified'} for conn in APIS}
    wrapper = {'name': fid, 'id': '/providers/Microsoft.Flow/flows/' + fid, 'type': 'Microsoft.Flow/flows', 'properties': {'apiId': '/providers/Microsoft.PowerApps/apis/shared_logicflows', 'displayName': display, 'definition': build_definition(), 'connectionReferences': refs, 'flowFailureAlertSubscribed': False}}
    files = {f'Microsoft.Flow/flows/{fid}/definition.json': wrapper, f'Microsoft.Flow/flows/{fid}/apisMap.json': {conn: guid('api/' + conn) for conn in APIS},
             f'Microsoft.Flow/flows/{fid}/connectionsMap.json': {conn: guid('conn/' + conn) for conn in APIS}, 'Microsoft.Flow/flows/manifest.json': {'packageSchemaVersion': '1.0', 'flowAssets': {'assetPaths': [fid]}}}
    manifest['resources'][fid] = {'type': 'Microsoft.Flow/flows', 'suggestedCreationType': 'New', 'creationType': 'Existing, New, Update', 'details': {'displayName': display}, 'configurableBy': 'User', 'hierarchy': 'Root', 'dependsOn': [guid(kind + '/' + conn) for conn in APIS for kind in ['api', 'conn']]}
    for conn, label in APIS.items():
        aid, cid = guid('api/' + conn), guid('conn/' + conn)
        manifest['resources'][aid] = {'id': '/providers/Microsoft.PowerApps/apis/' + conn, 'name': conn, 'type': 'Microsoft.PowerApps/apis', 'suggestedCreationType': 'Existing', 'details': {'displayName': label}, 'configurableBy': 'System', 'hierarchy': 'Child', 'dependsOn': []}
        manifest['resources'][cid] = {'type': 'Microsoft.PowerApps/apis/connections', 'suggestedCreationType': 'Existing', 'creationType': 'Existing', 'details': {'displayName': label + ' Energetica'}, 'configurableBy': 'User', 'hierarchy': 'Child', 'dependsOn': [aid]}
    files['manifest.json'] = manifest
    output = output_dir / 'Energetica-VA-Semanal.zip'
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, value in files.items():
            archive.writestr(name, json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    (output_dir / 'definition.json').write_text(json.dumps(wrapper, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return output


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps({'package': str(build_package(args.output)), 'tenantImportVerified': False}))
