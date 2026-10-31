"""Signed launch adjustments, real engine/config and in-memory destinations only.

Set ENERGETICA_BACKEND_TEST_ROOT to the private backend snapshot. No tenant
clients, credentials, production files or private source are bundled here.
"""
import copy
import importlib.util
import os
from decimal import Decimal, ROUND_HALF_UP, localcontext
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'multi-provision-first-freight/tests'))
import test_first_freight as fixture
from workflow import _parse_decimal
from launch_cash_receipt import CashReceiptError


def number(raw):
    return Decimal(str(raw).replace(',', '.'))


def cents(raw):
    return number(raw).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


class LaunchCatalog(fixture.Catalog):
    """Idempotent create-only synthetic lists; optionally emulate numeric columns."""
    numeric_fields = {'QUANTIDADE', 'VALOR UNITÁRIO', 'FRETE', 'VALORTOTAL'}

    def __init__(self, numeric=False):
        super().__init__()
        self.numeric = numeric
        self.fail_launch_verification = False

    def transported(self, fields):
        return {key: float(number(value)) if self.numeric and key in self.numeric_fields else value
                for key, value in fields.items()}

    def get_options(self, step, context):
        if step.get('key') == 'unidade_padrao_produto_lancamento':
            return [{'id': 1, 'title': 'UN', 'value': 'UN'}]
        return super().get_options(step, context)

    def ensure_item(self, token, fields, *, target_list, **kwargs):
        if target_list not in {'LANCAMENTOS', 'NOTASPENDENTES'}:
            raise AssertionError('Unexpected synthetic destination')
        if kwargs.get('merge_existing') is not False:
            raise AssertionError('Financial retry must remain create-only')
        existing = self.tokens.get((target_list, token))
        if existing:
            return existing
        item_id = 100 + len(self.rows)
        self.rows[target_list, item_id] = {'fields': copy.deepcopy(self.transported(fields)), 'version': 1}
        self.tokens[target_list, token] = item_id
        self.creates.append((target_list, item_id))
        return item_id

    def verify_item(self, item_id, fields, names, *, target_list):
        if names or self.rows[target_list, item_id]['fields'] != self.transported(fields):
            raise AssertionError('Synthetic stored payload differs')
        if target_list == 'LANCAMENTOS' and self.fail_launch_verification:
            self.fail_launch_verification = False
            raise RuntimeError('Synthetic lost launch verification response')
        return {'fields': True, 'attachments': True}


class LaunchSignedDiscountTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture.FirstFreightTests()
        self.fixture.setUp()
        self.engine, self.state = self.fixture.engine, self.fixture.state
        self.catalog = LaunchCatalog()
        self.engine.sharepoint = self.catalog
        self.state.update(flow='launch', stage='selecting_fields',
                          launch_lines=[self.line('2', '100'), self.line('3', '200', '30')],
                          multi_launch_freight='30', current_launch_line_saved=True,
                          attachments=[], attachments_decision='no', attachments_phase_completed=True)
        self.state.update(copy.deepcopy(self.state['launch_lines'][-1]))
        self.state['answers'].update(aplicar_desconto_global_lancamento='SIM',
                                     acrescentar_linha_lancamento='NÃO')
        self.steps = self.engine._flow_config(self.state)['steps']
        self.step_index = next(i for i, row in enumerate(self.steps)
                               if row['key'] == 'valor_desconto_global_lancamento')
        self.state['step_index'] = self.step_index

    @staticmethod
    def line(quantity, unit, freight='0'):
        fields = {'QUANTIDADE': quantity, 'VALOR UNITÁRIO': unit, 'FRETE': freight,
                  'PRODUTO': 'PRODUTO SINTÉTICO', 'FORNECEDOR': 'FORNECEDOR QA',
                  'FILIAL': '004 - OBRA QA', 'UN': 'UN', 'DESCRIÇÃO': 'OBSERVAÇÃO ORIGINAL', 'CONTA': 'BANCO QA'}
        return {'fields': fields, 'display_values': copy.deepcopy(fields),
                'selections': {'produto_lancamento': {'id': 1}},
                'answers': {'tipo_lancamento': 'LANÇAMENTO MÚLTIPLO',
                            'pedido_lancamento': 'NOVO PEDIDO'}, 'attachments': []}

    def enter(self, raw):
        self.state.update(stage='selecting_fields', step_index=self.step_index)
        return self.engine._handle_number_reply({'text': raw}, self.state, self.fixture.etag(),
                                                 self.steps[self.step_index])

    def apply(self, raw):
        self.state['answers']['valor_desconto_global_lancamento'] = raw
        self.engine._apply_multi_launch_global_discount(self.state)

    def total(self, rows=None):
        rows = rows if rows is not None else [row['fields'] for row in self.state['launch_lines']]
        return cents(sum((number(row['QUANTIDADE']) * number(row['VALOR UNITÁRIO'])
                          + number(row['FRETE']) for row in rows), Decimal('0')))

    def commit(self):
        # Keep creation, calculations, checkpoints and verification real. Stop
        # only after persistence, before unrelated notification/HR workflows.
        original = self.engine._continue_confirmed_launch
        self.engine._continue_confirmed_launch = lambda *args: {'status': 'synthetic_persisted'}
        try:
            return self.engine._commit_multiple_launch(self.state, self.fixture.etag(),
                                                       self.engine._flow_config(self.state))
        finally:
            self.engine._continue_confirmed_launch = original

    def test_negative_six_cents_is_accepted_and_added_by_real_number_handler(self):
        self.assertEqual(self.enter('-0,06')['status'], 'awaiting_confirmation')
        self.assertEqual(self.state['answers']['valor_desconto_global_lancamento'], '-0,06')
        self.assertEqual(self.total(), Decimal('830.06'))
        self.assertEqual(self.catalog.creates, [])

    def test_surcharge_is_not_limited_by_product_subtotal(self):
        self.enter('-1600,00')
        self.assertEqual(self.state['stage'], 'awaiting_confirmation')
        self.assertEqual(self.total(), Decimal('2430.00'))

    def test_signed_allocations_use_gross_weights_without_positive_discount_caps(self):
        allocate = self.engine._proportional_discount_allocations
        self.assertEqual(allocate([Decimal('1'), Decimal('3')],
                                 [Decimal('1'), Decimal('3')], Decimal('-8')),
                         [Decimal('-2'), Decimal('-6')])
        self.assertEqual(allocate([Decimal('1'), Decimal('100')],
                                 [Decimal('1000'), Decimal('100')], Decimal('50')),
                         [Decimal('1'), Decimal('49')])

    def test_surcharge_can_raise_zero_product_prices_including_all_zero_lines(self):
        self.state['multi_launch_freight'] = '0'
        self.state['launch_lines'] = [self.line('2', '0'), self.line('3', '0')]
        self.apply('-0,06')
        self.assertEqual(self.total(), Decimal('0.06'))
        self.assertTrue(all(number(row['fields']['VALOR UNITÁRIO']) >= 0
                            for row in self.state['launch_lines']))

    def test_summary_and_line_notes_name_surcharge_and_show_its_magnitude(self):
        self.apply('-0,06')
        rows = self.engine._multiple_launch_summary_rows(self.state)
        by_label = {row['label']: row['value'] for row in rows}
        self.assertIn('ACRÉSCIMO GLOBAL', by_label)
        self.assertEqual(by_label['ACRÉSCIMO GLOBAL'], 'R$ 0,06')
        self.assertEqual(by_label['VALOR TOTAL APÓS ACRÉSCIMO'], 'R$ 830,06')
        for row in self.state['launch_lines']:
            self.assertIn('ACRÉSCIMO GLOBAL APLICADO', row['fields']['DESCRIÇÃO'])
            self.assertEqual(row['fields']['DESCRIÇÃO'].count('OBSERVAÇÃO ORIGINAL'), 1)

    def test_prompt_explains_negative_six_cents_before_amount_entry(self):
        self.engine._prompt_next_or_summary(self.state, self.fixture.etag())
        message = self.fixture.messenger.sent[-1]
        body = str(message.get('body') or message.get('step', {}).get('prompt', ''))
        self.assertIn('-0,06', body)
        self.assertIn('ACRÉSCIMO', body)

    def test_invalid_signed_input_does_not_change_lines_or_create_items(self):
        for raw in ['-0,001', '--1', '-1e2', 'NaN', '-Infinity', '0', '-0,00', '-1,234', '1.2.3']:
            with self.subTest(raw=raw):
                before = copy.deepcopy(self.state['launch_lines'])
                self.assertEqual(self.enter(raw)['status'], 'invalid_number')
                self.assertEqual(self.state['launch_lines'], before)
                self.assertEqual(self.catalog.creates, [])

    def test_generic_quantity_unit_and_freight_number_handlers_stay_positive_only(self):
        for field in ['QUANTIDADE', 'VALOR UNITÁRIO', 'FRETE']:
            step = next(row for row in self.steps
                        if row.get('target_field') == field and row['kind'] == 'number')
            before = copy.deepcopy(self.state['fields'])
            result = self.engine._handle_number_reply({'text': '-0,06'}, self.state,
                                                       self.fixture.etag(), step)
            self.assertEqual(result['status'], 'invalid_number')
            self.assertEqual(self.state['fields'], before)
            self.assertIsNone(_parse_decimal('-0,06', allow_zero=True))

    def test_repeated_apply_summary_and_resume_never_compound_surcharge(self):
        self.enter('-0,06')
        expected = copy.deepcopy(self.state['launch_lines'])
        for _ in range(3):
            self.engine._apply_multi_launch_global_discount(self.state)
            self.engine._multiple_launch_summary_rows(self.state)
            self.engine._resume_draft_prompt(self.state, self.fixture.etag())
        self.assertEqual(self.total(), Decimal('830.06'))
        self.assertEqual(self.state['launch_lines'], expected)

    def test_edit_remove_and_sign_switch_restore_originals_before_reapplying(self):
        for raw, expected in [('-0,06', '830.06'), ('80', '750'), ('-10', '840'), ('0', '830')]:
            with self.subTest(raw=raw):
                self.apply(raw)
                self.assertEqual(self.total(), Decimal(expected))
        self.apply('-0,06')
        self.state['answers']['aplicar_desconto_global_lancamento'] = 'NÃO'
        self.engine._apply_multi_launch_global_discount(self.state)
        self.assertEqual(self.total(), Decimal('830'))
        for row in self.state['launch_lines']:
            self.assertEqual(row['fields']['DESCRIÇÃO'], 'OBSERVAÇÃO ORIGINAL')

    def test_review_menu_removes_surcharge_then_can_enter_opposite_sign(self):
        self.assertEqual(self.enter('-0,06')['status'], 'awaiting_confirmation')
        self.fixture.reply('confirm_edit')
        option = next(row for row in self.state['options']
                      if row.get('value') == '__edit_global_discount__')
        self.fixture.reply(str(option['id']))
        self.fixture.reply('1')
        self.fixture.reply('80')
        self.assertEqual(self.total(), Decimal('750'))
        self.fixture.reply('confirm_edit')
        self.fixture.reply(str(option['id']))
        self.fixture.reply('2')
        self.assertEqual(self.total(), Decimal('830'))

    def test_restored_numeric_metadata_keeps_the_negative_sign(self):
        for raw in [-0.06, Decimal('-0.06'), '-0,06']:
            with self.subTest(raw=raw):
                self.state['answers'].pop('valor_desconto_global_lancamento', None)
                self.state['answers'].pop('aplicar_desconto_global_lancamento', None)
                self.state['multi_launch_discount'] = {'enabled': True, 'discount': raw}
                self.engine._apply_multi_launch_global_discount(self.state)
                self.assertEqual(self.total(), Decimal('830.06'))

    def test_positive_limits_full_discount_and_legacy_zero_are_preserved(self):
        self.assertEqual(self.enter('800,01')['status'], 'invalid_discount')
        self.apply('800')
        self.assertEqual(self.total(), Decimal('30'))
        self.assertTrue(all(number(row['fields']['VALOR UNITÁRIO']) == 0
                            for row in self.state['launch_lines']))
        self.apply('0')
        self.assertEqual(self.total(), Decimal('830'))
        self.assertFalse(self.state['multi_launch_discount']['enabled'])

    def test_legacy_positive_fractional_discount_keeps_its_precision(self):
        self.assertEqual(self.enter('1,234')['status'], 'awaiting_confirmation')
        self.assertEqual(self.state['answers']['valor_desconto_global_lancamento'], '1,234')
        self.assertEqual(self.state['multi_launch_discount']['discount'], '1,234')
        self.assertEqual(self.total(), Decimal('828.77'))
        # Summary, resume, edit menu and persistence all read stored metadata.
        self.state['answers'].pop('valor_desconto_global_lancamento')
        self.engine._multiple_launch_summary_rows(self.state)
        self.engine._launch_line_edit_options(self.state)
        self.engine._resume_draft_prompt(self.state, self.fixture.etag())
        self.assertEqual(self.total(), Decimal('828.77'))
        self.commit()
        parent = next(row['fields'] for (target, _), row in self.catalog.rows.items()
                      if target == 'NOTASPENDENTES')
        self.assertEqual(cents(parent['VALORTOTAL']), Decimal('828.77'))

    def test_fractional_quantities_preserve_freight_quantity_and_cent_total(self):
        self.state['launch_lines'] = [self.line('0.5', '20'), self.line('1.5', '40', '30')]
        self.apply('-0,06')
        self.assertEqual(self.total(), Decimal('100.06'))
        self.assertEqual([row['fields']['QUANTIDADE'] for row in self.state['launch_lines']], ['0.5', '1.5'])
        self.assertEqual([row['fields']['FRETE'] for row in self.state['launch_lines']], ['0', '30'])

    def test_line_price_edit_uses_original_prices_without_compounding_surcharge(self):
        self.apply('-0,06')
        self.engine._remove_multi_launch_discount_adjustments(self.state)
        self.engine._restore_launch_line(self.state, self.state['launch_lines'][1])
        self.state['fields']['VALOR UNITÁRIO'] = '100'
        self.state['editing_launch_line_index'] = 1
        self.engine._finish_launch_line_summary_edit(self.state, self.fixture.etag())
        self.assertEqual(self.total(), Decimal('530.06'))

    def test_line_deletion_reallocates_same_surcharge_and_preserves_freight(self):
        self.apply('-0,06')
        self.engine._prompt_launch_line_delete_choice(self.state, self.fixture.etag())
        self.fixture.reply('1')
        self.assertEqual(self.total(), Decimal('630.06'))
        self.assertEqual(len(self.state['launch_lines']), 1)
        self.assertEqual(self.state['launch_lines'][0]['fields']['FRETE'], '30')

    def test_unrepresentable_numeric_transport_does_not_reach_review_or_mutate_lines(self):
        self.state['multi_launch_freight'] = '0'
        self.state['launch_lines'] = [self.line('0.99999999999999999', '1.005'), self.line('1', '0')]
        self.state.update(copy.deepcopy(self.state['launch_lines'][-1]))
        self.state['answers']['aplicar_desconto_global_lancamento'] = 'SIM'
        before = copy.deepcopy(self.state['launch_lines'])
        self.assertEqual(self.enter('-0,01')['status'], 'invalid_discount')
        self.assertEqual(self.state['launch_lines'], before)
        self.assertEqual(self.catalog.creates, [])

    def test_low_ambient_precision_cannot_hide_a_cent_mismatch_in_surcharge(self):
        self.state['multi_launch_freight'] = '0'
        self.state['launch_lines'] = [self.line('3.32', '6833.7'), self.line('8.6', '5361.485')]
        self.state.update(copy.deepcopy(self.state['launch_lines'][-1]))
        self.state['answers']['aplicar_desconto_global_lancamento'] = 'SIM'
        before = copy.deepcopy(self.state['launch_lines'])
        # Exact original 68796.655 + 0.06 = 68796.715, payable 68796.72.
        # Rounded float units actually yield 68796.71: precision 16 used to
        # hide that difference in both the calculation and its own validator.
        with localcontext() as ambient:
            ambient.prec = 16
            result = self.enter('-0,06')
            self.assertEqual(ambient.prec, 16)
        self.assertEqual(result['status'], 'invalid_discount')
        self.assertEqual(self.state['launch_lines'], before)
        self.assertEqual(self.catalog.creates, [])

    def test_malformed_restored_adjustment_fails_closed(self):
        self.state['answers'].pop('aplicar_desconto_global_lancamento', None)
        self.state['multi_launch_discount'] = {'enabled': True, 'discount': '-NaN'}
        with self.assertRaises(ValueError):
            self.engine._apply_multi_launch_global_discount(self.state)
        self.assertEqual(self.catalog.creates, [])

    def test_commit_persists_surcharged_lines_and_same_order_total_after_numeric_transport(self):
        self.catalog = LaunchCatalog(numeric=True)
        self.engine.sharepoint = self.catalog
        self.state['launch_lines'] = [self.line('0.5', '20'), self.line('1.5', '40', '30')]
        self.apply('-0,06')
        self.commit()
        children = [row['fields'] for (target, _), row in self.catalog.rows.items() if target == 'LANCAMENTOS']
        parent = next(row['fields'] for (target, _), row in self.catalog.rows.items() if target == 'NOTASPENDENTES')
        self.assertEqual(self.total(children), Decimal('100.06'))
        self.assertEqual(cents(parent['VALORTOTAL']), Decimal('100.06'))
        self.assertIn('ACRÉSCIMO GLOBAL: R$ 0,06', parent['OBS'])
        self.assertNotIn('DESCONTO GLOBAL', parent['OBS'])
        self.assertEqual(len({row['AGRUPAR'] for row in children}), 1)

    def test_commit_retry_preserves_payload_and_does_not_duplicate_surcharge_or_items(self):
        self.apply('-0,06')
        self.catalog.fail_launch_verification = True
        with self.assertRaises(CashReceiptError):
            self.commit()
        frozen = copy.deepcopy(self.catalog.rows)
        self.commit()
        for key, row in frozen.items():
            self.assertEqual(self.catalog.rows[key], row)
        self.assertEqual(len(self.catalog.creates), 3)
        self.assertEqual(self.total(), Decimal('830.06'))

    def cash_retry(self, initial_engine, resumed_engine):
        self.engine = initial_engine
        for line in self.state['launch_lines']:
            line['fields']['CONTA'] = 'DINHEIRO'
        self.state['fields']['CONTA'] = 'DINHEIRO'
        self.state['stage'] = 'committing'
        self.catalog.fail_launch_verification = True
        # Legacy payloads were frozen at the baseline's usual precision 28,
        # even when this regression suite itself runs at ambient precision 16.
        with localcontext() as legacy_context:
            legacy_context.prec = 28
            self.apply('0,06')
            with self.assertRaises(CashReceiptError):
                self.commit()
        self.assertEqual(len(self.catalog.creates), 2)
        frozen_lines = copy.deepcopy(self.state['launch_lines'])
        frozen_journal = {token: copy.deepcopy(row['fields'])
                          for token, row in self.state['launch_cash_writes'].items()}
        frozen_rows = copy.deepcopy(self.catalog.rows)
        self.state, _ = self.fixture.store.load(self.state['key'])
        self.fixture.state = self.state
        self.engine = resumed_engine
        try:
            resumed = self.commit()
        except CashReceiptError:
            self.fail('A started cash journal must resume with its frozen unit prices, without recalculation')
        self.assertEqual(resumed['status'], 'synthetic_persisted')
        self.assertEqual(self.state['launch_lines'], frozen_lines)
        for token, fields in frozen_journal.items():
            self.assertEqual(self.state['launch_cash_writes'][token]['fields'], fields)
        for key, row in frozen_rows.items():
            self.assertEqual(self.catalog.rows[key], row)
        self.assertEqual(len(self.catalog.creates), 3)
        self.assertEqual(self.total(), Decimal('829.94'))

    def test_legacy_cash_discount_journal_resumes_without_recalculating_frozen_prices(self):
        baseline_root = Path(os.environ.get('ENERGETICA_BACKEND_TEST_BASELINE_ROOT',
                                             str(fixture.ROOT.parent / 'baseline')))
        baseline_source = baseline_root / 'worker/workflow.py'
        self.assertTrue(baseline_source.is_file(),
                        'Provide the private baseline via ENERGETICA_BACKEND_TEST_BASELINE_ROOT')
        spec = importlib.util.spec_from_file_location('_launch_signed_baseline', baseline_source)
        baseline = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(baseline)
        initial = baseline.WorkflowEngine(self.fixture.config, self.fixture.store, None,
                                         self.fixture.messenger, self.catalog,
                                         summary_builder=self.fixture.summary)
        self.cash_retry(initial, self.engine)
        first = next(iter(self.state['launch_cash_writes'].values()))
        self.assertEqual(first['fields']['VALOR UNITÁRIO'], '99,99277108433734939759036145')

    def test_current_cash_discount_journal_also_keeps_its_frozen_prices_on_retry(self):
        self.cash_retry(self.engine, self.engine)


if __name__ == '__main__':
    unittest.main()
