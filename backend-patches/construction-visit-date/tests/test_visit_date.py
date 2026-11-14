"""Exercise visit dates in the shared workflow with an in-memory SharePoint."""
import copy
from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'visit-existing-diary/tests'))
import test_visit_diary as previous


class VisitDateTests(unittest.TestCase):
    def setUp(self):
        previous.VisitDiaryTests.setUp(self)
        self.state['step_index'] = 2
        self.state['answers'].pop('data_visita_obra', None)
        self.state['fields'].pop('DATA', None)
        self.state['display_values'].pop('DATA', None)

    def reply(self, value, *, reply_id=None):
        return self.engine._handle_step_reply({
            'kind': 'text', 'message_id': str(len(self.messenger.sent)),
            'text': value, 'reply_id': reply_id,
        }, self.state, None)

    def confirm(self):
        with patch.object(self.engine, '_notify_completed', return_value={'status': 'completed'}):
            return self.engine._handle_confirmation_reply({
                'kind': 'text', 'message_id': 'confirm', 'reply_id': 'confirm_yes',
            }, self.state, None)

    def test_accepting_the_visit_price_prompts_for_date_before_diary(self):
        self.state['step_index'] = 1
        result = self.reply('', reply_id='valor_visita_obra_keep')
        self.assertEqual(result.get('field'), 'data_visita_obra')
        self.assertEqual(self.catalog.queries, [])
        actions = self.messenger.sent[-1]['actions']
        self.assertTrue({'date_today', 'date_other'} <= {action['id'] for action in actions})

    def test_invalid_date_does_not_advance_or_write(self):
        result = self.reply('31/02/2026')
        self.assertEqual(result['status'], 'invalid_date')
        self.assertEqual(self.catalog.queries, [])
        self.assertEqual(self.catalog.writes, [])

    def test_selected_date_is_in_summary_and_all_three_records(self):
        self.catalog.diaries.append({'Id': 221, 'FILIAL': previous.BRANCH, 'DATA': '2026-10-20'})
        result = self.reply('18/10/2026')
        self.assertEqual(result.get('field'), 'criar_diario_obra')
        result = self.reply('', reply_id='choice:criar_diario_obra:1')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        summary = {row['label']: row['value'] for row in self.engine._summary_rows(self.state)}
        self.assertEqual(summary['DATA DA VISITA'], '18/10/2026')
        self.assertEqual(self.catalog.writes, [])
        previous.Clock.instant = datetime(2026, 10, 21, 3, 1, tzinfo=timezone.utc)
        self.assertEqual(self.confirm()['status'], 'completed')
        records = {row['list']: row['fields'] for row in self.catalog.writes}
        self.assertEqual(records['NOTASPENDENTES']['DATA PEDIDO'], '2026-10-18')
        self.assertIn('18/10/2026', records['NOTASPENDENTES']['OBS'])
        self.assertEqual(records['DIÁRIO DE OBRAS']['DATA'], '2026-10-18')
        for field in ['DATA', 'DATA RMS', 'DATA PGTO PREVISTO', 'DATA PGTO EFETUADO']:
            self.assertEqual(records['LANCAMENTOS'][field], '2026-10-18')

    def test_existing_diary_on_selected_day_is_reused(self):
        original = {'Id': 221, 'FILIAL': previous.BRANCH, 'DATA': '2026-10-18', 'STATUS': 'CONCLUÍDO'}
        self.catalog.diaries.append(copy.deepcopy(original))
        result = self.reply('18/10/2026')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(previous.VisitDiaryTests.commit(self)['status'], 'completed')
        self.assertEqual(self.catalog.diaries, [original])

    def test_legacy_summary_confirmation_asks_for_an_explicit_date(self):
        self.state.update(stage='awaiting_confirmation', step_index=3)
        self.state['fields']['DATA'] = '2026-10-20'
        self.state['answers']['criar_diario_obra'] = 'SIM'
        self.catalog._find_item = lambda *_: None
        result = self.confirm()
        self.assertEqual(result.get('field'), 'data_visita_obra')
        self.assertEqual(self.state['stage'], 'selecting_fields')
        self.assertEqual(self.catalog.writes, [])

    def test_resuming_legacy_summary_prompts_for_date_before_confirmation(self):
        self.state.update(stage='awaiting_confirmation', step_index=3)
        self.state['fields']['DATA'] = '2026-10-20'
        self.state['answers']['criar_diario_obra'] = 'NÃO'
        result = self.engine._resume_draft_prompt(self.state, None)
        self.assertTrue(result['draft_resumed'])
        self.assertEqual(result.get('field'), 'data_visita_obra')
        self.assertNotIn('criar_diario_obra', self.state['answers'])
        self.assertEqual(self.catalog.writes, [])

    def test_editing_date_rechecks_diary_for_that_day(self):
        self.catalog.diaries.append({'Id': 221, 'FILIAL': previous.BRANCH, 'DATA': '2026-10-18'})
        self.assertEqual(self.reply('18/10/2026')['status'], 'awaiting_confirmation')
        self.engine._prompt_edit_field(self.state, None)
        option = next(option for option in self.state['options'] if option['title'] == 'DATA DA VISITA')
        self.assertEqual(self.engine._handle_edit_field_reply({
            'kind': 'text', 'message_id': 'edit-date', 'reply_id': f"choice:edit_field:{option['id']}",
        }, self.state, None).get('field'), 'data_visita_obra')
        self.assertEqual(self.reply('19/10/2026').get('field'), 'criar_diario_obra')
        self.assertNotIn('criar_diario_obra', self.state['answers'])

    def test_today_is_explicit_and_uses_the_sao_paulo_calendar(self):
        previous.Clock.instant = datetime(2026, 10, 21, 1, 30, tzinfo=timezone.utc)
        self.assertEqual(self.reply('', reply_id='date_today').get('field'), 'criar_diario_obra')
        self.assertEqual(self.state['fields']['DATA'], '2026-10-20')

    def test_retry_of_partially_posted_legacy_visit_keeps_existing_order_date(self):
        token = f"WA-VISITA-PEDIDO-{self.state['batch_id']}"
        posted = {'DATA PEDIDO': '2026-10-18', 'OBS': 'VISITA EM CAMPO EM 18/10/2026'}
        pending_id = self.catalog.ensure_item(token, posted, target_list='NOTASPENDENTES')
        self.catalog.get_item_fields = lambda *_: {'DATA PEDIDO': '2026-10-18T03:00:00Z'}
        self.state['partial_submission_items'] = [{'item_id': pending_id, 'target_list': 'NOTASPENDENTES'}]
        self.state['answers']['criar_diario_obra'] = 'SIM'
        self.assertEqual(previous.VisitDiaryTests.commit(self)['status'], 'completed')
        self.assertEqual(self.catalog.writes[0]['fields'], posted)
        self.assertEqual(self.catalog.diaries[0]['DATA'], '2026-10-18')
        self.assertEqual(self.catalog.writes[-1]['fields']['DATA'], '2026-10-18')

    def test_back_after_uncertain_order_write_keeps_selected_date_for_retry(self):
        self.assertEqual(self.reply('18/10/2026').get('field'), 'criar_diario_obra')
        self.assertEqual(self.reply('', reply_id='choice:criar_diario_obra:2')['status'], 'awaiting_confirmation')
        self.engine._push_navigation_state(self.state)
        original_ensure = self.catalog.ensure_item

        def write_then_fail(*args, **kwargs):
            original_ensure(*args, **kwargs)
            raise TimeoutError('Order saved but reply was lost')

        self.catalog.ensure_item = write_then_fail
        self.assertEqual(self.confirm()['status'], 'submission_failed')
        self.engine._navigate_back(self.state, None)
        self.assertEqual(self.state['stage'], 'submission_failed')
        self.catalog.ensure_item = original_ensure
        self.assertEqual(previous.VisitDiaryTests.commit(self)['status'], 'completed')
        self.assertEqual(len(self.catalog.writes), 2)
        self.assertEqual(self.catalog.writes[-1]['fields']['DATA'], '2026-10-18')


if __name__ == '__main__':
    unittest.main()
