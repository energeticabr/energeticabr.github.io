"""Real conversation regression; all SharePoint/media boundaries are synthetic."""
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'provision-settlement-batch-review/tests'))
from test_batch_review import BatchReviewTests


class SingleUnitPriceTests(BatchReviewTests):
    def test_missing_single_price_is_first_question_then_returns_to_review(self):
        self.child_ids = [11]
        self.h.sharepoint.items[11]['fields']['VALOR TOTAL'] = None
        result = self.open()
        self.assertEqual(result.get('field'), 'validar_valor_total_baixa')
        self.assertFalse(any(m.get('detail_table') for m in self.h.messenger.sent))
        self.assertEqual(self.state()['confirm_or_replace_number_modes']['validar_valor_total_baixa'], 'enter_value')
        for invalid in ('0', '-1', 'abc'):
            self.h.reply(invalid)
            self.assertEqual(self.h.engine._current_step(self.state())['key'], 'validar_valor_total_baixa')
            self.no_writes()
        result = self.h.reply('25,55')
        self.assertEqual(result.get('field'), 'description_review')
        self.assertTrue(self.table()['canSubmit'])
        self.assertEqual(self.table()['totalDisplay'], 'R$ 54,10')
        self.assertEqual(self.state()['provision_description']['entries'][0]['fields']['QTD'], '2')
        self.assertEqual(self.h.reply(reply_id='description_review_submit').get('field'), 'data_pgto_efetuado_baixa')
        self.no_writes()

    def test_empty_zero_and_pending_single_prices_ask_before_review(self):
        for price in ('', ' ', 0, '0', '0,00', '0.00', 'PENDENTE', 'VALOR PENDENTE'):
            with self.subTest(price=price):
                case = BatchReviewTests('runTest')
                case.setUp()
                try:
                    case.h.sharepoint.items[11]['fields']['VALOR TOTAL'] = price
                    case.child_ids = [11]
                    result = case.open()
                    self.assertEqual(result.get('field'), 'validar_valor_total_baixa')
                    case.h.reply('25,55')
                    self.assertTrue(case.table()['canSubmit'])
                    case.no_writes()
                finally:
                    case.doCleanups()

    def test_first_price_is_only_written_after_final_confirmation(self):
        self.child_ids = [11]
        self.h.sharepoint.items[11]['fields']['VALOR TOTAL'] = '0'
        self.open()
        self.h.reply('25,55')
        self.prepare()
        self.no_writes()
        result = self.h.reply('SIM')
        self.assertEqual(result.get('status'), 'completed', result)
        self.assertEqual(self.h.sharepoint.items[11]['fields']['VALOR TOTAL'], '25,55')
        self.assertEqual(self.h.sharepoint.items[7]['fields']['VALORTOTAL'], '54.1')

    def test_one_pending_of_several_linked_children_keeps_review(self):
        self.child_ids = [11, 14]
        self.h.sharepoint.items[11]['fields']['VALOR TOTAL'] = None
        self.assertEqual(self.open().get('field'), 'description_review')
        self.assertFalse(self.table()['canSubmit'])

    def test_multiple_missing_prices_keep_review(self):
        self.h.sharepoint.items[11]['fields']['VALOR TOTAL'] = None
        self.assertEqual(self.open().get('field'), 'description_review')
        self.assertFalse(self.table()['canSubmit'])

    def test_attachment_survives_first_price_question_and_return_to_review(self):
        self.child_ids = [11]
        self.h.sharepoint.items[11]['fields']['VALOR TOTAL'] = '0'
        self.open()
        uploaded = self.h.attachment('synthetic-price', 'fixture.pdf', b'fixture')
        self.assertEqual(len(self.state()['attachments']), 1)
        self.assertEqual(self.state()['stage'], 'selecting_fields', uploaded)
        self.assertEqual(self.h.engine._current_step(self.state())['key'], 'validar_valor_total_baixa')
        self.h.reply('12,50')
        self.assertEqual(self.table()['totalDisplay'], 'R$ 28,00')
        self.assertEqual(len(self.state()['attachments']), 1)
        self.no_writes()

    def test_filled_prices_and_other_invalid_values_keep_existing_review(self):
        for price in ('0,01', '10.5', '1.234,56', '-1', 'NaN', True):
            with self.subTest(price=price):
                case = BatchReviewTests('runTest')
                case.setUp()
                try:
                    case.child_ids = [11]
                    case.h.sharepoint.items[11]['fields']['VALOR TOTAL'] = price
                    self.assertEqual(case.open().get('field'), 'description_review')
                    case.no_writes()
                finally:
                    case.doCleanups()


if __name__ == '__main__':
    unittest.main()
