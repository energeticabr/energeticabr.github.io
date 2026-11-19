"""Real workflow with synthetic catalogs, state and attachments only."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('order_supplier_fixture',
    Path(__file__).resolve().parents[1] / 'single-launch-order-supplier/test_order_supplier.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


class ExemptionTests(unittest.TestCase):
    reply = base.OrderSupplierTests.reply
    choose_launch = base.OrderSupplierTests.choose_launch
    action = base.OrderSupplierTests.action
    choose_different = base.OrderSupplierTests.choose_different

    def setUp(self):
        base.OrderSupplierTests.setUp(self)
        self.payroll_rows = []
        self.payroll_queries = []
        get_options = self.sharepoint.get_options

        def options(step, context=None):
            if step['source'].get('list') == 'IDFOLHA':
                self.payroll_queries.append(copy.deepcopy(step))
                return copy.deepcopy(self.payroll_rows)
            return get_options(step, context)

        self.sharepoint.get_options = options

    def sheet(self, supplier='FORNECEDOR A', item_id=21, month='01/2020'):
        return {'id': item_id, 'title': month, 'value': month,
                'source_values': {'Id': item_id, 'FORNECEDOR': supplier,
                                  'MESREFERENCIA': month}}

    def confirm_order(self):
        self.choose_launch()
        self.reply(self.action('SIM'))

    def assert_skipped(self):
        self.assertGreater(self.current['step_index'], self.pending_index)
        self.assertEqual(self.current['supplier_pending_provision_ids'], [])
        self.assertFalse(any('PENDENTES EM PROVISÃO' in m.get('body', '')
                             or 'PENDENTE EM PROVISÃO' in m.get('body', '')
                             for m in self.messenger.sent))

    def test_sheet_skips_warning_even_for_historical_competency(self):
        self.payroll_rows = [self.sheet()]
        before = copy.deepcopy(self.current['attachments'])
        self.confirm_order()
        self.assert_skipped()
        self.assertEqual(self.current['attachments'], before)
        query = self.payroll_queries[-1]['source']
        self.assertEqual(query['filters'], [{'field': 'FORNECEDOR', 'equals': 'FORNECEDOR A'}])
        self.assertTrue(query['fetch_all_pages'])

    def test_no_sheet_keeps_pending_warning(self):
        self.confirm_order()
        self.assertEqual(self.current['step_index'], self.pending_index)
        self.assertIn('901', self.messenger.sent[-1]['body'])
        self.assertIn('PROVISÃO PGTO', self.messenger.sent[-1]['body'])

    def test_other_supplier_sheet_does_not_exempt_launch(self):
        self.payroll_rows = [self.sheet('FORNECEDOR B')]
        self.confirm_order()
        self.assertEqual(self.current['step_index'], self.pending_index)

    def test_normalized_supplier_matches(self):
        self.payroll_rows = [self.sheet('  Fornecedor Á  ')]
        self.confirm_order()
        self.assert_skipped()

    def test_invalid_or_missing_sheet_id_does_not_exempt(self):
        for item_id in (None, '', 'bad', 0, -1):
            with self.subTest(item_id=item_id):
                self.setUp()
                self.payroll_rows = [self.sheet(item_id=item_id)]
                self.confirm_order()
                self.assertEqual(self.current['step_index'], self.pending_index)

    def test_missing_sheet_supplier_does_not_exempt(self):
        self.payroll_rows = [self.sheet(supplier=None)]
        self.confirm_order()
        self.assertEqual(self.current['step_index'], self.pending_index)

    def test_multiple_launch_skips_warning_with_sheet(self):
        self.current['answers']['tipo_lancamento'] = 'LANÇAMENTO MÚLTIPLO'
        self.payroll_rows = [self.sheet()]
        self.choose_launch()
        self.assert_skipped()

    def test_alternate_order_supplier_does_not_determine_exemption(self):
        self.payroll_rows = [self.sheet('FORNECEDOR B')]
        self.choose_different()
        self.assertEqual(self.current['step_index'], self.pending_index)
        self.assertIn('901', self.messenger.sent[-1]['body'])

    def test_launch_sheet_exempts_even_with_different_order_supplier(self):
        self.payroll_rows = [self.sheet()]
        self.choose_different()
        self.assert_skipped()
        self.assertEqual(self.current['fields']['FORNECEDOR'], 'FORNECEDOR A')

    def test_old_warning_rechecks_sheet_before_processing_reply(self):
        for reply in ('qualquer texto', 'confirm_supplier_pending_provisions_no',
                      'confirm_supplier_pending_provisions_yes'):
            with self.subTest(reply=reply):
                self.setUp()
                self.confirm_order()
                self.assertEqual(self.current['step_index'], self.pending_index)
                self.payroll_rows = [self.sheet()]
                self.messenger.sent.clear()
                self.reply(reply)
                self.assert_skipped()
                self.assertEqual(self.current['fields']['FORNECEDOR'], 'FORNECEDOR A')

    def test_no_sheet_still_allows_changing_supplier(self):
        self.confirm_order()
        self.reply('confirm_supplier_pending_provisions_no')
        self.assertEqual(self.current['step_index'], self.supplier_index)

    def test_sheet_lookup_failure_does_not_silently_exempt(self):
        original = self.sharepoint.get_options

        def broken(step, context=None):
            if step['source'].get('list') == 'IDFOLHA':
                raise RuntimeError('synthetic catalog unavailable')
            return original(step, context)

        self.sharepoint.get_options = broken
        self.choose_launch()
        with self.assertRaisesRegex(RuntimeError, 'synthetic catalog unavailable'):
            self.reply(self.action('SIM'))
        self.assertEqual(self.current['step_index'], self.pending_index)


if __name__ == '__main__':
    unittest.main()
