"""Real workflow; only external services use the existing in-memory fixtures."""
import copy
import os
from pathlib import Path
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

ROOT = Path(os.environ.get('ATTENDANCE_SOURCE', '/home/opc/energetica-build'))
sys.path.insert(0, str(ROOT / 'worker'))
sys.path.insert(0, os.environ.get('ATTENDANCE_CANDIDATE', str(ROOT / 'worker')))
import workflow
sys.path.insert(0, str(ROOT / 'tests'))
import test_workflow as fixtures

ACTION = 'start_today_pending_attendance'

class Clock(datetime):
    instant = datetime(2026, 10, 14, 1, 0, tzinfo=timezone.utc)

    @classmethod
    def now(cls, tz=None):
        return cls.instant.astimezone(tz) if tz else cls.instant.replace(tzinfo=None)


class HomeTodayTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.WorkflowTests('runTest')
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        Clock.instant = datetime(2026, 10, 14, 1, 0, tzinfo=timezone.utc)
        self.clock = patch.object(workflow, 'datetime', Clock)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.network = patch('requests.sessions.Session.request', side_effect=AssertionError('No network in workflow tests'))
        self.network.start()
        self.addCleanup(self.network.stop)
        self.template = copy.deepcopy(self.case.sharepoint.options_by_key['registro_presenca_pendente'][0])

    def row(self, identifier, date='2026-10-13T03:00:00Z', status='PENDENTE'):
        row = copy.deepcopy(self.template)
        row.update(id=identifier, value=str(identifier), title=f'{identifier} - TESTE')
        row['source_values'].update(Id=identifier, DATA=date, PRESENCA=status)
        return row

    def rows(self, *rows):
        self.case.sharepoint.options_by_key['registro_presenca_pendente'] = list(rows)

    def home(self):
        self.case.reply('OPA')
        return self.case.messenger.sent[-1]['actions']

    def test_counts_only_unique_pending_today_using_sao_paulo_day(self):
        self.rows(self.row(1), self.row(2), self.row(2), self.row(3, '2026-10-12'), self.row(4, status='PRESENTE'))
        actions = self.home()
        action = next((a for a in actions if a['id'] == ACTION), None)
        self.assertIsNotNone(action)
        self.assertEqual(action['title'], '👷 PRESENÇAS (2)')
        self.assertEqual(action['tone'], 'danger')
        self.assertEqual(self.case.sharepoint.update_calls, [])

    def test_hides_without_pending_today(self):
        for rows in [[], [self.row(1, '2026-10-12')], [self.row(1, status='AUSENTE')]]:
            self.rows(*rows)
            self.assertNotIn(ACTION, [a['id'] for a in self.home()])

    def test_query_failure_does_not_break_menu_or_invent_count(self):
        original = self.case.sharepoint.get_options
        def get_options(step, context=None):
            if step['key'] == 'registro_presenca_pendente':
                raise RuntimeError('temporarily unavailable')
            return original(step, context)
        self.case.sharepoint.get_options = get_options
        self.assertNotIn(ACTION, [a['id'] for a in self.home()])

    def test_shortcut_skips_dates_and_reuses_hr_validation_without_writes(self):
        self.rows(self.row(1814))
        self.home()
        self.case.messenger.sent.clear()
        result = self.case.reply(reply_id=ACTION)
        self.assertEqual(result.get('field'), 'registro_presenca_pendente')
        self.assertFalse(any(m.get('field') == 'data_presenca_pendente' for m in self.case.messenger.sent))
        state = next(iter(self.case.state.values.values()))[0]
        self.assertEqual(state['flow'], 'attendance_validation')
        self.assertEqual(state['fields']['DATA FILTRO PRESENÇA'], '2026-10-13')
        self.assertEqual(state['step_index'], 1)
        self.assertEqual(self.case.sharepoint.update_calls, [])
        self.assertEqual(self.case.reply('1814')['field'], 'revisar_dados_presenca')
        self.assertEqual(self.case.sharepoint.update_calls, [])

    def test_stale_button_rechecks_today_and_returns_menu_if_empty(self):
        self.rows(self.row(1814))
        self.home()
        self.rows()
        result = self.case.reply(reply_id=ACTION)
        self.assertEqual(result['status'], 'awaiting_action')
        self.assertNotIn(ACTION, [a['id'] for a in self.case.messenger.sent[-1]['actions']])
        self.assertEqual(self.case.sharepoint.update_calls, [])

    def test_rollover_click_uses_new_local_day(self):
        Clock.instant = datetime(2026, 10, 14, 2, 59, tzinfo=timezone.utc)
        self.rows(self.row(1814))
        self.home()
        Clock.instant = datetime(2026, 10, 14, 3, 1, tzinfo=timezone.utc)
        self.rows(self.row(1815, '2026-10-14'))
        result = self.case.reply(reply_id=ACTION)
        self.assertEqual(result.get('field'), 'registro_presenca_pendente', result)
        state = next(iter(self.case.state.values.values()))[0]
        self.assertEqual(state['fields']['DATA FILTRO PRESENÇA'], '2026-10-14')
        self.assertEqual(self.case.sharepoint.update_calls, [])

    def test_back_preserves_existing_draft_exit_policy(self):
        self.rows(self.row(1814))
        self.home()
        self.case.reply(reply_id=ACTION)
        back = self.case.reply(reply_id=workflow.NAVIGATION_BACK_ID)
        self.assertEqual(back.get('status'), 'awaiting_portal_draft_exit', back)
        self.assertEqual(self.case.sharepoint.update_calls, [])

    def test_return_to_home_recounts_current_pending_rows(self):
        self.rows(self.row(1814), self.row(1815))
        self.home()
        self.case.reply(reply_id=ACTION)
        self.rows(self.row(1815))
        self.case.reply(reply_id=workflow.NAVIGATION_MAIN_MENU_ID)
        self.case.reply(reply_id='portal_draft_exit_discard')
        actions = self.case.messenger.sent[-1]['actions']
        self.assertEqual(next(a['title'] for a in actions if a['id'] == ACTION), '👷 PRESENÇAS (1)')
        self.assertEqual(self.case.sharepoint.update_calls, [])

    def test_opened_names_exclude_other_days_and_already_validated_rows(self):
        self.rows(self.row(1814), self.row(1815, '2026-10-12'), self.row(1816, status='PRESENTE'))
        self.home()
        self.case.reply(reply_id=ACTION)
        state = next(iter(self.case.state.values.values()))[0]
        record_ids = [str(o['value']) for o in state['options'] if o.get('source_values')]
        self.assertEqual(record_ids, ['1814'])
        self.assertEqual(self.case.sharepoint.update_calls, [])

if __name__ == '__main__':
    unittest.main()
