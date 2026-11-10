"""Verify that each snapshot product uses the OBS of its linked provision."""
from datetime import date
from unittest import TestCase

from worker.provision_description_settlement import group_snapshot


def card(*children):
    due = date(2026, 11, 10)
    group = {
        'Id': 21, 'DATA PREVISTO PGTO': due.isoformat(), 'OBS': 'OBS DO DESCRITIVO',
        'CHILDREN': [
            {'Id': item_id, 'PRODUTO': product, 'OBS': obs, 'DATA PREVISTO PGTO': due.isoformat()}
            for item_id, (product, obs) in enumerate(children, 335)
        ],
        'PENDING CHILD IDS': [str(i) for i in range(335, 335 + len(children))],
        'VALOR TOTAL DESCRITIVO': '300', 'totalDisplay': 'R$ 300,00',
    }
    return group_snapshot([group], due)['rows'][0]


class ProductObservationSnapshot(TestCase):
    def test_uses_only_the_linked_provision_observation(self):
        row = card(('CONTABILIDADE', '  FOLHA DE TESTE  '))
        self.assertEqual(row['product'], 'CONTABILIDADE')
        self.assertEqual(row.get('productDisplay'), 'CONTABILIDADE (FOLHA DE TESTE)')

    def test_pairs_distinct_observations_with_products_in_linked_order(self):
        row = card(('SERVIÇOS', 'MÊS 1'), ('TAXAS', ' '), ('SERVIÇOS', 'MÊS 2'))
        self.assertEqual(row.get('productDisplay'), 'SERVIÇOS (MÊS 1) / TAXAS / SERVIÇOS (MÊS 2)')

    def test_preserves_original_product_summary_when_observations_are_blank(self):
        row = card(('SERVIÇOS', None), ('SERVIÇOS', ''), ('TAXAS', ' \n '))
        self.assertEqual(row['product'], 'SERVIÇOS / TAXAS')
        self.assertNotIn('productDisplay', row)
