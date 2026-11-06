"""Replay completed submissions through the real engine with synthetic storage."""
import copy
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(os.environ['SUBMISSION_MENU_SOURCE']).resolve()
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT), str(ROOT / 'tests')]
import test_workflow as fixtures


class CompletedSubmissionTests(unittest.TestCase):
    def setUp(self):
        fixtures.WorkflowTests.setUp(self)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state.directory = temporary.name
        self.sharepoint.site_url = 'https://synthetic.example.test/site'
        self.config['limits']['inactivity_expiration_enabled'] = False
        self.config['limits']['post_completion_menu_enabled'] = True
        self.current = self.engine._new_state(fixtures.event('seed', 'text'),
            fixtures.conversation_key(fixtures.event('seed', 'text')))
        self.current.update(flow='launch', stage='completed',
            fields={'VALOR TOTAL': '10'},
            processed_message_ids=['earlier-answer', 'submit-original'],
            completion_trigger_message_id='submit-original',
            sharepoint={'item_id': 77, 'recorded_at': '2026-11-06T18:36:00+00:00',
                        'attachment_names': []})
        self.engine._save(self.current, None)
        self.messenger.sent.clear()

    def send(self, message_id, reply='', text=''):
        result = self.engine.handle(fixtures.event(message_id, 'text', reply_id=reply, text=text))
        self.current = self.state.load(self.current['key'])[0]
        self.assertEqual(self.sharepoint.items, {}, 'Replay must never write financial records')
        return result

    def assert_completed(self, batch):
        self.assertEqual(self.current['stage'], 'completed')
        self.assertEqual(self.current['batch_id'], batch)
        self.assertEqual(self.current['sharepoint']['item_id'], 77)
        self.assertFalse(any('ÁREA NÃO RECONHECIDA' in str(m) for m in self.messenger.sent))

    def test_same_submit_request_replays_success(self):
        batch = self.current['batch_id']
        self.assertEqual(self.send('submit-original', 'confirm_yes')['status'], 'completion_replayed')
        self.assert_completed(batch)

    def test_second_submit_click_replays_success_without_reset(self):
        batch = self.current['batch_id']
        self.assertEqual(self.send('submit-second', 'confirm_yes')['status'], 'completion_replayed')
        self.assert_completed(batch)

    def test_typed_repeat_confirmation_replays_success(self):
        batch = self.current['batch_id']
        self.assertEqual(self.send('submit-second', text='SIM')['status'], 'completion_replayed')
        self.assert_completed(batch)

    def test_earlier_processed_answer_cannot_become_area_selection(self):
        batch = self.current['batch_id']
        self.assertEqual(self.send('earlier-answer', text='10')['status'], 'duplicate')
        self.assert_completed(batch)
        self.assertEqual(self.messenger.sent, [])

    def test_real_menu_choice_still_opens_area_in_one_click(self):
        batch = self.current['batch_id']
        self.assertEqual(self.send('open-area', 'group_supplies')['status'], 'awaiting_action')
        self.assertEqual(self.current['stage'], 'choosing_action')
        self.assertEqual(self.current['selected_group'], 'group_supplies')
        self.assertNotEqual(self.current['batch_id'], batch)

    def test_area_transition_preserves_deduplication_for_delayed_submit(self):
        self.send('open-area', 'group_supplies')
        area = copy.deepcopy(self.current)
        self.messenger.sent.clear()
        self.assertEqual(self.send('submit-original', 'confirm_yes')['status'], 'duplicate')
        self.assertEqual(self.current['batch_id'], area['batch_id'])
        self.assertEqual(self.current['stage'], 'choosing_action')
        self.assertEqual(self.messenger.sent, [])

    def test_replayed_second_click_is_remembered_after_area_transition(self):
        self.send('submit-second', 'confirm_yes')
        self.send('open-area', 'group_supplies')
        self.messenger.sent.clear()
        self.assertEqual(self.send('submit-second', 'confirm_yes')['status'], 'duplicate')
        self.assertEqual(self.messenger.sent, [])

    def test_invalid_area_still_reports_actual_invalid_input(self):
        self.assertEqual(self.send('unrecognized', text='unknown-area')['status'], 'invalid_group')
        self.assertTrue(any('ÁREA NÃO RECONHECIDA' in str(m) for m in self.messenger.sent))

    def test_confirmation_without_record_does_not_claim_success(self):
        self.current['sharepoint'] = {}
        _, etag = self.state.load(self.current['key'])
        self.engine._save(self.current, etag)
        self.assertNotEqual(self.send('not-recorded', 'confirm_yes')['status'], 'completion_replayed')


if __name__ == '__main__':
    unittest.main()
