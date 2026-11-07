"""Contract tests for the deployed grouped snapshot; synthetic rows only."""
from datetime import date
from unittest import TestCase

from worker.provision_description_settlement import group_snapshot

DAY = date(2026, 11, 7)


def line(item_id, qty, unit, freight, due='2026-11-09', paid=False):
    return {'Id': item_id, 'QTD': qty, 'VALOR TOTAL': unit, 'FRETE': freight,
            'DATA PREVISTO PGTO': due,
            'STATUS': 'Pagamento efetuado' if paid else 'Pagamento previsto',
            'DATA PGTO EFETUADO': '2026-11-08' if paid else None,
            'PGTOAGENDADO': 'Pago' if paid else None}


def row(children, total='61600', display='R$ 61.600,00', **group_fields):
    group = {'Id': 52, 'DATA PREVISTO PGTO': '2026-11-09', 'CHILDREN': children,
             'totalDisplay': display, 'VALOR TOTAL DESCRITIVO': total,
             'PENDING CHILD IDS': [str(c['Id']) for c in children if not c['DATA PGTO EFETUADO']],
             **group_fields}
    return group_snapshot([group], DAY)['rows'][0]


class DueValue(TestCase):
    def test_only_unpaid_lines_on_card_date_contribute_with_freight_and_cents(self):
        result = row([
            line(1, '2', '10000,01', '19,97'),
            line(2, '1', '579,99', '', '09/11/2026'),
            line(3, '1', '1000,02', '', '2026-11-09T03:00:00Z'),
            line(4, '1', '40000', '', '2026-11-10'),
        ])
        self.assertEqual(result['amountDueDisplay'], 'R$ 21.600,00')
        self.assertEqual(result['totalDisplay'], 'R$ 61.600,00')
        self.assertEqual(result['total'], '61600')
        self.assertEqual(result['dueDate'], '2026-11-09')
        self.assertEqual(result['pendingChildIds'], ['1', '2', '3', '4'])

    def test_paid_line_on_card_date_does_not_inflate_value_due(self):
        result = row([line(1, '1', '21600', ''), line(2, '1', '40000', '', paid=True)])
        self.assertEqual(result['amountDueDisplay'], 'R$ 21.600,00')

    def test_all_due_and_single_line_use_the_existing_total(self):
        for children in ([line(1, '1', '61600', '')],
                         [line(1, '1', '21600', ''), line(2, '1', '40000', '')]):
            result = row(children)
            self.assertNotIn('amountDueDisplay', result)
            self.assertEqual(result['totalDisplay'], 'R$ 61.600,00')

    def test_other_dates_inside_the_alert_window_do_not_contribute(self):
        result = row([line(1, '1', '21600', ''), line(2, '1', '40000', '', '2026-11-08')])
        self.assertEqual(result['amountDueDisplay'], 'R$ 21.600,00')

    def test_unconfirmed_dates_do_not_claim_a_subtotal(self):
        for due in (None, '2026-11-10'):
            children = [line(1, '1', '21600', '', '2026-11-10'), line(2, '1', '40000', '', due)]
            self.assertIsNone(row(children)['amountDueDisplay'])

    def test_incomplete_total_keeps_existing_blocked_value(self):
        result = row([line(1, None, '21600', ''), line(2, '1', '40000', '')],
                     total=None, display='—', settlementBlocked=True)
        self.assertNotIn('amountDueDisplay', result)
        self.assertEqual(result['totalDisplay'], '—')
        self.assertTrue(result['settlementBlocked'])
