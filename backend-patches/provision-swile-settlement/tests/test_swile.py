"""SWILE billing groups retain each employee owner and retry idempotently."""
import copy
import unittest
import re
from urllib.parse import unquote, urlsplit
from test_single_order import Fixture
from test_scoped_fanout import ScopedFanoutTests
import test_parent_fanout as files


class SwileSettlementTests(unittest.TestCase):
    def ready(self):
        f = Fixture()
        f.client.site_url = 'https://synthetic.invalid'
        f.client._internal_field = lambda kind, field: field
        f.client._list_endpoint = lambda kind: "web/lists/getbytitle('" + kind + "')"
        def request(method, endpoint, params=None, **kwargs):
            assert method == 'GET'
            path = unquote(urlsplit(endpoint).path)
            match = re.search(r"getbytitle\('([^']+)'\)/items(?:\((\d+)\))?(.*)$", path)
            assert match, path
            kind, ident, suffix = match.groups()
            if ident and suffix == '/AttachmentFiles':
                return {'value': []}
            if not ident and not suffix:
                return {'value': [{'Id': i} for (k,i),row in f.client.items.items()
                                  if k == kind and str(row.get('DESCRITIVOPROVISAO')) == '7']}
            raise AssertionError(path)
        f.client._request = request
        f.client.items['DESCRITIVOPROVISAO', 7]['FORNECEDOR'] = 'SWILE'
        for i in (11,12,13,14):
            f.client.items['PROVISÃO PGTOS', i]['FORNECEDOR'] = f'Employee {i}'
        f.engine._description_start(f.state, f.client.get_provision_description_for_settlement(7))
        f.ready()
        return f

    def test_swile_group_settles_under_one_order_with_individual_launches(self):
        f = self.ready()
        result=f.commit()
        self.assertEqual(result['status'], 'completed', result)
        orders = f.created('NOTASPENDENTES')
        self.assertEqual(len(orders), 1)
        self.assertEqual(orders[0][1]['FORNECEDOR'], 'SWILE')
        launches = f.created('LANCAMENTOS')
        self.assertEqual(len(launches), 4)
        for _, fields in launches:
            child = f.client.items['PROVISÃO PGTOS', int(fields['IDPGTOAGENDADO'])]
            self.assertEqual(fields['FORNECEDOR'], child['FORNECEDOR'])
            self.assertEqual(str(fields['AGRUPAR']), str(orders[0][0]))

    def test_swile_retry_after_child_failure_reuses_order(self):
        f = self.ready()
        f.client.fail_before_child = 12
        self.assertEqual(f.commit()['status'], 'submission_failed')
        result=f.commit()
        self.assertEqual(result['status'], 'completed', result)
        self.assertEqual(len(f.created('NOTASPENDENTES')), 1)
        self.assertEqual(len(f.created('LANCAMENTOS')), 4)


class SwileAttachmentTests(ScopedFanoutTests):
    def test_swile_parent_and_order_copy_evidence_without_changing_employees(self):
        self.client.items[files.PARENT,7]['FORNECEDOR'] = 'SWILE'
        self.parent_owner = copy.deepcopy(self.client.items[files.PARENT,7])
        self.client.items[files.ORDER,50]['FORNECEDOR'] = 'SWILE'
        self.client.items[files.CHILD,12]['IDPEDIDO'] = '50'
        self.client.items[files.LAUNCH,61]['AGRUPAR'] = '50'
        self.sync(expected_owners=self.owners)
        self.assertIn(b'parent proof', self.client.files[files.ORDER,50].values())
        self.assertEqual(self.client.items[files.LAUNCH,61]['FORNECEDOR'], 'Second supplier')
        self.client.files[files.ORDER,50].clear()
        self.sync()
        self.assertIn(b'parent proof', self.client.files[files.ORDER,50].values())

    def test_swile_order_without_matching_parent_is_rejected(self):
        self.client.items[files.ORDER,50]['FORNECEDOR'] = 'SWILE'
        with self.assertRaises(RuntimeError):
            self.sync(expected_owners=self.owners)
        self.assertFalse(self.client.uploads)


if __name__ == '__main__':
    unittest.main()
