"""Native WDL monthly payroll-tax flow; builds packages, never calls a cloud API."""
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import uuid
import zipfile

_spec = importlib.util.spec_from_file_location('weekly_standard_connectors', Path(__file__).parents[1]/'weekly-meal-provisions/build_flow.py')
w = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(w)
SITE, PARENT, CHILD, SUPPLIERS = w.SITE, w.PARENT, w.CHILD, w.SUPPLIERS
HR = '8311a380-ee1e-42eb-a529-7452a47b0ae3'
SALARIES = '1bae74a2-dd35-4abf-8a13-899da1000e6a'
SHEETS = '73576660-a385-49c3-b003-337fbc58104c'
PAYROLL = '673fb201-4af4-48b3-a003-fe9a35f580fb'
NS = uuid.UUID('e13f3b0e-3a02-4b46-b3ab-412578fe5ee8')
after, compose, api, http, variable = w.after, w.compose, w.api, w.http, w.variable


def require(expression, prev=None, message='Lote de encargos inválido. Nenhum registro divergente foi sobrescrito.'):
    tag = uuid.uuid5(NS, str(prev)+expression).hex[:14]
    return {'type':'If','expression':expression,'actions':{'Conferido_'+tag:compose('OK')},
            'else':{'actions':{'Interromper_'+tag:{'type':'ParseJson','inputs':{
                'content':{'code':'ENCARGOS_VALIDATION','message':message},
                'schema':{'type':'object','required':['__VALIDACAO_APROVADA__']}},'runAfter':{}}}},'runAfter':after(prev)}


def validate(expression, prev=None, message='Preflight inválido; nenhuma gravação financeira autorizada.'):
    """A native schema assertion uses one action and no nested branch."""
    return {'type':'ParseJson','inputs':{'content':{'ok':expression,'message':message},
        'schema':{'type':'object','required':['ok'],'properties':{'ok':{'type':'boolean','enum':[True]}}}},'runAfter':after(prev)}


def loop(source, actions, prev=None):
    return {'type':'Foreach','foreach':source,'actions':actions,
            'runtimeConfiguration':{'concurrency':{'repetitions':1}},'runAfter':after(prev)}


def query(source, where, prev=None):
    return {'type':'Query','inputs':{'from':source,'where':where},'runAfter':after(prev)}


def select(source, value, prev=None):
    return {'type':'Select','inputs':{'from':source,'select':value},'runAfter':after(prev)}


def append(name, value, prev=None, string=False):
    return {'type':'AppendToStringVariable' if string else 'AppendToArrayVariable',
            'inputs':{'name':name,'value':value},'runAfter':after(prev)}


def increment(name, value, prev=None):
    return {'type':'IncrementVariable','inputs':{'name':name,'value':value},'runAfter':after(prev)}


def escape_html(expression):
    return "replace(replace(replace(string("+expression+"), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')"


def collection(guid, fields):
    return f"_api/web/lists(guid'{guid}')/items?$select={','.join(fields)}&$orderby=Id&$top=500"


def paginated(label, guid, fields, previous, target=None):
    base = collection(guid, fields)
    path = base.split('?')[0].replace("'", "''")
    page_var = 'Pagina'+label
    actions = {'Iniciar_Pagina_'+label:variable(page_var, base, previous)}
    reads = {'Destino_'+label:require("@or(startsWith(variables('"+page_var+"'), '"+path+"?'), startsWith(variables('"+page_var+"'), '"+SITE+'/'+path+"?'))",message='Continuação fora da lista autorizada.'),
             'Nao_Repetir_'+label:require("@not(contains(variables('Visitadas"+label+"'), variables('"+page_var+"')))",'Destino_'+label),
             'Registrar_Pagina_'+label:append('Visitadas'+label,"@variables('"+page_var+"')",'Nao_Repetir_'+label),
             'Ler_'+label:http("@replace(variables('"+page_var+"'), '"+SITE+"/', '')",'Registrar_Pagina_'+label)}
    reads['Acumular_'+label] = loop("@body('Ler_"+label+"')?['value']",{'Adicionar_'+label:append(target or label,'@item()')},'Ler_'+label)
    reads['Proxima_'+label] = variable(page_var,"@coalesce(body('Ler_"+label+"')?['odata.nextLink'], body('Ler_"+label+"')?['@odata.nextLink'], '')",'Acumular_'+label)
    actions['Paginar_'+label] = {'type':'Until','expression':"@equals(variables('"+page_var+"'), '')",'limit':{'count':200,'timeout':'PT1H'},'actions':reads,'runAfter':after('Iniciar_Pagina_'+label)}
    actions['Completo_'+label] = require("@equals(variables('"+page_var+"'), '')",'Paginar_'+label,'Paginação incompleta não é uma lista vazia.')
    return actions, 'Completo_'+label


def lookup(guid, field, value, numeric=False, top=2):
    right = 'string('+value+')' if numeric else "concat(decodeUriComponent('%27'), uriComponent("+value+"), decodeUriComponent('%27'))"
    tail = "'&$top="+str(top)+"'" if isinstance(top,int) else "concat('&$top=', string("+top+"))"
    return "@concat('_api/web/lists(guid''"+guid+"'')/items?$filter="+field+"%20eq%20', "+right+", "+tail+")"


def record_checks(actual, fields):
    """The same frozen-field and unsettled checks gate preflight and readback."""
    checks = []
    for name, expected in fields.items():
        value = actual+"?['"+name+"']"
        right = expected[1:] if isinstance(expected,str) and expected.startswith('@') else "'"+str(expected).replace("'","''")+"'"
        if name in ('DATA','DATAPREVISTOPGTO'):
            checks.append("equals(substring(coalesce("+value+", '0000-00-00'), 0, 10), substring("+right+", 0, 10))")
        elif name in ('QTD','FRETE','VALORTOTAL','VALORUNITARIO','IDFOLHA','IDPROVISAO'):
            checks.append("equals(float(coalesce("+value+", '-1')), float("+right+"))")
        else: checks.append("equals(string(coalesce("+value+", '')), string("+right+"))")
    for name in ('IDLANCAMENTO','IDLANCAMENTOS','IDPEDIDO','IDPEDIDOS','DATAPGTOEFETUADO','DATAPAGAMENTO','DATAPGTO'):
        checks.append("empty(trim(string(coalesce("+actual+"?['"+name+"'], ''))))")
    for name in ('STATUS','PGTOAGENDADO'):
        value = "toUpper(trim(string(coalesce("+actual+"?['"+name+"'], ''))))"
        checks.append("or(empty("+value+"), equals("+value+", 'PENDENTE'), equals("+value+", 'PAGAMENTO PREVISTO'))")
    return '@and('+', '.join(checks)+')'


def intent_path(label, value):
    return "@concat('/ENCARGOS-INTENCAO-', uriComponent(concat('"+label+"-', string("+value+"))), '.json')"


def parent_payload(tax, branches):
    key = "concat('ENCARGOS:', variables('Manifesto')?['competence'], ':', "+tax+")"
    return {'Title':'@'+key,'FOLHAOPERACAO':'@'+key,
        'FILIAL':"@if(equals(length(union("+branches+", "+branches+")), 1), first("+branches+"), 'DIVERSAS')",
        'FORNECEDOR':"@if(equals(length(variables('Manifesto')?['rows']), 1), first(variables('Manifesto')?['rows'])?['name'], 'DIVERSOS')",
        'VALORTOTAL':"@formatNumber(div(variables('Manifesto')?['totals']?["+tax+"], 100.0), 'F2', 'en-US')",
        'OBS':"@concat("+tax+", ' - COMPETÊNCIA ', variables('Manifesto')?['competence'])",'FORMAPGTO':'','STATUS':'PAGAMENTO PREVISTO',
        'DATAPREVISTOPGTO':"@concat(variables('Manifesto')?['dueDate'], 'T12:00:00Z')"}


def provision_payload(row, tax, parent_id):
    key = "concat('ENCARGOS:', variables('Manifesto')?['competence'], ':', "+tax+", ':', string("+row+"?['supplierId']))"
    amount = "formatNumber(div(if(equals("+tax+", 'INSS'), "+row+"?['inssCents'], "+row+"?['fgtsCents']), 100.0), 'F2', 'en-US')"
    return {'Title':'@'+key,'FOLHAOPERACAO':'@'+key,'FILIAL':'@'+row+"?['branch']",'FORNECEDOR':'@'+row+"?['name']",'PRODUTO':'@'+row+"?['profession']",
        'OBS':"@concat("+tax+", ' - ', "+row+"?['name'], ' - COMPETÊNCIA ', variables('Manifesto')?['competence'])",'IMOVEL':'TODOS','FORMAPGTO':'','QTD':'1','VALORTOTAL':'@'+amount,'FRETE':'0',
        'STATUS':'PAGAMENTO PREVISTO','PGTOAGENDADO':'PENDENTE','DATA':"@concat(variables('Manifesto')?['createdDate'], 'T12:00:00Z')",'DATAPREVISTOPGTO':"@concat(variables('Manifesto')?['dueDate'], 'T12:00:00Z')",
        'DESCRITIVOPROVISAO':'@string('+parent_id+')','IDFOLHA':'@'+row+"?['sheetId']"}


def payroll_payload(row, tax, provision_id):
    amount = "formatNumber(div(if(equals("+tax+", 'INSS'), "+row+"?['inssCents'], "+row+"?['fgtsCents']), 100.0), 'F2', 'en-US')"
    return {'Title':"@concat('APP-folha-provisao-', string("+provision_id+"))",'FORNECEDOR':'@'+row+"?['name']",'TIPOPGTO':'@'+tax,
        'VALORUNITARIO':'@'+amount,'QTD':'1','DATA':"@concat(variables('Manifesto')?['dueDate'], 'T12:00:00Z')",'IDFOLHA':"@string("+row+"?['sheetId'])",'IDPROVISAO':'@'+provision_id}


