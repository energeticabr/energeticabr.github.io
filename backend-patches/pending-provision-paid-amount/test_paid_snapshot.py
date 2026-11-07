"""Verify the paid amount on pending provision cards with synthetic rows."""
from datetime import date
from unittest import TestCase

from worker.provision_description_settlement import group_snapshot


def line(item_id, due='2026-11-09', paid=False, quantity='1', unit='100', freight=''):
    return {
        'Id': item_id, 'DATA PREVISTO PGTO': due,
        'STATUS': 'Pagamento efetuado' if paid else 'Pagamento previsto',
        'DATA PGTO EFETUADO': '08/11/2026' if paid else None,
        'PGTOAGENDADO': 'PAGO' if paid else None,
        'QTD': quantity, 'VALOR TOTAL': unit, 'FRETE': freight,
    }


def card(children, pending_ids, **fields):
    group = {
        'Id': 52, 'DATA PREVISTO PGTO': '2026-11-09', 'CHILDREN': children,
        'PENDING CHILD IDS': list(map(str, pending_ids)),
        'VALOR TOTAL DESCRITIVO': '61600', 'totalDisplay': 'R$ 61.600,00',
        **fields,
    }
    return group_snapshot([group], date(2026, 11, 7))['rows'][0]


class PaidSnapshot(TestCase):
    def test_sums_all_confirmed_payments_with_quantity_freight_and_cents(self):
        result = card([
            line(1, unit='20533,34'),
            line(2, '08/11/2026', paid=True, quantity='2', unit='10000,01', freight='19,98'),
            line(3, '2026-11-09T03:00:00Z', paid=True, unit='11066,66'),
            line(4, '2026-11-10', unit='9980,00'),
        ], [1, 4])
        self.assertEqual(result['amountPaidDisplay'], 'R$ 31.086,66')
        self.assertEqual(result['amountDueDisplay'], 'R$ 20.533,34')
        self.assertEqual(result['totalDisplay'], 'R$ 61.600,00')

    def test_omits_paid_amount_when_all_installments_share_the_card_date(self):
        result = card([line(1), line(2, '09/11/2026', paid=True)], [1])
        self.assertNotIn('amountPaidDisplay', result)

    def test_omits_paid_amount_for_one_installment_or_no_confirmed_payment(self):
        unconfirmed = {**line(2, '2026-11-08', paid=True), 'DATA PGTO EFETUADO': None}
        for children, pending in (
            ([line(1)], [1]),
            ([line(1), line(2, '2026-11-10')], [1, 2]),
            ([line(1), unconfirmed], [1]),
        ):
            with self.subTest(children=children):
                self.assertNotIn('amountPaidDisplay', card(children, pending))

    def test_omits_paid_amount_without_a_confirmed_due_split_or_valid_total(self):
        paid = line(2, '2026-11-08', paid=True)
        self.assertNotIn('amountPaidDisplay', card([line(1, '2026-11-10'), paid], [1]))
        self.assertNotIn('amountPaidDisplay', card([line(1), line(2, None, paid=True)], [1]))
        self.assertNotIn('amountPaidDisplay', card([line(1), paid], [1], settlementBlocked=True))
