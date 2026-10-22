"""Real wizard behavior with synthetic catalogs; no tenant writes."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'multi-provision-first-freight/tests'))
from test_first_freight import FirstFreightTests, Catalog
from logic import conversation_key


BRANCHES = [
    {'id': 9, 'title': '999 - PESSOAL QA', 'value': '999 - PESSOAL QA'},
    {'id': 5, 'title': '004 - OBRA QA', 'value': '004 - OBRA QA'},
    {'id': 4, 'title': '003 - OBRA QA', 'value': '003 - OBRA QA'},
    {'id': 3, 'title': '002 - OBRA QA', 'value': '002 - OBRA QA'},
    {'id': 2, 'title': '001 - OBRA QA', 'value': '001 - OBRA QA'},
    {'id': 1, 'title': '000 - CENTRAL QA', 'value': '000 - CENTRAL QA'},
    {'id': 14, 'title': '0040 - OUTRA QA', 'value': '0040 - OUTRA QA'},
    {'id': 15, 'title': 'OUTRA 004 - QA', 'value': 'OUTRA 004 - QA'},
    {'id': 16, 'title': '004 - ROTULO ENGANOSO', 'value': '003 - OBRA QA'},
]


class BranchCatalog(Catalog):
    def get_options(self, step, context):
        if step.get('target_field') == 'FILIAL':
            return copy.deepcopy(BRANCHES)
        return super().get_options(step, context)


class AllowedBranchTests(unittest.TestCase):
    def setUp(self):
        self.fixture = FirstFreightTests()
        self.fixture.setUp()
        self.engine, self.state = self.fixture.engine, self.fixture.state
        self.catalog = BranchCatalog()
        self.engine.sharepoint = self.catalog
        self.messenger = self.fixture.messenger

    def question(self, flow='payment'):
        self.state.update(flow=flow, stage='selecting_fields', options=[])
        steps = self.engine._flow_config(self.state)['steps']
        index = next(i for i, step in enumerate(steps) if step.get('target_field') == 'FILIAL')
        self.state['step_index'] = index
        if steps[index].get('edit_only'):
            self.state['edit_step_indices'] = [index]
        else:
            self.state.pop('edit_step_indices', None)
        return self.engine._current_step(self.state)

    def reply(self, raw, *, filter_query=False, typed=False):
        return self.engine._handle_selection_reply(
            {'kind': 'text', 'text': raw,
             **({} if typed else {'reply_id': 'filter_query' if filter_query else raw})},
            self.state, self.fixture.etag(), self.engine._current_step(self.state))

    # A missing scope/filter would expose a third branch or blank in these wizards.
    def test_creation_edit_and_description_settlement_offer_only_allowed_branches(self):
        for flow in ['payment', 'payment_provision_edit', 'payment_settlement']:
            with self.subTest(flow=flow):
                step = self.question(flow)
                options = self.engine._selection_options(self.state, step)
                self.assertEqual([row['id'] for row in options], [5, 1])
                self.assertFalse(step.get('allow_blank'))
                self.assertEqual([row['value'] for row in options],
                                 ['004 - OBRA QA', '000 - CENTRAL QA'])

    # Cached old buttons, including blank, must be rejected before recording a value.
    def test_stale_disallowed_and_blank_replies_never_advance_or_change_fields(self):
        for raw in ['9', '4', '3', '2', '0', 'EM BRANCO', 'choice:filial_pagamento:4']:
            with self.subTest(reply=raw):
                step = self.question()
                self.state['options'] = copy.deepcopy(BRANCHES) + [
                    {'id': 0, 'title': 'EM BRANCO', 'value': None}]
                before = copy.deepcopy(self.state['fields'])
                index = self.state['step_index']
                self.assertEqual(self.reply(raw)['status'], 'invalid_option')
                self.assertEqual(self.state['step_index'], index)
                self.assertEqual(self.state['fields'], before)
                self.assertEqual([row['id'] for row in self.state['options']], [5, 1])
                self.assertEqual(self.catalog.creates, [])

    # Refresh/filter paths must not resurrect a forbidden branch or blank.
    def test_search_clear_and_refresh_never_restore_disallowed_choices(self):
        for raw, query, expected in [('PESSOAL', True, 'invalid_option'),
                                     ('CENTRAL', True, 'filtered_options'),
                                     ('', True, 'filter_cleared'),
                                     ('filter_clear', False, 'filter_cleared'),
                                     ('refresh_options', False, 'options_refreshed')]:
            with self.subTest(reply=raw):
                self.question()
                self.state['options'] = copy.deepcopy(BRANCHES)
                result = self.reply(raw, filter_query=query)
                self.assertEqual(result['status'], expected)
                sent = self.messenger.sent[-1]['options']
                branches = [row for row in sent
                            if not row.get('navigation_back') and not row.get('navigation_main_menu')]
                self.assertTrue(branches)
                self.assertTrue(all(row['id'] in [5, 1] for row in branches))
                self.assertEqual(self.catalog.creates, [])

    def test_typed_search_is_not_a_selection(self):
        self.question()
        index = self.state['step_index']
        self.assertEqual(self.reply('CENTRAL', typed=True)['status'], 'filtered_options')
        self.assertEqual(self.state['step_index'], index)
        self.assertEqual(self.catalog.creates, [])

    # Allowed branches keep SharePoint IDs and save the catalog's actual value.
    def test_allowed_choices_keep_original_ids_and_advance_the_creation_wizard(self):
        for raw, expected in [('5', '004 - OBRA QA'), ('1', '000 - CENTRAL QA')]:
            with self.subTest(reply=raw):
                self.question()
                index = self.state['step_index']
                self.reply(raw)
                self.assertGreater(self.state['step_index'], index)
                self.assertEqual(self.state['fields']['FILIAL'], expected)
                self.assertEqual(self.state['selections']['filial_pagamento']['id'], int(raw))
                self.assertEqual(self.catalog.creates, [])

    # The restriction belongs to provisions, not to suppliers/documents/launches.
    def test_unrelated_branch_questions_keep_other_branches_and_blank(self):
        for flow in ['document_group_registration', 'launch', 'supplier_attendance_creation']:
            with self.subTest(flow=flow):
                self.state['flow'] = flow
                step = {'key': 'unrelated_filial', 'kind': 'selection', 'target_field': 'FILIAL',
                        'allow_blank': True, 'source': {'type': 'sharepoint_list'}}
                ids = [row['id'] for row in self.engine._selection_options(self.state, step)]
                self.assertIn(0, ids)
                self.assertIn(9, ids)
                self.assertIn(4, ids)

    def test_single_and_multiple_modes_use_the_same_restricted_choices(self):
        for mode in ['UNICO', 'MULTIPLOS']:
            with self.subTest(mode=mode):
                self.state['answers']['tipo_provisao_pagamento'] = mode
                step = self.question()
                self.assertEqual([row['id'] for row in self.engine._selection_options(self.state, step)], [5, 1])
                configured = self.engine._flow_config(self.state)['steps'][self.state['step_index']]
                self.assertTrue(configured['allow_blank'], 'Do not mutate shared workflow configuration')

    # option_next is intercepted before selection handling: old page snapshots
    # must be sanitized at the actual emission boundary, including resumed pages.
    def test_old_pagination_through_handle_cannot_reemit_forbidden_branches(self):
        for flow in ['payment', 'payment_provision_edit', 'payment_settlement']:
            with self.subTest(flow=flow):
                step = self.question(flow)
                self.state['options'] = copy.deepcopy(BRANCHES) + [
                    {'id': 0, 'title': 'EM BRANCO', 'value': None}]
                self.state['option_pagination'] = {
                    'step': {**step, 'allow_blank': True},
                    'options': copy.deepcopy(self.state['options']),
                    'offset': 0, 'page_size': 1, 'maximum': 3, 'filtered': False}
                event = {'kind': 'text', 'message_id': 'qa-page-' + flow,
                         'trusted_portal': True,
                         'sender': 'qa', 'conversation_id': 'qa',
                         'phone_number_id': 'portal-admin', 'reply_id': 'option_next'}
                key = conversation_key(event)
                self.state['key'] = key
                _, etag = self.fixture.store.load(key)
                self.fixture.store.save(key, self.state, etag)
                before = copy.deepcopy(self.state['fields'])
                result = self.engine.handle(event)
                self.assertIn(result['status'], ['next_option_page', 'option_page_end'])
                sent = self.messenger.sent[-1]
                branches = [row for row in sent['options'] if not row.get('navigation_back')
                            and not row.get('navigation_main_menu') and row['id'] != 'option_next']
                self.assertTrue(branches)
                self.assertTrue(all(row['value'] in ['004 - OBRA QA', '000 - CENTRAL QA']
                                    for row in branches))
                self.assertFalse(sent['step'].get('allow_blank'))
                saved, _ = self.fixture.store.load(key)
                self.assertEqual(saved['fields'], before)
                self.assertEqual(self.catalog.creates, [])


if __name__ == '__main__':
    unittest.main()
