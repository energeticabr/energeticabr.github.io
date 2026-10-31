"""Parent due dates: real worker methods with synthetic records only."""
import copy
from datetime import date
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, unquote, urlsplit
from requests import HTTPError, Response

PATCHES = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PATCHES / 'multi-provision-first-freight/tests'))
import test_first_freight as fixture
import payment_provision_group as money
from provision_parent_choice import PARENT_FIELDS, read_parent
from provision_description_settlement import PARENT_FIELDS as SETTLEMENT_PARENT_FIELDS
import provision_description_query as query


class PagedRest:
    """Real query adapter, with the earliest existing child on page two."""
    site_url = 'https://synthetic.invalid/sites/fixture'

    def __init__(self, catalog, *, fail_next=False):
        self.catalog, self.fail_next, self.pages = catalog, fail_next, []
        self.schemas = {query.PARENT_LIST: {'Id', *PARENT_FIELDS},
                        query.CHILD_LIST: set(query.CHILD_FIELDS)}

    @staticmethod
    def _internal_field(kind, field):
        return field

    def _list_endpoint(self, kind):
        return self.site_url + "/_api/web/lists/getbytitle('" + kind + "')"

    @staticmethod
    def _values(payload):
        return payload['value']

    def _request(self, method, endpoint, params=None):
        assert method == 'GET'
        path = unquote(urlsplit(endpoint).path)
        kind = next(name for name in self.schemas if "getbytitle('" + name + "')" in path)
        if path.endswith('/fields'):
            return {'value': [{'Title': field, 'InternalName': field} for field in self.schemas[kind]]}
        rows = [{'Id': ident, **{field: record['fields'].get(field) for field in self.schemas[kind] if field != 'Id'}}
                for (target, ident), record in sorted(self.catalog.rows.items()) if target == kind]
        if '/items(' in path:
            return rows[0]
        if kind == query.PARENT_LIST:
            return {'value': rows}
        page = int(parse_qs(urlsplit(endpoint).query).get('page', ['1'])[0])
        self.pages.append(page)
        if page > 1 and self.fail_next:
            raise RuntimeError('Synthetic unavailable child page')
        result = {'value': rows[(page - 1) * 2:page * 2]}
        if len(rows) > page * 2:
            result['@odata.nextLink'] = self._list_endpoint(kind) + '/items?page=' + str(page + 1)
        return result


class Catalog(fixture.Catalog):
    aliases = {'DATA PREVISTO PGTO': 'DATAPREVISTOPGTO', 'DATA PGTO EFETUADO': 'DATAPGTOEFETUADO'}

    def __init__(self):
        super().__init__()
        self.updates = []
        self.after_parent_update = None
        self.lose_parent_response = False
        self.incomplete = False
        self.fail_verification = False
        self.parent_attempts = 0
        self.conflict_on_parent_attempt = None

    def get_item_fields_with_etag(self, item_id, fields, *, target_list):
        row = self.rows[target_list, int(item_id)]
        return {key: row['fields'].get(self.aliases.get(key, key) if target_list == 'DESCRITIVOPROVISAO' else key)
                for key in fields}, str(row['version'])

    def update_item_with_etag(self, item_id, fields, etag, *, target_list):
        if target_list == 'DESCRITIVOPROVISAO':
            self.parent_attempts += 1
            if self.parent_attempts == self.conflict_on_parent_attempt:
                self.rows[target_list, int(item_id)]['version'] += 1
                response = Response()
                response.status_code = 412
                raise HTTPError('Synthetic parent ETag race', response=response)
        actual = {self.aliases.get(key, key) if target_list == 'DESCRITIVOPROVISAO' else key: value
                  for key, value in fields.items()}
        super().update_item_with_etag(item_id, actual, etag, target_list=target_list)
        self.updates.append((target_list, int(item_id), copy.deepcopy(actual)))
        if target_list == 'DESCRITIVOPROVISAO':
            callback, self.after_parent_update = self.after_parent_update, None
            if callback:
                callback()
            if self.lose_parent_response:
                self.lose_parent_response = False
                raise RuntimeError('Synthetic lost parent due response')

    def update_item(self, item_id, fields, *, target_list):
        version = str(self.rows[target_list, int(item_id)]['version'])
        self.update_item_with_etag(item_id, fields, version, target_list=target_list)

    def verify_item(self, item_id, fields, names, *, target_list):
        if self.fail_verification and target_list == 'PROVISÃO PGTOS':
            raise RuntimeError('Synthetic child verification failure')
        actual, _ = self.get_item_fields_with_etag(item_id, fields, target_list=target_list)
        if actual != fields or names:
            raise AssertionError('Unexpected synthetic persisted payload')
        return {'fields': True, 'attachments': True}

    def get_provision_description(self, parent, **kwargs):
        children = [{'Id': ident, **copy.deepcopy(record['fields'])}
                    for (target, ident), record in self.rows.items()
                    if target == 'PROVISÃO PGTOS' and record['fields'].get('DESCRITIVOPROVISAO') == str(parent)]
        fields, _ = self.get_item_fields_with_etag(parent, SETTLEMENT_PARENT_FIELDS,
                                                   target_list='DESCRITIVOPROVISAO')
        return {'Id': int(parent), **fields, 'CHILDREN': children, 'complete': not self.incomplete}