def ensure(guid, label, fields, field, value, previous=None, numeric=False, source_record=None):
    """Unique-key create + durable write-ahead claim + exact authoritative readback."""
    uri = lookup(guid, field, value, numeric)
    fields_name, get_name, create_branch = 'Campos_'+label,'Buscar_Criacao_'+label,'Criar_Se_Ausente_'+label
    reread, unique, verified = 'Reler_'+label,'Unico_'+label,'Verificar_'+label
    acts = {fields_name:compose(fields,previous),get_name:http(uri,fields_name)}
    cached_id = "int(coalesce(variables('IDsValidados')?[concat('"+label+":', string("+value+"))], 0))"
    current_id = "if(empty(body('"+get_name+"')?['value']), 0, first(body('"+get_name+"')?['value'])?['Id'])"
    state = 'Estado_Preflight_'+label
    acts[state] = validate("@and(lessOrEquals(length(body('"+get_name+"')?['value']), 1), equals("+cached_id+", "+current_id+"), if(equals(length(body('"+get_name+"')?['value']), 1), "+record_checks("first(body('"+get_name+"')?['value'])",fields)[1:]+", true))",get_name,'ID/campos/estado mudou após o preflight; não criar, substituir ou anexar.')
    token = "concat('"+label+"-', string("+value+"))"
    intent = intent_path(label, value)
    claim = {'Ler_Intencao_'+label:api('shared_onedriveforbusiness','GetFileMetadataByPath',{'path':intent})}
    guard = 'Intencao_Ausente_'+label
    claim[guard] = require("@equals(outputs('Ler_Intencao_"+label+"')?['statusCode'], 404)",message='Há um envio anterior ainda sem registro confirmado. Não repetir o POST; reconciliar a origem.')
    claim[guard]['runAfter'] = {'Ler_Intencao_'+label:['Succeeded','Failed','TimedOut']}
    temp = 'Salvar_Intencao_'+label
    claim[temp] = api('shared_onedriveforbusiness','CreateFile',{'folderPath':'/',
        'name':"@concat('ENCARGOS-INTENCAO-', uriComponent("+token+"), '-', workflow()?['run']?['name'], '.json')",
        'body':"@string(addProperty(addProperty(json('{}'), 'run', workflow()?['run']?['name']), 'fields', outputs('"+fields_name+"')))"},guard)
    reserve = 'Reservar_Intencao_'+label
    claim[reserve] = api('shared_onedriveforbusiness','CopyDriveFile',{'id':"@body('"+temp+"')?['Id']",'destination':intent,'overwrite':False},temp)
    claim[reserve]['inputs']['retryPolicy'] = {'type':'none'}
    read_claim = 'Conferir_Intencao_'+label
    claim[read_claim] = api('shared_onedriveforbusiness','GetFileContentByPath',{'path':intent,'inferContentType':False})
    claim[read_claim]['runAfter'] = {reserve:['Succeeded','Failed','TimedOut']}
    own = 'Intencao_Propria_'+label
    claim[own] = require("@and(equals(json(base64ToString(body('"+read_claim+"')?['$content']))?['run'], workflow()?['run']?['name']), equals(string(json(base64ToString(body('"+read_claim+"')?['$content']))?['fields']), string(outputs('"+fields_name+"'))))",read_claim)
    before_create = own
    if source_record is not None:
        source_guid, source_id, source_fields = source_record
        read_source, valid_source = 'Provisao_Atual_Para_'+label, 'Estado_Provisao_Para_'+label
        claim[read_source] = http("@concat('_api/web/lists(guid''"+source_guid+"'')/items(', string("+source_id[1:]+"), ')')",own)
        claim[valid_source] = validate(record_checks("body('"+read_source+"')",source_fields),read_source,'Provisão de origem alterada ou baixada; não criar o vínculo FOLHAPGTO.')
        before_create = valid_source
    claim['Criar_'+label] = http(f"_api/web/lists(guid'{guid}')/items",before_create,method='POST',body="@string(outputs('"+fields_name+"'))")
    acts[create_branch] = {'type':'If','expression':"@equals(length(body('"+get_name+"')?['value']), 0)",'actions':claim,
        'else':{'actions':{'Reutilizar_'+label:compose('Conferir o registro já gravado, sem editar')}},'runAfter':after(state)}
    acts[reread] = http(uri); acts[reread]['runAfter'] = {create_branch:['Succeeded','Failed','TimedOut']}
    acts[unique] = require("@and(equals(length(body('"+reread+"')?['value']), 1), or(equals("+cached_id+", 0), equals(first(body('"+reread+"')?['value'])?['Id'], "+cached_id+")))",reread)
    acts[verified] = require(record_checks("first(body('"+reread+"')?['value'])", fields),unique,'Registro existente diverge do plano congelado ou já liquidado. Não substituir nem duplicar.')
    return acts, verified, "@first(body('"+reread+"')?['value'])?['Id']"


def attachments(guid, label, item_id, previous, fields):
    """Use the frozen PDF, preserve originals and verify the returned bytes."""
    params = {'dataset':SITE,'table':guid,'itemId':item_id}
    read, guarded = 'Item_Atual_Para_Anexo_'+label, 'Estado_Atual_Para_Anexo_'+label
    acts = {read:http("@concat('_api/web/lists(guid''"+guid+"'')/items(', string("+item_id[1:]+"), ')')",previous)}
    acts[guarded] = validate(record_checks("body('"+read+"')",fields),read,'Item alterado ou baixado após o preflight; não anexar nem sobrescrever.')
    acts['Anexos_'+label] = api('shared_sharepointonline','GetItemAttachments',params,guarded)
    selected = 'Anexo_Deste_Lote_'+label
    acts[selected] = query("@body('Anexos_"+label+"')","@equals(item()?['DisplayName'], variables('Manifesto')?['pdfs']?[items('Cada_Encargo')]?['fileName'])",'Anexos_'+label)
    gate = 'Anexar_Se_Ausente_'+label
    acts[gate] = {'type':'If','expression':"@equals(length(body('"+selected+"')), 0)",'actions':{
        'Anexar_'+label:api('shared_sharepointonline','CreateAttachment',{**params,
            'displayName':"@variables('Manifesto')?['pdfs']?[items('Cada_Encargo')]?['fileName']",'body':"@base64ToBinary(variables('PDFBase64'))"})},
        'else':{'actions':{'Manter_Anexo_'+label:compose('Preservar o original')}},'runAfter':after(selected)}
    reread = 'Reler_Anexos_'+label
    acts[reread] = api('shared_sharepointonline','GetItemAttachments',params)
    acts[reread]['runAfter'] = {gate:['Succeeded','Failed','TimedOut']}
    again = 'Anexo_Confirmado_'+label
    acts[again] = query("@body('"+reread+"')","@equals(item()?['DisplayName'], variables('Manifesto')?['pdfs']?[items('Cada_Encargo')]?['fileName'])",reread)
    unique = 'Anexo_Unico_'+label; acts[unique] = require("@equals(length(body('"+again+"')), 1)",again)
    content = 'Conteudo_Anexo_'+label
    acts[content] = api('shared_sharepointonline','GetAttachmentContent',{**params,'attachmentId':"@first(body('"+again+"'))?['Id']"},unique)
    checked = 'Conferir_Anexo_'+label
    acts[checked] = require("@equals(base64(body('"+content+"')), variables('PDFBase64'))",content,'PDF existente diferente; original preservado, não substituído.')
    return acts, checked


