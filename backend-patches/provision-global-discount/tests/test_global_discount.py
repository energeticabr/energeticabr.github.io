"""Real payment wizard; synthetic persistence only, never calls a tenant."""
import copy
from decimal import Decimal
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'multi-provision-first-freight/tests'))
import test_first_freight as freight_fixture
from payment_provision_group import provision_preview
from provision_parent_choice import read_parent, PARENT_FIELDS


class NumericTransportCatalog(freight_fixture.Catalog):
    numeric = {'QTD', 'VALOR TOTAL', 'FRETE', 'VALORTOTAL'}

    def ensure_item(self, token, fields, **kwargs):
        converted = {key: float(str(value).replace(',', '.')) if key in self.numeric else value
                     for key, value in fields.items()}
        return super().ensure_item(token, converted, **kwargs)

    def update_item_with_etag(self, item_id, fields, etag, **kwargs):
        converted = {key: float(value) if key in self.numeric else value for key, value in fields.items()}
        return super().update_item_with_etag(item_id, converted, etag, **kwargs)

    def verify_item(self, item_id, fields, names, *, target_list):
        actual = self.rows[target_list, item_id]['fields']
        for key, value in fields.items():
            expected = float(str(value).replace(',', '.')) if key in self.numeric else value
            if actual.get(key) != expected:
                raise AssertionError('Persisted field differs from the numeric transport')
        return {'fields': True, 'attachments': not names}