class ParentDueTests(unittest.TestCase):
    def setUp(self):
        self.f = fixture.FirstFreightTests()
        self.f.setUp()
        self.engine, self.state = self.f.engine, self.f.state
        self.catalog = Catalog()
        self.engine.sharepoint = self.catalog

    @staticmethod
    def child(ident, due, *, paid=False):
        fields = fixture.line(quantity='1', unit='10', freight='0')['fields']
        fields.update(DESCRITIVOPROVISAO='50', STATUS='PAGAMENTO PREVISTO', PGTOAGENDADO='PENDENTE',
                      FORMAPGTO='PIX', IDPEDIDO=None, IDLANCAMENTOS=None,
                      **{'DATA PREVISTO PGTO': due, 'DATA PGTO EFETUADO': None})
        if paid:
            fields.update(PGTOAGENDADO='PAGO', **{'DATA PGTO EFETUADO': '2026-10-31'})
        return {'Id': ident, **fields}

    def seed(self, children=None, *, due='2026-11-09'):
        children = children or [self.child(11, '2026-11-09'), self.child(12, '2026-11-23'), self.child(13, '2026-12-22')]
        parent = dict.fromkeys(PARENT_FIELDS)
        parent.update(FORNECEDOR='FORNECEDOR QA', FILIAL='004 - OBRA QA', DATAPREVISTOPGTO=due,
                      VALORTOTAL=str(10 * len(children)))
        self.catalog.rows['DESCRITIVOPROVISAO', 50] = {'fields': parent, 'version': 1}
        for child in children:
            self.catalog.rows['PROVISÃO PGTOS', child['Id']] = {
                'fields': {key: value for key, value in child.items() if key != 'Id'}, 'version': 1}
        return children

    def due(self):
        return self.catalog.rows['DESCRITIVOPROVISAO', 50]['fields']['DATAPREVISTOPGTO']

    def creation(self, dates, *, append=False):
        lines = [fixture.line(quantity='1', unit='10', freight='0') for _ in dates]
        for line, due in zip(lines, dates):
            line['fields']['DATA PREVISTO PGTO'] = due
        self.state.update(copy.deepcopy(lines[-1]))
        self.state.update(provision_lines=lines, provision_current_saved=True,
                          provision_composition_complete=True, attachments=[],
                          provision_discount={'enabled': False, 'decision_complete': True, 'amount': '0'},
                          provision_parent_mode='EXISTING' if append else 'NEW')
        if append:
            self.state['provision_parent_selection'] = read_parent(self.catalog, 50)
        return self.engine._persist_provision_group(self.state, self.f.etag(), self.engine._flow_config(self.state))

    def finalize(self, paid_ids):
        original = self.catalog.get_provision_description(50)['CHILDREN']
        common = {'DATA PGTO EFETUADO': '2026-10-31', 'FORMAPGTO': 'PIX', 'OBS': ''}
        journal = {'parent': {'item_id': 50}, 'children': {}}
        for ident in paid_ids:
            row = self.catalog.rows['PROVISÃO PGTOS', ident]['fields']
            row.update(PGTOAGENDADO='PAGO', **{'DATA PGTO EFETUADO': common['DATA PGTO EFETUADO']})
            journal['children'][str(ident)] = {'expected_fields': {
                'PGTOAGENDADO': 'PAGO', 'DATA PGTO EFETUADO': common['DATA PGTO EFETUADO']}}
        self.state['provision_description'] = {'parent_id': '50', 'original_children': original,
            'children': [row for row in original if row['Id'] in paid_ids], 'entries': [],
            'parent': self.catalog.get_provision_description(50), 'common': common, 'journal': journal}
        expected = {**common, 'DATA PGTO EFETUADO': None}
        # The real grouped commit has already persisted/verified these common
        # parent fields before invoking its finalizer.
        self.catalog.rows['DESCRITIVOPROVISAO', 50]['fields'].update(
            FORMAPGTO='PIX', OBS='', DATAPGTOEFETUADO=None)
        return self.engine._description_finalize_parent(self.state, lambda: None, expected, [])

    def test_creation_parent_due_is_earliest_not_first_line(self):
        self.creation(['2026-12-22', '2026-11-09', '2026-11-23'])
        parent = next(row['fields'] for (target, _), row in self.catalog.rows.items() if target == 'DESCRITIVOPROVISAO')
        self.assertEqual(parent['DATAPREVISTOPGTO'], '2026-11-09')
        self.assertEqual(parent['VALORTOTAL'], '30')

    def test_append_recomputes_across_existing_and_new_children(self):
        for old, new, expected in [('2026-12-22', '2026-11-09', '2026-11-09'),
                                   ('2026-11-09', '2026-12-22', '2026-11-09')]:
            with self.subTest(old=old, new=new):
                self.setUp()
                self.seed([self.child(11, old)], due=old)
                self.creation([new], append=True)
                self.assertEqual(self.due(), expected)
                self.assertEqual(self.catalog.rows['DESCRITIVOPROVISAO', 50]['fields']['VALORTOTAL'], '20')

    def test_append_lost_parent_response_retries_own_due_change_without_duplicate_children(self):
        self.seed([self.child(11, '2026-12-22')], due='2026-12-22')
        self.catalog.lose_parent_response = True
        with self.assertRaisesRegex(RuntimeError, 'lost parent due'):
            self.creation(['2026-11-09'], append=True)
        self.engine._persist_provision_group(self.state, self.f.etag(), self.engine._flow_config(self.state))
        self.assertEqual(self.due(), '2026-11-09')
        self.assertEqual(len(self.catalog.creates), 1)

    def test_partial_first_middle_last_and_out_of_order_choose_remaining_minimum(self):
        for ids, expected in [([11], '2026-11-23'), ([12], '2026-11-09'),
                              ([13], '2026-11-09'), ([12, 11], '2026-12-22')]:
            with self.subTest(ids=ids):
                self.setUp()
                self.seed()
                self.finalize(ids)
                self.assertEqual(self.due(), expected)
                self.assertIsNone(self.catalog.rows['DESCRITIVOPROVISAO', 50]['fields']['DATAPGTOEFETUADO'])

    def test_ties_and_all_paid_preserve_existing_historical_due_and_paid_date_contract(self):
        self.seed([self.child(11, '2026-11-09'), self.child(12, '2026-11-09')])
        self.finalize([11])
        self.assertEqual(self.due(), '2026-11-09')
        self.finalize([12])
        self.assertEqual(self.due(), '2026-11-09')
        self.assertEqual(self.catalog.rows['DESCRITIVOPROVISAO', 50]['fields']['DATAPGTOEFETUADO'], '2026-10-31')

    def test_not_proven_paid_still_counts_even_when_not_selectable_for_settlement(self):
        rows = [self.child(11, '2026-11-09'), self.child(12, '2026-11-01'), self.child(13, '2026-12-22')]
        rows[1].update(**{'DATA PGTO EFETUADO': '2027-03-01'}, PGTOAGENDADO='PENDENTE')
        self.seed(rows)
        self.finalize([11])
        self.assertEqual(self.due(), '2026-11-01')

    def test_invalid_unpaid_due_fails_closed_without_parent_update(self):
        for raw in [None, '', '31/02/2026', 'not-a-date']:
            with self.subTest(raw=raw):
                self.setUp()
                self.seed([self.child(11, '2026-11-09'), self.child(12, raw)])
                with self.assertRaises((ValueError, RuntimeError)):
                    self.finalize([11])
                self.assertEqual(self.catalog.updates, [])

    def test_new_earlier_child_after_parent_cas_is_seen_without_parent_etag_change(self):
        self.seed()
        def insert():
            row = self.child(14, '2026-11-02')
            self.catalog.rows['PROVISÃO PGTOS', 14] = {'fields': {k: v for k, v in row.items() if k != 'Id'}, 'version': 1}
        self.catalog.after_parent_update = insert
        self.finalize([11])
        self.assertEqual(self.due(), '2026-11-02')
        self.assertIsNone(self.catalog.rows['DESCRITIVOPROVISAO', 50]['fields']['DATAPGTOEFETUADO'])

    def test_shared_helper_iso_br_date_only_overdue_and_payment_evidence(self):
        helper = getattr(money, 'earliest_unpaid_due', None)
        self.assertTrue(callable(helper), 'Provide the shared pure unpaid due-date rule')
        rows = [self.child(11, '2026-11-23T23:30:00-03:00'), self.child(12, '09/11/2026'),
                self.child(13, '2026-01-01', paid=True)]
        self.assertEqual(helper(rows), '2026-11-09')
        rows[1]['DATA PREVISTO PGTO'] = date(2025, 12, 1)
        rows[1]['PGTOAGENDADO'] = 'PENDENTE'
        self.assertEqual(helper(rows), '2025-12-01')
        rows[1].update(STATUS='DESCONHECIDO', PGTOAGENDADO='PAGO', **{'DATA PGTO EFETUADO': 'invalid'})
        self.assertEqual(helper(rows), '2025-12-01')
        alias = self.child(15, None)
        alias['DATAPREVISTOPGTO'] = '2025-11-01'
        self.assertEqual(helper([alias]), '2025-11-01')
        self.assertIsNone(helper([self.child(16, None, paid=True)]))

    def test_single_settlement_advances_due_only_after_verified_child_write(self):
        self.seed()
        self.state.update(flow='payment_settlement', fields={**self.child(11, '2026-11-09'),
            'ID PROVISÃO': '11', 'DATA PGTO EFETUADO': '2026-10-31', 'FORMAPGTO': 'PIX'},
            answers={'submeter_lancamentos': 'NÃO'}, attachments=[])
        self.engine._notify_completed = lambda state, etag: {'status': 'completed'}
        with patch('workflow.propagate_payroll_row_attachments', return_value={}):
            result = self.engine._commit_payment_settlement(self.state, self.f.etag(), self.engine._flow_config(self.state))
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(self.due(), '2026-11-23')

    def test_single_child_verification_failure_never_updates_parent(self):
        self.seed()
        self.catalog.fail_verification = True
        self.state.update(flow='payment_settlement', fields={**self.child(11, '2026-11-09'),
            'ID PROVISÃO': '11', 'DATA PGTO EFETUADO': '2026-10-31', 'FORMAPGTO': 'PIX'},
            answers={'submeter_lancamentos': 'NÃO'}, attachments=[])
        with patch('workflow.propagate_payroll_row_attachments', return_value={}):
            result = self.engine._commit_payment_settlement(self.state, self.f.etag(), self.engine._flow_config(self.state))
        self.assertEqual(result['status'], 'submission_failed')
        self.assertFalse(any(target == 'DESCRITIVOPROVISAO' for target, _, _ in self.catalog.updates))

    def test_complete_pagination_includes_earliest_child_beyond_first_page(self):
        self.seed([self.child(11, '2026-11-23'), self.child(12, '2026-12-22'), self.child(13, '2026-11-09')],
                  due='2026-12-22')
        rest = PagedRest(self.catalog)
        self.catalog.get_provision_description = query.ProvisionDescriptionQuery(rest).get_provision_description
        self.creation(['2026-12-30'], append=True)
        self.assertIn(2, rest.pages)
        self.assertEqual(self.due(), '2026-11-09')

    def test_unavailable_child_page_never_authorizes_partial_parent_due_update(self):
        self.seed([self.child(11, '2026-11-23'), self.child(12, '2026-12-22'), self.child(13, '2026-11-09')],
                  due='2026-12-22')
        rest = PagedRest(self.catalog, fail_next=True)
        self.catalog.get_provision_description = query.ProvisionDescriptionQuery(rest).get_provision_description
        with self.assertRaisesRegex(RuntimeError, 'unavailable child page'):
            self.creation(['2026-12-30'], append=True)
        self.assertEqual(self.due(), '2026-12-22')
        self.assertFalse(any(target == 'DESCRITIVOPROVISAO' for target, _, _ in self.catalog.updates))

    def test_single_settlement_rechecks_insertions_after_parent_cas(self):
        self.seed([self.child(11, '2026-11-09', paid=True), self.child(12, '2026-11-23')])
        def insert():
            row = self.child(13, '2026-11-02')
            self.catalog.rows['PROVISÃO PGTOS', 13] = {'fields': {k: v for k, v in row.items() if k != 'Id'}, 'version': 1}
        self.catalog.after_parent_update = insert
        helper = getattr(self.engine, '_provision_refresh_linked_parent_due', None)
        self.assertTrue(callable(helper))
        helper(11, 'PROVISÃO PGTOS')
        self.assertEqual(self.due(), '2026-11-02')

    def test_single_all_paid_preserves_historical_due_and_parent_payment_fields(self):
        self.seed([self.child(11, '2026-11-09', paid=True)])
        parent = self.catalog.rows['DESCRITIVOPROVISAO', 50]['fields']
        parent.update(DATAPGTOEFETUADO='2026-10-31', PGTOAGENDADO='2026-10-30T12:00:00Z')
        before = copy.deepcopy(parent)
        helper = getattr(self.engine, '_provision_refresh_linked_parent_due', None)
        self.assertTrue(callable(helper))
        helper(11, 'PROVISÃO PGTOS')
        self.assertEqual(parent, before)
        self.assertEqual(self.catalog.updates, [])

    def test_description_child_commit_does_not_reenter_parent_due_lock(self):
        self.seed()
        self.state.update(flow='payment_settlement', fields={**self.child(11, '2026-11-09'),
            'ID PROVISÃO': '11', 'DATA PGTO EFETUADO': '2026-10-31', 'FORMAPGTO': 'PIX'},
            answers={'submeter_lancamentos': 'NÃO'}, attachments=[],
            _description_child_commit=True, _description_child_etag='1')
        with patch('workflow.propagate_payroll_row_attachments', return_value={}), patch.object(
                self.engine, '_provision_refresh_linked_parent_due', side_effect=AssertionError('Parent lock re-entry')):
            record = self.engine._commit_payment_settlement(self.state, None, self.engine._flow_config(self.state))
        self.assertEqual(record['item_id'], 11)
        self.assertEqual(self.due(), '2026-11-09')

    def test_append_retries_cas_race_after_an_earlier_own_due_update(self):
        self.seed([self.child(11, '2026-12-22')], due='2026-12-22')
        def insert():
            row = self.child(12, '2026-10-31')
            self.catalog.rows['PROVISÃO PGTOS', 12] = {'fields': {k: v for k, v in row.items() if k != 'Id'}, 'version': 1}
        self.catalog.after_parent_update = insert
        self.catalog.conflict_on_parent_attempt = 2
        self.creation(['2026-11-09'], append=True)
        self.assertEqual(self.due(), '2026-10-31')
        self.assertEqual(len(self.catalog.creates), 1)
        self.assertTrue(self.state['provision_commit']['total_update']['verified'])

    def test_invalid_paid_date_with_valid_prefix_never_closes_partial_parent(self):
        rows = [self.child(11, '2026-11-09'), self.child(12, '2026-11-23')]
        rows[1].update(PGTOAGENDADO='PAGO', **{'DATA PGTO EFETUADO': '2026-10-31invalid'})
        self.seed(rows)
        self.finalize([11])
        self.assertEqual(self.due(), '2026-11-23')
        self.assertIsNone(self.catalog.rows['DESCRITIVOPROVISAO', 50]['fields']['DATAPGTOEFETUADO'])

    def test_grouped_incomplete_projection_never_authorizes_parent_due_write(self):
        self.seed()
        self.catalog.incomplete = True
        with self.assertRaisesRegex(RuntimeError, 'confirmar todos os vínculos'):
            self.finalize([11])
        self.assertEqual(self.catalog.updates, [])


if __name__ == '__main__':
    unittest.main()
