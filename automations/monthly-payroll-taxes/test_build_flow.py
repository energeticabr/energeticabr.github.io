"""Contracts of the native flow at its connector/payload boundary."""
import ast
import base64
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest
from urllib.parse import quote, unquote
import zipfile

spec = importlib.util.spec_from_file_location('monthly_tax_flow', Path(__file__).with_name('build_flow.py'))
flow = None
if Path(spec.origin).exists():
    flow = importlib.util.module_from_spec(spec); spec.loader.exec_module(flow)


def actions_in(actions):
    for name, action in actions.items():
        yield name, action
        yield from actions_in(action.get('actions', {}))
        yield from actions_in(action.get('else', {}).get('actions', {}))


class PreflightRejected(Exception):
    pass


class NativePreflight:
    """Execute the generated guard subset, with data at the connector boundary.

    This is deliberately not a Power Automate runtime: unsupported expressions
    fail the test, and any mutating connector operation fails immediately.
    """
    def __init__(self, fixture):
        self.data = deepcopy(fixture)
        self.variables = dict(Manifesto=self.data['plan'], Cadastros=self.data['hr'],
                              Folhas=self.data['sheets'], Provisoes=self.data['lists'][flow.CHILD],
                              Pagamentos=self.data['lists'][flow.PAYROLL], PDFsValidados={}, IDsValidados={})
        self.values = {'Fim_Competencia': '2026-09-30', 'Inicio_Competencia': '2026-09-01'}
        self.bodies, self.outputs, self.statuses, self.items, self.calls = {}, {}, {}, {}, []

    def evaluate(self, value):
        if isinstance(value, dict): return {key: self.evaluate(item) for key,item in value.items()}
        if isinstance(value, list): return [self.evaluate(item) for item in value]
        if not isinstance(value, str) or not value.startswith('@'): return value
        source = re.sub(r"'(?:[^']|'')*'", lambda match: json.dumps(match[0][1:-1].replace("''", "'")), value[1:])
        source = re.sub(r'\b(and|or|not|if)\s*\(', lambda match: 'wdl_'+match[1]+'(', source).replace('?[', '[')
        return self.node(ast.parse(source, mode='eval').body)

    def node(self, node):
        if isinstance(node, ast.Constant): return node.value
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub): return -self.node(node.operand)
        if isinstance(node, ast.Name): return {'true':True, 'false':False, 'null':None}[node.id]
        if isinstance(node, ast.Subscript):
            value, key = self.node(node.value), self.node(node.slice)
            return value.get(key) if isinstance(value, dict) else value[key] if value is not None else None
        if isinstance(node, ast.Call):
            name = node.func.id
            if name == 'wdl_if': return self.node(node.args[1] if self.node(node.args[0]) else node.args[2])
            args = [self.node(argument) for argument in node.args]
            functions = {
                'wdl_and':lambda *values:all(values), 'wdl_or':lambda *values:any(values), 'wdl_not':lambda value:not value,
                'equals':lambda left,right:left == right, 'empty':lambda value:value is None or value == '' or value == [] or value == {},
                'string':lambda value:'' if value is None else json.dumps(value, separators=(',',':')) if isinstance(value,(dict,list)) else str(value),
                'coalesce':lambda *values:next((value for value in values if value is not None),None),
                'trim':lambda value:value.strip(), 'toUpper':lambda value:value.upper(), 'length':len,
                'first':lambda value:value[0] if value else None, 'float':float, 'int':int,
                'lessOrEquals':lambda a,b:a <= b, 'greater':lambda a,b:a > b,
                'startsWith':lambda value,prefix:value.startswith(prefix), 'contains':lambda value,part:part in value,
                'concat':lambda *values:''.join(str(value) for value in values), 'substring':lambda value,start,size:value[start:start+size],
                'createArray':lambda *values:list(values), 'union':lambda a,b:list(dict.fromkeys(a+b)),
                'div':lambda a,b:a/b, 'formatNumber':lambda value,pattern,locale:format(value,'.2f'),
                'json':json.loads, 'uriComponent':lambda value:quote(str(value),safe=''), 'decodeUriComponent':unquote,
                'base64':lambda value:value['$content'] if isinstance(value,dict) else base64.b64encode(value if isinstance(value,bytes) else value.encode()).decode(),
                'setProperty':lambda value,key,item:{**value,key:item},
                'variables':lambda name:self.variables[name], 'body':lambda name:self.bodies[name],
                'outputs':lambda name:self.outputs[name] if name in self.outputs else self.values[name],
                'items':lambda name:self.items[name], 'item':lambda:self.items['item']}
            if name not in functions: raise AssertionError('Unsupported generated guard function: '+name)
            return functions[name](*args)
        raise AssertionError('Unsupported generated guard syntax: '+ast.dump(node))

    def connector(self, inputs):
        operation, params = inputs['host']['operationId'], self.evaluate(inputs['parameters'])
        self.calls.append((operation, params))
        if operation == 'HttpRequest':
            if params['parameters/method'] != 'GET': raise AssertionError('Financial mutation inside preflight')
            uri = unquote(params['parameters/uri'])
            match = re.search(r"lists\(guid'([^']+)'\)/items(?:\((\d+)\))?",uri)
            rows = self.data['lists'][match[1]]
            if match[2]: return 200, next(row for row in rows if str(row['Id']) == match[2])
            condition = re.search(r"\$filter=([A-Z_]+) eq (?:'([^']*)'|(\d+))",uri)
            if condition:
                if condition[2] is not None:
                    rows = [row for row in rows if str(row.get(condition[1],'')) == condition[2]]
                else:
                    rows = [row for row in rows if row.get(condition[1]) is not None and float(row[condition[1]]) == float(condition[3])]
            return 200, {'value':deepcopy(rows[:2])}
        if operation in ('GetFileMetadataByPath','GetFileContentByPath'):
            entry = self.data['files'].get(params['path'])
            if entry is None: return 404, None
            return 200, {'ETag':entry['etag']} if operation == 'GetFileMetadataByPath' else entry['content']
        key = (params.get('table'), int(params.get('itemId',0)))
        if operation == 'GetItemAttachments':
            return 200, [{key:value for key,value in item.items() if key != 'content'} for item in self.data['attachments'].get(key,[])]
        if operation == 'GetAttachmentContent':
            return 200, next(item['content'] for item in self.data['attachments'][key] if item['Id'] == params['attachmentId'])
        raise AssertionError('Unexpected or mutating preflight operation: '+operation)

    def run(self, actions):
        for name, action in actions.items():
            if any(self.statuses.get(previous) not in allowed for previous,allowed in action.get('runAfter',{}).items()):
                self.statuses[name] = 'Skipped'; continue
            kind = action['type']; result = None; status = 'Succeeded'
            if kind == 'Compose': result = self.evaluate(action['inputs']); self.values[name] = result
            elif kind == 'Query':
                result = []
                for row in self.evaluate(action['inputs']['from']):
                    self.items['item'] = row
                    if self.evaluate(action['inputs']['where']): result.append(deepcopy(row))
            elif kind == 'Select':
                result = []
                for row in self.evaluate(action['inputs']['from']):
                    self.items['item'] = row; result.append(self.evaluate(action['inputs']['select']))
            elif kind == 'If': self.run(action['actions'] if self.evaluate(action['expression']) else action.get('else',{}).get('actions',{}))
            elif kind == 'Foreach':
                for row in self.evaluate(action['foreach']):
                    self.items[name] = row; self.run(action['actions'])
            elif kind == 'Scope': self.run(action['actions'])
            elif kind == 'SetVariable': self.variables[action['inputs']['name']] = self.evaluate(action['inputs']['value'])
            elif kind == 'OpenApiConnection':
                code,result = self.connector(action['inputs']); status = 'Succeeded' if code == 200 else 'Failed'
                self.outputs[name] = {'statusCode':code,'body':result}
            elif kind == 'ParseJson':
                result = self.evaluate(action['inputs']['content']); schema = action['inputs']['schema']
                if any(field not in result for field in schema.get('required',[])):
                    raise PreflightRejected(result.get('message','Missing required validation property'))
                for field,rules in schema.get('properties',{}).items():
                    if 'enum' in rules and result.get(field) not in rules['enum']:
                        raise PreflightRejected(result.get('message','Schema assertion rejected'))
            else: raise AssertionError('Unsupported preflight action: '+kind)
            self.bodies[name] = result; self.statuses[name] = status


