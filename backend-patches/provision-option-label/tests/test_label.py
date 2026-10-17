"""Compact provision labels keep source identity and financial meaning."""
import copy
import unittest
from provision_description_settlement import group_options


class ProvisionLabelTests(unittest.TestCase):
    def source(self):
        return {'Id': 18, 'FORNECEDOR': 'SWILE', 'DATA PREVISTO PGTO': '2026-10-15T03:00:00Z',
                'totalDisplay': 'R$ 1,00', 'CHILDREN': [{'Id': 332}]}

    def test_compact_label_matches_requested_id_supplier_date_amount(self):
        self.assertEqual(group_options([self.source()])[0]['title'],
                         '18 - SWILE (15/10/2026) - R$ 1,00')

    def test_multiple_child_ids_do_not_expand_label_or_change_selection_identity(self):
        source = self.source()
        source.update({'Id': 28, 'FORNECEDOR': 'ARCELOR MITTAL', 'totalDisplay': 'R$ 8.186,02',
                       'CHILDREN': [{'Id': item_id} for item_id in (342, 343, 344, 345)]})
        before = copy.deepcopy(source)
        option = group_options([source])[0]
        self.assertEqual(option['title'], '28 - ARCELOR MITTAL (15/10/2026) - R$ 8.186,02')
        self.assertEqual(option['id'], 'provision_description:28')
        self.assertEqual(option['value'], '28')
        self.assertEqual(option['source_values'], before)
        self.assertEqual(source, before)

    def test_unknown_amount_stays_explicit_never_zero(self):
        source = self.source()
        source.update({'settlementBlocked': True, 'totalDisplay': '—'})
        self.assertEqual(group_options([source])[0]['title'],
                         '18 - SWILE (15/10/2026) - VALOR PENDENTE')

    def test_brazilian_date_is_not_reversed(self):
        source = self.source()
        source['DATA PREVISTO PGTO'] = '04/11/2026'
        self.assertIn('(04/11/2026)', group_options([source])[0]['title'])

    def test_invalid_or_missing_date_does_not_invent_due_date(self):
        for value in (None, '', 'not a date'):
            source = self.source()
            source['DATA PREVISTO PGTO'] = value
            self.assertIn('(—)', group_options([source])[0]['title'])


if __name__ == '__main__':
    unittest.main()
