"""Run against the real deployed workflow with in-memory external services."""
import copy
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path('/home/opc/energetica-build')
sys.path[:0] = [os.environ['ATTENDANCE_CANDIDATE'], '/opt/energetica-whatsapp/worker', '/opt/energetica-whatsapp', str(ROOT / 'tests')]
import workflow
import test_workflow as fixtures

ACTION = 'start_today_pending_attendance'


class HomePendingTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.WorkflowTests('runTest')
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        guard = patch('requests.sessions.Session.request', side_effect=AssertionError('No network'))
        guard.start()
        self.addCleanup(guard.stop)
        self.template = copy.deepcopy(self.case.sharepoint.options_by_key['registro_presenca_pendente'][0])

    def row(self, identifier, date='2026-10-01', status='PENDENTE'):
        row = copy.deepcopy(self.template)
        row.update(id=identifier, value=str(identifier), title=f'{identifier} - TESTE')
        row['source_values'].update(Id=identifier, DATA=date, PRESENCA=status)
        return row

    def rows(self, *rows):
        self.case.sharepoint.options_by_key['registro_presenca_pendente'] = list(rows)

    def test_past_only_keeps_red_alert(self):
        self.rows(self.row(1))
        action = self.case.engine._today_pending_attendance_action({})
        self.assertIsNotNone(action)
        self.assertEqual(action['title'], '👷 PRESENÇAS (1)')
        self.assertEqual(action['tone'], 'danger')

    def test_counts_unique_pending_across_all_dates(self):
        self.rows(self.row(1), self.row(2, '2026-09-01'), self.row(2, '2026-09-01'),
                  self.row(3, status='PRESENTE'), self.row(4, status='AUSENTE'),
                  self.row(5, status='FERIADO'), self.row(6, ''))
        action = self.case.engine._today_pending_attendance_action({})
        self.assertIsNotNone(action)
        self.assertEqual(action['title'], '👷 PRESENÇAS (3)')

    def test_query_keeps_status_filter_without_date_or_config_mutation(self):
        engine = self.case.engine
        before = copy.deepcopy(engine._attendance_validation_config())
        original = self.case.sharepoint.get_options
        captured = []
        def get_options(step, context=None):
            captured.append((copy.deepcopy(step), copy.deepcopy(context)))
            return original(step, context)
        self.case.sharepoint.get_options = get_options
        self.rows(self.row(1))
        engine._today_pending_attendance_action({'fields': {'DATA FILTRO PRESENÇA': '2026-11-18'}})
        step, context = captured[-1]
        self.assertEqual(step['key'], 'registro_presenca_pendente')
        self.assertFalse(any(f.get('field') == 'DATA' for f in step['source']['filters']))
        self.assertTrue(any(f.get('field') == 'PRESENCA' and f.get('equals') == 'PENDENTE' for f in step['source']['filters']))
        self.assertEqual(context, {})
        self.assertEqual(engine._attendance_validation_config(), before)

    def test_empty_and_validated_only_hide_alert(self):
        for rows in ([], [self.row(1, status='PRESENTE')]):
            self.rows(*rows)
            self.assertIsNone(self.case.engine._today_pending_attendance_action({}))

    def test_read_failure_does_not_invent_count(self):
        self.case.sharepoint.get_options = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('offline'))
        self.assertIsNone(self.case.engine._today_pending_attendance_action({}))

    def test_click_opens_existing_pending_date_selector_without_writes(self):
        self.rows(self.row(1))
        self.case.reply('OPA')
        result = self.case.reply(reply_id=ACTION)
        self.assertEqual(result.get('field'), 'data_presenca_pendente', result)
        state = next(iter(self.case.state.values.values()))[0]
        self.assertEqual(state['flow'], 'attendance_validation')
        self.assertNotIn('DATA FILTRO PRESENÇA', state['fields'])
        self.assertEqual(self.case.sharepoint.update_calls, [])

    def test_selecting_past_date_opens_only_pending_records_for_that_day(self):
        self.rows(self.row(1814, '2026-07-31'), self.row(1815),
                  self.row(1816, '2026-07-31', status='PRESENTE'))
        self.case.reply('OPA')
        self.case.reply(reply_id=ACTION)
        state = next(iter(self.case.state.values.values()))[0]
        selected = next(o for o in state['options'] if str(o.get('value', '')).startswith('2026-07-31'))
        result = self.case.reply(reply_id=str(selected.get('reply') or selected['id']))
        self.assertEqual(result.get('field'), 'registro_presenca_pendente', result)
        state = next(iter(self.case.state.values.values()))[0]
        records = [str(o['value']) for o in state['options'] if o.get('source_values')]
        self.assertEqual(records, ['1814'])
        self.assertEqual(self.case.sharepoint.update_calls, [])

    def test_stale_click_recounts_and_returns_home_without_writes(self):
        self.rows(self.row(1))
        self.case.reply('OPA')
        self.rows()
        result = self.case.reply(reply_id=ACTION)
        self.assertEqual(result['status'], 'awaiting_action')
        self.assertNotIn(ACTION, [a['id'] for a in self.case.messenger.sent[-1]['actions']])
        texts = [str(m.get('text', '')) for m in self.case.messenger.sent]
        self.assertFalse(any('PENDENTES DE HOJE' in text for text in texts))
        self.assertEqual(self.case.sharepoint.update_calls, [])


if __name__ == '__main__':
    unittest.main()
