from datetime import date
import importlib.util
from pathlib import Path
import unittest

PATH = Path(__file__).with_name('model.py')
model = None
if PATH.exists():
    spec = importlib.util.spec_from_file_location('swile_model_test', PATH)
    model = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(model)


def person(rid=1, sid='1001', name='PESSOA A', **extra):
    return {'Id': rid, 'IDFORNECEDORORIGEM': sid, 'Title': name,
            'FILIAL': '004 - OBRA TESTE', 'IMOVEL': 'TODOS', **extra}


class PlannerTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(model, 'RH weekly planner is not implemented')

    def test_two_upcoming_wednesdays_and_one_swile_parent_per_date(self):
        plans = model.plan_horizon([person(), person(2, '1002', 'PESSOA B'),
                                    person(3, '9009', 'PESSOA EXCLUIDA')], date(2026, 10, 26), [9009])
        self.assertEqual([p['dueDate'] for p in plans], ['2026-10-28', '2026-11-04'])
        self.assertEqual([p['key'] for p in plans], ['SWILE-RH:2026-10-28', 'SWILE-RH:2026-11-04'])
        for p in plans:
            self.assertEqual(p['total'], 450)
            self.assertEqual([r['supplierId'] for r in p['rows']], [1001, 1002])
            parent = model.parent_payload(p)
            self.assertEqual((parent['FORNECEDOR'], parent['VALORTOTAL']), ('SWILE', '0'))
            self.assertEqual(parent['Title'], p['key'] + '|PREPARANDO')
            self.assertEqual(parent['STATUS'], 'PAGAMENTO PREVISTO')

    def test_today_wednesday_and_fourteen_day_boundary_are_included(self):
        plans = model.plan_horizon([person()], date(2026, 10, 28), [])
        self.assertEqual([p['dueDate'] for p in plans], ['2026-10-28', '2026-11-04', '2026-11-11'])

    def test_year_rollover_is_by_calendar_date(self):
        plans = model.plan_horizon([person()], date(2026, 12, 28), [])
        self.assertEqual([p['dueDate'] for p in plans], ['2026-12-30', '2027-01-06'])

    def test_rh_membership_not_legacy_role_drives_eligibility(self):
        plans = model.plan_horizon([person(CARGO='', EMPREITEIRO='NÃO')], date(2026, 10, 26), [])
        self.assertEqual(plans[0]['rows'][0]['supplierId'], 1001)

    def test_child_uses_origin_identity_and_rh_location_with_exact_225_total(self):
        p = model.plan_horizon([person(rid=77, IMOVEL='TORRE B')], date(2026, 10, 26), [9009])[0]
        row = model.child_payload(p, p['rows'][0], 808)
        self.assertEqual(row['FOLHAOPERACAO'], 'SWILE-RH:2026-10-28:1001')
        self.assertEqual(row['DESCRITIVOPROVISAO'], '808')
        self.assertEqual((row['FORNECEDOR'], row['FILIAL'], row['IMOVEL']), ('PESSOA A', '004 - OBRA TESTE', 'TORRE B'))
        self.assertEqual((row['QTD'], row['VALORTOTAL'], row['FRETE']), ('5', '45', '0'))
        self.assertEqual((row['DATA'], row['DATAPREVISTOPGTO']), ('2026-10-26T12:00:00Z', '2026-10-28T12:00:00Z'))
        self.assertEqual(row['PGTOAGENDADO'], 'PENDENTE')
        self.assertEqual(row['OBS'], 'VALE ALIMENTAÇÃO')
        for forbidden in ['DATAPGTOEFETUADO', 'IDLANCAMENTOS', 'IDPEDIDO', 'IDRECORRENCIA', 'IDFOLHA']:
            self.assertNotIn(forbidden, row)

    def test_missing_or_ambiguous_rh_identity_fails_before_any_payload(self):
        cases = [[person(sid='')], [person(sid='0')], [person(sid='1.5')],
                 [person(FILIAL='')], [person(name='')],
                 [person(), person(2, '1001', 'PESSOA B')],
                 [person(), person(2, '1002', 'PESSOA A')]]
        for rows in cases:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                model.plan_horizon(rows, date(2026, 10, 26), [])

    def test_no_recipients_means_no_empty_financial_group(self):
        self.assertEqual(model.plan_horizon([person(sid='9009')], date(2026, 10, 26), [9009]), [])

    def test_keys_do_not_change_when_the_rh_row_id_or_creation_day_changes(self):
        a = model.plan_horizon([person(rid=1)], date(2026, 10, 26), [])[0]
        b = model.plan_horizon([person(rid=88)], date(2026, 10, 27), [])[0]
        self.assertEqual(model.child_payload(a, a['rows'][0], 3)['FOLHAOPERACAO'], 'SWILE-RH:2026-10-28:1001')
        self.assertEqual(model.child_payload(b, b['rows'][0], 3)['FOLHAOPERACAO'], 'SWILE-RH:2026-10-28:1001')

    def test_cleanup_selects_exact_unpaid_origin_and_only_exclusive_parents(self):
        rows = [
            {'Id': 10, 'IDRECORRENCIA': '36', 'STATUS': 'PAGAMENTO PREVISTO', 'DESCRITIVOPROVISAO': '90'},
            {'Id': 11, 'IDRECORRENCIA': '36', 'STATUS': 'PENDENTE', 'DESCRITIVOPROVISAO': '91'},
            {'Id': 12, 'IDRECORRENCIA': '136', 'STATUS': 'PENDENTE', 'DESCRITIVOPROVISAO': '91'},
            {'Id': 13, 'IDRECORRENCIA': '36', 'STATUS': 'PENDENTE', 'DATAPGTOEFETUADO': '2026-10-21', 'DESCRITIVOPROVISAO': '92'},
            {'Id': 14, 'IDRECORRENCIA': '36', 'STATUS': 'PAGO', 'DESCRITIVOPROVISAO': '93'},
            {'Id': 15, 'IDRECORRENCIA': '36', 'STATUS': 'PENDENTE', 'PGTOAGENDADO': 'AGENDADO', 'DESCRITIVOPROVISAO': '94'},
            {'Id': 16, 'IDRECORRENCIA': '36', 'STATUS': 'PENDENTE', 'IDLANCAMENTOS': '777', 'DESCRITIVOPROVISAO': '95'},
        ]
        parents = [{'Id': i, 'Attachments': False} for i in range(90, 96)]
        result = model.legacy_targets(rows, parents, 36)
        self.assertEqual(result['provisionIds'], [10, 11])
        self.assertEqual(result['parentIds'], [90])

    def test_cleanup_retains_documents_and_parent_with_any_retained_child(self):
        rows = [{'Id': 1, 'IDRECORRENCIA': '36', 'STATUS': 'PENDENTE', 'DESCRITIVOPROVISAO': '99'}]
        self.assertEqual(model.legacy_targets(rows, [{'Id': 99, 'Attachments': True}], 36)['parentIds'], [])
        rows.append({'Id': 2, 'IDRECORRENCIA': '36', 'STATUS': 'PAGO', 'DESCRITIVOPROVISAO': '99'})
        self.assertEqual(model.legacy_targets(rows, [{'Id': 99, 'Attachments': False}], 36)['parentIds'], [])

    def test_cleanup_retains_parent_with_scheduling_order_or_payment_evidence(self):
        rows = [{'Id': 1, 'IDRECORRENCIA': '36', 'STATUS': 'PENDENTE', 'DESCRITIVOPROVISAO': '99'}]
        for evidence in [{'PGTOAGENDADO': 'AGENDADO'}, {'IDPEDIDO': '7'},
                         {'IDLANCAMENTOS': '8'}, {'DATAPGTOEFETUADO': '2026-10-21'}]:
            with self.subTest(evidence=evidence):
                self.assertEqual(model.legacy_targets(rows, [{'Id': 99, 'Attachments': False, **evidence}], 36)['parentIds'], [])

    def test_scheduling_dates_preserve_children_and_legacy_parents(self):
        for field in ['DATAPGTOAGENDADO', 'DATAEXECUCAOAGENDAMENTO']:
            child = {'Id': 1, 'IDRECORRENCIA': '36', 'STATUS': 'PENDENTE',
                     'PGTOAGENDADO': 'PENDENTE', 'DESCRITIVOPROVISAO': '99'}
            with self.subTest(field=field):
                self.assertFalse(model.unpaid({**child, field: '2026-10-28'}))
                self.assertEqual(model.legacy_targets([{**child, field: '2026-10-28'}], [{'Id': 99}], 36)['provisionIds'], [])
                self.assertEqual(model.legacy_targets([child], [{'Id': 99, field: '2026-10-28'}], 36)['parentIds'], [])


if __name__ == '__main__':
    unittest.main()