def calculation_actions(previous):
    """Native integer-cent implementation of model.plan_month's data contract."""
    actions = {}; prev = previous
    for label,guid,fields in [
        ('Cadastros',HR,['Id','Title','IDFORNECEDORORIGEM','CARGO','STATUS','EMPREITEIRO','DATAADMISSAO','DATADESLIGAMENTO','VINCULO']),
        ('Salarios',SALARIES,['Id','CARGO','SALARIO','DATAREFERENCIA']),
        ('Folhas',SHEETS,['Id','FORNECEDOR','MESREFERENCIA'])]:
        new,prev = paginated(label,guid,fields,prev); actions.update(new)
    actions['Ativos'] = query("@variables('Cadastros')","@and(equals(toUpper(trim(coalesce(item()?['STATUS'], ''))), 'ATIVO'), equals(toUpper(trim(coalesce(item()?['EMPREITEIRO'], ''))), 'SIM'), empty(item()?['DATADESLIGAMENTO']))",prev)
    actions['Elegiveis'] = query("@body('Ativos')","@lessOrEquals(ticks(item()?['DATAADMISSAO']), ticks(concat(outputs('Fim_Competencia'), 'T23:59:59Z')))",'Ativos')
    person = {
        'Ler_Fornecedor':http("@concat('_api/web/lists(guid''"+SUPPLIERS+"'')/items(', string(int(items('Cada_Cadastro')?['IDFORNECEDORORIGEM'])), ')?$select=Id,Title,FILIAL,PROFISSAO,STATUS,EMPREITEIRO')"),
        'Fornecedor_Valido':require("@and(equals(string(body('Ler_Fornecedor')?['Id']), string(items('Cada_Cadastro')?['IDFORNECEDORORIGEM'])), equals(toUpper(trim(body('Ler_Fornecedor')?['Title'])), toUpper(trim(items('Cada_Cadastro')?['Title']))), equals(toUpper(trim(body('Ler_Fornecedor')?['STATUS'])), 'ATIVO'), equals(toUpper(trim(body('Ler_Fornecedor')?['EMPREITEIRO'])), 'SIM'), equals(toUpper(trim(items('Cada_Cadastro')?['VINCULO'])), 'CLT'), not(empty(trim(body('Ler_Fornecedor')?['FILIAL']))), not(empty(trim(body('Ler_Fornecedor')?['PROFISSAO']))))",'Ler_Fornecedor','Fornecedor/RH divergente ou regime não coberto pelas regras de CLT.'),
        'Inicio_Trabalhado':compose("@if(greater(ticks(items('Cada_Cadastro')?['DATAADMISSAO']), ticks(concat(outputs('Inicio_Competencia'), 'T23:59:59Z'))), substring(items('Cada_Cadastro')?['DATAADMISSAO'], 0, 10), outputs('Inicio_Competencia'))",'Fornecedor_Valido'),
        'Cargos_Do_Funcionario':query("@variables('Salarios')","@and(equals(toUpper(trim(coalesce(item()?['CARGO'], ''))), toUpper(trim(items('Cada_Cadastro')?['CARGO']))), lessOrEquals(ticks(coalesce(item()?['DATAREFERENCIA'], '9999-12-31T00:00:00Z')), ticks(concat(outputs('Fim_Competencia'), 'T23:59:59Z'))))",'Inicio_Trabalhado'),
        'Salario_Disponivel':require("@greater(length(body('Cargos_Do_Funcionario')), 0)",'Cargos_Do_Funcionario','Salário não cadastrado para esse cargo/competência.'),
        'Ultimo_Salario':compose("@last(sort(body('Cargos_Do_Funcionario'), 'DATAREFERENCIA'))",'Salario_Disponivel'),
        'Mesmo_Salario':query("@body('Cargos_Do_Funcionario')","@equals(item()?['DATAREFERENCIA'], outputs('Ultimo_Salario')?['DATAREFERENCIA'])",'Ultimo_Salario'),
        'Salario_Vigente_Unico':require("@and(equals(length(body('Mesmo_Salario')), 1), lessOrEquals(ticks(outputs('Ultimo_Salario')?['DATAREFERENCIA']), ticks(concat(outputs('Inicio_Trabalhado'), 'T23:59:59Z'))))",'Mesmo_Salario','Salário ambíguo ou alterado no meio da competência.'),
        'Folhas_Do_Funcionario':query("@variables('Folhas')","@and(equals(toUpper(trim(coalesce(item()?['FORNECEDOR'], ''))), toUpper(trim(body('Ler_Fornecedor')?['Title']))), or(equals(trim(coalesce(item()?['MESREFERENCIA'], '')), outputs('Competencia')), equals(trim(coalesce(item()?['MESREFERENCIA'], '')), formatDateTime(concat(outputs('Inicio_Competencia'), 'T12:00:00Z'), 'MM/yyyy'))))",'Salario_Vigente_Unico'),
        'Folha_Unica_Do_Fornecedor':require("@equals(length(body('Folhas_Do_Funcionario')), 1)",'Folhas_Do_Funcionario','IDFOLHA ausente/duplicado para fornecedor e competência; nenhuma provisão sem vínculo.'),
        'Salario_Texto':compose("@if(contains(string(outputs('Ultimo_Salario')?['SALARIO']), ','), replace(replace(string(outputs('Ultimo_Salario')?['SALARIO']), '.', ''), ',', '.'), string(outputs('Ultimo_Salario')?['SALARIO']))",'Folha_Unica_Do_Fornecedor'),
        'Salario_Centavos':compose("@int(formatNumber(mul(float(outputs('Salario_Texto')), 100), '0', 'en-US'))",'Salario_Texto'),
        'Salario_Centavos_Valido':require("@and(greater(outputs('Salario_Centavos'), 0), lessOrEquals(outputs('Salario_Centavos'), 1000000000000), equals(float(outputs('Salario_Texto')), div(outputs('Salario_Centavos'), 100.0)))",'Salario_Centavos'),
        'Divisor':compose("@if(equals(variables('Regras')?['divisor'], 'calendar'), int(formatDateTime(concat(outputs('Fim_Competencia'), 'T12:00:00Z'), 'dd')), 30)",'Salario_Centavos_Valido'),
        'Dias':compose("@if(lessOrEquals(ticks(items('Cada_Cadastro')?['DATAADMISSAO']), ticks(concat(outputs('Inicio_Competencia'), 'T23:59:59Z'))), outputs('Divisor'), min(outputs('Divisor'), add(1, div(sub(ticks(concat(outputs('Fim_Competencia'), 'T12:00:00Z')), ticks(concat(outputs('Inicio_Trabalhado'), 'T12:00:00Z'))), 864000000000))))",'Divisor'),
        'Base_Centavos':compose("@div(add(mul(outputs('Salario_Centavos'), outputs('Dias')), div(outputs('Divisor'), 2)), outputs('Divisor'))",'Dias'),
        'Zerar_Empregado':variable('Empregado',0,'Base_Centavos'),
        'Zerar_Faixa':variable('LimiteAnterior',0,'Zerar_Empregado')}
    bands = {'Faixa_Valida':require("@greater(items('Cada_Faixa')?['limitCents'], variables('LimiteAnterior'))"),
             'Largura_Faixa':compose("@max(0, sub(min(outputs('Base_Centavos'), items('Cada_Faixa')?['limitCents']), variables('LimiteAnterior')))",'Faixa_Valida'),
             'Contribuicao_Faixa':increment('Empregado',"@div(mul(outputs('Largura_Faixa'), items('Cada_Faixa')?['rateBps']), 10000)",'Largura_Faixa'),
             'Guardar_Limite':variable('LimiteAnterior',"@items('Cada_Faixa')?['limitCents']",'Contribuicao_Faixa')}
    person['Cada_Faixa'] = loop("@variables('Regras')?['employeeBrackets']",bands,'Zerar_Faixa')
    person['Linha_Bruta'] = compose({'supplierId':"@body('Ler_Fornecedor')?['Id']",'employeeId':"@items('Cada_Cadastro')?['Id']",'name':"@trim(body('Ler_Fornecedor')?['Title'])",'branch':"@trim(body('Ler_Fornecedor')?['FILIAL'])",'profession':"@trim(body('Ler_Fornecedor')?['PROFISSAO'])",'cargo':"@items('Cada_Cadastro')?['CARGO']",'admission':"@substring(items('Cada_Cadastro')?['DATAADMISSAO'], 0, 10)",'sheetId':"@first(body('Folhas_Do_Funcionario'))?['Id']",'salaryCents':"@outputs('Salario_Centavos')",'days':"@outputs('Dias')",'divisor':"@outputs('Divisor')",'baseCents':"@outputs('Base_Centavos')",'employeeCents':"@variables('Empregado')",'fgtsCents':"@div(mul(outputs('Base_Centavos'), variables('Regras')?['fgtsBps']), 10000)"},'Cada_Faixa')
    person['Acumular_Linha'] = append('LinhasBrutas',"@outputs('Linha_Bruta')",'Linha_Bruta')
    actions['Cada_Cadastro'] = loop("@body('Elegiveis')",person,'Elegiveis')
    actions['IDs_Calculados'] = select("@variables('LinhasBrutas')","@item()?['supplierId']",'Cada_Cadastro')
    actions['Nomes_Calculados'] = select("@variables('LinhasBrutas')","@toUpper(trim(item()?['name']))",'IDs_Calculados')
    actions['Identidades_Unicas'] = require("@and(equals(length(union(body('IDs_Calculados'), body('IDs_Calculados'))), length(variables('LinhasBrutas'))), equals(length(union(body('Nomes_Calculados'), body('Nomes_Calculados'))), length(variables('LinhasBrutas'))))",'Nomes_Calculados')
    actions['Filiais_Calculadas'] = select("@variables('LinhasBrutas')","@item()?['branch']",'Identidades_Unicas')
    groups = {'Grupo_Linhas':query("@variables('LinhasBrutas')","@equals(item()?['branch'], items('Cada_Filial'))")}
    components = {'Zerar_Base_Grupo':variable('BaseGrupo',0),'Zerar_Pisos':variable('PisosGrupo',0,'Zerar_Base_Grupo')}
    components['Somar_Bases_Grupo'] = loop("@body('Grupo_Linhas')",{
        'Somar_Base':increment('BaseGrupo',"@items('Somar_Bases_Grupo')?['baseCents']"),
        'Somar_Piso':increment('PisosGrupo',"@div(mul(items('Somar_Bases_Grupo')?['baseCents'], items('Cada_Componente_Grupo')?['rateBps']), 10000)",'Somar_Base')},'Zerar_Pisos')
    components['Centavos_Residuais'] = compose("@sub(div(mul(variables('BaseGrupo'), items('Cada_Componente_Grupo')?['rateBps']), 10000), variables('PisosGrupo'))",'Somar_Bases_Grupo')
    components['Prioridades'] = select("@body('Grupo_Linhas')",{'id':"@item()?['supplierId']",'base':"@item()?['baseCents']",'priority':"@concat(formatNumber(sub(10000, mod(mul(item()?['baseCents'], items('Cada_Componente_Grupo')?['rateBps']), 10000)), '00000', 'en-US'), '-', formatNumber(item()?['supplierId'], '000000000000000', 'en-US'))"},'Centavos_Residuais')
    components['Zerar_Indice'] = variable('IndiceResiduo',0,'Prioridades')
    allocate = {'Novo_Ajuste':compose("@setProperty(variables('Ajustes'), concat(string(items('Distribuir_Residuo')?['id']), ':', items('Cada_Componente_Grupo')?['code']), add(div(mul(items('Distribuir_Residuo')?['base'], items('Cada_Componente_Grupo')?['rateBps']), 10000), if(less(variables('IndiceResiduo'), outputs('Centavos_Residuais')), 1, 0)))"),
                'Guardar_Ajuste':variable('Ajustes',"@outputs('Novo_Ajuste')",'Novo_Ajuste'),
                'Avancar_Indice':increment('IndiceResiduo',1,'Guardar_Ajuste')}
    components['Distribuir_Residuo'] = loop("@sort(body('Prioridades'), 'priority')",allocate,'Zerar_Indice')
    groups['Cada_Componente_Grupo'] = loop("@variables('Regras')?['employerComponents']",components,'Grupo_Linhas')
    actions['Cada_Filial'] = loop("@union(body('Filiais_Calculadas'), body('Filiais_Calculadas'))",groups,'Filiais_Calculadas')
    finalize = {'Iniciar_Componentes':variable('Componentes',"@setProperty(json('{}'), 'EMPREGADO', items('Finalizar_Linhas')?['employeeCents'])"),
                'Iniciar_INSS_Linha':variable('INSSLinha',"@items('Finalizar_Linhas')?['employeeCents']",'Iniciar_Componentes')}
    finalize['Componentes_Da_Linha'] = loop("@variables('Regras')?['employerComponents']",{
        'Atualizar_Componente':compose("@setProperty(variables('Componentes'), items('Componentes_Da_Linha')?['code'], variables('Ajustes')?[concat(string(items('Finalizar_Linhas')?['supplierId']), ':', items('Componentes_Da_Linha')?['code'])])"),
        'Guardar_Componente':variable('Componentes',"@outputs('Atualizar_Componente')",'Atualizar_Componente'),
        'Somar_INSS_Linha':increment('INSSLinha',"@variables('Ajustes')?[concat(string(items('Finalizar_Linhas')?['supplierId']), ':', items('Componentes_Da_Linha')?['code'])]",'Guardar_Componente')},'Iniciar_INSS_Linha')
    finalize['Linha_Final'] = compose("@setProperty(setProperty(items('Finalizar_Linhas'), 'components', variables('Componentes')), 'inssCents', variables('INSSLinha'))",'Componentes_Da_Linha')
    finalize['Guardar_Linha_Final'] = append('Linhas',"@outputs('Linha_Final')",'Linha_Final')
    finalize['Somar_Total_INSS'] = increment('TotalINSS',"@variables('INSSLinha')",'Guardar_Linha_Final')
    finalize['Somar_Total_FGTS'] = increment('TotalFGTS',"@items('Finalizar_Linhas')?['fgtsCents']",'Somar_Total_INSS')
    actions['Finalizar_Linhas'] = loop("@variables('LinhasBrutas')",finalize,'Cada_Filial')
    actions['Novo_Manifesto'] = compose({'version':1,'key':"@outputs('Chave_Lote')",'competence':"@outputs('Competencia')",'createdDate':"@formatDateTime(outputs('Agora_Brasilia'), 'yyyy-MM-dd')",'dueDate':"@outputs('Vencimento')",'rulesVersion':"@variables('Regras')?['version']",'rules':"@variables('Regras')",'rows':"@variables('Linhas')",'totals':{'INSS':"@variables('TotalINSS')",'FGTS':"@variables('TotalFGTS')"},'title':"@concat('ENCARGOS-', outputs('Competencia'), '-', workflow()?['run']?['name'])"},'Finalizar_Linhas')
    actions['Usar_Calculo'] = variable('Manifesto',"@outputs('Novo_Manifesto')",'Novo_Manifesto')
    return actions


