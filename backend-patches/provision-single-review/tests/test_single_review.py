"""Real conversation regressions; synthetic files and SharePoint only."""
import copy
import os
from pathlib import Path
import sys
import unittest

if not os.getenv('ENERGETICA_BACKEND_TEST_ROOT'):
    raise unittest.SkipTest('Requires private backend snapshot')
ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path[:0] = [str(ROOT), str(ROOT/'worker'), str(ROOT/'tests')]
import test_batch_review


class SingleReviewTests(test_batch_review.BatchReviewTests):
    # Reuse the real boundary fixture and its existing grouped-flow regressions.
    def review_count(self):
        return sum((message.get('detail_table') or {}).get('kind') ==
                   'provision_settlement_review' for message in self.h.messenger.sent)

    def upload_three(self):
        for index in range(3):
            self.h.attachment('synthetic-' + str(index), str(index) + '.pdf', b'fixture')

    def test_uploads_keep_review_action_and_submit_advances_once(self):
        self.open()
        self.upload_three()
        self.assertEqual(self.state()['stage'], 'selecting_fields')
        self.assertEqual({item['id'] for item in self.state()['options']},
                         {'description_review_submit', 'description_review_edit'})
        before = self.review_count()
        result = self.h.reply(reply_id='description_review_submit')
        self.assertEqual(result.get('field'), 'data_pgto_efetuado_baixa')
        self.assertEqual(self.review_count(), before)
        self.assertEqual(len(self.state()['attachments']), 3)
        self.no_writes()

    def test_finishing_legacy_collection_alone_does_not_approve_overview(self):
        self.open()
        self.upload_three()
        state = self.state()
        state['stage'] = 'collecting_attachments'
        state['options'] = []
        key = next(key for key, (value, _) in self.h.state.values.items()
                   if value.get('flow') == 'payment_settlement')
        _, etag = self.h.state.values[key]
        self.h.engine._save(state, etag)
        result = self.h.reply(reply_id='finish_attachments')
        self.assertEqual(result.get('field'), 'description_review')
        self.assertEqual(self.state()['provision_description']['review_phase'], 'overview')
        self.no_writes()

    def test_duplicate_submit_does_not_answer_payment_question(self):
        self.open()
        self.upload_three()
        self.h.reply(reply_id='description_review_submit')
        state = copy.deepcopy(self.state())
        result = self.h.engine.handle(test_batch_review.backend_fixtures.event(
            'reply-' + str(self.h.reply_number), 'text', reply_id='description_review_submit'))
        self.assertEqual(result.get('status'), 'duplicate')
        self.assertEqual(self.state(), state)
        self.no_writes()

    def test_persisted_collection_accepts_visible_submit_without_repeating_table(self):
        self.open()
        self.upload_three()
        # Old deployments cleared the options and entered collection on upload.
        state = self.state()
        state['stage'] = 'collecting_attachments'
        state['options'] = []
        key = next(key for key, (value, _) in self.h.state.values.items()
                   if value.get('flow') == 'payment_settlement')
        _, etag = self.h.state.values[key]
        self.h.engine._save(state, etag)
        before = self.review_count()
        result = self.h.reply(reply_id='description_review_submit')
        self.assertEqual(result.get('field'), 'data_pgto_efetuado_baixa')
        self.assertEqual(self.review_count(), before)
        self.assertEqual(len(self.state()['attachments']), 3)
        self.no_writes()

    def test_edit_after_upload_still_requires_review_submission(self):
        self.open()
        self.upload_three()
        result = self.h.reply(reply_id='description_review_edit')
        self.assertEqual(result.get('status'), 'awaiting_description_edit_choice')
        self.assertEqual(self.state()['provision_description']['review_phase'], 'overview')
        self.no_writes()

    def test_final_confirmation_and_attachment_finish_are_preserved(self):
        self.open()
        self.upload_three()
        result = self.h.reply(reply_id='description_review_submit')
        self.assertEqual(result.get('field'), 'data_pgto_efetuado_baixa')
        self.h.reply(reply_id='date_today')
        self.choose_value('ENERGÉTICA - CAIXA')
        self.h.reply(reply_id='description_observation_blank')
        result = self.choose_value('NÃO')
        if result.get('status') == 'awaiting_attachment_decision':
            result = self.h.reply('SIM')
        self.assertEqual(result.get('status'), 'waiting_for_attachments')
        before = self.review_count()
        result = self.h.reply(reply_id='finish_attachments')
        self.assertEqual(result.get('status'), 'awaiting_confirmation')
        self.assertEqual(self.review_count(), before)
        self.assertEqual(len(self.state()['attachments']), 3)
        self.no_writes()