def preflight_fixture():
    """Five fictional people and literal frozen amounts, never real HR data."""
    plan = dict(version=1, key='ENCARGOS:2026-09', title='ENCARGOS-2026-09-synthetic',
                competence='2026-09', createdDate='2026-10-01', dueDate='2026-10-20',
                rulesVersion='FICTICIA', rules={}, rows=[], totals={'INSS':110000,'FGTS':32000}, pdfs={})
    data = dict(plan=plan, hr=[], sheets=[], lists={flow.PARENT:[],flow.CHILD:[],flow.PAYROLL:[],flow.SUPPLIERS:[]}, files={}, attachments={})
    for index in range(5):
        name = f'PESSOA FICTICIA {index+1}'
        row = dict(supplierId=101+index, employeeId=301+index, name=name, branch='FILIAL TESTE', profession='SERVICO TESTE',
                   cargo='CARGO RH', admission='2026-09-23', sheetId=501+index, salaryCents=300000, days=8, divisor=30,
                   baseCents=80000, components={'EMPREGADO':6000,'FICTICIO':16000}, inssCents=22000, fgtsCents=6400)
        plan['rows'].append(row)
        data['hr'].append(dict(Id=301+index, Title=name, IDFORNECEDORORIGEM=str(101+index), CARGO='CARGO RH',
                               STATUS='ATIVO', EMPREITEIRO='SIM', VINCULO='CLT', DATAADMISSAO='2026-09-23', DATADESLIGAMENTO=None))
        data['sheets'].append(dict(Id=501+index, FORNECEDOR=name, MESREFERENCIA='09/2026'))
        data['lists'][flow.SUPPLIERS].append(dict(Id=101+index, Title=name, FILIAL='FILIAL TESTE', PROFISSAO='SERVICO TESTE', STATUS='ATIVO', EMPREITEIRO='SIM'))
    for offset,tax,amount,total in [(0,'INSS','220.00','1100.00'),(100,'FGTS','64.00','320.00')]:
        key = 'ENCARGOS:2026-09:'+tax; parent_id = 801+offset
        data['lists'][flow.PARENT].append(dict(Id=parent_id, Title=key, FOLHAOPERACAO=key, FILIAL='FILIAL TESTE',
            FORNECEDOR='DIVERSOS', VALORTOTAL=total, OBS=tax+' - COMPETÊNCIA 2026-09', FORMAPGTO='', STATUS='PAGAMENTO PREVISTO', DATAPREVISTOPGTO='2026-10-20T12:00:00Z'))
        for index,row in enumerate(plan['rows']):
            child_id = 1001+offset+index; child_key = key+':'+str(row['supplierId'])
            data['lists'][flow.CHILD].append(dict(Id=child_id, Title=child_key, FOLHAOPERACAO=child_key, FILIAL='FILIAL TESTE',
                FORNECEDOR=row['name'], PRODUTO='SERVICO TESTE', OBS=tax+' - '+row['name']+' - COMPETÊNCIA 2026-09',
                IMOVEL='TODOS', FORMAPGTO='', QTD='1', VALORTOTAL=amount, FRETE='0', STATUS='PAGAMENTO PREVISTO',
                PGTOAGENDADO='PENDENTE', DATA='2026-10-01T12:00:00Z', DATAPREVISTOPGTO='2026-10-20T12:00:00Z', DESCRITIVOPROVISAO=str(parent_id), IDFOLHA=row['sheetId']))
            data['lists'][flow.PAYROLL].append(dict(Id=2001+offset+index, Title='APP-folha-provisao-'+str(child_id),
                FORNECEDOR=row['name'], TIPOPGTO=tax, VALORUNITARIO=amount, QTD='1', DATA='2026-10-20T12:00:00Z',
                IDFOLHA=str(row['sheetId']), IDPROVISAO=child_id, IDLANCAMENTO=None))
        path = '/ENCARGOS-2026-09-synthetic-'+tax+'.pdf'
        plan['pdfs'][tax] = dict(path=path, etag='etag-'+tax, fileName='MEMORIA-'+tax+'-2026-09.pdf')
        data['files'][path] = dict(etag='etag-'+tax, content=b'%PDF-1.4\n'+(tax+' FICTICIO\n').encode()*30)
    return data