def document_actions(previous=None):
    each = {'Zerar_HTML':variable('HTMLRows','')}
    amount = "if(equals(items('Criar_Documentos'), 'INSS'), items('Cada_Linha_PDF')?['inssCents'], items('Cada_Linha_PDF')?['fgtsCents'])"
    line = {'Zerar_Componentes_HTML':variable('HTMLComponentes','')}
    line['Detalhar_Componentes'] = loop("@variables('Manifesto')?['rules']?['employerComponents']",{
        'Componente_HTML':append('HTMLComponentes',"@concat(' | ', "+escape_html("items('Detalhar_Componentes')?['label']")+", ': R$ ', formatNumber(div(items('Cada_Linha_PDF')?['components']?[items('Detalhar_Componentes')?['code']], 100.0), 'N2', 'pt-BR'))",string=True)},'Zerar_Componentes_HTML')
    line['Linha_HTML'] = append('HTMLRows',"@concat('<tr><td colspan=\"4\"><strong>', "+escape_html("items('Cada_Linha_PDF')?['name']")+", '</strong> | ', "+escape_html("items('Cada_Linha_PDF')?['profession']")+", ' | IDFOLHA ', string(items('Cada_Linha_PDF')?['sheetId']), '</td></tr><tr><td>Salário R$ ', formatNumber(div(items('Cada_Linha_PDF')?['salaryCents'], 100.0), 'N2', 'pt-BR'), '</td><td>Admissão ', formatDateTime(items('Cada_Linha_PDF')?['admission'], 'dd/MM/yyyy'), '</td><td>', string(items('Cada_Linha_PDF')?['days']), '/', string(items('Cada_Linha_PDF')?['divisor']), ' dias | Base R$ ', formatNumber(div(items('Cada_Linha_PDF')?['baseCents'], 100.0), 'N2', 'pt-BR'), '</td><td><strong>R$ ', formatNumber(div("+amount+", 100.0), 'N2', 'pt-BR'), '</strong></td></tr>', if(equals(items('Criar_Documentos'), 'INSS'), concat('<tr><td colspan=\"4\">Empregado R$ ', formatNumber(div(items('Cada_Linha_PDF')?['components']?['EMPREGADO'], 100.0), 'N2', 'pt-BR'), variables('HTMLComponentes'), '</td></tr>'), ''))",'Detalhar_Componentes',string=True)
    each['Cada_Linha_PDF'] = loop("@variables('Manifesto')?['rows']",line,'Zerar_HTML')
    each['HTML'] = compose("@concat('<!doctype html><html><head><meta charset=\"utf-8\"><style>@page{size:A4 landscape;margin:15mm}body{font:11px Arial;color:#143746}h1{color:#075367}table{width:100%;border-collapse:collapse}td,th{padding:7px;border:1px solid #bfd0d8;word-wrap:break-word}tr{page-break-inside:avoid}thead{display:table-header-group}.note{font-size:10px}</style></head><body><h1>', items('Criar_Documentos'), ' - memória de cálculo</h1><p>Competência ', variables('Manifesto')?['competence'], ' | Vencimento ', formatDateTime(variables('Manifesto')?['dueDate'], 'dd/MM/yyyy'), '</p><p>Base: somente SALARIO. Regras: ', "+escape_html("variables('Manifesto')?['rulesVersion']")+", '</p><table><thead><tr><th>Salário mensal</th><th>Admissão</th><th>Proporção/base</th><th>', items('Criar_Documentos'), '</th></tr></thead><tbody>', variables('HTMLRows'), '</tbody></table><h2>TOTAL R$ ', formatNumber(div(variables('Manifesto')?['totals']?[items('Criar_Documentos')], 100.0), 'N2', 'pt-BR'), '</h2><p class=\"note\">Valores previstos, ainda não pagos. Não é guia de recolhimento. Prêmio, alimentação e transporte não integram esta base. Admissão: dias corridos inclusivos / dias reais do mês; salário integral no mês completo. FGTS truncado por pessoa e INSS por faixa; componentes patronais totalizados por filial/código, com distribuição apenas de centavos residuais pelas maiores frações. Eventual regra específica da CCT deve ser observada.</p></body></html>')",'Cada_Linha_PDF')
    each['Salvar_HTML'] = api('shared_onedriveforbusiness','CreateFile',{'folderPath':'/','name':"@concat(variables('Manifesto')?['title'], '-', items('Criar_Documentos'), '.html')",'body':"@outputs('HTML')"},'HTML')
    each['Aguardar_Conversao'] = {'type':'Wait','inputs':{'interval':{'count':5,'unit':'Second'}},'runAfter':after('Salvar_HTML')}
    each['Converter_PDF'] = api('shared_onedriveforbusiness','ConvertFile',{'id':"@body('Salvar_HTML')?['Id']",'type':'PDF'},'Aguardar_Conversao')
    each['PDF_Gerado_Valido'] = require("@and(startsWith(base64(body('Converter_PDF')), 'JVBER'), greater(length(base64(body('Converter_PDF'))), 100))",'Converter_PDF')
    each['Salvar_PDF'] = api('shared_onedriveforbusiness','CreateFile',{'folderPath':'/','name':"@concat(variables('Manifesto')?['title'], '-', items('Criar_Documentos'), '.pdf')",'body':"@body('Converter_PDF')"},'PDF_Gerado_Valido')
    each['Meta_PDF_Novo'] = api('shared_onedriveforbusiness','GetFileMetadataByPath',{'path':"@concat('/', variables('Manifesto')?['title'], '-', items('Criar_Documentos'), '.pdf')"},'Salvar_PDF')
    each['Novo_Indice_PDF'] = compose("@setProperty(variables('PDFs'), items('Criar_Documentos'), addProperty(addProperty(addProperty(json('{}'), 'path', concat('/', variables('Manifesto')?['title'], '-', items('Criar_Documentos'), '.pdf')), 'etag', body('Meta_PDF_Novo')?['ETag']), 'fileName', concat('MEMORIA-', items('Criar_Documentos'), '-', variables('Manifesto')?['competence'], '.pdf')))",'Meta_PDF_Novo')
    each['Guardar_Indice_PDF'] = variable('PDFs',"@outputs('Novo_Indice_PDF')",'Novo_Indice_PDF')
    actions = {'Criar_Documentos':loop("@createArray('INSS','FGTS')",each,previous)}
    actions['Manifesto_Com_PDFs'] = compose("@setProperty(variables('Manifesto'), 'pdfs', variables('PDFs'))",'Criar_Documentos')
    actions['Guardar_Manifesto_Com_PDFs'] = variable('Manifesto',"@outputs('Manifesto_Com_PDFs')",'Manifesto_Com_PDFs')
    actions['Salvar_Manifesto'] = api('shared_onedriveforbusiness','CreateFile',{'folderPath':'/','name':"@concat(variables('Manifesto')?['title'], '.json')",'body':"@string(variables('Manifesto'))"},'Guardar_Manifesto_Com_PDFs')
    actions['Meta_Manifesto_Novo'] = api('shared_onedriveforbusiness','GetFileMetadataByPath',{'path':"@concat('/', variables('Manifesto')?['title'], '.json')"},'Salvar_Manifesto')
    actions['Campos_Reserva'] = compose({'key':"@outputs('Chave_Lote')",'manifestPath':"@concat('/', variables('Manifesto')?['title'], '.json')",'manifestETag':"@body('Meta_Manifesto_Novo')?['ETag']"},'Meta_Manifesto_Novo')
    actions['Preparar_Reserva'] = api('shared_onedriveforbusiness','CreateFile',{'folderPath':'/','name':"@concat(variables('Manifesto')?['title'], '-reserva.json')",'body':"@string(outputs('Campos_Reserva'))"},'Campos_Reserva')
    actions['Reservar_Sem_Sobrescrever'] = api('shared_onedriveforbusiness','CopyDriveFile',{'id':"@body('Preparar_Reserva')?['Id']",'destination':"@outputs('Caminho_Reserva')",'overwrite':False},'Preparar_Reserva')
    actions['Reservar_Sem_Sobrescrever']['inputs']['retryPolicy'] = {'type':'none'}
    actions['Confirmar_Reserva'] = api('shared_onedriveforbusiness','GetFileContentByPath',{'path':"@outputs('Caminho_Reserva')",'inferContentType':False})
    actions['Confirmar_Reserva']['runAfter'] = {'Reservar_Sem_Sobrescrever':['Succeeded','Failed','TimedOut']}
    actions['Usar_Reserva_Confirmada'] = variable('Reserva',"@json(base64ToString(body('Confirmar_Reserva')?['$content']))",'Confirmar_Reserva')
    actions['Reserva_Do_Mes'] = require("@equals(string(variables('Reserva')), string(outputs('Campos_Reserva')))",'Usar_Reserva_Confirmada','Outra execução reservou a competência. Retomar o retrato original.')
    return actions


