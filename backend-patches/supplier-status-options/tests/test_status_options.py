"""Supplier status uses actual enum values in new and resumed conversations."""
import copy
import os
from pathlib import Path
import sys
import unittest

if not os.getenv('ENERGETICA_BACKEND_TEST_ROOT'):
    raise unittest.SkipTest('Requires private backend snapshot')
ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path[:0] = [str(ROOT), str(ROOT/'worker'), str(ROOT/'tests')]
import test_workflow as fixtures

KEY = 'status_fornecedor_suprimentos'


class StatusOptionsTests(unittest.TestCase):
    def setUp(self):
        self.h = fixtures.WorkflowTests('runTest')
        self.h.setUp()
        self.h.reply('OPA')
        self.key, (self.state, self.etag) = next(iter(self.h.state.values.items()))
        # Resume a synthetic draft at the real status step. No supplier/HR
        # checkpoint or external record is created by this focused fixture.
        self.state['flow'] = 'supply_supplier_registration'
        self.state['stage'] = 'selecting_fields'
        self.state['supplier_employment_version'] = 2
        self.state['fields'].update({'TIPO': 'SERVIÇO', 'EMPREITEIRO': 'NÃO'})
        steps = self.h.engine._flow_config(self.state)['steps']
        self.state['step_index'] = next(i for i, step in enumerate(steps) if step['key'] == KEY)
        self.state['options'] = []
        self.step = steps[self.state['step_index']]
        result = self.h.engine._prompt_next_or_summary(self.state, self.etag)
        self.assertEqual(result.get('field'), KEY)

    def current(self):
        return self.h.state.values[self.key][0]

    def assert_direct(self):
        self.assertEqual([(item['title'], item['value']) for item in self.current()['options']],
                         [('ATIVO', 'ATIVO'), ('INATIVO', 'INATIVO')])

    def no_writes(self):
        self.assertEqual(self.h.sharepoint.items, {})
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def save_legacy_options(self):
        state, etag = self.h.state.values[self.key]
        state['options'] = [
            {'id': 1, 'title': '✅ SIM, MANTER — ATIVO', 'value': 'ATIVO', 'recommended': True},
            {'id': KEY + '__alterar_padrao', 'title': '✏️ NÃO, ESCOLHER OUTRO VALOR',
             'value': '__ESCOLHER_OUTRO_VALOR__', 'action': 'expand_recommended_selection'}]
        self.h.engine._save(state, etag)

    def test_question_offers_only_active_and_inactive(self):
        self.assert_direct()
        self.no_writes()

    def test_active_is_selected_in_one_reply(self):
        self.h.reply(reply_id='1')
        self.assertEqual(self.current()['fields'].get('STATUS'), 'ATIVO')
        self.assertEqual(self.current()['answers'].get(KEY), 'ATIVO')
        self.no_writes()

    def test_inactive_is_selected_in_one_reply(self):
        self.h.reply(reply_id='2')
        self.assertEqual(self.current()['fields'].get('STATUS'), 'INATIVO')
        self.assertEqual(self.current()['answers'].get(KEY), 'INATIVO')
        self.no_writes()

    def test_legacy_cached_menu_accepts_inactive_without_extra_prompt(self):
        self.save_legacy_options()
        self.h.reply(reply_id='2')
        self.assertEqual(self.current()['fields'].get('STATUS'), 'INATIVO')
        self.no_writes()

    def test_stale_change_button_refreshes_choices_without_setting_status(self):
        self.save_legacy_options()
        self.h.reply(reply_id=KEY + '__alterar_padrao')
        self.assert_direct()
        self.assertNotIn('STATUS', self.current()['fields'])
        self.no_writes()

    def test_resume_rebuilds_direct_options_and_keeps_parent_context(self):
        self.save_legacy_options()
        state, etag = self.h.state.values[self.key]
        parent = {'type': 'launch_supplier_registration',
                  'state': {'flow': 'launch', 'fields': {'OBS': 'synthetic parent'}, 'attachments': []}}
        state['embedded_return'] = copy.deepcopy(parent)
        self.h.engine._resend_current_prompt(state, etag)
        self.assert_direct()
        self.assertEqual(self.current()['embedded_return'], parent)
        self.no_writes()
