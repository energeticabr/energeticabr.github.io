"""Exercise real settlement/fanout with SharePoint automation racing its caller."""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.append(str(Path(__file__).parent.parent / 'payroll-row-attachments' / 'tests'))
from test_propagation import Fixture, CHILD


class OwnProgressTests(unittest.TestCase):
    def fixture(self, extra=None):
        f = Fixture()
        f.state['flow'] = 'payment_settlement'
        ensure = f.client.ensure_item
        self.armed = None
        def create(token, fields, target_list=None, **kwargs):
            existing = (target_list, token) in f.client.tokens
            ident = ensure(token, fields, target_list, **kwargs)
            if target_list == 'LANCAMENTOS' and not existing:
                child = int(fields['IDPGTOAGENDADO'])
                self.armed = (child, ident, fields['AGRUPAR'])
            return ident
        f.client.ensure_item = create
        read = f.client._request
        def automate(method, endpoint, **kwargs):
            if self.armed and endpoint.startswith('LANCAMENTOS') and '/$value' in endpoint:
                child, launch, order = self.armed
                self.armed = None
                f.client.items[CHILD, child].update({
                    'IDPEDIDO': str(order), 'IDLANCAMENTOS': str(launch),
                    'STATUS': 'PAGAMENTO EFETUADO', 'DATA PGTO EFETUADO': '2026-10-19T12:00:00Z'})
                f.client.items[CHILD, child].update(extra or {})
                key = CHILD, child
                f.client.versions[key] = f.client.versions.get(key, 0) + 1
            return read(method, endpoint, **kwargs)
        f.client._request = automate
        return f

    def test_own_automatic_links_during_fanout_complete_once(self):
        f = self.fixture()
        result = f.commit()
        self.assertEqual(result['status'], 'completed', result)
        self.assertEqual(len(f.client.tokens), 3)
        self.assertEqual(f.client.items[CHILD, 11]['PGTOAGENDADO'], 'PAGO')
        self.assertEqual(f.client.items[CHILD, 12]['PGTOAGENDADO'], 'PAGO')

    def test_interrupted_after_automation_resumes_without_duplicate_launch(self):
        f = self.fixture()
        request = f.client._request
        def fail_after_automation(*args, **kwargs):
            armed = self.armed
            result = request(*args, **kwargs)
            if armed and self.armed is None:
                f.client._request = request
                raise RuntimeError('synthetic interrupted attachment transfer')
            return result
        f.client._request = fail_after_automation
        self.assertEqual(f.commit()['status'], 'failed')
        result = f.commit()
        self.assertEqual(result['status'], 'completed', result)
        self.assertEqual(len(f.client.tokens), 3)

    def test_external_amount_change_after_financial_creation_remains_blocked(self):
        for changes in ({'VALOR TOTAL': '999'}, {'QTD': '99'}, {'FORNECEDOR': 'Other'},
                        {'FILIAL': 'Other'}, {'IDPEDIDO': '999'}, {'IDLANCAMENTOS': '999'},
                        {'DATA PGTO EFETUADO': '2026-10-20'},
                        {'DATA PGTO EFETUADO': '2026-10-19T02:59:59Z'}, {'FORMAPGTO': 'Other'},
                        {'OBS': 'external edit'}):
            with self.subTest(changes=changes):
                f = self.fixture(extra=changes)
                self.assertEqual(f.commit()['status'], 'failed')
                self.assertNotEqual(f.client.items[CHILD, 11].get('PGTOAGENDADO'), 'PAGO')
                self.assertEqual(f.commit()['status'], 'failed')


if __name__ == '__main__': unittest.main()