def preflight_attachments(guid, label, item_id, previous):
    params = {'dataset':SITE,'table':guid,'itemId':'@'+item_id}
    get, found = 'Anexos_Preflight_'+label, 'Anexo_Preflight_'+label
    actions = {get:api('shared_sharepointonline','GetItemAttachments',params,previous)}
    actions[found] = query("@body('"+get+"')","@equals(item()?['DisplayName'], variables('Manifesto')?['pdfs']?[items('Conferir_Tipos')]?['fileName'])",get)
    unique = 'Anexo_Preflight_Unico_'+label
    actions[unique] = validate("@lessOrEquals(length(body('"+found+"')), 1)",found)
    content = 'Conteudo_Preflight_'+label
    actions['Conferir_Anexo_Preflight_'+label] = {'type':'If','expression':"@equals(length(body('"+found+"')), 1)",'actions':{
        content:api('shared_sharepointonline','GetAttachmentContent',{**params,'attachmentId':"@first(body('"+found+"'))?['Id']"}),
        'Bytes_Preflight_'+label:validate("@equals(base64(body('"+content+"')), variables('PDFsValidados')?[items('Conferir_Tipos')])",content,'Anexo existente diferente do PDF congelado; original preservado.')},
        'else':{'actions':{'Anexo_Ausente_Preflight_'+label:compose('Anexo ausente; nenhuma inclusão durante a validação.')}},'runAfter':after(unique)}
    return actions


def preflight_record(guid, label, fields, field, key, previous=None, numeric=False, parent_id=None):
    get, unique, gate = 'Buscar_Preflight_'+label, 'Unico_Preflight_'+label, 'Conferir_Preflight_'+label
    actions = {get:http(lookup(guid,field,key,numeric),previous)}
    actions[unique] = validate("@lessOrEquals(length(body('"+get+"')?['value']), 1)",get,'Chave existente duplicada; lote bloqueado antes do primeiro POST.')
    actual = "first(body('"+get+"')?['value'])"
    checks = record_checks(actual,fields)
    if parent_id is not None: checks = '@and('+checks[1:]+', greater('+parent_id+', 0))'
    existing = {'Campos_Preflight_Validos_'+label:validate(checks,message='Registro existente divergente ou liquidado; nenhuma alteração autorizada.')}
    if label != 'Folha': existing.update(preflight_attachments(guid,label,actual+"?['Id']",'Campos_Preflight_Validos_'+label))
    read = 'Ler_Intencao_Preflight_'+label
    absent = {read:api('shared_onedriveforbusiness','GetFileMetadataByPath',{'path':intent_path(label,key)})}
    check = 'Intencao_Preflight_Ausente_'+label
    absent[check] = validate("@equals(outputs('"+read+"')?['statusCode'], 404)",message='Intenção incerta anterior; reconciliar antes de qualquer novo POST.')
    absent[check]['runAfter'] = {read:['Succeeded','Failed','TimedOut']}
    if numeric:
        absent = {'Chave_Preflight_Conhecida_'+label:{'type':'If','expression':'@greater('+key+', 0)','actions':absent,
            'else':{'actions':{'ID_Preflight_Futuro_'+label:compose('ID de provisão ainda não criado; ensure mantém a trava de intenção.')}},'runAfter':{}}}
    actions[gate] = {'type':'If','expression':"@equals(length(body('"+get+"')?['value']), 1)",'actions':existing,'else':{'actions':absent},'runAfter':after(unique)}
    record_id = "if(empty(body('"+get+"')?['value']), 0, first(body('"+get+"')?['value'])?['Id'])"
    cache, save = 'Novo_ID_Preflight_'+label, 'Guardar_ID_Preflight_'+label
    actions[cache] = compose("@setProperty(variables('IDsValidados'), concat('"+label+":', string("+key+")), "+record_id+")",gate)
    actions[save] = variable('IDsValidados',"@outputs('"+cache+"')",cache)
    return actions,save,record_id


def current_people_actions():
    row = "items('Revalidar_Pessoas')"; hr = "first(body('RH_Atual'))"; supplier = "body('Ler_Fornecedor_Atual')"
    actions = {'RH_Atual':query("@variables('Cadastros')","@equals(string(item()?['IDFORNECEDORORIGEM']), string("+row+"?['supplierId']))"),
        'RH_Atual_Unico':validate("@equals(length(body('RH_Atual')), 1)",'RH_Atual','Vínculo RH/origem ausente ou duplicado na retomada.')}
    checks = ["equals(toUpper(trim(coalesce("+hr+"?['"+field+"'], ''))), '"+value+"')" for field,value in [('VINCULO','CLT'),('STATUS','ATIVO'),('EMPREITEIRO','SIM')]]
    checks += ["empty("+hr+"?['DATADESLIGAMENTO'])", "or(equals("+row+"?['employeeId'], null), equals(string("+hr+"?['Id']), string("+row+"?['employeeId'])))"]
    checks += ["equals(trim(coalesce("+hr+"?['"+field+"'], '')), trim("+row+"?['"+frozen+"']))" for field,frozen in [('Title','name'),('CARGO','cargo')]]
    checks.append("equals(substring(coalesce("+hr+"?['DATAADMISSAO'], '0000-00-00'), 0, 10), "+row+"?['admission'])")
    actions['Identidade_RH_Atual'] = validate('@and('+', '.join(checks)+')','RH_Atual_Unico','Elegibilidade, identidade, cargo ou admissão RH mudou; não recalcular nem gravar.')
    actions['Ler_Fornecedor_Atual'] = http("@concat('_api/web/lists(guid''"+SUPPLIERS+"'')/items(', string("+row+"?['supplierId']), ')?$select=Id,Title,FILIAL,PROFISSAO,STATUS,EMPREITEIRO')",'Identidade_RH_Atual')
    checks = ["equals(string("+supplier+"?['Id']), string("+row+"?['supplierId']))"]
    checks += ["equals(trim(coalesce("+supplier+"?['"+field+"'], '')), trim("+row+"?['"+frozen+"']))" for field,frozen in [('Title','name'),('FILIAL','branch'),('PROFISSAO','profession')]]
    checks += ["equals(toUpper(trim(coalesce("+supplier+"?['"+field+"'], ''))), '"+value+"')" for field,value in [('STATUS','ATIVO'),('EMPREITEIRO','SIM')]]
    actions['Identidade_Fornecedor_Atual'] = validate('@and('+', '.join(checks)+')','Ler_Fornecedor_Atual','Fornecedor/origem mudou desde o manifesto; nenhuma substituição automática.')
    actions['Folha_Atual'] = query("@variables('Folhas')","@and(equals(trim(coalesce(item()?['FORNECEDOR'], '')), "+row+"?['name']), or(equals(trim(coalesce(item()?['MESREFERENCIA'], '')), variables('Manifesto')?['competence']), equals(trim(coalesce(item()?['MESREFERENCIA'], '')), concat(substring(variables('Manifesto')?['competence'], 5, 2), '/', substring(variables('Manifesto')?['competence'], 0, 4)))))",'Identidade_Fornecedor_Atual')
    actions['Folha_Atual_Unica'] = validate("@and(equals(length(body('Folha_Atual')), 1), equals(float(coalesce(first(body('Folha_Atual'))?['Id'], -1)), float("+row+"?['sheetId'])))",'Folha_Atual','IDFOLHA/fornecedor/competência mudou ou está ambíguo.')
    return actions


