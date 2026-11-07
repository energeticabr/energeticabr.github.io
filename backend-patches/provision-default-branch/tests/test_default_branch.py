import copy
import json
import os
from pathlib import Path
import sys
import unittest

stage = Path('/home/opc/provision-default-branch-20261106')
sys.path[:0] = ['/opt/energetica-whatsapp/worker', '/opt/energetica-whatsapp', str(stage/'tests')]
os.environ['ENERGETICA_BACKEND_TEST_ROOT'] = '/opt/energetica-whatsapp'
from test_first_freight import FirstFreightTests, Catalog
from clients import SharePointClient

class CatalogWithDefault(Catalog):
    def __init__(self):
        super().__init__()
        self.preferred = '000 - CENTRAL QA'
        self.lookup = object.__new__(SharePointClient)
        self.lookup._internal_field = lambda target, field: field
        self.lookup._list_endpoint = lambda target: target
        self.lookup._request = lambda method, path, **kw: {'value': [{'FILIAL': self.preferred}]}

    def get_options(self, step, context):
        if step.get('target_field') != 'FILIAL':
            return super().get_options(step, context)
        options = [{'id': 5, 'title': '004 - OBRA QA', 'value': '004 - OBRA QA'},
                   {'id': 1, 'title': '000 - CENTRAL QA', 'value': '000 - CENTRAL QA'},
                   {'id': 9, 'title': '999 - PESSOAL QA', 'value': '999 - PESSOAL QA'}]
        return self.lookup._decorate_recommended_options(step['source'], context, options)

class DefaultBranchTests(unittest.TestCase):
    def setUp(self):
        self.fixture = FirstFreightTests()
        self.fixture.setUp()
        self.engine, self.state = self.fixture.engine, self.fixture.state
        self.catalog = CatalogWithDefault()
        self.engine.sharepoint = self.catalog
        if os.getenv('CANDIDATE'):
            self.engine.config = json.loads((stage/'candidate-config.json').read_bytes())
        self.state['step_index'] = self.fixture.index('filial_pagamento')

    def options(self):
        step = self.engine._current_step(self.state)
        return self.engine._selection_options(self.state, step)

    def test_default_is_first_with_star_for_single_and_multiple(self):
        for mode in ['UNICO', 'MULTIPLOS']:
            self.state['answers']['tipo_provisao_pagamento'] = mode
            options = self.options()
            self.assertEqual([row['id'] for row in options], [1, 5])
            self.assertEqual(options[0]['title'], '⭐ 000 - CENTRAL QA (PADRÃO DO FORNECEDOR)')
            self.assertEqual(options[0]['value'], '000 - CENTRAL QA')
            self.assertTrue(options[0]['recommended'])
            self.assertEqual(self.catalog.creates, [])

    def test_no_default_or_missing_or_disallowed_default_does_not_add_options(self):
        for default in ['', None, '999 - PESSOAL QA', '001 - INEXISTENTE QA']:
            self.catalog.preferred = default
            options = self.options()
            self.assertEqual([row['id'] for row in options], [5, 1])
            self.assertFalse(any(row.get('recommended') for row in options))

    def test_supplier_default_changes_are_reflected_on_refresh(self):
        self.catalog.preferred = '004 - OBRA QA'
        self.assertEqual(self.options()[0]['id'], 5)
        self.catalog.preferred = '000 - CENTRAL QA'
        self.assertEqual(self.options()[0]['id'], 1)

    def test_selection_preserves_catalog_value_and_id(self):
        step = self.engine._current_step(self.state)
        self.state['options'] = self.options()
        self.engine._handle_selection_reply({'kind': 'text', 'text': '1', 'reply_id': '1'},
            self.state, self.fixture.etag(), step)
        self.assertEqual(self.state['fields']['FILIAL'], '000 - CENTRAL QA')
        self.assertEqual(self.state['selections']['filial_pagamento']['id'], 1)
        self.assertEqual(self.catalog.creates, [])

    def test_filter_clear_and_refresh_keep_default_marked(self):
        self.state['options'] = self.options()
        for raw, extra in [('CENTRAL', {'reply_id': 'filter_query'}),
                           ('filter_clear', {'reply_id': 'filter_clear'}),
                           ('refresh_options', {'reply_id': 'refresh_options'})]:
            self.engine._handle_selection_reply({'kind': 'text', 'text': raw, **extra},
                self.state, self.fixture.etag(), self.engine._current_step(self.state))
            rows = self.fixture.messenger.sent[-1]['options']
            default = next(row for row in rows if row.get('id') == 1)
            self.assertTrue(default['title'].startswith('⭐ '))
            self.assertTrue(default['recommended'])
            self.assertEqual(self.catalog.creates, [])

    def test_absent_supplier_has_no_default(self):
        self.state['fields'].pop('FORNECEDOR', None)
        self.state['answers'].pop('fornecedor_pagamento', None)
        self.assertFalse(any(row.get('recommended') for row in self.options()))

if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(DefaultBranchTests))
    raise SystemExit(not result.wasSuccessful())
