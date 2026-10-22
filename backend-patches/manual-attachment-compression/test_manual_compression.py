"""Runtime regressions; run with the private mirror's test_workflow harness."""
import copy
import unittest

import test_workflow as harness


LEGACY = (
    'confirming_attachment_compression',
    'confirming_compressed_attachment_choice',
    'confirming_intermediate_attachment_choice',
    'awaiting_attachment_compression_consent',
)


class ManualCompressionTests(unittest.TestCase):
    def setUp(self):
        self.h = harness.WorkflowTests()
        self.h.setUp()
        self.h.config['limits']['compression_offer_attachment_bytes'] = 500_000
        self.h.config['limits']['inactivity_expiration_enabled'] = False
        self.h.config['limits']['attachment_restart_on_inactivity_enabled'] = False

    def current(self):
        return next(iter(self.h.state.values.values()))

    def upload(self, mid, size):
        return self.h.engine.handle(harness.event(
            mid, 'attachment', original_filename=mid + '.pdf',
            mime_type='application/pdf', content=b'x' * size))

    def ready(self, *, summary=True):
        self.upload('seed', 4)
        state, etag = self.current()
        state['flow'] = 'document'
        state['fields'] = {'FILIAL': '000 - ESCRITÓRIO CENTRAL',
                           'TIPOHOMOLOGACAO': 'HOMOLOGAÇÃO CONTRATO', 'OBS': 'PRESERVAR'}
        state['stage'] = 'selecting_fields'
        state['step_index'] = len(self.h.config['sharepoint']['steps']) if summary else 0
        state['attachments_phase_completed'] = summary
        state['attachments_decision'] = 'yes'
        etag = self.h.state.save(state['key'], state, etag)
        if summary:
            self.h.engine._summarize_and_confirm(state, etag)

    def assert_quiet_originals(self, expected):
        state, _ = self.current()
        self.assertEqual([a['message_id'] for a in state['attachments']], expected)
        self.assertNotIn('pending_attachment_compression', state)
        self.assertFalse(state.get('attachment_compression_queue'))
        self.assertEqual(self.h.attachment_compressor.calls, [])
        self.assertEqual(self.h.sharepoint.items, {})
        for message in self.h.messenger.sent:
            ids = [a.get('id') for a in message.get('actions', [])]
            self.assertNotIn('compress_attachments_yes', ids)
            self.assertNotIn('compress_all_attachments', ids)

    def test_initial_upload_small_threshold_large_and_over_hard_limit_keep_original(self):
        for size in (7, 500_000, 500_001, 10_000_001):
            with self.subTest(size=size):
                self.setUp()
                self.upload('initial', size)
                self.assert_quiet_originals(['initial'])
                state, _ = self.current()
                self.assertEqual(state['stage'], 'choosing_group')
                self.assertEqual(len(self.h.media.read(state['attachments'][0])), size)

    def test_menu_multi_upload_retains_order_and_ignores_duplicate(self):
        self.h.reply('OPA')
        self.h.reply('SUPRIMENTOS')
        for mid in ('one', 'two', 'two', 'three'):
            self.upload(mid, 600_000)
        self.assert_quiet_originals(['one', 'two', 'three'])
        self.assertEqual(self.current()[0]['stage'], 'choosing_action')

    def test_form_upload_does_not_answer_or_advance_current_field(self):
        self.ready(summary=False)
        before = copy.deepcopy(self.current()[0])
        self.upload('large-in-form', 600_000)
        after = self.current()[0]
        self.assertEqual(after['stage'], before['stage'])
        self.assertEqual(after['step_index'], before['step_index'])
        self.assertEqual(after['fields'], before['fields'])
        self.assert_quiet_originals(['seed', 'large-in-form'])

    def test_confirmation_upload_refreshes_summary_without_posting(self):
        self.ready()
        count = len(self.h.summary_builder.calls)
        self.upload('large-at-summary', 600_000)
        self.assertEqual(self.current()[0]['stage'], 'awaiting_confirmation')
        self.assertEqual(len(self.h.summary_builder.calls), count + 1)
        self.assert_quiet_originals(['seed', 'large-at-summary'])

    def legacy(self, stage, *, initial=False, confirmation=False):
        if confirmation:
            self.ready()
        elif initial:
            self.h.reply('OPA')
        else:
            self.ready(summary=False)
        state, etag = self.current()
        resume = state['stage']
        entries = []
        for mid in ('pending-original', 'queued-original'):
            event = harness.event(mid, 'attachment', original_filename=mid + '.pdf',
                                  mime_type='application/pdf', content=b'x' * 600_000)
            attachment = self.h.media.stage(event, state['batch_id'], state['key'])
            preview = self.h.media.replace(attachment, b'preview')
            entries.append({'attachment': attachment, 'compressed_attachment': preview,
                            'intermediate_attachment': preview, 'resume_stage': resume,
                            'initial': initial, 'key': state['key'],
                            'event': {k: v for k, v in event.items() if k != 'content'}})
        state['stage'] = stage
        if stage == 'awaiting_attachment_compression_consent':
            state['attachments'].extend(e['attachment'] for e in entries)
            state['attachment_compression_resume_stage'] = resume
        else:
            state['pending_attachment_compression'] = entries[0]
            state['attachment_compression_queue'] = [entries[1]]
        self.h.state.save(state['key'], state, etag)
        return resume, copy.deepcopy(state['fields']), state.get('step_index')

    def test_legacy_reply_restores_originals_without_replaying_input_continue(self):
        for stage in LEGACY:
            with self.subTest(stage=stage):
                self.setUp()
                resume, fields, step = self.legacy(stage)
                self.h.reply(reply_id='input_continue')
                state, _ = self.current()
                self.assertEqual(state['stage'], resume)
                self.assertEqual(state['fields'], fields)
                self.assertEqual(state.get('step_index'), step)
                self.assert_quiet_originals(['seed', 'pending-original', 'queued-original'])
                for a in state['attachments'][1:]:
                    self.assertEqual(len(self.h.media.read(a)), 600_000)

    def test_legacy_resend_restores_initial_menu_and_original_queue_once(self):
        for stage in LEGACY:
            with self.subTest(stage=stage):
                self.setUp()
                self.legacy(stage, initial=True)
                state, etag = self.current()
                self.h.engine._resend_current_prompt(state, etag)
                state, etag = self.current()
                self.h.engine._resend_current_prompt(state, etag)
                self.assertEqual(self.current()[0]['stage'], 'choosing_group')
                self.assert_quiet_originals(['pending-original', 'queued-original'])

    def test_legacy_confirm_yes_and_new_upload_cannot_post_or_drop_queue(self):
        for stage in LEGACY:
            with self.subTest(stage=stage):
                self.setUp()
                self.legacy(stage, confirmation=True)
                self.h.reply('SIM')
                self.assertEqual(self.current()[0]['stage'], 'awaiting_confirmation')
                self.assert_quiet_originals(['seed', 'pending-original', 'queued-original'])
                self.upload('after-recovery', 600_000)
                self.assert_quiet_originals(['seed', 'pending-original', 'queued-original', 'after-recovery'])

    def test_upload_as_first_legacy_recovery_event_preserves_all_originals(self):
        self.legacy('confirming_compressed_attachment_choice')
        self.upload('new-during-recovery', 600_000)
        self.assert_quiet_originals(['seed', 'pending-original', 'queued-original', 'new-during-recovery'])

    def test_interruption_after_first_durable_restore_keeps_remaining_queue_on_resume(self):
        self.legacy('confirming_compressed_attachment_choice')
        save = self.h.state.save

        def interrupted_save(key, state, etag):
            result = save(key, state, etag)
            mids = [a['message_id'] for a in state.get('attachments', [])]
            if 'pending-original' in mids and 'queued-original' not in mids:
                raise RuntimeError('Synthetic interruption after durable save')
            return result

        self.h.state.save = interrupted_save
        with self.assertRaisesRegex(RuntimeError, 'Synthetic interruption'):
            self.h.reply(reply_id='input_continue')
        self.h.state.save = save
        state, etag = self.current()
        self.h.engine._resend_current_prompt(state, etag)
        self.assert_quiet_originals(['seed', 'pending-original', 'queued-original'])

    def test_hard_limit_blocks_at_fields_and_actual_bytes_precommit_without_compressing(self):
        self.ready()
        self.upload('over-limit', 10)
        self.assert_quiet_originals(['seed', 'over-limit'])
        # The deployed contract uses input cap + 1, not the retired 10 MB cap.
        self.h.config['limits']['max_input_attachment_bytes'] = 13
        state, etag = self.current()
        state['stage'] = 'selecting_fields'
        etag = self.h.state.save(state['key'], state, etag)
        blocked = self.h.engine._prompt_next_or_summary(state, etag)
        self.assertEqual(blocked['status'], 'attachment_limit_exceeded')
        self.assertEqual(self.current()[0]['stage'], 'awaiting_confirmation')
        again = self.h.reply('SIM')
        self.assertEqual(again['status'], 'attachment_limit_exceeded')
        self.assert_quiet_originals(['seed', 'over-limit'])
        self.h.reply('EDITAR')
        self.assertEqual(self.current()[0]['stage'], 'editing_field_choice')

    def test_actual_bytes_guard_ignores_forged_metadata_and_preserves_fields(self):
        self.ready()
        self.h.config['limits']['max_input_attachment_bytes'] = 9
        state, _ = self.current()
        fields = copy.deepcopy(state['fields'])
        self.h.media.content[state['attachments'][0]['object_name']] = b'x' * 10
        result = self.h.reply('SIM')
        self.assertEqual(result['status'], 'attachment_limit_exceeded')
        self.assertEqual(self.current()[0]['fields'], fields)
        self.assert_quiet_originals(['seed'])

    def test_count_and_input_byte_limits_remain_enforced(self):
        self.h.config['limits']['max_attachments_per_batch'] = 2
        self.upload('one', 1)
        self.upload('two', 1)
        result = self.upload('three', 1)
        self.assertEqual(result['status'], 'limit_reached')
        self.assert_quiet_originals(['one', 'two'])
        self.h.config['limits']['max_input_attachment_bytes'] = 2
        state, _ = self.current()
        with self.assertRaises(ValueError):
            self.h.engine._append_attachment(harness.event('over-input', 'attachment', content=b'x'), state)
        self.assertEqual(len(state['attachments']), 2)

    def test_diary_pipeline_retains_large_originals_without_individual_compression(self):
        self.h.reply('OPA')
        state, etag = self.current()
        state.update(flow='construction_diary_create', stage='diary_collecting_evidence',
                     attachments_decision='yes', diary_evidence_pages=[])
        self.h.state.save(state['key'], state, etag)
        result = self.h.engine.handle(harness.event(
            'diary-photo', 'attachment', original_filename='diary.jpg',
            mime_type='image/jpeg', content=b'x' * 600_000))
        self.assertEqual(result['status'], 'diary_evidence_staged')
        self.assert_quiet_originals(['diary-photo'])
        state, _ = self.current()
        self.assertEqual(state['attachments'][0]['compression_decision'], 'diary_pdf_pipeline')
        self.assertEqual(len(self.h.media.read(state['attachments'][0])), 600_000)
        self.assertEqual(state['diary_evidence_pages'][0]['message_ids'], ['diary-photo'])

    def test_diary_legacy_resend_restores_originals_and_pages(self):
        self.legacy('confirming_intermediate_attachment_choice', initial=True)
        state, etag = self.current()
        state.update(flow='construction_diary_create', diary_evidence_pages=[])
        for entry in [state['pending_attachment_compression'], *state['attachment_compression_queue']]:
            entry['resume_stage'] = 'diary_collecting_evidence'
            entry['initial'] = False
            entry['attachment']['mime_type'] = 'image/jpeg'
            entry['attachment']['sharepoint_name'] = entry['attachment']['message_id'] + '.jpg'
            entry['attachment']['original_name'] = entry['attachment']['sharepoint_name']
        self.h.state.save(state['key'], state, etag)
        self.h.engine._resend_current_prompt(state, self.current()[1])
        self.assert_quiet_originals(['pending-original', 'queued-original'])
        state, _ = self.current()
        self.assertEqual(state['diary_evidence_pages'][0]['message_ids'],
                         ['pending-original', 'queued-original'])
        self.assertTrue(all(a['compression_decision'] == 'diary_pdf_pipeline' for a in state['attachments']))


if __name__ == '__main__':
    unittest.main()