class GlobalDiscountTests(unittest.TestCase):
    def setUp(self):
        self.fixture = freight_fixture.FirstFreightTests()
        self.fixture.setUp()
        self.engine, self.state = self.fixture.engine, self.fixture.state
        self.catalog, self.messenger = self.fixture.catalog, self.fixture.messenger
        self.state['provision_lines'] = [
            freight_fixture.line(quantity='2', unit='100', freight='30'),
            freight_fixture.line('PRODUTO B QA', quantity='3', unit='200', freight='0')]
        self.state.update(copy.deepcopy(self.state['provision_lines'][-1]))
        self.state.update(provision_current_saved=True, provision_composition_complete=False,
                          attachments_decision='no', attachments_phase_completed=True,
                          provision_parent_mode='NEW')
        self.state['step_index'] = len(self.engine._flow_config(self.state)['steps'])
        self.engine._prompt_provision_question(self.state, self.fixture.etag(), 'asking_provision_more')

    def reply(self, text):
        return self.fixture.reply(text)

    def finish_lines(self):
        result = self.reply('2')
        self.assertEqual(self.state['stage'], 'asking_provision_discount',
                         'Finishing a multiple-line provision must ask about the global discount')
        return result

    def discount(self, value='80'):
        self.finish_lines()
        self.reply('1')
        self.assertEqual(self.state['stage'], 'entering_provision_discount')
        return self.reply(value)

    def units(self):
        return [Decimal(row['fields']['VALOR TOTAL'].replace(',', '.'))
                for row in self.state['provision_lines']]

    # Missing the final question must fail before attachments/review/any posting.
    def test_finishing_lines_asks_once_before_review_and_posting(self):
        self.finish_lines()
        self.assertEqual(self.catalog.creates, [])
        self.assertEqual(self.units(), [Decimal('100'), Decimal('200')])
        options = self.messenger.sent[-1]['options']
        self.assertTrue(any(row.get('value') == 'SIM' for row in options))

    def test_yes_asks_for_the_monetary_amount(self):
        self.finish_lines()
        result = self.reply('1')
        self.assertEqual(self.state['stage'], 'entering_provision_discount')
        self.assertEqual(result['field'], 'valor_desconto_global_provisao')
        self.assertEqual(self.catalog.creates, [])

    # Different quantities plus freight catch equal-per-line/gross-weighted bugs.
    def test_same_percentage_reduces_unit_prices_and_preserves_quantity_and_freight(self):
        result = self.discount()
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(self.units(), [Decimal('90'), Decimal('180')])
        fields = [row['fields'] for row in self.state['provision_lines']]
        self.assertEqual([row['QTD'] for row in fields], ['2', '3'])
        self.assertEqual([row['FRETE'] for row in fields], ['30', '0'])
        self.assertEqual(provision_preview(self.state)['totalDisplay'], 'R$ 750,00')
        rows = self.fixture.summary.rows[-1]
        self.assertEqual(next(row['value'] for row in rows if row['label'] == 'TOTAL ORIGINAL'), 'R$ 830,00')
        self.assertIn('80,00', next(row['value'] for row in rows if row['label'] == 'DESCONTO GLOBAL'))

    def test_no_keeps_all_original_values(self):
        self.finish_lines()
        self.assertEqual(self.reply('2')['status'], 'awaiting_confirmation')
        self.assertEqual(self.units(), [Decimal('100'), Decimal('200')])
        self.assertEqual(provision_preview(self.state)['totalDisplay'], 'R$ 830,00')

    def test_invalid_amounts_never_change_lines_or_create_records(self):
        self.finish_lines()
        self.reply('1')
        original = copy.deepcopy(self.state['provision_lines'])
        for raw in ['', '0', '-0,001', 'NaN', 'Infinity', '801', '0,001']:
            with self.subTest(amount=raw):
                self.reply(raw)
                self.assertEqual(self.state['stage'], 'entering_provision_discount')
                self.assertEqual(self.state['provision_lines'], original)
                self.assertEqual(self.catalog.creates, [])

    def test_full_product_discount_leaves_only_the_freight(self):
        self.discount('800')
        self.assertEqual(self.units(), [Decimal('0'), Decimal('0')])
        self.assertEqual(provision_preview(self.state)['totalDisplay'], 'R$ 30,00')

    def test_repeated_summaries_and_resume_do_not_compound_the_discount(self):
        self.discount()
        expected = copy.deepcopy(self.state['provision_lines'])
        for _ in range(3):
            self.engine._summarize_and_confirm(self.state, self.fixture.etag())
            self.engine._resume_draft_prompt(self.state, self.fixture.etag())
        self.assertEqual(self.state['provision_lines'], expected)
        self.assertEqual(self.catalog.creates, [])

    def test_review_can_edit_or_remove_global_discount_without_compounding(self):
        self.discount()
        self.reply('confirm_edit')
        option = next(row for row in self.state['options']
                      if row.get('value') == '__edit_provision_discount__')
        self.reply(str(option['id']))
        self.assertEqual(self.state['stage'], 'asking_provision_discount')
        self.reply('1')
        self.reply('160')
        self.assertEqual(self.units(), [Decimal('80'), Decimal('160')])
        self.assertEqual(provision_preview(self.state)['totalDisplay'], 'R$ 670,00')
        self.reply('confirm_edit')
        option = next(row for row in self.state['options']
                      if row.get('value') == '__edit_provision_discount__')
        self.reply(str(option['id']))
        self.reply('2')
        self.assertEqual(self.units(), [Decimal('100'), Decimal('200')])

    def test_last_line_edit_recalculates_using_original_unit_prices(self):
        self.discount()
        self.reply('confirm_edit')
        self.assertEqual(self.state['stage'], 'editing_provision_line_choice')
        self.reply('2')
        index = next(i for i, step in enumerate(self.engine._flow_config(self.state)['steps'])
                     if step['key'] == 'valor_unitario_pagamento')
        self.reply(str(index + 1))
        self.reply('100')
        for _ in range(8):
            if self.state['stage'] != 'selecting_fields':
                break
            self.reply('2')
        self.assertEqual(self.state['stage'], 'awaiting_confirmation')
        # Original products now total 500, so discount 80 is 16% for BOTH units.
        self.assertEqual(self.units(), [Decimal('84'), Decimal('84')])
        self.assertEqual(provision_preview(self.state)['totalDisplay'], 'R$ 450,00')

    def test_awkward_fraction_preserves_percentage_and_exact_currency_total(self):
        lines = self.state['provision_lines']
        lines[0]['fields'].update(QTD='3', **{'VALOR TOTAL': '100'})
        lines[1]['fields'].update(QTD='7', **{'VALOR TOTAL': '37'})
        self.state.update(copy.deepcopy(lines[-1]))
        self.discount('0,01')
        first, second = self.units()
        self.assertLess(abs(first / Decimal('100') - second / Decimal('37')), Decimal('0.00000000000001'))
        self.assertEqual(provision_preview(self.state)['totalDisplay'], 'R$ 588,99')

    def test_single_line_does_not_get_the_global_discount_question(self):
        self.state['provision_lines'] = self.state['provision_lines'][:1]
        self.state.update(copy.deepcopy(self.state['provision_lines'][-1]))
        self.reply('2')
        self.assertEqual(self.state['stage'], 'awaiting_confirmation')

    def test_commit_writes_discounted_children_and_the_same_parent_total(self):
        self.discount()
        self.engine._persist_provision_group(self.state, self.fixture.etag(), self.engine._flow_config(self.state))
        children = [row['fields'] for (target, _), row in self.catalog.rows.items() if target == 'PROVISÃO PGTOS']
        parent = next(row['fields'] for (target, _), row in self.catalog.rows.items() if target == 'DESCRITIVOPROVISAO')
        self.assertEqual([Decimal(row['VALOR TOTAL']) for row in children], [Decimal('90'), Decimal('180')])
        self.assertEqual(Decimal(parent['VALORTOTAL']), Decimal('750'))
        self.assertEqual(len({row['DESCRITIVOPROVISAO'] for row in children}), 1)

    def test_retry_keeps_frozen_discounted_payload_and_does_not_duplicate(self):
        self.discount()
        self.catalog.fail_child_verification = True
        with self.assertRaisesRegex(RuntimeError, 'Synthetic lost'):
            self.engine._persist_provision_group(self.state, self.fixture.etag(), self.engine._flow_config(self.state))
        frozen = copy.deepcopy(self.state['provision_commit']['children'])
        self.engine._persist_provision_group(self.state, self.fixture.etag(), self.engine._flow_config(self.state))
        self.assertEqual([row['fields']['VALOR TOTAL'] for row in frozen], ['90', '180'])
        self.assertEqual(len(self.catalog.creates), 3)

    def test_old_confirmation_must_ask_discount_before_it_can_post(self):
        self.state.update(stage='awaiting_confirmation', provision_composition_complete=True)
        self.reply('confirm_yes')
        self.assertEqual(self.state['stage'], 'asking_provision_discount')
        self.assertEqual(self.catalog.creates, [])

    def test_a_changed_line_requires_a_new_review_even_after_reading_progress(self):
        self.discount()
        self.state['provision_lines'][0]['fields']['QTD'] = '4'
        self.engine._summary_rows(self.state)
        self.assertEqual(self.reply('confirm_yes')['status'], 'awaiting_confirmation')
        self.assertEqual(self.catalog.creates, [])
        self.assertEqual(provision_preview(self.state)['totalDisplay'], 'R$ 950,00')

    def test_existing_description_gets_discounted_new_rows_without_rewriting_old_rows(self):
        fields = dict.fromkeys(PARENT_FIELDS)
        fields.update(FORNECEDOR='FORNECEDOR QA', FILIAL='004 - OBRA QA', VALORTOTAL='50')
        self.catalog.rows['DESCRITIVOPROVISAO', 50] = {'fields': fields, 'version': 1}
        old = freight_fixture.line(quantity='1', unit='50', freight='0')['fields']
        old['DESCRITIVOPROVISAO'] = '50'
        self.catalog.rows['PROVISÃO PGTOS', 51] = {'fields': copy.deepcopy(old), 'version': 1}
        self.state.update(provision_parent_mode='EXISTING', provision_parent_choice_complete=True,
                          provision_parent_selection=read_parent(self.catalog, 50))
        self.discount()
        self.engine._persist_provision_group(self.state, self.fixture.etag(), self.engine._flow_config(self.state))
        self.assertEqual(self.catalog.rows['PROVISÃO PGTOS', 51]['fields'], old)
        self.assertEqual(Decimal(self.catalog.rows['DESCRITIVOPROVISAO', 50]['fields']['VALORTOTAL']), Decimal('800'))
        self.assertEqual(len(self.catalog.creates), 2)

    def test_float_persistence_keeps_the_parent_and_displayed_currency_total(self):
        self.catalog = NumericTransportCatalog()
        self.engine.sharepoint = self.catalog
        for line, quantity, unit in zip(self.state['provision_lines'], ['3', '7'], ['100', '37']):
            line['fields'].update(QTD=quantity, **{'VALOR TOTAL': unit})
        self.state.update(copy.deepcopy(self.state['provision_lines'][-1]))
        self.discount('0,01')
        self.engine._persist_provision_group(self.state, self.fixture.etag(), self.engine._flow_config(self.state))
        parent = next(row['fields'] for (target, _), row in self.catalog.rows.items() if target == 'DESCRITIVOPROVISAO')
        self.assertEqual(parent['VALORTOTAL'], 588.99)

    def test_a_discount_too_large_after_price_edit_requests_a_new_amount(self):
        self.discount('700')
        self.reply('confirm_edit')
        self.assertEqual(self.state['stage'], 'editing_provision_line_choice')
        self.reply('2')
        index = next(i for i, step in enumerate(self.engine._flow_config(self.state)['steps'])
                     if step['key'] == 'valor_unitario_pagamento')
        self.reply(str(index + 1))
        self.reply('100')
        for _ in range(8):
            if self.state['stage'] != 'selecting_fields':
                break
            self.reply('2')
        self.assertEqual(self.state['stage'], 'entering_provision_discount')
        self.assertEqual(self.units(), [Decimal('100'), Decimal('100')])
        self.reply('50')
        self.assertEqual(self.units(), [Decimal('90'), Decimal('90')])
        self.assertEqual(self.catalog.creates, [])

    def test_started_old_journal_does_not_get_a_new_discount_or_changed_payload(self):
        self.state['provision_commit'] = {'parent_id': 50, 'children': [{'fields': {'VALOR TOTAL': '100'}}]}
        before = copy.deepcopy(self.state)
        self.assertIsNone(self.engine._provision_discount_before_review(self.state, self.fixture.etag()))
        self.assertIsNone(self.engine._provision_discount_before_commit(self.state, self.fixture.etag()))
        self.assertEqual(self.state, before)

    def test_fractional_quantities_keep_the_same_percentage(self):
        for line, quantity, unit in zip(self.state['provision_lines'], ['0.5', '1.5'], ['20', '40']):
            line['fields'].update(QTD=quantity, **{'VALOR TOTAL': unit})
        self.state.update(copy.deepcopy(self.state['provision_lines'][-1]))
        self.discount('7')
        self.assertEqual(self.units(), [Decimal('18'), Decimal('36')])
        self.assertEqual(provision_preview(self.state)['totalDisplay'], 'R$ 93,00')

    def test_transport_rounding_cannot_change_the_approved_cent_amount(self):
        for line, quantity, unit in zip(self.state['provision_lines'], ['0.99999999999999999', '1'], ['1.015', '0']):
            line['fields'].update(QTD=quantity, FRETE='0', **{'VALOR TOTAL': unit})
        self.state.update(copy.deepcopy(self.state['provision_lines'][-1]))
        self.finish_lines()
        self.reply('1')
        original = copy.deepcopy(self.state['provision_lines'])
        self.reply('0,01')
        self.assertEqual(self.state['stage'], 'entering_provision_discount')
        self.assertEqual(self.state['provision_lines'], original)
        self.assertEqual(self.catalog.creates, [])

    def test_very_small_unit_prices_survive_preview_and_numeric_persistence(self):
        self.catalog = NumericTransportCatalog()
        self.engine.sharepoint = self.catalog
        for line in self.state['provision_lines']:
            line['fields'].update(QTD='1000', FRETE='0', **{'VALOR TOTAL': '0.01'})
        self.state.update(copy.deepcopy(self.state['provision_lines'][-1]))
        self.discount('19,99')
        self.assertEqual(self.state['stage'], 'awaiting_confirmation')
        self.assertEqual(self.units(), [Decimal('0.000005'), Decimal('0.000005')])
        self.assertEqual(provision_preview(self.state)['totalDisplay'], 'R$ 0,01')
        self.engine._persist_provision_group(self.state, self.fixture.etag(), self.engine._flow_config(self.state))
        parent = next(row['fields'] for (target, _), row in self.catalog.rows.items() if target == 'DESCRITIVOPROVISAO')
        self.assertEqual(parent['VALORTOTAL'], 0.01)

    def test_returned_snapshot_and_transport_must_both_match_the_discount_total(self):
        for line, quantity, unit, freight in zip(self.state['provision_lines'],
                ['0.3333333333333333333', '1'], ['0.03', '0.005'], ['1', '0']):
            line['fields'].update(QTD=quantity, FRETE=freight, **{'VALOR TOTAL': unit})
        self.state.update(copy.deepcopy(self.state['provision_lines'][-1]))
        self.finish_lines()
        self.reply('1')
        before = copy.deepcopy(self.state['provision_lines'])
        self.reply('0,01')
        self.assertEqual(self.state['stage'], 'entering_provision_discount')
        self.assertEqual(self.state['provision_lines'], before)
        self.assertEqual(self.catalog.creates, [])


if __name__ == '__main__':
    unittest.main()