def global_preflight_actions():
    a = {'Provisoes_Externas_Da_Competencia':query("@variables('Provisoes')","@and(equals(substring(coalesce(item()?['DATAPREVISTOPGTO'], '0000-00-00'), 0, 7), substring(variables('Manifesto')?['dueDate'], 0, 7)), or(contains(toUpper(coalesce(item()?['OBS'], '')), 'INSS'), contains(toUpper(coalesce(item()?['OBS'], '')), 'FGTS'), equals(toUpper(coalesce(item()?['PRODUTO'], '')), 'INSS'), equals(toUpper(coalesce(item()?['PRODUTO'], '')), 'FGTS')), not(startsWith(coalesce(item()?['FOLHAOPERACAO'], ''), concat('ENCARGOS:', variables('Manifesto')?['competence'], ':'))))"),
        'Sem_Obrigacao_Agregada_Concorrente':validate("@equals(length(body('Provisoes_Externas_Da_Competencia')), 0)",'Provisoes_Externas_Da_Competencia','Já há obrigação de INSS/FGTS fora deste lote para o mês. Reconciliar antes de gerar outra.'),
        'Chaves_Planejadas_INSS':select("@variables('Manifesto')?['rows']","@concat('ENCARGOS:', variables('Manifesto')?['competence'], ':INSS:', string(item()?['supplierId']))",'Sem_Obrigacao_Agregada_Concorrente'),
        'Chaves_Planejadas_FGTS':select("@variables('Manifesto')?['rows']","@concat('ENCARGOS:', variables('Manifesto')?['competence'], ':FGTS:', string(item()?['supplierId']))",'Chaves_Planejadas_INSS'),
        'Provisoes_Fora_Do_Manifesto':query("@variables('Provisoes')","@and(startsWith(coalesce(item()?['FOLHAOPERACAO'], ''), concat('ENCARGOS:', variables('Manifesto')?['competence'], ':')), not(contains(union(body('Chaves_Planejadas_INSS'), body('Chaves_Planejadas_FGTS')), item()?['FOLHAOPERACAO'])))",'Chaves_Planejadas_FGTS'),
        'Somente_Provisoes_Planejadas':validate("@equals(length(body('Provisoes_Fora_Do_Manifesto')), 0)",'Provisoes_Fora_Do_Manifesto','Há provisão deste lote fora do manifesto congelado; reconciliar antes de gravar.'),
        'Revalidar_Pessoas':loop("@variables('Manifesto')?['rows']",current_people_actions(),'Somente_Provisoes_Planejadas'),
        'Filiais_Preflight':select("@variables('Manifesto')?['rows']","@item()?['branch']",'Revalidar_Pessoas')}
    pdf = "variables('Manifesto')?['pdfs']?[items('Conferir_PDFs')]"
    pdfs = {'Meta_PDF_Original':api('shared_onedriveforbusiness','GetFileMetadataByPath',{'path':'@'+pdf+"?['path']"}),
        'Versao_PDF_Original':validate("@and(not(empty("+pdf+"?['etag'])), not(empty("+pdf+"?['fileName'])), equals(body('Meta_PDF_Original')?['ETag'], "+pdf+"?['etag']))",'Meta_PDF_Original'),
        'Ler_PDF_Original':api('shared_onedriveforbusiness','GetFileContentByPath',{'path':'@'+pdf+"?['path']",'inferContentType':False},'Versao_PDF_Original'),
        'Usar_PDF_Original':variable('PDFBase64',"@base64(body('Ler_PDF_Original'))",'Ler_PDF_Original'),
        'PDF_Original_Valido':validate("@and(startsWith(variables('PDFBase64'), 'JVBER'), greater(length(variables('PDFBase64')), 100))",'Usar_PDF_Original'),
        'Meta_PDF_Apos_Leitura':api('shared_onedriveforbusiness','GetFileMetadataByPath',{'path':'@'+pdf+"?['path']"},'PDF_Original_Valido'),
        'PDF_Inalterado_Durante_Leitura':validate("@equals(body('Meta_PDF_Apos_Leitura')?['ETag'], "+pdf+"?['etag'])",'Meta_PDF_Apos_Leitura'),
        'Novo_Cache_PDF':compose("@setProperty(variables('PDFsValidados'), items('Conferir_PDFs'), variables('PDFBase64'))",'PDF_Inalterado_Durante_Leitura'),
        'Guardar_Cache_PDF':variable('PDFsValidados',"@outputs('Novo_Cache_PDF')",'Novo_Cache_PDF')}
    a['Conferir_PDFs'] = loop("@createArray('INSS','FGTS')",pdfs,'Filiais_Preflight')
    tax,row = "items('Conferir_Tipos')","items('Conferir_Pessoas')"
    parent = parent_payload(tax,"body('Filiais_Preflight')")
    types,prev,parent_id = preflight_record(PARENT,'Descritivo',parent,'FOLHAOPERACAO',parent['FOLHAOPERACAO'][1:])
    types['Filhos_Do_Pai_Preflight'] = query("@variables('Provisoes')","@and(greater("+parent_id+", 0), equals(string(coalesce(item()?['DESCRITIVOPROVISAO'], '')), string("+parent_id+")))",prev)
    types['Filhos_Estranhos_Preflight'] = query("@body('Filhos_Do_Pai_Preflight')","@not(contains(if(equals("+tax+", 'INSS'), body('Chaves_Planejadas_INSS'), body('Chaves_Planejadas_FGTS')), coalesce(item()?['FOLHAOPERACAO'], '')))",'Filhos_Do_Pai_Preflight')
    types['Somente_Filhos_Planejados'] = validate("@equals(length(body('Filhos_Estranhos_Preflight')), 0)",'Filhos_Estranhos_Preflight','Descritivo contém filho estranho ao manifesto; nenhuma linha adicional será criada.')
    prev = 'Somente_Filhos_Planejados'
    child = provision_payload(row,tax,parent_id)
    people = {'Provisoes_Externas_Da_Folha':query("@variables('Provisoes')","@and(equals(float(if(empty(trim(string(item()?['IDFOLHA']))), -1, item()?['IDFOLHA'])), float("+row+"?['sheetId'])), or(contains(toUpper(coalesce(item()?['OBS'], '')), "+tax+"), equals(toUpper(trim(coalesce(item()?['PRODUTO'], ''))), "+tax+"), equals(toUpper(trim(coalesce(item()?['TIPOPGTO'], ''))), "+tax+")), not(equals(coalesce(item()?['FOLHAOPERACAO'], ''), "+child['FOLHAOPERACAO'][1:]+")))"),
        'Sem_Provisao_Externa_Da_Folha':validate("@equals(length(body('Provisoes_Externas_Da_Folha')), 0)",'Provisoes_Externas_Da_Folha','Já existe provisão externa desse encargo/IDFOLHA, mesmo sem vencimento ou FOLHAPGTO; não duplicar.')}
    new,child_prev,child_id = preflight_record(CHILD,'Provisao',child,'FOLHAOPERACAO',child['FOLHAOPERACAO'][1:],'Sem_Provisao_Externa_Da_Folha',parent_id=parent_id); people.update(new)
    payment = payroll_payload(row,tax,child_id)
    new,child_prev,_ = preflight_record(PAYROLL,'Folha',payment,'IDPROVISAO',child_id,child_prev,numeric=True,parent_id=child_id); people.update(new)
    people['Pagamentos_Existentes_Do_Tipo'] = query("@variables('Pagamentos')","@or(and(equals(toUpper(trim(coalesce(item()?['TIPOPGTO'], ''))), "+tax+"), equals(float(if(empty(trim(string(item()?['IDFOLHA']))), -1, item()?['IDFOLHA'])), float("+row+"?['sheetId']))), and(greater("+child_id+", 0), equals(float(if(empty(trim(string(item()?['IDPROVISAO']))), -1, item()?['IDPROVISAO'])), float("+child_id+"))))",child_prev)
    people['Sem_Pagamento_Duplicado'] = validate("@and(lessOrEquals(length(body('Pagamentos_Existentes_Do_Tipo')), 1), equals(length(body('Pagamentos_Existentes_Do_Tipo')), length(body('Buscar_Preflight_Folha')?['value'])), if(equals(length(body('Pagamentos_Existentes_Do_Tipo')), 1), equals(first(body('Pagamentos_Existentes_Do_Tipo'))?['Id'], first(body('Buscar_Preflight_Folha')?['value'])?['Id']), true))",'Pagamentos_Existentes_Do_Tipo','Pagamento já vinculado a outra provisão/folha/pessoa; bloquear o lote inteiro.')
    types['Conferir_Pessoas'] = loop("@variables('Manifesto')?['rows']",people,prev)
    a['Conferir_Tipos'] = loop("@createArray('INSS','FGTS')",types,'Conferir_PDFs')
    return a