class MonthlyFlowTests(unittest.TestCase):
    def setUp(self): self.assertIsNotNone(flow, 'The native monthly flow is not implemented')

    def preflight(self, fixture):
        financial = flow.build_definition()['actions']['Somente_Dia_01']['actions']
        self.assertTrue('Preflight_Global' in financial, 'All people, PDFs and existing records must be checked before any write')
        engine = NativePreflight(fixture)
        engine.run(financial['Preflight_Global']['actions'])
        return engine

    def test_recovery_paginates_current_hr_and_sheets_without_recalculating_salary(self):
        recovery = flow.build_definition()['actions']['Recuperar_Ou_Calcular']['actions']
        connectors = [action for _,action in actions_in(recovery) if action['type'] == 'OpenApiConnection']
        for label,guid,target in [('Cadastros_Recuperacao',flow.HR,'Cadastros'),('Folhas_Recuperacao',flow.SHEETS,'Folhas')]:
            self.assertTrue(guid in recovery['Iniciar_Pagina_'+label]['inputs']['value'])
            reader = dict(actions_in(recovery['Paginar_'+label]['actions']))
            self.assertEqual(reader['Adicionar_'+label]['inputs']['name'],target)
            self.assertTrue('Completo_'+label in recovery)
        self.assertFalse(any(flow.SALARIES in json.dumps(action) for action in connectors))
        self.assertEqual(recovery['Usar_Manifesto_Original']['inputs']['name'], 'Manifesto')

    def test_global_preflight_success_gates_the_only_financial_write_loop(self):
        financial = flow.build_definition()['actions']['Somente_Dia_01']['actions']
        self.assertTrue('Preflight_Global' in financial)
        self.assertEqual(financial['Cada_Encargo']['runAfter'], {'Preflight_Global':['Succeeded']})
        for _,action in actions_in(financial['Preflight_Global']['actions']):
            if action['type'] == 'OpenApiConnection':
                operation = action['inputs']['host']['operationId']
                self.assertNotIn(operation, ['CreateFile','CopyDriveFile','CreateAttachment'])
                if operation == 'HttpRequest':
                    self.assertEqual(action['inputs']['parameters']['parameters/method'], 'GET')

    def test_definition_fits_the_500_action_and_eight_level_native_limits(self):
        def levels(actions, depth=1):
            for _,action in actions.items():
                yield depth
                yield from levels(action.get('actions',{}),depth+1)
                yield from levels(action.get('else',{}).get('actions',{}),depth+1)
        depths = list(levels(flow.build_definition()['actions']))
        self.assertLessEqual(len(depths),500)
        self.assertLessEqual(max(depths),8)

    def test_current_hr_source_and_exact_unique_person_month_sheet_are_revalidated(self):
        mutations = [
            ('hr','VINCULO','AUTONOMO'), ('hr','STATUS','INATIVO'), ('hr','EMPREITEIRO','NAO'),
            ('hr','DATADESLIGAMENTO','2026-09-30'), ('hr','IDFORNECEDORORIGEM','999'),
            ('hr','Id',999), ('hr','Title','OUTRA PESSOA'), ('hr','CARGO','OUTRO CARGO'),
            ('hr','DATAADMISSAO','2026-09-24'), ('source','Id',999), ('source','Title','OUTRA PESSOA'),
            ('source','STATUS','INATIVO'), ('source','EMPREITEIRO','NAO'),
            ('source','FILIAL','OUTRA FILIAL'), ('source','PROFISSAO','OUTRO SERVICO'),
            ('sheets','Id',999), ('sheets','FORNECEDOR','OUTRA PESSOA'), ('sheets','MESREFERENCIA','10/2026')]
        for group,field,value in mutations:
            fixture = preflight_fixture()
            rows = fixture['lists'][flow.SUPPLIERS] if group == 'source' else fixture[group]
            rows[-1][field] = value
            with self.subTest(group=group,field=field), self.assertRaises((PreflightRejected,StopIteration)):
                self.preflight(fixture)
        for group in ('hr','sheets'):
            fixture = preflight_fixture(); fixture[group].append(deepcopy(fixture[group][-1]))
            with self.subTest(duplicate=group), self.assertRaises(PreflightRejected): self.preflight(fixture)

    def test_settled_parent_provision_or_payroll_blocks_the_entire_batch(self):
        for guid in (flow.PARENT, flow.CHILD, flow.PAYROLL):
            for field,value in [('IDLANCAMENTO','990'),('IDLANCAMENTOS','991'),('IDPEDIDO','992'),
                                ('DATAPGTOEFETUADO','2026-10-15'),('DATAPAGAMENTO','2026-10-15'),
                                ('STATUS','PAGO'),('PGTOAGENDADO','SIM')]:
                fixture = preflight_fixture(); fixture['lists'][guid][-1][field] = value
                with self.subTest(guid=guid,field=field), self.assertRaises(PreflightRejected): self.preflight(fixture)

    def test_corrupt_second_pdf_or_changed_etag_blocks_the_first_financial_write(self):
        for field,value in [('content',b'not a PDF'),('etag','changed-etag')]:
            fixture = preflight_fixture()
            fixture['files'][fixture['plan']['pdfs']['FGTS']['path']][field] = value
            with self.subTest(field=field), self.assertRaises(PreflightRejected): self.preflight(fixture)

    def test_existing_last_fgts_fields_and_crosslinks_must_match_before_writes(self):
        cases = [(flow.PARENT,'VALORTOTAL','319.99'),(flow.PARENT,'FILIAL','OUTRA FILIAL'),
                 (flow.CHILD,'VALORTOTAL','63.99'),(flow.CHILD,'DESCRITIVOPROVISAO','801'),
                 (flow.CHILD,'IDFOLHA',999),(flow.CHILD,'PRODUTO','OUTRO SERVICO'),
                 (flow.PAYROLL,'VALORUNITARIO','63.99'),(flow.PAYROLL,'IDPROVISAO',999),
                 (flow.PAYROLL,'TIPOPGTO','IRRF'),(flow.PAYROLL,'FORNECEDOR','OUTRA PESSOA')]
        for guid,field,value in cases:
            fixture = preflight_fixture(); fixture['lists'][guid][-1][field] = value
            with self.subTest(guid=guid,field=field), self.assertRaises(PreflightRejected): self.preflight(fixture)

    def test_integral_sharepoint_number_ids_match_frozen_integer_ids(self):
        fixture = preflight_fixture()
        for guid,fields in [(flow.CHILD,['IDFOLHA']), (flow.PAYROLL,['IDFOLHA','IDPROVISAO'])]:
            for row in fixture['lists'][guid]:
                for field in fields: row[field] = float(row[field])
        engine = self.preflight(fixture)
        self.assertEqual(engine.data, fixture)
        actions = dict(actions_in(flow.build_definition()['actions']))
        engine.items.update(Cada_Encargo='FGTS',Cada_Fornecedor=fixture['plan']['rows'][-1])
        engine.bodies['Filiais_Do_Lote'] = ['FILIAL TESTE'] * 5
        engine.bodies['Reler_Descritivo'] = {'value':[fixture['lists'][flow.PARENT][-1]]}
        engine.bodies['Reler_Provisao'] = {'value':[fixture['lists'][flow.CHILD][-1]]}
        for label,guid in [('Provisao',flow.CHILD),('Folha',flow.PAYROLL)]:
            engine.bodies['Buscar_Criacao_'+label] = {'value':[fixture['lists'][guid][-1]]}
            engine.bodies['Reler_'+label] = {'value':[fixture['lists'][guid][-1]]}
            with self.subTest(label=label):
                self.assertTrue(engine.evaluate(actions['Estado_Preflight_'+label]['inputs']['content']['ok']))
                self.assertTrue(engine.evaluate(actions['Verificar_'+label]['expression']))

    def test_fractional_or_missing_numeric_links_are_not_rounded_into_matching_ids(self):
        for guid,field in [(flow.CHILD,'IDFOLHA'),(flow.PAYROLL,'IDFOLHA'),(flow.PAYROLL,'IDPROVISAO')]:
            for value in (None, 0, '999.5'):
                fixture = preflight_fixture(); fixture['lists'][guid][-1][field] = value
                with self.subTest(guid=guid,field=field,value=value), self.assertRaises(PreflightRejected):
                    self.preflight(fixture)

    def test_existing_attachment_bytes_are_checked_for_both_taxes_without_uploads(self):
        fixture = preflight_fixture()
        parent_id = fixture['lists'][flow.PARENT][0]['Id']
        child_id = fixture['lists'][flow.CHILD][-1]['Id']
        fixture['attachments'][(flow.PARENT,parent_id)] = [dict(Id='original',DisplayName='guia-original.pdf',content=b'preservar')]
        fixture['attachments'][(flow.CHILD,child_id)] = [dict(Id='conflict',DisplayName='MEMORIA-FGTS-2026-09.pdf',content=b'different')]
        with self.assertRaises(PreflightRejected): self.preflight(fixture)
        fixture['attachments'][(flow.CHILD,child_id)][0]['content'] = fixture['files'][fixture['plan']['pdfs']['FGTS']['path']]['content']
        engine = self.preflight(fixture)
        self.assertEqual(engine.data['attachments'], fixture['attachments'])
        self.assertTrue(any(operation == 'GetAttachmentContent' for operation,_ in engine.calls))

    def test_valid_preflight_preserves_frozen_values_and_caches_both_pdf_contents(self):
        fixture = preflight_fixture(); original = deepcopy(fixture)
        engine = self.preflight(fixture)
        self.assertEqual(engine.variables['Manifesto'], original['plan'])
        self.assertEqual(engine.data, original)
        for tax in ('INSS','FGTS'):
            self.assertEqual(engine.variables['PDFsValidados'][tax], base64.b64encode(fixture['files'][fixture['plan']['pdfs'][tax]['path']]['content']).decode())

    def test_uncertain_missing_record_intent_blocks_global_preflight(self):
        fixture = preflight_fixture()
        fixture['lists'][flow.PAYROLL].pop()
        child_id = fixture['lists'][flow.CHILD][-1]['Id']
        fixture['files'][f'/ENCARGOS-INTENCAO-Folha-{child_id}.json'] = dict(etag='intent',content=b'prior unresolved POST')
        with self.assertRaises(PreflightRejected): self.preflight(fixture)
        fixture['files'].pop(f'/ENCARGOS-INTENCAO-Folha-{child_id}.json')
        self.preflight(fixture)

    def test_new_batch_and_partial_recovery_allow_only_absent_consistent_records(self):
        fixture = preflight_fixture()
        for guid in (flow.PARENT,flow.CHILD,flow.PAYROLL): fixture['lists'][guid] = []
        self.preflight(fixture)
        fixture = preflight_fixture(); fixture['lists'][flow.PARENT].pop()
        with self.assertRaises(PreflightRejected): self.preflight(fixture)
        for guid in (flow.PARENT,flow.CHILD,flow.PAYROLL):
            fixture = preflight_fixture(); fixture['lists'][guid].append(deepcopy(fixture['lists'][guid][-1]))
            with self.subTest(duplicate=guid), self.assertRaises(PreflightRejected): self.preflight(fixture)

    def test_unplanned_owned_provision_does_not_bypass_the_global_preflight(self):
        fixture = preflight_fixture(); extra = deepcopy(fixture['lists'][flow.CHILD][-1])
        extra.update(Id=9999,FOLHAOPERACAO='ENCARGOS:2026-09:FGTS:999',Title='ENCARGOS:2026-09:FGTS:999')
        fixture['lists'][flow.CHILD].append(extra)
        with self.assertRaises(PreflightRejected): self.preflight(fixture)

    def test_write_stage_does_not_softly_accept_a_recreated_or_settled_preflight_record(self):
        fixture = preflight_fixture(); engine = self.preflight(fixture)
        actions = dict(actions_in(flow.build_definition()['actions']))
        engine.items.update(Cada_Encargo='FGTS',Cada_Fornecedor=fixture['plan']['rows'][-1])
        engine.bodies['Filiais_Do_Lote'] = ['FILIAL TESTE'] * 5
        engine.bodies['Reler_Descritivo'] = {'value':[fixture['lists'][flow.PARENT][-1]]}
        engine.bodies['Reler_Provisao'] = {'value':[fixture['lists'][flow.CHILD][-1]]}
        for label,guid in [('Descritivo',flow.PARENT),('Provisao',flow.CHILD),('Folha',flow.PAYROLL)]:
            guard = 'Estado_Preflight_'+label
            self.assertTrue(guard in actions, 'Write stage must preserve the preflighted ID and pending state')
            self.assertEqual(actions['Criar_Se_Ausente_'+label]['runAfter'], {guard:['Succeeded']})
            for change in ({'Id':9999},{'IDLANCAMENTO':'999'},{'STATUS':'PAGO'}):
                row = {**fixture['lists'][guid][-1],**change}
                engine.bodies['Buscar_Criacao_'+label] = {'value':[row]}
                with self.subTest(label=label,change=change):
                    self.assertFalse(engine.evaluate(actions[guard]['inputs']['content']['ok']))

    def test_authoritative_readback_cannot_switch_an_existing_preflight_id(self):
        fixture = preflight_fixture(); engine = self.preflight(fixture)
        actions = dict(actions_in(flow.build_definition()['actions']))
        engine.items.update(Cada_Encargo='FGTS',Cada_Fornecedor=fixture['plan']['rows'][-1])
        for label,guid in [('Descritivo',flow.PARENT),('Provisao',flow.CHILD),('Folha',flow.PAYROLL)]:
            engine.bodies['Reler_Descritivo'] = {'value':[fixture['lists'][flow.PARENT][-1]]}
            engine.bodies['Reler_Provisao'] = {'value':[fixture['lists'][flow.CHILD][-1]]}
            engine.bodies['Reler_'+label] = {'value':[{**fixture['lists'][guid][-1],'Id':9999}]}
            with self.subTest(label=label):
                self.assertFalse(engine.evaluate(actions['Unico_'+label]['expression']))

    def test_schedule_is_monthly_first_day_brasilia_with_one_run(self):
        trigger = next(iter(flow.build_definition()['triggers'].values()))
        self.assertEqual(trigger['type'], 'Recurrence')
        self.assertEqual(trigger['recurrence']['frequency'], 'Month')
        self.assertEqual(trigger['recurrence']['interval'], 1)
        self.assertEqual(trigger['recurrence']['startTime'], '2026-11-01T06:00:00')
        self.assertEqual(trigger['recurrence']['timeZone'], 'E. South America Standard Time')
        self.assertEqual(trigger['runtimeConfiguration']['concurrency']['runs'], 1)

    def test_native_payloads_create_individual_provision_and_payroll_not_paid_launches(self):
        all_actions = dict(actions_in(flow.build_definition()['actions']))
        child = all_actions['Campos_Provisao']['inputs']
        payroll = all_actions['Campos_Folha']['inputs']
        self.assertEqual(child['QTD'], '1'); self.assertEqual(child['IMOVEL'], 'TODOS')
        self.assertEqual(child['FORMAPGTO'], ''); self.assertEqual(child['PGTOAGENDADO'], 'PENDENTE')
        self.assertEqual(child['PRODUTO'], "@items('Cada_Fornecedor')?['profession']")
        self.assertEqual(child['FORNECEDOR'], payroll['FORNECEDOR'])
        self.assertEqual(child['IDFOLHA'], "@items('Cada_Fornecedor')?['sheetId']")
        self.assertEqual(payroll['IDPROVISAO'], "@first(body('Reler_Provisao')?['value'])?['Id']")
        self.assertEqual(payroll['TIPOPGTO'], "@items('Cada_Encargo')")
        self.assertNotIn('IDLANCAMENTO', payroll)
        self.assertNotIn('DATAPGTOEFETUADO', child)
        for action in all_actions.values():
            if action['type'] == 'OpenApiConnection' and action['inputs']['host']['operationId'] == 'HttpRequest':
                params = action['inputs']['parameters']
                if params['parameters/method'] == 'POST':
                    self.assertIn(params['parameters/uri'], [f"_api/web/lists(guid'{guid}')/items" for guid in (flow.PARENT,flow.CHILD,flow.PAYROLL)])

    def test_manual_preview_cannot_reach_a_financial_post(self):
        actions = flow.build_definition()['actions']
        stage = actions['Somente_Dia_01']
        self.assertIn("dayOfMonth(outputs('Agora_Brasilia')), 1", stage['expression'])
        self.assertFalse(any(a['type'] == 'OpenApiConnection' for _,a in actions_in(stage['else']['actions'])))
        self.assertEqual(stage['runAfter'], {'Validar_Reserva_Confirmada': ['Succeeded']})

    def test_uncertain_post_has_no_automatic_retry_and_is_always_read_back(self):
        actions = dict(actions_in(flow.build_definition()['actions']))
        for label in ['Descritivo','Provisao','Folha']:
            self.assertEqual(actions['Criar_'+label]['inputs']['retryPolicy'], {'type':'none'})
            self.assertEqual(actions['Reler_'+label]['runAfter'], {'Criar_Se_Ausente_'+label:['Succeeded','Failed','TimedOut']})
        self.assertIn('IDPROVISAO', actions['Buscar_Criacao_Folha']['inputs']['parameters']['parameters/uri'])

    def test_rules_sheets_and_complete_pagination_gate_the_frozen_manifest(self):
        actions = dict(actions_in(flow.build_definition()['actions']))
        self.assertEqual(actions['Ler_Regras']['inputs']['parameters']['path'], '/ENERGETICA-ENCARGOS-CONFIG.json')
        self.assertIn('Validar_Regras', actions)
        self.assertIn('Folha_Unica_Do_Fornecedor', actions)
        self.assertIn('Salario_Vigente_Unico', actions)
        for label in ['Cadastros','Salarios','Folhas']:
            self.assertIn('Paginar_'+label, actions)
            self.assertIn('Completo_'+label, actions)
        self.assertIn('Versao_Manifesto_Original', actions)
        self.assertIs(actions['Reservar_Sem_Sobrescrever']['inputs']['parameters']['overwrite'], False)

    def test_both_pdfs_are_version_pinned_before_any_financial_mutation(self):
        actions = dict(actions_in(flow.build_definition()['actions']))
        self.assertEqual(actions['Converter_PDF']['inputs']['host']['operationId'], 'ConvertFile')
        self.assertEqual(actions['Ler_PDF_Original']['inputs']['parameters']['inferContentType'], False)
        self.assertIn('Versao_PDF_Original', actions)
        self.assertIn('Conferir_Anexo_Descritivo', actions)
        self.assertIn('Conferir_Anexo_Provisao', actions)
        self.assertIn('Verificar_Chave_Unica_Folha', actions)

    def test_pagination_allowlist_escapes_the_odata_quotes_inside_wdl_literals(self):
        actions = dict(actions_in(flow.build_definition()['actions']))
        for label, guid in [('Cadastros', flow.HR), ('Salarios', flow.SALARIES),
                            ('Folhas', flow.SHEETS), ('Provisoes', flow.CHILD), ('Pagamentos', flow.PAYROLL)]:
            expression = actions['Destino_'+label]['expression']
            self.assertIn("lists(guid''"+guid+"'')/items?", expression)
            self.assertNotIn("lists(guid'"+guid+"')/items?", expression)

    def test_action_names_and_initializers_are_valid_for_power_automate(self):
        definition = flow.build_definition(); pairs = list(actions_in(definition['actions']))
        names = [name for name,_ in pairs]
        self.assertEqual(len(names),len(set(names)))
        for name,action in pairs:
            if action['type']=='InitializeVariable':
                self.assertIn(name,definition['actions'])
                self.assertEqual(len(action['inputs']['variables']),1)
            if action['type']=='Foreach':
                self.assertNotIn('Terminate',[a['type'] for _,a in actions_in(action['actions'])])

    def test_package_uses_only_existing_standard_connectors_and_has_complete_maps(self):
        with tempfile.TemporaryDirectory() as folder:
            with zipfile.ZipFile(flow.build_package(Path(folder))) as archive:
                manifest=json.loads(archive.read('manifest.json')); resources=manifest['resources']
                apis={r['name'] for r in resources.values() if r['type']=='Microsoft.PowerApps/apis'}
                self.assertEqual(apis,{'shared_sharepointonline','shared_onedriveforbusiness'})
                flows=[n for n in archive.namelist() if n.endswith('/definition.json')]
                self.assertEqual(len(flows),1)
                for resource in resources.values():
                    self.assertTrue(all(ref in resources for ref in resource['dependsOn']))
                refs=json.loads(archive.read(flows[0]))['properties']['connectionReferences']
                self.assertEqual(len({r['connectionName'] for r in refs.values()}),2)


if __name__=='__main__': unittest.main()
