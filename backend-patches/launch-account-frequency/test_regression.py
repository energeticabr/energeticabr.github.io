"""Real workflow selector exercised with synthetic read-only financial history."""
import copy
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(os.environ['ACCOUNT_FREQUENCY_SOURCE']).resolve()
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT), str(ROOT / 'tests')]
import test_workflow as fixtures


class AccountFrequencyTests(unittest.TestCase):
    def setUp(self):
        fixtures.WorkflowTests.setUp(self)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state.directory = temporary.name
        self.config['limits']['inactivity_expiration_enabled'] = False
        seed = fixtures.event('seed', 'text')
        self.current = self.engine._new_state(seed, fixtures.conversation_key(seed))
        self.current.update(flow='launch', stage='selecting_fields',
            fields={'FILIAL': 'FILIAL FICTÍCIA'},
            attachments=[{'object_name': 'qa/receipt', 'sharepoint_name': 'teste.pdf'}],
            idempotency_token='preserved-token')
        steps = self.engine._flow_config(self.current)['steps']
        self.current['step_index'] = next(i for i, s in enumerate(steps) if s['key'] == 'conta_lancamento')
        self.step = steps[self.current['step_index']]
        self.catalog = [dict(id=i, title=f'{i} - {name}', value=name) for i, name in
            [(1, 'AMAEL PF - CAIXA'), (2, 'DINHEIRO'), (3, 'ENERGÉTICA - CAIXA'), (5, 'AMAEL SICOOB')]]
        self.history = [dict(id=i, value='DINHEIRO' if i <= 2 else 'AMAEL SICOOB') for i in range(1, 101)]
        self.reads = []
        self.original_get = self.sharepoint.get_options
        def read(step, context=None):
            if step['key'] == 'recent_launch_account_usage':
                self.reads.append(copy.deepcopy(step))
                return copy.deepcopy(self.history)
            if step['key'] == 'conta_lancamento':
                return copy.deepcopy(self.catalog)
            return self.original_get(step, context)
        self.sharepoint.get_options = read

    def options(self):
        return self.engine._selection_options(self.current, self.step)

    def ids(self):
        return [row['id'] for row in self.options()]

    def test_frequency_overrides_catalog_ids_and_preserves_all_options(self):
        before = copy.deepcopy(self.current)
        result = self.options()
        self.assertEqual([r['id'] for r in result], [5, 2, 1, 3])
        self.assertEqual(sorted((r['id'], r['value']) for r in result),
                         sorted((r['id'], r['value']) for r in self.catalog))
        self.assertEqual(self.current, before)
        self.assertEqual(self.sharepoint.items, {})
        source = self.reads[0]['source']
        self.assertEqual((source['list'], source['value_field'], source['fields']),
                         ('LANCAMENTOS', 'CONTA', ['Id', 'CONTA']))
        self.assertEqual((source['top'], source['sort_field'], source['sort_direction']), (100, 'Id', 'desc'))
        self.assertFalse(source.get('distinct'))
        self.assertFalse(source.get('filters'))
        self.assertFalse(source.get('fetch_all_pages'))

    def test_only_latest_100_ids_count_even_if_connector_ignores_top(self):
        self.history = [dict(id=i, value='DINHEIRO' if i <= 100 else 'AMAEL SICOOB') for i in range(1, 161)]
        self.assertEqual(self.ids(), [5, 2, 1, 3])

    def test_blank_and_unknown_accounts_still_occupy_history_window(self):
        self.history = [dict(id=1, value='DINHEIRO'), dict(id=2, value='AMAEL SICOOB')]
        self.history += [dict(id=i, value=None if i % 2 else 'CONTA ANTIGA') for i in range(3, 102)]
        self.assertEqual(self.ids(), [5, 1, 2, 3])

    def test_normalizes_case_spaces_and_accents_using_stored_value(self):
        self.history = [dict(id=9, value=' energetica   - caixa ')]
        self.assertEqual(self.ids(), [3, 1, 2, 5])

    def test_ties_keep_catalog_order(self):
        self.history = [dict(id=1, value='AMAEL SICOOB'), dict(id=2, value='DINHEIRO')]
        self.assertEqual(self.ids(), [2, 5, 1, 3])

    def test_empty_and_failed_history_keep_every_account_available(self):
        self.history = []
        self.assertEqual(self.ids(), [1, 2, 3, 5])
        previous = self.sharepoint.get_options
        def failed(step, context=None):
            if step['key'] == 'recent_launch_account_usage':
                raise RuntimeError('synthetic outage')
            return previous(step, context)
        self.sharepoint.get_options = failed
        self.assertEqual(self.ids(), [1, 2, 3, 5])

    def test_reopening_for_next_multiple_launch_line_refreshes_usage(self):
        self.current['launch_lines'] = [{'fields': {'CONTA': 'DINHEIRO'}}]
        self.assertEqual(self.ids()[0], 5)
        self.history = [dict(id=101, value='ENERGÉTICA - CAIXA')]
        self.assertEqual(self.ids()[0], 3)
        self.assertEqual(len(self.reads), 2)
        self.assertEqual(self.current['launch_lines'][0]['fields']['CONTA'], 'DINHEIRO')

    def test_other_flows_and_fields_do_not_query_account_history(self):
        self.current['flow'] = 'payment_provision'
        self.options()
        self.current['flow'] = 'launch'
        self.step = {'key': 'produto_lancamento', 'source': {'type': 'static', 'options': []}}
        self.options()
        self.assertEqual(self.reads, [])

    def test_prompt_pages_keep_ranked_ids(self):
        options = self.options()
        page1, meta1 = self.engine._option_page(self.step, options, 4, 0)
        page2, _ = self.engine._option_page(self.step, options, 4, meta1['end'])
        accounts = [r['id'] for r in [*page1, *page2] if isinstance(r['id'], int)]
        self.assertEqual(accounts, [5, 2, 1, 3])

    def test_filtered_choice_saves_account_value_after_reordering(self):
        self.current['options'] = self.options()
        self.engine._save(self.current, None)
        filtered = self.engine.handle(fixtures.event('filter', 'text', reply_id='filter_query', text='AMAEL'))
        self.assertEqual(filtered['status'], 'filtered_options')
        self.current = self.state.load(self.current['key'])[0]
        selected = self.engine.handle(fixtures.event('pick', 'text', reply_id='choice:conta_lancamento:5'))
        self.current = self.state.load(self.current['key'])[0]
        self.assertEqual(self.current['fields']['CONTA'], 'AMAEL SICOOB')
        self.assertEqual(self.current['idempotency_token'], 'preserved-token')
        self.assertEqual(len(self.current['attachments']), 1)
        self.assertEqual(self.sharepoint.items, {})


if __name__ == '__main__':
    unittest.main()