def financial_actions():
    a = {'Preflight_Global':{'type':'Scope','actions':global_preflight_actions(),'runAfter':{}}}
    tax,row = "items('Cada_Encargo')","items('Cada_Fornecedor')"
    types = {'Zerar_IDs_Encargo':variable('IDsDesteEncargo',[]),
        'PDF_Validado_Para_Escrita':variable('PDFBase64',"@variables('PDFsValidados')?[items('Cada_Encargo')]",'Zerar_IDs_Encargo'),
        'Filiais_Do_Lote':select("@variables('Manifesto')?['rows']","@item()?['branch']",'PDF_Validado_Para_Escrita')}
    parent = parent_payload(tax,"body('Filiais_Do_Lote')")
    new,prev,parent_id = ensure(PARENT,'Descritivo',parent,'FOLHAOPERACAO',parent['FOLHAOPERACAO'][1:],'Filiais_Do_Lote'); types.update(new)
    new,prev = attachments(PARENT,'Descritivo',parent_id,prev,parent); types.update(new)
    provision = provision_payload(row,tax,parent_id[1:])
    children,child_prev,child_id = ensure(CHILD,'Provisao',provision,'FOLHAOPERACAO',provision['FOLHAOPERACAO'][1:])
    fields = payroll_payload(row,tax,child_id[1:])
    new,child_prev,_ = ensure(PAYROLL,'Folha',fields,'IDPROVISAO',child_id[1:],child_prev,numeric=True,source_record=(CHILD,child_id,provision)); children.update(new)
    new,child_prev = attachments(CHILD,'Provisao',child_id,child_prev,provision); children.update(new)
    children['Guardar_ID_Provisao'] = append('IDsDesteEncargo',child_id,child_prev)
    types['Cada_Fornecedor'] = loop("@variables('Manifesto')?['rows']",children,prev)
    # N+1 is intentional: any extra child fails the count, and a continuation
    # link is rejected instead of accepting a truncated set as complete.
    types['Filhos_Finais_Do_Descritivo'] = http(lookup(CHILD,'DESCRITIVOPROVISAO','string('+parent_id[1:]+')',top="add(length(variables('Manifesto')?['rows']), 1)"),'Cada_Fornecedor')
    pending = record_checks('item()',{'STATUS':'PAGAMENTO PREVISTO','PGTOAGENDADO':'PENDENTE'})[1:]
    types['Filhos_Finais_Divergentes'] = query("@body('Filhos_Finais_Do_Descritivo')?['value']","@or(not(contains(variables('IDsDesteEncargo'), item()?['Id'])), not("+pending+"))",'Filhos_Finais_Do_Descritivo')
    types['Conjunto_Final_De_Filhos'] = validate("@and(equals(length(body('Filhos_Finais_Do_Descritivo')?['value']), length(variables('Manifesto')?['rows'])), equals(length(variables('IDsDesteEncargo')), length(variables('Manifesto')?['rows'])), equals(length(union(variables('IDsDesteEncargo'), variables('IDsDesteEncargo'))), length(variables('IDsDesteEncargo'))), empty(body('Filhos_Finais_Divergentes')), empty(coalesce(body('Filhos_Finais_Do_Descritivo')?['odata.nextLink'], body('Filhos_Finais_Do_Descritivo')?['@odata.nextLink'], '')))",'Filhos_Finais_Divergentes','Conjunto final de filhos divergente, incompleto ou baixado; não confirmar conclusão.')
    types['Resumo_Encargo'] = compose({'tipo':'@'+tax,'descritivo':parent_id,'linhas':"@length(variables('Manifesto')?['rows'])",'totalCentavos':"@variables('Manifesto')?['totals']?[items('Cada_Encargo')]",'competencia':"@variables('Manifesto')?['competence']",'vencimento':"@variables('Manifesto')?['dueDate']"},'Conjunto_Final_De_Filhos')
    a['Cada_Encargo'] = loop("@createArray('INSS','FGTS')",types,'Preflight_Global')
    return a


