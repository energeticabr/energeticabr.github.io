"""Read-only regression cases for the launch stage selector."""
import copy
import unittest
import test_workflow as legacy


class StageFrequencyTests(unittest.TestCase):
    def setUp(self):
        self.h = legacy.WorkflowTests(methodName='runTest')
        self.h.setUp()
        self.step = {'key': 'etapa_lancamento', 'source': {'type': 'sharepoint_list'}}
        self.options = [dict(id=i, title=name, value=name) for i, name in
                        [(143, 'CONTABILIDADE'), (65, 'VISITA EM CAMPO'), (20, 'ALVENARIA')]]
        self.history = [dict(id=i, title='row', value='ALVENARIA' if i > 2 else 'VISITA EM CAMPO')
                        for i in range(1, 101)]
        self.reads = []
        def get_options(step, context=None):
            if step['key'] == 'recent_launch_stage_usage':
                self.reads.append(copy.deepcopy(step))
                return self.history
            return copy.deepcopy(self.options)
        self.h.sharepoint.get_options = get_options

    def select(self, flow='launch', step=None):
        return self.h.engine._selection_options(
            {'flow': flow, 'fields': {}, 'selections': {}}, step or self.step)

    def test_frequency_beats_id_and_keeps_unused_options(self):
        self.assertEqual([r['id'] for r in self.select()], [20, 65, 143])
        source = self.reads[0]['source']
        self.assertEqual(source['list'], 'LANCAMENTOS')
        self.assertEqual(source['top'], 100)
        self.assertEqual(source['sort_field'], 'Id')
        self.assertEqual(source['sort_direction'], 'desc')
        self.assertFalse(source.get('distinct'))
        self.assertFalse(source.get('fetch_all_pages'))
        self.assertFalse(source.get('filters'))

    def test_only_latest_100_and_normalized_names(self):
        self.history = [dict(id=i, title='row', value=' visita  em campo ' if i > 10 else 'ALVENARIA')
                        for i in range(1, 111)]
        self.assertEqual([r['id'] for r in self.select()], [65, 143, 20])

    def test_ties_keep_existing_order(self):
        self.history = [dict(id=2, value='VISITA EM CAMPO'), dict(id=1, value='ALVENARIA')]
        self.assertEqual([r['id'] for r in self.select()], [65, 20, 143])

    def test_empty_and_failed_history_preserve_catalog(self):
        self.history = []
        self.assertEqual([r['id'] for r in self.select()], [143, 65, 20])
        original = self.h.sharepoint.get_options
        def failed(step, context=None):
            if step['key'] == 'recent_launch_stage_usage':
                raise RuntimeError('temporary history failure')
            return original(step, context)
        self.h.sharepoint.get_options = failed
        self.assertEqual([r['id'] for r in self.select()], [143, 65, 20])

    def test_requery_reflects_new_launches_and_supports_multiple_lines(self):
        self.assertEqual(self.select()[0]['id'], 20)
        self.history = [dict(id=101, value='CONTABILIDADE')]
        self.assertEqual(self.select()[0]['id'], 143)
        self.assertEqual(len(self.reads), 2)

    def test_other_fields_and_flows_do_not_read_history(self):
        self.select(step={'key': 'produto_lancamento', 'source': {'type': 'sharepoint_list'}})
        self.select(flow='payment_provision')
        self.assertEqual(self.reads, [])


if __name__ == '__main__':
    unittest.main()
