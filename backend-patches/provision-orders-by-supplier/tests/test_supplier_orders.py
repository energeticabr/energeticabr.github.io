"""Real conversation regressions; all records and deliveries are synthetic."""
import copy
import os
import sys
import unittest
from types import MethodType
from decimal import Decimal
from pathlib import Path

if not os.getenv('ENERGETICA_BACKEND_TEST_ROOT'):
    raise unittest.SkipTest('Requires an isolated backend source snapshot')
ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path[:0] = [str(ROOT), str(ROOT / 'worker'), str(ROOT / 'tests')]
import test_batch_review as review_fixture


class SupplierOrderTests(unittest.TestCase):
    def setUp(self):
        self.f = review_fixture.BatchReviewTests('runTest')
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.failures = []
        failure = self.f.h.engine._submission_failed
        def record_failure(state, etag, error):
            self.failures.append(str(error))
            return failure(state, etag, error)
        self.f.h.engine._submission_failed = record_failure

    def mixed(self, suppliers=('Fornecedor A', 'Fornecedor B', 'Fornecedor A'), branches=None):
        for index, ident in enumerate((11, 12, 13)):
            fields = self.f.h.sharepoint.items[ident]['fields']
            fields['FORNECEDOR'] = suppliers[index]
            if branches:
                fields['FILIAL'] = branches[index]

    def ready(self, launch=True):
        self.f.open()
        self.f.prepare(launch=launch)
        self.assertFalse(self.f.h.sharepoint.update_calls)
        self.assertFalse(self.rows('NOTASPENDENTES'))
        self.assertFalse(self.rows('LANCAMENTOS'))

    def rows(self, kind):
        return {ident: row for ident, row in self.f.h.sharepoint.items.items()
                if row['target_list'] == kind}

    def confirm(self):
        result = self.f.h.reply('SIM')
        if self.failures:
            result['synthetic_diagnostic'] = self.failures[-1]
        return result

    def assert_links(self, order_count, line_count=3):
        orders, launches = self.rows('NOTASPENDENTES'), self.rows('LANCAMENTOS')
        self.assertEqual(len(orders), order_count)
        self.assertEqual(len(launches), line_count)
        sums = {ident: Decimal(0) for ident in orders}
        for row in launches.values():
            fields = row['fields']
            child = self.f.h.sharepoint.items[int(fields['IDPGTOAGENDADO'])]['fields']
            order_id = int(fields['AGRUPAR'])
            order = orders[order_id]['fields']
            self.assertEqual(order['FORNECEDOR'].strip().casefold(), child['FORNECEDOR'].strip().casefold())
            self.assertEqual(order['FILIAL'].strip().casefold(), child['FILIAL'].strip().casefold())
            self.assertEqual(child['IDPEDIDO'], str(order_id))
            number = lambda value: Decimal(str(value).replace(',', '.'))
            sums[order_id] += number(child['QTD']) * number(child['VALOR TOTAL']) + number(child['FRETE'])
        for ident, expected in sums.items():
            self.assertEqual(Decimal(str(orders[ident]['fields']['VALORTOTAL']).replace(',', '.')), expected)

    def test_mixed_suppliers_finish_with_one_order_per_supplier(self):
        self.mixed()
        self.ready()
        paid_before = copy.deepcopy(self.f.h.sharepoint.items[14])
        result = self.confirm()
        self.assertEqual(result.get('status'), 'completed', result)
        self.assert_links(2)
        self.assertEqual(self.f.h.sharepoint.items[14], paid_before)

    def test_same_supplier_in_two_branches_uses_separate_orders(self):
        self.mixed(('Fornecedor A',) * 3, ('Filial A', 'Filial B', 'Filial A'))
        self.ready()
        result = self.confirm()
        self.assertEqual(result.get('status'), 'completed', result)
        self.assert_links(2)

    def test_five_different_suppliers_match_reported_failure(self):
        self.mixed(('Fornecedor A', 'Fornecedor B', 'Fornecedor C'))
        for ident in (14, 15):
            fields = copy.deepcopy(self.f.h.sharepoint.items[11]['fields'])
            fields.update({'Id': ident, 'FORNECEDOR': f'Fornecedor ficticio {ident}'})
            self.f.h.sharepoint.items[ident] = {'fields': fields, 'attachments': {}, 'target_list': 'PROVISÃO PGTOS'}
        self.f.child_ids.append(15)
        self.f.h.sharepoint.items[7]['fields']['PENDING CHILD IDS'] = ['11', '12', '13', '14', '15']
        self.ready()
        result = self.confirm()
        self.assertEqual(result.get('status'), 'completed', result)
        self.assert_links(5, 5)

    def test_same_supplier_keeps_legacy_single_order_key(self):
        self.ready()
        self.assertEqual(self.confirm().get('status'), 'completed')
        self.assert_links(1)
        journal = self.f.state()['provision_description']['journal']
        self.assertEqual(journal['order_intent']['token'], 'WA-BAIXA-PEDIDO-DESCRITIVO-7')

    def test_lost_order_response_reuses_orders_after_retry(self):
        self.mixed()
        self.ready()
        create = self.f.h.sharepoint.ensure_item
        lost = []
        def create_then_lose(*args, **kwargs):
            result = create(*args, **kwargs)
            if kwargs.get('target_list') == 'NOTASPENDENTES' and not lost:
                lost.append(True)
                raise RuntimeError('synthetic response lost after order creation')
            return result
        self.f.h.sharepoint.ensure_item = create_then_lose
        self.assertEqual(self.confirm().get('status'), 'submission_failed')
        result = self.f.h.reply(reply_id='error_retry')
        self.assertEqual(result.get('status'), 'completed', result)
        self.assert_links(2)

    def test_lost_paid_child_response_does_not_repeat_writes(self):
        self.mixed()
        self.ready()
        update = self.f.h.sharepoint.update_item_with_etag
        lost = []
        def update_then_lose(ident, fields, etag, target_list=None):
            result = update(ident, fields, etag, target_list=target_list)
            if target_list == 'PROVISÃO PGTOS' and int(ident) == 12 and not lost:
                lost.append(True)
                raise RuntimeError('synthetic response lost after child update')
            return result
        self.f.h.sharepoint.update_item_with_etag = update_then_lose
        self.assertEqual(self.confirm().get('status'), 'submission_failed')
        result = self.f.h.reply(reply_id='error_retry')
        self.assertEqual(result.get('status'), 'completed', result)
        self.assert_links(2)
        self.assertEqual(len(self.f.h.sharepoint.update_calls), 4)

    def test_declining_launches_never_creates_orders_for_mixed_suppliers(self):
        self.mixed()
        self.ready(launch=False)
        result = self.confirm()
        self.assertEqual(result.get('status'), 'completed', result)
        self.assertFalse(self.rows('NOTASPENDENTES'))
        self.assertFalse(self.rows('LANCAMENTOS'))

    def test_altered_supplier_in_draft_is_rejected_before_writes(self):
        self.ready()
        state = self.f.state()
        state['provision_description']['entries'][0]['fields']['FORNECEDOR'] = 'Fornecedor adulterado'
        _, etag = self.f.h.state.load(state['key'])
        result = self.f.h.engine._description_commit(state, etag, self.f.h.engine._flow_config(state))
        self.assertEqual(result.get('status'), 'submission_failed', result)
        self.assertFalse(self.f.h.sharepoint.update_calls)
        self.assertFalse(self.rows('NOTASPENDENTES'))

    def test_summary_explains_separate_orders_before_confirmation(self):
        self.mixed()
        self.ready()
        rows = self.f.h.engine._description_summary_rows(self.f.state())
        row = next((row for row in rows if row['label'] == 'PEDIDOS A GERAR'), None)
        self.assertIsNotNone(row)
        self.assertIn('2', row['value'])
        self.assertIn('FORNECEDOR', row['value'].upper())

    def test_original_group_attachment_reaches_every_owner_order_and_row_file_stays_scoped(self):
        self.mixed()
        self.f.h.sharepoint.items[7]['attachments']['comprovante-grupo.pdf'] = b'synthetic group proof'
        self.f.h.sharepoint.items[12]['attachments']['comprovante-linha.pdf'] = b'synthetic row proof'
        self.ready()
        result = self.confirm()
        self.assertEqual(result.get('status'), 'completed', result)
        self.assert_links(2)
        for row in self.rows('NOTASPENDENTES').values():
            contents = set(row['attachments'].values())
            self.assertIn(b'synthetic group proof', contents)
            self.assertEqual(b'synthetic row proof' in contents, row['fields']['FORNECEDOR'] == 'Fornecedor B')

    def test_frozen_partition_cannot_be_changed_during_retry(self):
        self.mixed()
        self.ready()
        create = self.f.h.sharepoint.ensure_item
        def lose_order(*args, **kwargs):
            result = create(*args, **kwargs)
            if kwargs.get('target_list') == 'NOTASPENDENTES':
                raise RuntimeError('synthetic lost order response')
            return result
        self.f.h.sharepoint.ensure_item = lose_order
        self.assertEqual(self.confirm().get('status'), 'submission_failed')
        before = copy.deepcopy(self.f.h.sharepoint.items)
        state = self.f.state()
        state['provision_description']['entries'][0]['fields']['QTD'] = '99'
        _, etag = self.f.h.state.load(state['key'])
        result = self.f.h.engine._description_commit(state, etag, self.f.h.engine._flow_config(state))
        self.assertEqual(result.get('status'), 'submission_failed', result)
        self.assertEqual(self.f.h.sharepoint.items, before)

    def test_new_confirmation_attachment_uses_scoped_sync_with_real_upload_hook(self):
        from clients import SharePointClient
        self.mixed()
        self.ready()
        client = self.f.h.sharepoint
        raw_upload = client.ensure_attachment
        def local_upload(ident, filename, content, mime_type=None, target_list=None):
            return raw_upload(ident, filename, content, mime_type, target_list=target_list)
        client._ensure_attachment_local = local_upload
        client.ensure_attachment = MethodType(SharePointClient.ensure_attachment, client)
        state = self.f.state()
        attachment = self.f.h.media.stage({'message_id': 'synthetic-proof',
            'original_filename': 'novo-comprovante.pdf', 'content': b'synthetic new proof',
            'mime_type': 'application/pdf'}, state['batch_id'], state['key'])
        state['attachments'] = [attachment]
        _, etag = self.f.h.state.load(state['key'])
        self.f.h.state.save(state['key'], state, etag)
        result = self.confirm()
        self.assertEqual(result.get('status'), 'completed', result)
        self.assert_links(2)
        for row in self.rows('NOTASPENDENTES').values():
            self.assertIn(b'synthetic new proof', row['attachments'].values())

    def test_case_variants_preserve_legacy_homogeneous_order_identity(self):
        self.mixed(('Fornecedor A', 'FORNECEDOR A', 'Fornecedor A'))
        self.ready()
        plan = self.f.h.engine._description_order_plan(self.f.state()['provision_description'])
        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0]['token'], 'WA-BAIXA-PEDIDO-DESCRITIVO-7')


if __name__ == '__main__':
    unittest.main()
