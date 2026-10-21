"""Contracts for the actual imported WDL and its local preview inputs."""
from datetime import date
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('weekly_va', HERE / 'build_flow.py')
flow = None
if (HERE / 'build_flow.py').exists():
    flow = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(flow)


def supplier(sid=264, **changes):
    return {'Id': sid, 'Title': 'COLABORADOR A', 'CARGO': 'PEDREIRO I',
            'STATUS': 'ATIVO', 'EMPREITEIRO': 'SIM', 'FILIAL': '004 - EDIFÍCIO XAVANTE', **changes}


def actions_in(actions):
    for name, action in actions.items():
        yield name, action
        yield from actions_in(action.get('actions', {}))
        yield from actions_in(action.get('else', {}).get('actions', {}))


class WeeklyFlowTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(flow, 'The weekly VA builder is not implemented')

    def test_week_is_sunday_to_upcoming_friday_across_year(self):
        for reference, sunday, friday in [
            ('2026-10-25', '2026-10-25', '2026-10-30'),
            ('2026-10-21', '2026-10-18', '2026-10-23'),
            ('2026-12-27', '2026-12-27', '2027-01-01'),
            ('2027-01-02', '2026-12-27', '2027-01-01')]:
            with self.subTest(reference=reference):
                result = flow.plan_week([supplier()], date.fromisoformat(reference))
                self.assertEqual((result['sunday'], result['friday']), (sunday, friday))

    def test_only_active_contractors_with_a_cargo_are_eligible(self):
        result = flow.plan_week([supplier(), supplier(2, CARGO=' '), supplier(3, STATUS='INATIVO'),
                                supplier(4, EMPREITEIRO='NÃO'), supplier(240, Title='COLABORADOR Z', CARGO='ENGENHEIRO')], date(2026, 10, 25))
        self.assertEqual([row['id'] for row in result['rows']], [264, 240])
        self.assertEqual(result['total'], 450)

    def test_one_parent_and_one_child_each_without_paid_records(self):
        result = flow.plan_week([supplier(), supplier(269, Title='COLABORADOR B', FILIAL='001 - OURO PRETO')], date(2026, 10, 25))
        parent = flow.parent_payload(result, 'VA-2026-10-25-test')
        self.assertEqual(parent['VALORTOTAL'], '450')
        self.assertEqual(parent['FORNECEDOR'], 'DIVERSOS')
        self.assertEqual(parent['FILIAL'], 'DIVERSAS')
        children = [flow.child_payload(result, row, 37) for row in result['rows']]
        self.assertEqual([row['DESCRITIVOPROVISAO'] for row in children], ['37', '37'])
        self.assertEqual([row['FILIAL'] for row in children], ['004 - EDIFÍCIO XAVANTE', '001 - OURO PRETO'])
        for row in children:
            self.assertEqual((row['QTD'], row['VALORTOTAL'], row['FRETE']), ('5', '45', '0'))
            self.assertEqual((row['PRODUTO'], row['OBS'], row['IMOVEL'], row['FORMAPGTO']), ('VALE ALIMENTAÇÃO', 'VALE ALIMENTAÇÃO', 'TODOS', ''))
            self.assertEqual((row['STATUS'], row['PGTOAGENDADO']), ('PAGAMENTO PREVISTO', 'PENDENTE'))
            self.assertNotIn('DATAPGTOEFETUADO', row)
            self.assertNotIn('IDLANCAMENTOS', row)

    def test_duplicate_ids_or_names_and_missing_branch_fail_before_any_write(self):
        for rows in [[supplier(), supplier()], [supplier(), supplier(265)], [supplier(FILIAL='')]]:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                flow.plan_week(rows, date(2026, 10, 25))

    def test_blank_markers_are_not_cargos(self):
        result = flow.plan_week([supplier(1, CARGO='EM BRANCO'), supplier(2, CARGO='0'), supplier(3, CARGO=None)], date(2026, 10, 25))
        self.assertEqual(result['rows'], [])

    def test_seven_rows_are_1575_and_line_price_is_225(self):
        result = flow.plan_week([supplier(i, Title=f'PESSOA {i}') for i in range(1, 8)], date(2026, 10, 25))
        self.assertEqual((len(result['rows']), result['total']), (7, 1575))
        self.assertEqual({(row['quantity'], row['unitValue'], row['total']) for row in result['rows']}, {(5, 45, 225)})

    def test_weekly_keys_do_not_depend_on_roster_names_or_run_uuid(self):
        plan = flow.plan_week([supplier()], date(2026, 10, 25))
        self.assertEqual(flow.parent_payload(plan, 'run1')['FOLHAOPERACAO'], 'VA-SEMANAL:2026-10-25')
        self.assertEqual(flow.parent_payload(plan, 'run2')['FOLHAOPERACAO'], 'VA-SEMANAL:2026-10-25')
        self.assertEqual(flow.child_payload(plan, plan['rows'][0], 37)['FOLHAOPERACAO'], 'VA-SEMANAL:2026-10-25:264')

    def test_sunday_schedule_uses_brasilia_and_one_concurrent_run(self):
        definition = flow.build_definition()
        trigger = definition['triggers']['Domingo_06h']
        self.assertEqual(trigger['recurrence'], {'frequency': 'Week', 'interval': 1, 'timeZone': 'E. South America Standard Time',
                         'startTime': '2026-10-25T06:00:00', 'schedule': {'weekDays': ['Sunday'], 'hours': [6], 'minutes': [0]}})
        self.assertEqual(trigger['runtimeConfiguration']['concurrency']['runs'], 1)

    def test_power_automate_initializes_one_variable_per_top_level_action(self):
        definition = flow.build_definition()
        all_inits = [(name, action) for name, action in actions_in(definition['actions']) if action['type'] == 'InitializeVariable']
        self.assertGreaterEqual(len(all_inits), 5)
        for name, action in all_inits:
            self.assertIn(name, definition['actions'])
            self.assertEqual(len(action['inputs']['variables']), 1)

    def test_non_sunday_preview_has_no_financial_writes_and_no_other_lists(self):
        definition = flow.build_definition()
        financial = definition['actions']['Somente_Domingo']
        self.assertEqual(financial['expression'], "@and(equals(dayOfWeek(outputs('Agora_Brasilia')), 0), greater(length(variables('Manifesto')?['rows']), 0))")
        self.assertFalse(any(action['type'] == 'OpenApiConnection' for _, action in actions_in(financial['else']['actions'])))
        all_actions = list(actions_in(definition['actions']))
        methods = [action['inputs']['parameters'].get('parameters/method') for _, action in all_actions if action['type'] == 'OpenApiConnection']
        self.assertNotIn('DELETE', methods)
        serialized = json.dumps(definition)
        for forbidden in ['LANCAMENTOS', 'NOTASPENDENTES', 'FOLHAPGTO', 'DATAPGTOEFETUADO']:
            self.assertNotIn(forbidden, serialized)

    def test_recovery_uses_original_manifest_and_checks_unique_keys(self):
        definition = flow.build_definition()
        lookup = definition['actions']['Procurar_Descritivo']['inputs']['parameters']['parameters/uri']
        self.assertIn('FOLHAOPERACAO', lookup)
        recovery = definition['actions']['Recuperar_Ou_Ler_Cadastro']['actions']
        self.assertEqual(recovery['Ler_Manifesto']['inputs']['host']['operationId'], 'GetFileContentByPath')
        self.assertEqual(recovery['Ler_Manifesto']['inputs']['parameters']['path'], "@variables('Reserva')?['manifestPath']")
        self.assertNotIn('Ler_Fornecedores', recovery)

    def test_json_recovery_forces_binary_envelopes_before_base64_decoding(self):
        actions = dict(actions_in(flow.build_definition()['actions']))
        for name in ['Ler_Reserva', 'Ler_Manifesto', 'Confirmar_Reserva']:
            self.assertIn(name, actions, 'Durable snapshot recovery is missing')
            self.assertIs(actions[name]['inputs']['parameters']['inferContentType'], False)

    def test_weekly_snapshot_survives_uncommitted_parent_with_changed_roster(self):
        actions = flow.build_definition()['actions']
        self.assertIn('Procurar_Reserva', actions, 'The snapshot must be discoverable without the parent')
        lookup = actions['Procurar_Reserva']['inputs']['parameters']['path']
        self.assertEqual(lookup, "@concat('/VA-RESERVA-', outputs('Domingo'), '.json')")
        choose = actions['Recuperar_Ou_Ler_Cadastro']
        self.assertEqual(choose['expression'], "@equals(actions('Procurar_Reserva')?['status'], 'Succeeded')")
        nested = dict(actions_in(actions))
        copy = nested['Reservar_Sem_Sobrescrever']
        self.assertEqual(copy['inputs']['host']['operationId'], 'CopyDriveFile')
        self.assertIs(copy['inputs']['parameters']['overwrite'], False)
        self.assertEqual(copy['inputs']['parameters']['destination'], lookup)
        self.assertEqual(nested['Confirmar_Reserva']['runAfter'], {'Reservar_Sem_Sobrescrever': ['Succeeded', 'Failed', 'TimedOut']})

    def test_same_count_manifest_substitution_is_rejected_by_version_pins(self):
        actions = dict(actions_in(flow.build_definition()['actions']))
        self.assertIn('Versao_Manifesto_Original', actions, 'Manifest version pin is missing')
        self.assertEqual(actions['Versao_Manifesto_Original']['expression'], "@and(not(empty(variables('Reserva')?['manifestETag'])), equals(body('Meta_Manifesto_Original')?['ETag'], variables('Reserva')?['manifestETag']))")
        self.assertEqual(actions['Versao_PDF_Original']['expression'], "@and(not(empty(variables('Reserva')?['pdfETag'])), equals(body('Meta_PDF_Original')?['ETag'], variables('Reserva')?['pdfETag']))")
        parent_fields = actions['Campos_Descritivo']['inputs']
        self.assertEqual(parent_fields['Title'], "@outputs('Titulo_Imutavel')")
        guard = actions['Conferir_Reserva_Descritivo']
        self.assertIn("first(body('Procurar_Descritivo')?['value'])?['Title'], outputs('Titulo_Imutavel')", guard['expression'])
        self.assertEqual(actions['Conferir_PDF']['runAfter'], {'Conferir_Reserva_Descritivo': ['Succeeded']})

    def test_conversion_and_validation_precede_financial_create(self):
        definition = flow.build_definition()
        self.assertEqual(definition['actions']['Somente_Domingo']['runAfter'], {'Conferir_PDF': ['Succeeded']})
        self.assertEqual(definition['actions']['Converter_PDF']['inputs']['host']['operationId'], 'ConvertFile')
        self.assertEqual(definition['actions']['Converter_PDF']['inputs']['parameters']['type'], 'PDF')
        for name, action in actions_in(definition['actions']):
            if name.startswith('Criar_') and action['type'] == 'OpenApiConnection' and action['inputs']['parameters'].get('parameters/method') == 'POST':
                self.assertEqual(action['inputs']['retryPolicy'], {'type': 'none'})
        rechecks = [(name, action) for name, action in actions_in(definition['actions']) if name in {'Reler_Descritivo', 'Reler_Provisao'}]
        self.assertEqual(len(rechecks), 2)
        for _, action in rechecks:
            self.assertEqual(list(action['runAfter'].values()), [['Succeeded', 'Failed', 'TimedOut']])

    def test_importable_action_names_are_unique_and_loop_failures_are_valid(self):
        names = [name for name, _ in actions_in(flow.build_definition()['actions'])]
        self.assertEqual(len(names), len(set(names)), 'Power Automate requires globally distinct action names')
        for _, action in actions_in(flow.build_definition()['actions']):
            if action['type'] == 'Foreach':
                self.assertNotIn('Terminate', [nested['type'] for _, nested in actions_in(action['actions'])])

    def test_rest_bodies_are_encoded_objects_not_interpolated_json_strings(self):
        actions = dict(actions_in(flow.build_definition()['actions']))
        for label in ['Descritivo', 'Provisao']:
            self.assertEqual(actions['Criar_' + label]['inputs']['parameters']['parameters/body'], f"@string(outputs('Campos_{label}'))")

    def test_pdf_names_values_and_html_escape(self):
        plan = flow.plan_week([supplier(1, Title='A&B <PEDREIRO>')], date(2026, 10, 25))
        html = flow.preview_html(plan)
        for text in ['A&amp;B &lt;PEDREIRO&gt;', '5', '45,00', '225,00', '30/10/2026', '25/10/2026']:
            self.assertIn(text, html)
        self.assertNotIn('<PEDREIRO>', html)

    def test_pdf_is_attached_to_parent_and_each_child_with_content_comparison(self):
        names = dict(actions_in(flow.build_definition()['actions']))
        for label in ['Descritivo', 'Provisao']:
            self.assertIn(f'Anexos_{label}', names)
            self.assertIn(f'Conferir_Anexo_{label}', names)
            self.assertIn(f'Anexar_{label}', names)
            self.assertEqual(names[f'Anexar_{label}']['inputs']['host']['operationId'], 'CreateAttachment')

    def test_import_package_has_only_standard_apis_and_resolvable_maps(self):
        with tempfile.TemporaryDirectory() as folder:
            path = flow.build_package(Path(folder))
            with zipfile.ZipFile(path) as archive:
                manifest = json.loads(archive.read('manifest.json'))
                resources = manifest['resources']
                self.assertEqual(len([r for r in resources.values() if r['type'] == 'Microsoft.Flow/flows']), 1)
                apis = {r['name'] for r in resources.values() if r['type'] == 'Microsoft.PowerApps/apis'}
                self.assertEqual(apis, {'shared_sharepointonline', 'shared_onedriveforbusiness'})
                for resource in resources.values():
                    for ref in resource['dependsOn']:
                        self.assertIn(ref, resources)


if __name__ == '__main__':
    unittest.main()
