from copy import deepcopy
from datetime import date
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


def load(name):
    path = Path(__file__).with_name(name + '.py')
    if not path.exists():
        return None
    spec = importlib.util.spec_from_file_location('swile_test_' + name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


model, engine = load('model'), load('reconcile')
PARENT, CHILD, LEGACY = 'DESCRITIVOPROVISAO', 'PROVISÃO PGTOS', 'DESPESASRECORRENTES'


class Store:
    """Only the remote boundary is synthetic; uniqueness and ETags are real constraints here."""
    def __init__(self):
        self.data = {PARENT: {}, CHILD: {}, LEGACY: {}}
        self.next_id = 100
        self.writes = []
        self.lose_create_response = False
        self.reject_create_before_commit = False
        self.before_mutation = None
        self.unique = True

    def all_rows(self, title):
        return deepcopy(list(self.data[title].values()))

    def find(self, title, field, value):
        return [r for r in self.all_rows(title) if str(r.get(field, '')).casefold() == str(value).casefold()]

    def read(self, title, item_id):
        return deepcopy(self.data[title].get(int(item_id)))

    def require_unique(self, title, field):
        if not self.unique or title not in (PARENT, CHILD) or field != 'FOLHAOPERACAO':
            raise ValueError('Unique index unavailable')

    def create(self, title, fields):
        self.writes.append(('create', title, deepcopy(fields)))
        if self.reject_create_before_commit:
            self.reject_create_before_commit = False
            raise TimeoutError('Request outcome uncertain before commit')
        if self.find(title, 'FOLHAOPERACAO', fields['FOLHAOPERACAO']):
            raise ValueError('Duplicate unique key')
        self.next_id += 1
        row = dict(deepcopy(fields), Id=self.next_id, audit_etag='"1"')
        self.data[title][row['Id']] = row
        if self.lose_create_response:
            self.lose_create_response = False
            raise TimeoutError('Committed response lost')
        return deepcopy(row)

    def patch(self, title, item_id, fields, etag):
        if self.before_mutation:
            self.before_mutation('patch', title, item_id)
        row = self.data[title][int(item_id)]
        if row['audit_etag'] != etag:
            raise ValueError('ETag conflict')
        self.writes.append(('patch', title, item_id, deepcopy(fields)))
        row.update(deepcopy(fields))
        row['audit_etag'] = '"' + str(int(etag.strip('"')) + 1) + '"'
        return deepcopy(row)

    def delete(self, title, item_id, etag):
        if self.before_mutation:
            self.before_mutation('delete', title, item_id)
        row = self.data[title][int(item_id)]
        if row['audit_etag'] != etag:
            raise ValueError('ETag conflict')
        self.writes.append(('delete', title, item_id))
        del self.data[title][int(item_id)]


def people(count=6):
    return [{'Id': i, 'IDFORNECEDORORIGEM': str(1000 + i), 'Title': 'PESSOA ' + str(i),
             'FILIAL': '004 - OBRA TESTE', 'IMOVEL': 'TODOS'} for i in range(1, count + 1)]


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(engine, 'Reconciler is not implemented')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.store = Store()
        self.plans = model.plan_horizon(people(), date(2026, 10, 26), [9009])

    def run_plan(self, plans=None):
        return engine.reconcile(self.store, self.plans if plans is None else plans,
                                engine.JsonJournal(self.path / 'journal.json'))

    def test_first_run_creates_twelve_correct_children_and_two_1350_swile_groups(self):
        result = self.run_plan()
        self.assertEqual([r['status'] for r in result], ['confirmed', 'confirmed'])
        parents, children = self.store.all_rows(PARENT), self.store.all_rows(CHILD)
        self.assertEqual(len(parents), 2)
        self.assertEqual(len(children), 12)
        self.assertEqual([p['VALORTOTAL'] for p in parents], ['1350', '1350'])
        for p in parents:
            self.assertEqual(p['Title'], p['FOLHAOPERACAO'])
            self.assertEqual(p['FORNECEDOR'], 'SWILE')
            linked = [c for c in children if c['DESCRITIVOPROVISAO'] == str(p['Id'])]
            self.assertEqual(len(linked), 6)
            self.assertEqual({c['FORNECEDOR'] for c in linked}, {'PESSOA 1', 'PESSOA 2', 'PESSOA 3', 'PESSOA 4', 'PESSOA 5', 'PESSOA 6'})
            self.assertEqual({(c['QTD'], c['VALORTOTAL']) for c in linked}, {('5', '45')})

    def test_repeat_and_next_day_repeat_make_no_writes_or_duplicate_rows(self):
        first = self.run_plan()
        self.store.writes.clear()
        second = self.run_plan(model.plan_horizon(people(), date(2026, 10, 27), [9009]))
        self.assertEqual([x['parentId'] for x in first], [x['parentId'] for x in second])
        self.assertEqual(self.store.writes, [])
        self.assertEqual(len(self.store.all_rows(CHILD)), 12)

    def test_new_rh_recipient_is_added_once_to_each_open_week_with_correct_totals(self):
        self.run_plan()
        self.store.writes.clear()
        self.run_plan(model.plan_horizon(people(7), date(2026, 10, 27), [9009]))
        self.assertEqual(len(self.store.all_rows(CHILD)), 14)
        self.assertEqual([p['VALORTOTAL'] for p in self.store.all_rows(PARENT)], ['1575', '1575'])
        self.assertEqual(len([w for w in self.store.writes if w[:2] == ('create', CHILD)]), 2)

    def test_lost_create_response_is_recovered_by_key_without_a_second_post(self):
        self.store.lose_create_response = True
        self.run_plan()
        self.assertEqual(len(self.store.all_rows(CHILD)), 12)
        self.assertEqual(len([w for w in self.store.writes if w[:2] == ('create', PARENT)]), 2)

    def test_uncertain_create_without_confirmation_is_not_blindly_repeated(self):
        self.store.reject_create_before_commit = True
        with self.assertRaises(engine.ReconciliationError):
            self.run_plan()
        before = deepcopy(self.store.writes)
        with self.assertRaises(engine.ReconciliationError):
            self.run_plan()
        self.assertEqual(self.store.writes, before)
        self.assertEqual(self.store.all_rows(PARENT), [])

    def test_paid_week_is_preserved_while_a_later_missing_week_is_created(self):
        self.run_plan([self.plans[0]])
        first = next(iter(self.store.data[PARENT].values()))
        first['STATUS'] = 'PAGO'
        first['DATAPGTOEFETUADO'] = '2026-10-26'
        snapshot = deepcopy(first)
        self.store.writes.clear()
        result = self.run_plan()
        self.assertEqual(result[0]['status'], 'preserved')
        self.assertEqual(self.store.read(PARENT, first['Id']), snapshot)
        self.assertEqual(len(self.store.all_rows(CHILD)), 12)

    def test_manual_child_changes_are_preserved_and_do_not_block_later_weeks(self):
        self.run_plan([self.plans[0]])
        child = next(iter(self.store.data[CHILD].values()))
        child['VALORTOTAL'] = '40'
        snapshot = deepcopy(self.store.data)
        result = self.run_plan()
        self.assertEqual(result[0]['status'], 'preserved')
        self.assertEqual(self.store.read(CHILD, child['Id']), snapshot[CHILD][child['Id']])
        self.assertEqual(len(self.store.all_rows(CHILD)), 12)

    def test_missing_unique_index_prevents_all_financial_writes(self):
        self.store.unique = False
        with self.assertRaises(ValueError):
            self.run_plan()
        self.assertEqual(self.store.writes, [])

    def test_manual_account_or_observation_on_either_level_preserves_the_week(self):
        for title in [PARENT, CHILD]:
            for field, value in [('FORMAPGTO', 'PIX'), ('OBS', 'OBSERVAÇÃO MANUAL')]:
                with self.subTest(title=title, field=field):
                    self.store = Store()
                    journal_path = self.path / (str(len(list(self.path.iterdir()))) + '.json')
                    engine.reconcile(self.store, [self.plans[0]], engine.JsonJournal(journal_path))
                    row = next(iter(self.store.data[title].values()))
                    row[field] = value
                    snapshot = deepcopy(self.store.data)
                    self.store.writes.clear()
                    result = engine.reconcile(self.store, model.plan_horizon(people(7), date(2026, 10, 26), [])[:1],
                                              engine.JsonJournal(journal_path))
                    self.assertEqual(result[0]['status'], 'preserved')
                    self.assertEqual(self.store.writes, [])
                    self.assertEqual(self.store.data, snapshot)

    def test_existing_backup_cannot_authorize_deleting_a_later_edited_version(self):
        self.store.data[LEGACY][36] = {'Id': 36, 'FORNECEDOR': 'SWILE', 'EQUIPAMENTO': 'VALE ALIMENTAÇÃO', 'STATUS': 'ATIVO', 'audit_etag': '"1"'}
        self.store.data[PARENT][90] = {'Id': 90, 'Attachments': False, 'audit_etag': '"1"'}
        self.store.data[CHILD][10] = {'Id': 10, 'IDRECORRENCIA': '36', 'STATUS': 'PENDENTE', 'DESCRITIVOPROVISAO': '90',
                                           'QTD': '5', 'audit_etag': '"1"'}
        backup = self.path / 'before.json'
        def concurrent_edit(method, title, item_id):
            if method == 'delete' and title == CHILD:
                self.store.data[CHILD][10].update(QTD='6', audit_etag='"2"')
        self.store.before_mutation = concurrent_edit
        with self.assertRaises(engine.ReconciliationError):
            engine.retire_legacy(self.store, 36, backup)
        self.store.before_mutation = None
        before = deepcopy(self.store.data)
        with self.assertRaises(engine.ReconciliationError):
            engine.retire_legacy(self.store, 36, backup)
        self.assertEqual(self.store.data, before)
        self.assertEqual(json.loads(backup.read_text())['provisions'][0]['QTD'], '5')

    def test_cleanup_retry_finishes_an_empty_parent_backed_up_before_child_deletion(self):
        self.store.data[LEGACY][36] = {'Id': 36, 'FORNECEDOR': 'SWILE', 'EQUIPAMENTO': 'VALE ALIMENTAÇÃO', 'STATUS': 'ATIVO', 'audit_etag': '"1"'}
        self.store.data[PARENT][90] = {'Id': 90, 'Attachments': False, 'audit_etag': '"1"'}
        self.store.data[CHILD][10] = {'Id': 10, 'IDRECORRENCIA': '36', 'STATUS': 'PENDENTE', 'DESCRITIVOPROVISAO': '90', 'audit_etag': '"1"'}
        backup = self.path / 'before.json'
        def interruption(method, title, item_id):
            if method == 'delete' and title == PARENT:
                raise TimeoutError('Interrupted before parent delete')
        self.store.before_mutation = interruption
        with self.assertRaises(engine.ReconciliationError):
            engine.retire_legacy(self.store, 36, backup)
        self.assertIsNone(self.store.read(CHILD, 10))
        self.store.before_mutation = None
        result = engine.retire_legacy(self.store, 36, backup)
        self.assertEqual(result['deletedParentIds'], [90])
        self.assertIsNone(self.store.read(PARENT, 90))

    def test_cleanup_retry_cannot_inactivate_an_unbacked_recurrence_version(self):
        self.store.data[LEGACY][36] = {'Id': 36, 'FORNECEDOR': 'SWILE', 'EQUIPAMENTO': 'VALE ALIMENTAÇÃO',
                                     'STATUS': 'ATIVO', 'OBS': 'ORIGINAL', 'audit_etag': '"1"'}
        backup = self.path / 'before.json'
        def concurrent_edit(method, title, item_id):
            if method == 'patch' and title == LEGACY:
                self.store.data[LEGACY][36].update(OBS='EDIÇÃO', audit_etag='"2"')
        self.store.before_mutation = concurrent_edit
        with self.assertRaises(engine.ReconciliationError):
            engine.retire_legacy(self.store, 36, backup)
        self.store.before_mutation = None
        before = deepcopy(self.store.data)
        with self.assertRaises(engine.ReconciliationError):
            engine.retire_legacy(self.store, 36, backup)
        self.assertEqual(self.store.data, before)
        self.assertEqual(json.loads(backup.read_text())['recurrence']['OBS'], 'ORIGINAL')

    def test_a_payment_racing_with_group_preparation_prevents_new_children(self):
        self.run_plan([self.plans[0]])
        pid = next(iter(self.store.data[PARENT]))
        def race(method, title, item_id):
            if title == PARENT and method == 'patch':
                self.store.data[PARENT][pid].update(STATUS='PAGO', audit_etag='"999"')
        self.store.before_mutation = race
        self.store.writes.clear()
        with self.assertRaises(engine.ReconciliationError):
            self.run_plan(model.plan_horizon(people(7), date(2026, 10, 26), [9009]))
        self.assertEqual(len(self.store.all_rows(CHILD)), 6)
        self.assertEqual(self.store.read(PARENT, pid)['STATUS'], 'PAGO')

    def test_legacy_backup_precedes_retirement_and_paid_and_unrelated_rows_survive(self):
        self.store.data[LEGACY][36] = {'Id': 36, 'FORNECEDOR': 'SWILE', 'EQUIPAMENTO': 'VALE ALIMENTAÇÃO', 'STATUS': 'ATIVO', 'audit_etag': '"1"'}
        self.store.data[PARENT][90] = {'Id': 90, 'FORNECEDOR': 'SWILE', 'Attachments': False, 'audit_etag': '"1"'}
        self.store.data[CHILD] = {
            10: {'Id': 10, 'IDRECORRENCIA': '36', 'STATUS': 'PAGAMENTO PREVISTO', 'DESCRITIVOPROVISAO': '90', 'audit_etag': '"1"'},
            11: {'Id': 11, 'IDRECORRENCIA': '36', 'STATUS': 'PAGO', 'DATAPGTOEFETUADO': '2026-10-21', 'audit_etag': '"1"'},
            12: {'Id': 12, 'IDRECORRENCIA': '136', 'STATUS': 'PENDENTE', 'audit_etag': '"1"'},
        }
        preserved = [self.store.read(CHILD, 11), self.store.read(CHILD, 12)]
        backup = self.path / 'before.json'
        def check_backup(*args):
            self.assertTrue(backup.exists())
            self.assertEqual(json.loads(backup.read_text())['recurrence']['STATUS'], 'ATIVO')
        self.store.before_mutation = check_backup
        result = engine.retire_legacy(self.store, 36, backup)
        self.assertEqual(result['deletedProvisionIds'], [10])
        self.assertEqual(result['deletedParentIds'], [90])
        self.assertEqual(self.store.read(LEGACY, 36)['STATUS'], 'INATIVO')
        self.assertEqual([self.store.read(CHILD, 11), self.store.read(CHILD, 12)], preserved)


if __name__ == '__main__':
    unittest.main()
