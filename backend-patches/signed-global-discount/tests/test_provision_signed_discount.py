"""Signed adjustments with the real provision engine and synthetic persistence."""
import copy
from decimal import Decimal
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'provision-global-discount/tests'))
import test_global_discount as fixtures
import payment_provision_group as group


class SignedProvisionDiscountTests(unittest.TestCase):
    def setUp(self):
        self.qa = fixtures.GlobalDiscountTests()
        self.qa.setUp()

    def test_negative_six_cents_adds_to_preview_and_keeps_freight(self):
        result = self.qa.discount('-0,06')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(group.provision_preview(self.qa.state)['totalDisplay'], 'R$ 830,06')
        self.assertEqual(self.qa.state['provision_discount']['amount'], '-0.06')
        self.assertEqual([r['fields']['QTD'] for r in self.qa.state['provision_lines']], ['2', '3'])
        self.assertEqual([r['fields']['FRETE'] for r in self.qa.state['provision_lines']], ['30', '0'])
        self.assertEqual(self.qa.catalog.creates, [])
        rows = self.qa.fixture.summary.rows[-1]
        adjustment = next(r for r in rows if r['label'] == 'ACRÉSCIMO GLOBAL')
        self.assertIn('R$ 0,06', adjustment['value'])

    def test_exact_reported_three_line_rounding_example(self):
        lines = [fixtures.freight_fixture.line(quantity=q, unit=u, freight='0')
                 for q, u in [('3', '1234.56'), ('7', '2000.02'), ('1', '43896.12')]]
        original = copy.deepcopy(lines)
        adjusted, metadata = group.apply_provision_discount(lines, '-0,06')
        self.assertEqual(metadata['original_total'], '61599.94')
        self.assertEqual(metadata['net_total'], '61600')
        total = group.provision_money(group._sum(group.provision_line_total(r['fields']) for r in adjusted))
        self.assertEqual(total, Decimal('61600.00'))
        self.assertEqual(lines, original)

    def test_negative_forms_and_restored_numeric_amount_keep_sign(self):
        for raw in ['-0,06', '-0.06', 'R$ -0,06', Decimal('-0.06'), -0.06, -1]:
            with self.subTest(raw=raw):
                _, metadata = group.apply_provision_discount(self.qa.state['provision_lines'], raw)
                self.assertEqual(Decimal(metadata['amount']), Decimal(str(raw).replace('R$ ', '').replace(',', '.')))

    def test_invalid_signed_inputs_do_not_mutate_the_original_lines(self):
        original = copy.deepcopy(self.qa.state['provision_lines'])
        for raw in ['0', '-0,00', '-0,001', 'NaN', '-Infinity', '-1e2', '--0,06', '0,06-', True]:
            with self.subTest(raw=raw):
                with self.assertRaises(ValueError):
                    group.apply_provision_discount(original, raw)
                self.assertEqual(original, self.qa.state['provision_lines'])

    def test_other_numeric_fields_stay_nonnegative(self):
        for field in ['QTD', 'VALOR TOTAL', 'FRETE']:
            lines = copy.deepcopy(self.qa.state['provision_lines'])
            lines[0]['fields'][field] = '-0.06'
            with self.subTest(field=field), self.assertRaises(ValueError):
                group.apply_provision_discount(lines, '-0,06')

    def test_global_parser_keeps_legacy_international_and_spaced_currency_formats(self):
        for raw in ['1,234.56', '1 234,56', '1\u00a0234,56', '1.234,56', 'R$ 1,234.56']:
            with self.subTest(raw=raw):
                self.assertEqual(group.parse_global_discount(raw), Decimal('1234.56'))
                self.assertEqual(group.parse_global_discount('-' + raw.replace('R$ ', '')), Decimal('-1234.56'))

    def test_parent_cent_transport_is_checked_before_any_creation(self):
        self.qa.state['provision_lines'] = [fixtures.freight_fixture.line(quantity='1', unit=u, freight='0')
                                            for u in ['50000000000000', '30000000000000']]
        self.qa.state.update(copy.deepcopy(self.qa.state['provision_lines'][-1]))
        self.qa.discount('-0,01')
        self.assertEqual(self.qa.state['stage'], 'entering_provision_discount')
        self.assertEqual(self.qa.catalog.creates, [])

    def test_surcharge_reapplication_and_sign_switch_restore_original_units(self):
        original = copy.deepcopy(self.qa.state['provision_lines'])
        adjusted, first = group.apply_provision_discount(original, '-0,06')
        repeated, second = group.apply_provision_discount(adjusted, first['amount'])
        self.assertEqual(adjusted, repeated)
        self.assertEqual(first, second)
        discounted, metadata = group.apply_provision_discount(repeated, '80')
        self.assertEqual([Decimal(r['fields']['VALOR TOTAL']) for r in discounted], [Decimal('90'), Decimal('180')])
        self.assertEqual(metadata['net_total'], '750')
        self.assertEqual(group.restore_provision_discount(repeated), original)

    def test_prompt_explains_negative_input_as_surcharge(self):
        self.qa.state['stage'] = 'entering_provision_discount'
        step = self.qa.engine._provision_question(self.qa.state)
        self.assertIn('-0,06', step['prompt'])
        self.assertIn('acréscimo', step['prompt'].lower())

    def test_numeric_commit_has_the_same_increased_parent_total(self):
        self.qa.catalog = fixtures.NumericTransportCatalog()
        self.qa.engine.sharepoint = self.qa.catalog
        self.qa.discount('-0,06')
        self.assertEqual(self.qa.state['stage'], 'awaiting_confirmation')
        self.qa.engine._persist_provision_group(self.qa.state, self.qa.fixture.etag(), self.qa.engine._flow_config(self.qa.state))
        parent = next(r['fields'] for (target, _), r in self.qa.catalog.rows.items() if target == 'DESCRITIVOPROVISAO')
        self.assertEqual(parent['VALORTOTAL'], 830.06)
        self.assertEqual(len(self.qa.catalog.creates), 3)

    def test_summaries_and_resume_do_not_repeat_the_surcharge(self):
        self.qa.discount('-0,06')
        expected = copy.deepcopy(self.qa.state['provision_lines'])
        for _ in range(3):
            self.qa.engine._summarize_and_confirm(self.qa.state, self.qa.fixture.etag())
            self.qa.engine._resume_draft_prompt(self.qa.state, self.qa.fixture.etag())
        self.assertEqual(self.qa.state['provision_lines'], expected)
        self.assertEqual(group.provision_preview(self.qa.state)['totalDisplay'], 'R$ 830,06')
        self.assertEqual(self.qa.catalog.creates, [])

    def test_retry_preserves_surcharge_payload_without_duplicate_children(self):
        self.qa.discount('-0,06')
        self.qa.catalog.fail_child_verification = True
        with self.assertRaisesRegex(RuntimeError, 'Synthetic lost'):
            self.qa.engine._persist_provision_group(self.qa.state, self.qa.fixture.etag(), self.qa.engine._flow_config(self.qa.state))
        def payloads():
            return [{k: copy.deepcopy(v) for k, v in child['fields'].items() if k != 'DESCRITIVOPROVISAO'}
                    for child in self.qa.state['provision_commit']['children']]
        frozen = payloads()
        self.qa.engine._persist_provision_group(self.qa.state, self.qa.fixture.etag(), self.qa.engine._flow_config(self.qa.state))
        self.assertEqual(payloads(), frozen)
        self.assertEqual({child['fields']['DESCRITIVOPROVISAO'] for child in self.qa.state['provision_commit']['children']}, {'100'})
        self.assertEqual(len(self.qa.catalog.creates), 3)
        parent = next(r['fields'] for (target, _), r in self.qa.catalog.rows.items() if target == 'DESCRITIVOPROVISAO')
        self.assertEqual(Decimal(parent['VALORTOTAL']), Decimal('830.06'))


if __name__ == '__main__':
    unittest.main()