def build_definition():
    a = {'Agora_Brasilia':compose("@convertTimeZone(utcNow(), 'UTC', 'E. South America Standard Time')")}
    for name,value,prev in [
        ('Fim_Competencia',"@formatDateTime(addDays(startOfMonth(outputs('Agora_Brasilia')), -1), 'yyyy-MM-dd')",'Agora_Brasilia'),
        ('Inicio_Competencia',"@formatDateTime(startOfMonth(outputs('Fim_Competencia')), 'yyyy-MM-dd')",'Fim_Competencia'),
        ('Competencia',"@substring(outputs('Inicio_Competencia'), 0, 7)",'Inicio_Competencia'),
        ('Vencimento',"@concat(formatDateTime(outputs('Agora_Brasilia'), 'yyyy-MM'), '-20')",'Competencia'),
        ('Chave_Lote',"@concat(if(equals(dayOfMonth(outputs('Agora_Brasilia')), 1), 'ENCARGOS:', 'ENCARGOS-PREVIA:'), outputs('Competencia'))",'Vencimento'),
        ('Caminho_Reserva',"@concat('/ENCARGOS-', if(equals(dayOfMonth(outputs('Agora_Brasilia')), 1), 'RESERVA-', 'PREVIA-RESERVA-'), outputs('Competencia'), '.json')",'Chave_Lote')]: a[name] = compose(value,prev)
    variables = {'Manifesto':('object',{}),'Reserva':('object',{}),'Regras':('object',{}),'PDFs':('object',{}),'PDFsValidados':('object',{}),'IDsValidados':('object',{}),'Ajustes':('object',{}),'Componentes':('object',{}),
                 'LinhasBrutas':('array',[]),'Linhas':('array',[]),'Empregado':('integer',0),'LimiteAnterior':('integer',0),'BaseGrupo':('integer',0),'PisosGrupo':('integer',0),'IndiceResiduo':('integer',0),'INSSLinha':('integer',0),'TotalINSS':('integer',0),'TotalFGTS':('integer',0),'HTMLRows':('string',''),'HTMLComponentes':('string',''),'PDFBase64':('string','')}
    for label in ['Cadastros','Salarios','Folhas','Provisoes','Pagamentos']:
        variables.update({label:('array',[]),'Pagina'+label:('string',''),'Visitadas'+label:('array',[])})
    variables['IDsDesteEncargo'] = ('array',[])
    for label in ['Cadastros_Recuperacao','Folhas_Recuperacao']:
        variables.update({'Pagina'+label:('string',''),'Visitadas'+label:('array',[])})
    prev = 'Caminho_Reserva'
    for name,(kind,value) in variables.items():
        label = 'Inicializar_'+name
        a[label] = {'type':'InitializeVariable','inputs':{'variables':[{'name':name,'type':kind,'value':value}]},'runAfter':after(prev)}
        prev = label
    a['Ler_Regras'] = api('shared_onedriveforbusiness','GetFileContentByPath',{'path':'/ENERGETICA-ENCARGOS-CONFIG.json','inferContentType':False},prev)
    a['Usar_Regras'] = variable('Regras',"@json(base64ToString(body('Ler_Regras')?['$content']))",'Ler_Regras')
    integer_rate = {'type':'integer','minimum':0,'maximum':10000}
    rules_properties = {
        'version':{'type':'string','minLength':1},'confirmed':{'type':'boolean'},'base':{'type':'string'},'validFrom':{'type':'string'},'validThrough':{'type':'string'},'divisor':{'enum':[30,'calendar']},'fgtsBps':integer_rate,
        'employeeRounding':{'type':'string'},'employerRounding':{'type':'string'},
        'employeeBrackets':{'type':'array','minItems':1,'maxItems':10,'items':{'type':'object','required':['limitCents','rateBps'],'properties':{'limitCents':{'type':'integer','minimum':1,'maximum':10000000000},'rateBps':integer_rate}}},
        'employerComponents':{'type':'array','minItems':1,'maxItems':20,'items':{'type':'object','required':['code','label','rateBps'],'properties':{'code':{'type':'string','minLength':1,'maxLength':40},'label':{'type':'string','minLength':1},'rateBps':integer_rate}}}}
    rules_schema = {'type':'object','required':list(rules_properties),'properties':rules_properties}
    a['Estrutura_Regras'] = {'type':'ParseJson','inputs':{'content':"@variables('Regras')",'schema':rules_schema},'runAfter':after('Usar_Regras')}
    a['Validar_Regras'] = require("@and(equals(variables('Regras')?['confirmed'], true), equals(variables('Regras')?['base'], 'SALARIO'), greater(variables('Regras')?['fgtsBps'], 0), equals(variables('Regras')?['employeeRounding'], 'truncate'), equals(variables('Regras')?['employerRounding'], 'truncate'), lessOrEquals(ticks(concat(variables('Regras')?['validFrom'], '-01T00:00:00Z')), ticks(concat(outputs('Inicio_Competencia'), 'T00:00:00Z'))), greaterOrEquals(ticks(concat(variables('Regras')?['validThrough'], '-01T00:00:00Z')), ticks(concat(outputs('Inicio_Competencia'), 'T00:00:00Z'))))",'Estrutura_Regras','Regras não confirmadas/vencidas. Atualizar a tabela antes de criar obrigações.')
    a['Codigos_Componentes'] = select("@variables('Regras')?['employerComponents']","@item()?['code']",'Validar_Regras')
    a['Codigos_Unicos'] = require("@and(not(contains(body('Codigos_Componentes'), 'EMPREGADO')), equals(length(union(body('Codigos_Componentes'), body('Codigos_Componentes'))), length(body('Codigos_Componentes'))))",'Codigos_Componentes')
    prev = 'Codigos_Unicos'
    for label,guid,column in [('Descritivo',PARENT,'FOLHAOPERACAO'),('Provisao',CHILD,'FOLHAOPERACAO'),('Folha',PAYROLL,'IDPROVISAO')]:
        name = 'Chave_Unica_'+label
        a[name] = http(f"_api/web/lists(guid'{guid}')/fields/getbyinternalnameortitle('{column}')?$select=InternalName,EnforceUniqueValues,Indexed",prev)
        valid = 'Verificar_Chave_Unica_'+label
        a[valid] = require("@and(equals(body('"+name+"')?['EnforceUniqueValues'], true), equals(body('"+name+"')?['Indexed'], true))",name,'Chave de idempotência não confirmada no SharePoint; não criar registros.')
        prev = valid
    a['Procurar_Reserva'] = api('shared_onedriveforbusiness','GetFileMetadataByPath',{'path':"@outputs('Caminho_Reserva')"},prev)
    a['Reserva_Disponivel_Ou_Ausente'] = require("@or(equals(actions('Procurar_Reserva')?['status'], 'Succeeded'), equals(outputs('Procurar_Reserva')?['statusCode'], 404))",message='Falha ao consultar reserva não significa lote inexistente.')
    a['Reserva_Disponivel_Ou_Ausente']['runAfter'] = {'Procurar_Reserva':['Succeeded','Failed','TimedOut']}
    recovery = {'Ler_Reserva':api('shared_onedriveforbusiness','GetFileContentByPath',{'path':"@outputs('Caminho_Reserva')",'inferContentType':False}),
        'Usar_Reserva':variable('Reserva',"@json(base64ToString(body('Ler_Reserva')?['$content']))",'Ler_Reserva'),
        'Meta_Manifesto_Original':api('shared_onedriveforbusiness','GetFileMetadataByPath',{'path':"@variables('Reserva')?['manifestPath']"},'Usar_Reserva'),
        'Versao_Manifesto_Original':require("@and(equals(variables('Reserva')?['key'], outputs('Chave_Lote')), not(empty(variables('Reserva')?['manifestETag'])), equals(body('Meta_Manifesto_Original')?['ETag'], variables('Reserva')?['manifestETag']))",'Meta_Manifesto_Original'),
        'Ler_Manifesto':api('shared_onedriveforbusiness','GetFileContentByPath',{'path':"@variables('Reserva')?['manifestPath']",'inferContentType':False},'Versao_Manifesto_Original'),
        'Usar_Manifesto_Original':variable('Manifesto',"@json(base64ToString(body('Ler_Manifesto')?['$content']))",'Ler_Manifesto')}
    prev = 'Usar_Manifesto_Original'
    for label,guid,fields,target in [
        ('Cadastros_Recuperacao',HR,['Id','Title','IDFORNECEDORORIGEM','CARGO','STATUS','EMPREITEIRO','DATAADMISSAO','DATADESLIGAMENTO','VINCULO'],'Cadastros'),
        ('Folhas_Recuperacao',SHEETS,['Id','FORNECEDOR','MESREFERENCIA'],'Folhas')]:
        new,prev = paginated(label,guid,fields,prev,target=target); recovery.update(new)
    a['Recuperar_Ou_Calcular'] = {'type':'If','expression':"@equals(actions('Procurar_Reserva')?['status'], 'Succeeded')",'actions':recovery,'else':{'actions':calculation_actions(None)},'runAfter':after('Reserva_Disponivel_Ou_Ausente')}
    a['Validar_Manifesto'] = require("@and(equals(variables('Manifesto')?['version'], 1), equals(variables('Manifesto')?['competence'], outputs('Competencia')), equals(variables('Manifesto')?['dueDate'], outputs('Vencimento')), equals(variables('Manifesto')?['key'], outputs('Chave_Lote')), equals(variables('Manifesto')?['rulesVersion'], variables('Regras')?['version']), equals(string(variables('Manifesto')?['rules']), string(variables('Regras'))))",'Recuperar_Ou_Calcular')
    a['Preservar_Manifesto'] = {'type':'If','expression':"@equals(actions('Procurar_Reserva')?['status'], 'Succeeded')",'actions':{'Preservar_Reserva_Existente':compose('Usar os arquivos originais, sem recalcular o lote.')},'else':{'actions':document_actions()},'runAfter':after('Validar_Manifesto')}
    prev = 'Preservar_Manifesto'
    # Read all scalar fields, including settled/launch references. A partial
    # projection must never turn an existing paid row into an apparently blank one.
    for label,guid,fields in [('Provisoes',CHILD,['*']),('Pagamentos',PAYROLL,['*'])]:
        new,prev = paginated(label,guid,fields,prev); a.update(new)
    a['Validar_Reserva_Confirmada'] = require("@and(equals(variables('Reserva')?['key'], variables('Manifesto')?['key']), not(empty(variables('Reserva')?['manifestETag'])), equals(variables('Reserva')?['manifestPath'], concat('/', variables('Manifesto')?['title'], '.json')))",prev)
    a['Somente_Dia_01'] = {'type':'If','expression':"@and(equals(dayOfMonth(outputs('Agora_Brasilia')), 1), greater(length(variables('Manifesto')?['rows']), 0))",'actions':financial_actions(),
        'else':{'actions':{'Previa_Sem_Provisoes':compose({'modo':'PRÉVIA - sem gravações financeiras','competencia':"@variables('Manifesto')?['competence']",'vencimento':"@variables('Manifesto')?['dueDate']",'fornecedores':"@length(variables('Manifesto')?['rows'])",'totaisCentavos':"@variables('Manifesto')?['totals']",'pdfs':"@variables('Manifesto')?['pdfs']"})}},'runAfter':after('Validar_Reserva_Confirmada')}
    return {'$schema':'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#','contentVersion':'1.0.0.0',
        'parameters':{'$connections':{'defaultValue':{},'type':'Object'},'$authentication':{'defaultValue':{},'type':'SecureObject'}},
        'triggers':{'Dia_01_06h':{'type':'Recurrence','recurrence':{'frequency':'Month','interval':1,'timeZone':'E. South America Standard Time','startTime':'2026-11-01T06:00:00'},'runtimeConfiguration':{'concurrency':{'runs':1}}}},'actions':a,'outputs':{}}


def build_package(output_dir):
    output_dir.mkdir(parents=True,exist_ok=True)
    guid = lambda name:str(uuid.uuid5(NS,name))
    fid = guid('flow'); display = 'INSS e FGTS — dia 01 — provisões individuais vinculadas à folha'
    resources = {}; apis = {'shared_sharepointonline':'SharePoint','shared_onedriveforbusiness':'OneDrive for Business'}
    resources[fid] = {'type':'Microsoft.Flow/flows','suggestedCreationType':'New','creationType':'Existing, New, Update','details':{'displayName':display},'configurableBy':'User','hierarchy':'Root','dependsOn':[guid(kind+'/'+conn) for conn in apis for kind in ['api','conn']]}
    for conn,label in apis.items():
        aid,cid = guid('api/'+conn),guid('conn/'+conn)
        resources[aid] = {'id':'/providers/Microsoft.PowerApps/apis/'+conn,'name':conn,'type':'Microsoft.PowerApps/apis','suggestedCreationType':'Existing','details':{'displayName':label},'configurableBy':'System','hierarchy':'Child','dependsOn':[]}
        resources[cid] = {'type':'Microsoft.PowerApps/apis/connections','suggestedCreationType':'Existing','creationType':'Existing','details':{'displayName':label+' Energetica'},'configurableBy':'User','hierarchy':'Child','dependsOn':[aid]}
    wrapper = {'name':fid,'id':'/providers/Microsoft.Flow/flows/'+fid,'type':'Microsoft.Flow/flows','properties':{'apiId':'/providers/Microsoft.PowerApps/apis/shared_logicflows','displayName':display,'definition':build_definition(),
        'connectionReferences':{conn:{'connectionName':'__VINCULAR_CONEXAO_'+conn+'__','source':'Embedded','id':'/providers/Microsoft.PowerApps/apis/'+conn,'tier':'NotSpecified'} for conn in apis},'flowFailureAlertSubscribed':False}}
    files = {'manifest.json':{'schema':'1.0','details':{'displayName':display,'description':'Dia 01 06h Brasília. Competência anterior, vencimento20. Dois descritivos, uma provisão e vínculo FOLHAPGTO por pessoa/rubrica. Regras versionadas; prévia manual sem financeiro.','createdTime':datetime.now(timezone.utc).isoformat(),'packageTelemetryId':guid('telemetry'),'creator':'N/A','sourceEnvironment':''},'resources':resources},
        'Microsoft.Flow/flows/manifest.json':{'packageSchemaVersion':'1.0','flowAssets':{'assetPaths':[fid]}},
        f'Microsoft.Flow/flows/{fid}/definition.json':wrapper,
        f'Microsoft.Flow/flows/{fid}/apisMap.json':{conn:guid('api/'+conn) for conn in apis},
        f'Microsoft.Flow/flows/{fid}/connectionsMap.json':{conn:guid('conn/'+conn) for conn in apis}}
    path = output_dir/'Energetica-INSS-FGTS-Mensal.zip'
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as archive:
        for name,value in files.items(): archive.writestr(name,json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    (output_dir/'definition.json').write_text(json.dumps(wrapper,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return path


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(); parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(); print(json.dumps({'package':str(build_package(args.output)),'tenantImportVerified':False}))
