"""Order retry comparisons against real settlement code; all records synthetic."""
import copy
import importlib.util
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(os.environ.get('ENERGETICA_BACKEND_TEST_ROOT', '/opt/energetica-whatsapp'))
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT)]
source = Path(os.environ.get('SETTLEMENT_SOURCE', ROOT / 'worker/provision_description_settlement.py'))
spec = importlib.util.spec_from_file_location('settlement_dates_under_test', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
client_source = Path(os.environ.get('CLIENT_SOURCE', ROOT / 'worker/clients.py'))
client_spec = importlib.util.spec_from_file_location('client_dates_under_test', client_source)
client_module = importlib.util.module_from_spec(client_spec)
client_spec.loader.exec_module(client_module)


class OrderDates(unittest.TestCase):
    def setUp(self):
        self.engine = module.ProvisionDescriptionSettlement()
        row = {'Id': 11, 'ID PROVISÃO': '11', 'FILIAL': 'Filial ficticia',
               'FORNECEDOR': 'Fornecedor ficticio', 'QTD': '2', 'VALOR TOTAL': '10.5', 'FRETE': '0'}
        self.group = {'parent_id': '7', 'original_children': [copy.deepcopy(row)],
                      'entries': [{'fields': row}], 'parent': copy.deepcopy(row),
                      'common': {'DATA PGTO EFETUADO': '2026-11-03', 'FORMAPGTO': 'Conta ficticia', 'OBS': ''}}
        self.existing = None
        self.engine._description_existing_order = lambda group, token: copy.deepcopy(self.existing)

    def test_created_order_plan_matches_sharepoint_date_readback(self):
        before = self.engine._description_order_plan(self.group)
        live = copy.deepcopy(before[0]['fields'])
        live['DATA PEDIDO'] = '2026-11-03T03:00:00Z'
        live['OBS'] = None
        self.existing = {'item_id': 50, 'fields': live}
        self.assertEqual(before, self.engine._description_order_plan(self.group))

    def test_existing_order_keeps_original_calendar_date(self):
        live = self.engine._description_order_plan(self.group)[0]['fields']
        live['DATA PEDIDO'] = '2026-10-31T03:00:00Z'
        self.existing = {'item_id': 50, 'fields': live}
        self.assertEqual('2026-10-31', self.engine._description_order_plan(self.group)[0]['fields']['DATA PEDIDO'])

    def test_order_date_compares_calendar_date(self):
        self.assertTrue(module._same('DATA PEDIDO', '2026-11-03', '2026-11-03T03:00:00Z'))

    def test_existing_frozen_iso_order_intent_stays_resumable(self):
        plan = self.engine._description_order_plan(self.group)
        plan[0]['fields']['DATA PEDIDO'] = '2026-11-03T03:00:00Z'
        self.group['journal'] = {'order_plan': copy.deepcopy(plan),
            'order_intent': {key: copy.deepcopy(plan[0][key]) for key in ('token', 'fields')}}
        self.existing = {'item_id': 50, 'fields': copy.deepcopy(plan[0]['fields'])}
        self.assertEqual(plan, self.engine._description_order_plan(self.group))

    def test_existing_iso_plan_before_parent_checkpoint_stays_resumable(self):
        plan = self.engine._description_order_plan(self.group)
        plan[0]['fields']['DATA PEDIDO'] = '2026-11-03T03:00:00Z'
        self.group['journal'] = {'order_plan': copy.deepcopy(plan)}
        self.existing = {'item_id': 50, 'fields': copy.deepcopy(plan[0]['fields'])}
        self.assertEqual(plan, self.engine._description_order_plan(self.group))

    def test_changed_order_date_is_still_conflict(self):
        self.assertFalse(module._same('DATA PEDIDO', '2026-11-03', '2026-11-04T03:00:00Z'))
        self.assertFalse(module._same('DATA PEDIDO', '2026-11-03', None))

    def test_changed_owner_is_still_rejected(self):
        live = self.engine._description_order_plan(self.group)[0]['fields']
        live['FORNECEDOR'] = 'Outro fornecedor'
        self.existing = {'item_id': 50, 'fields': live}
        with self.assertRaisesRegex(RuntimeError, 'fornecedor/filial'):
            self.engine._description_order_plan(self.group)


class SharePointCivilDates(unittest.TestCase):
    def test_payment_normalized_to_noon_keeps_confirmed_civil_date(self):
        self.assertTrue(client_module.SharePointClient._same_sharepoint_value(
            '2026-11-03T12:00:00Z', '2026-11-03', field_type='DateTime'))

    def test_previous_local_date_remains_a_mismatch(self):
        self.assertFalse(client_module.SharePointClient._same_sharepoint_value(
            '2026-11-03T01:00:00Z', '2026-11-03', field_type='DateTime'))

    def test_next_local_date_remains_a_mismatch(self):
        self.assertFalse(client_module.SharePointClient._same_sharepoint_value(
            '2026-11-04T03:00:00Z', '2026-11-03', field_type='DateTime'))

    def test_unknown_field_type_preserves_strict_instant_comparison(self):
        self.assertFalse(client_module.SharePointClient._same_sharepoint_value(
            '2026-11-03T12:00:00Z', '2026-11-03'))

    def test_explicit_timestamp_preserves_time(self):
        self.assertFalse(client_module.SharePointClient._same_sharepoint_value(
            '2026-11-03T12:00:00Z', '2026-11-03T03:00:00Z', field_type='DateTime'))

    def test_verify_paid_record_after_sharepoint_normalization(self):
        client = client_module.SharePointClient.__new__(client_module.SharePointClient)
        client.target_list = 'Synthetic'
        client._field_type_cache = {'Synthetic': {'PaymentDate': 'DateTime'}}
        client._internal_field = lambda kind, name: 'PaymentDate'
        client._list_endpoint = lambda kind: 'synthetic'
        client._request = lambda *args, **kwargs: {'Id': 11, 'PaymentDate': '2026-11-03T12:00:00Z'}
        client._attachment_names_with_retry = lambda *args, **kwargs: set()
        self.assertEqual({'fields': True, 'attachments': True},
            client.verify_item(11, {'DATA PGTO EFETUADO': '2026-11-03'}, []))


if __name__ == '__main__':
    unittest.main()
