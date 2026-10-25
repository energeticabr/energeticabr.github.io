"""Behavioral contracts; all people and financial settings here are synthetic."""
from copy import deepcopy
from datetime import date
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('monthly_tax_model', Path(__file__).with_name('model.py'))
model = None
if Path(spec.origin).exists():
    model = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(model)


def inputs():
    return dict(
        employees=[dict(Id=1, IDFORNECEDORORIGEM='101', CARGO='PEDREIRO I', STATUS='ATIVO',
                        EMPREITEIRO='SIM', VINCULO='CLT', DATAADMISSAO='2026-09-23', DATADESLIGAMENTO=None)],
        suppliers=[dict(Id=101, Title='PESSOA TESTE A', FILIAL='004 - FILIAL TESTE',
                        PROFISSAO='SERVIÇO TESTE', STATUS='ATIVO', EMPREITEIRO='SIM')],
        salaries=[dict(Id=1, CARGO='PEDREIRO I', SALARIO='3000', PREMIO='9999',
                       VALEALIMENTACAO='9999', VALETRANSPORTE='9999', DATAREFERENCIA='2026-09-01')],
        sheets=[dict(Id=10, FORNECEDOR='PESSOA TESTE A', MESREFERENCIA='09/2026')],
        rules=dict(version='TEST-2026', confirmed=True, base='SALARIO', validFrom='2026-01',
                   validThrough='2026-12', divisor=30, fgtsBps=800,
                   employeeBrackets=[dict(limitCents=200000, rateBps=750),
                                     dict(limitCents=400000, rateBps=900)],
                   employerComponents=[dict(code='TEST-PATRONAL', label='Empresa teste', rateBps=2000),
                                       dict(code='TEST-RAT', label='Risco teste', rateBps=300)],
                   employeeRounding='truncate', employerRounding='truncate'),
        execution_date=date(2026, 10, 1))


class MonthlyTaxModelTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(model, 'The monthly individual calculation is not implemented')

    def test_partial_admission_uses_only_salary_and_links_the_exact_person_month(self):
        result = model.plan_month(**inputs())
        self.assertEqual((result['competence'], result['dueDate']), ('2026-09', '2026-10-20'))
        row = result['rows'][0]
        self.assertEqual((row['supplierId'], row['sheetId'], row['profession']), (101, 10, 'SERVIÇO TESTE'))
        self.assertEqual((row['salaryCents'], row['days'], row['divisor'], row['baseCents']), (300000, 8, 30, 80000))
        self.assertEqual((row['components']['EMPREGADO'], row['components']['TEST-PATRONAL'], row['components']['TEST-RAT']), (6000, 16000, 2400))
        self.assertEqual((row['inssCents'], row['fgtsCents']), (24400, 6400))
        self.assertEqual(result['totals'], {'INSS': 24400, 'FGTS': 6400})

    def test_full_month_and_progressive_bands_are_not_one_flat_rate(self):
        args = inputs(); args['employees'][0]['DATAADMISSAO'] = '2026-01-01'
        row = model.plan_month(**args)['rows'][0]
        self.assertEqual((row['days'], row['baseCents']), (30, 300000))
        self.assertEqual(row['components']['EMPREGADO'], 24000)
        self.assertEqual((row['inssCents'], row['fgtsCents']), (93000, 24000))

    def test_month_and_year_rollover_uses_competence_not_current_clock(self):
        args = inputs(); args['execution_date'] = date(2027, 1, 1)
        args['employees'][0]['DATAADMISSAO'] = '2026-01-01'
        args['sheets'][0]['MESREFERENCIA'] = '12/2026'
        self.assertEqual((model.plan_month(**args)['competence'], model.plan_month(**args)['dueDate']), ('2026-12', '2027-01-20'))

    def test_admitted_later_inactive_terminated_and_noncontractors_do_not_qualify(self):
        for changes in [dict(DATAADMISSAO='2026-10-01'), dict(STATUS='INATIVO'),
                        dict(DATADESLIGAMENTO='2026-09-29'), dict(EMPREITEIRO='NÃO')]:
            args = inputs(); args['employees'][0].update(changes)
            with self.subTest(changes=changes):
                self.assertEqual(model.plan_month(**args)['rows'], [])

    def test_absent_wrong_person_wrong_month_and_duplicate_sheets_stop_the_batch(self):
        cases = [[], [dict(Id=10, FORNECEDOR='OUTRA PESSOA', MESREFERENCIA='09/2026')],
                 [dict(Id=10, FORNECEDOR='PESSOA TESTE A', MESREFERENCIA='10/2026')],
                 [dict(Id=10, FORNECEDOR='PESSOA TESTE A', MESREFERENCIA='09/2026'),
                  dict(Id=11, FORNECEDOR='PESSOA TESTE A', MESREFERENCIA='09/2026')]]
        for sheets in cases:
            args = inputs(); args['sheets'] = sheets
            with self.subTest(sheets=sheets), self.assertRaisesRegex(ValueError, 'folha'):
                model.plan_month(**args)

    def test_missing_or_non_clt_regime_blocks_instead_of_guessing_eligibility(self):
        for regime in (None, '', 'PJ', 'APRENDIZ'):
            args = inputs(); args['employees'][0]['VINCULO'] = regime
            with self.subTest(regime=regime), self.assertRaisesRegex(ValueError, 'CLT'):
                model.plan_month(**args)

    def test_missing_unconfirmed_expired_or_incomplete_rules_are_not_zero_rates(self):
        for change in [dict(confirmed=False), dict(base='SALARIO+PREMIO'), dict(validThrough='2026-08'),
                       dict(divisor=None), dict(employerComponents=[]), dict(employeeBrackets=[]),
                       dict(fgtsBps=None)]:
            args = inputs(); args['rules'].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                model.plan_month(**args)

    def test_missing_salary_duplicate_effective_salary_or_midmonth_change_is_not_guessed(self):
        for salaries in [[], [*inputs()['salaries'], *inputs()['salaries']],
                         [dict(Id=2, CARGO='PEDREIRO I', SALARIO='4000', DATAREFERENCIA='2026-09-26')]]:
            args = inputs(); args['salaries'] = salaries
            with self.subTest(salaries=salaries), self.assertRaisesRegex(ValueError, '(?i)sal.rio'):
                model.plan_month(**args)

    def test_employee_and_source_identity_branch_and_profession_must_be_unambiguous(self):
        for field in ['FILIAL', 'PROFISSAO', 'Title']:
            args = inputs(); args['suppliers'][0][field] = ''
            with self.subTest(field=field), self.assertRaises(ValueError): model.plan_month(**args)
        args = inputs(); args['employees'].append(deepcopy(args['employees'][0]))
        with self.assertRaises(ValueError): model.plan_month(**args)

    def test_fgts_is_truncated_by_person_not_rounded_or_computed_on_the_group(self):
        args = inputs(); args['salaries'][0]['SALARIO'] = '4933'
        row = model.plan_month(**args)['rows'][0]
        self.assertEqual((row['baseCents'], row['fgtsCents']), (131547, 10523))

    def test_progressive_contribution_truncates_each_band_before_summing(self):
        args = inputs(); args['employees'][0]['DATAADMISSAO'] = '2026-01-01'
        args['rules']['employeeBrackets'] = [dict(limitCents=162100, rateBps=750),
            dict(limitCents=290284, rateBps=900), dict(limitCents=435427, rateBps=1200),
            dict(limitCents=847555, rateBps=1400)]
        self.assertEqual(model.plan_month(**args)['rows'][0]['components']['EMPREGADO'], 24858)

    def test_calendar_proportion_preserves_full_month_and_counts_the_admission_day(self):
        args = inputs(); args['execution_date'] = date(2026, 11, 1)
        args['employees'][0]['DATAADMISSAO'] = '2026-10-19'
        args['sheets'][0]['MESREFERENCIA'] = '10/2026'
        args['rules']['divisor'] = 'calendar'
        row = model.plan_month(**args)['rows'][0]
        self.assertEqual((row['days'], row['divisor'], row['baseCents']), (13, 31, 125806))
        args['employees'][0]['DATAADMISSAO'] = '2026-10-01'
        self.assertEqual(model.plan_month(**args)['rows'][0]['baseCents'], 300000)

    def test_employer_components_totalize_by_branch_and_allocate_only_cent_remainders(self):
        args = inputs()
        args['rules']['employerComponents'] = [dict(code='TEST-S', label='Componente teste', rateBps=100)]
        args['employees'] = [] ; args['suppliers'] = []; args['salaries'] = []; args['sheets'] = []
        for index, salary in enumerate(['4101', '1963', '2517', '2711', '3159'], 1):
            args['employees'].append(dict(Id=index, IDFORNECEDORORIGEM=str(index), CARGO=f'CARGO {index}', STATUS='ATIVO',
                EMPREITEIRO='SIM', VINCULO='CLT', DATAADMISSAO='2026-09-23', DATADESLIGAMENTO=None))
            args['suppliers'].append(dict(Id=index, Title=f'PESSOA {index}', FILIAL='FILIAL TESTE', PROFISSAO='SERVIÇO', STATUS='ATIVO', EMPREITEIRO='SIM'))
            args['salaries'].append(dict(CARGO=f'CARGO {index}', SALARIO=salary, DATAREFERENCIA='2026-09-01'))
            args['sheets'].append(dict(Id=index, FORNECEDOR=f'PESSOA {index}', MESREFERENCIA='09/2026'))
        rows = model.plan_month(**args)['rows']
        self.assertEqual([row['components']['TEST-S'] for row in rows], [1094, 523, 671, 723, 842])
        self.assertEqual(sum(row['components']['TEST-S'] for row in rows), 3853)
        self.assertEqual(sum(row['fgtsCents'] for row in rows), 30826)

    def test_payroll_payload_uses_individual_provision_and_not_a_paid_launch(self):
        result = model.plan_month(**inputs()); row = result['rows'][0]
        parent = model.parent_fields(result, 'INSS')
        child = model.provision_fields(result, row, 'INSS', 200)
        payment = model.payroll_fields(result, row, 'INSS', 300)
        self.assertEqual((parent['VALORTOTAL'], child['VALORTOTAL'], payment['VALORUNITARIO']), ('244.00', '244.00', '244.00'))
        self.assertEqual((child['FORNECEDOR'], payment['FORNECEDOR']), ('PESSOA TESTE A', 'PESSOA TESTE A'))
        self.assertEqual((child['IDFOLHA'], payment['IDFOLHA'], payment['IDPROVISAO']), (10, '10', 300))
        self.assertEqual((child['DESCRITIVOPROVISAO'], child['PRODUTO'], child['QTD'], child['IMOVEL'], child['FORMAPGTO']), ('200', 'SERVIÇO TESTE', '1', 'TODOS', ''))
        self.assertEqual((payment['Title'], payment['TIPOPGTO']), ('APP-folha-provisao-300', 'INSS'))
        self.assertEqual(child['FOLHAOPERACAO'], 'ENCARGOS:2026-09:INSS:101')
        self.assertEqual(child['PGTOAGENDADO'], 'PENDENTE')
        self.assertNotIn('DATAPGTOEFETUADO', child)
        self.assertNotIn('IDLANCAMENTO', payment)


if __name__ == '__main__': unittest.main()
