from datetime import date
import importlib.util
import json
from pathlib import Path
import unittest

PATH = Path(__file__).with_name('build_flow.py')
builder = None
if PATH.exists():
    spec = importlib.util.spec_from_file_location('swile_builder_test', PATH)
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)


def walk(actions):
    for name, action in actions.items():
        yield name, action
        yield from walk(action.get('actions', {}))
        yield from walk(action.get('else', {}).get('actions', {}))


class FlowContractTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(builder, 'RH native flow builder is not implemented')
        self.definition = builder.build_definition([9009], date(2026, 10, 27))
        self.actions = dict(walk(self.definition['actions']))

    def test_daily_brasilia_trigger_serializes_runs_and_filters_an_inclusive_fortnight(self):
        trigger = self.definition['triggers']['Diariamente_06h']
        self.assertEqual(trigger['recurrence'], {'frequency': 'Day', 'interval': 1,
                         'timeZone': 'E. South America Standard Time', 'startTime': '2026-10-27T06:00:00',
                         'schedule': {'hours': [6], 'minutes': [0]}})
        self.assertEqual(trigger['runtimeConfiguration']['concurrency']['runs'], 1)
        self.assertEqual(self.actions['Quartas']['inputs']['from'], '@range(0, 15)')
        self.assertEqual(self.actions['Quartas']['inputs']['where'], "@equals(dayOfWeek(addDays(outputs('Agora_Brasilia'), item())), 3)")
        self.assertEqual(self.actions['Cada_Quarta']['runtimeConfiguration']['concurrency']['repetitions'], 1)

    def test_rh_origin_identity_and_configured_exception_replace_legacy_roles(self):
        self.assertEqual(self.actions['Inicializar_Excluidos']['inputs']['variables'][0]['value'], [9009])
        uri = self.actions['Inicializar_RHNext']['inputs']['variables'][0]['value']
        self.assertIn("8311a380-ee1e-42eb-a529-7452a47b0ae3", uri)
        self.assertIn('IDFORNECEDORORIGEM', uri)
        self.assertNotIn('CARGO', uri)
        self.assertNotIn('EMPREITEIRO', uri)
        self.assertEqual(self.actions['Elegiveis']['inputs']['where'], "@not(contains(variables('Excluidos'), int(item()?['IDFORNECEDORORIGEM'])))")

    def test_parent_supplier_and_child_values_are_correct_at_the_http_boundary(self):
        parent = self.actions['Campos_Pai']['inputs']
        self.assertEqual(parent['FORNECEDOR'], 'SWILE')
        self.assertEqual((parent['VALORTOTAL'], parent['STATUS']), ('0', 'PAGAMENTO PREVISTO'))
        child = self.actions['Campos_Filho']['inputs']
        self.assertEqual((child['QTD'], child['VALORTOTAL'], child['FRETE']), ('5', '45', '0'))
        self.assertEqual(child['FORNECEDOR'], "@items('Cada_Novo_Funcionario')?['name']")
        self.assertEqual(child['DESCRITIVOPROVISAO'], "@variables('ParentId')")
        self.assertEqual(child['STATUS'], 'PAGAMENTO PREVISTO')
        self.assertEqual(child['PGTOAGENDADO'], 'PENDENTE')
        self.assertNotIn('IDRECORRENCIA', child)
        self.assertNotIn('DATAPGTOEFETUADO', child)
        self.assertNotIn('IDLANCAMENTOS', child)

    def test_post_mutations_never_retry_and_conditional_merges_have_real_etags(self):
        for name, action in self.actions.items():
            if action.get('type') != 'OpenApiConnection':
                continue
            parameters = action['inputs']['parameters']
            if parameters.get('parameters/method') == 'POST':
                self.assertEqual(action['inputs']['retryPolicy'], {'type': 'none'}, name)
            headers = parameters.get('parameters/headers', {})
            if headers.get('X-HTTP-Method') == 'MERGE':
                self.assertIn('IF-MATCH', headers)
                self.assertNotEqual(headers['IF-MATCH'], '*')

    def test_pages_and_unique_indexes_are_checked_before_financial_creation(self):
        for name in ['RH_Complete', 'RH_Page_Allowed', 'RH_Page_Not_Repeated', 'ParentUniqueIndex', 'ChildUniqueIndex']:
            self.assertIn(name, self.actions)
        self.assertEqual(self.actions['Cada_Quarta']['runAfter'], {'Quartas': ['Succeeded']})
        self.assertEqual(self.actions['Quartas']['runAfter'], {'Validar_Destinatarios': ['Succeeded']})

    def test_existing_children_are_reconciled_and_paid_or_manual_weeks_are_preserved(self):
        self.assertIn('Antes_Page_Allowed', self.actions)
        self.assertIn('Depois_Page_Allowed', self.actions)
        self.assertEqual(self.actions['Faltantes']['inputs']['from'], "@body('Linhas')")
        self.assertIn('Chaves_Antes', self.actions['Faltantes']['inputs']['where'])
        self.assertEqual(self.actions['Preservar_Semana']['inputs']['status'], 'preserved')
        self.assertIn('Patch_Final', self.actions)
        self.assertIn('Readback_Final', self.actions)
        self.assertIn('Conferir_Final', self.actions)

    def test_legacy_retirement_is_not_repeated_by_the_daily_flow(self):
        all_actions = list(walk(self.definition['actions']))
        names = [name for name, _ in all_actions]
        self.assertEqual(len(names), len(set(names)))
        for name, action in all_actions:
            if action['type'] == 'InitializeVariable':
                self.assertIn(name, self.definition['actions'])
                self.assertEqual(len(action['inputs']['variables']), 1)
            if action['type'] == 'OpenApiConnection':
                self.assertEqual(action['inputs']['host']['apiId'], '/providers/Microsoft.PowerApps/apis/shared_sharepointonline')
                self.assertNotEqual(action['inputs']['parameters'].get('parameters/method'), 'DELETE')
        decoded = json.loads(json.dumps(self.definition, allow_nan=False))
        self.assertEqual(decoded['contentVersion'], '1.0.0.0')

    def test_emitted_expressions_compile_with_declared_variables_and_references(self):
        try:
            result = builder.validate_definition(self.definition)
        except ValueError as error:
            self.fail('Emitted WDL is invalid: ' + str(error))
        self.assertIsNone(result)

    def test_validation_rejects_unknown_functions_and_broken_references(self):
        for expression in ["@true()", "@equals(variables('Undeclared'),1)",
                           "@equals(outputs('MissingAction'),1)", "@equals(1,1"]:
            definition = json.loads(json.dumps(self.definition))
            definition['actions']['Broken'] = {'type': 'Compose', 'inputs': expression, 'runAfter': {}}
            with self.subTest(expression=expression), self.assertRaises(ValueError):
                builder.validate_definition(definition)

    def test_origin_validation_uses_supported_guards_instead_of_regex_schema(self):
        schema = self.actions['RH_Origins']['inputs']['schema']
        self.assertNotIn('pattern', json.dumps(schema))
        self.assertIn('RH_Origens_Invalidas', self.actions)
        self.assertEqual(self.actions['Elegiveis']['runAfter'], {'Validar_Origens': ['Succeeded']})
        guard = self.actions['RH_Origens_Invalidas']['inputs']['where']
        self.assertIn('isInt(', guard)
        self.assertIn('greater(int(', guard)
        self.assertIn('equals(string(int(', guard)

    def test_dates_and_manual_account_or_observation_guard_every_mutable_group(self):
        for name in ['Semana_Mutavel', 'Pai_Ainda_Preparando', 'Pai_Final_Mutavel', 'Antes_Invalida', 'Depois_Invalida']:
            expression = self.actions[name]['expression']
            for field in ['DATAPGTOAGENDADO', 'DATAEXECUCAOAGENDAMENTO', 'FORMAPGTO', 'OBS']:
                self.assertIn(field, expression, name)


if __name__ == '__main__':
    unittest.main()
