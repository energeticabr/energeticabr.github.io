"""Real HTTP manual-icon flow, real compressor, synthetic retained bytes."""
import unittest

import test_portal_attachments as harness


class ManualPortalTests(unittest.TestCase):
    def setUp(self):
        self.h = harness.PortalAttachmentTests()
        self.h.setUp()
        self.addCleanup(self.h.doCleanups)

    def exercise(self, choice):
        h = self.h
        state = h.seed_state()
        content = b'synthetic compressible attachment\n' * 1000
        original = h.attachment(state, 'manual.txt', content)
        original.update(mime_type='text/plain', size=9_000_000)
        state['attachments'] = [original]
        h.save(state)
        item = h.snapshot()[0]
        saved, _ = h.bridge.engine.state_store.load(state['key'])
        self.assertNotIn('portal_attachment_compression', saved)
        status, levels = h.request('/portal/chat', {
            'action': 'attachment_compress', 'attachmentId': item['id'],
        })
        self.assertEqual(status, 200, levels)
        self.assertEqual(levels['operation'], 'awaiting_portal_attachment_compression_level')
        saved, _ = h.bridge.engine.state_store.load(state['key'])
        self.assertNotIn('compressed', saved['portal_attachment_compression'])
        self.assertEqual(h.bridge.engine.media_repository.read(original), content)
        status, preview = h.request('/portal/chat', {
            'action': 'attachment_compression_choice', 'choice': 'attachment_compression_level_high',
        })
        self.assertEqual(status, 200, preview)
        self.assertEqual(preview['operation'], 'awaiting_portal_attachment_compression_choice')
        saved, _ = h.bridge.engine.state_store.load(state['key'])
        compressed = saved['portal_attachment_compression']['compressed']
        self.assertLess(compressed['size'], len(content))
        self.assertEqual(saved['attachments'][0]['object_name'], original['object_name'])
        self.assertEqual(h.bridge.engine.media_repository.read(original), content)
        document = next(m for m in preview['messages'] if m['type'] == 'document')
        self.assertEqual(h.request(document['mediaUrl'], method='GET')[0], 200)
        status, result = h.request('/portal/chat', {
            'action': 'attachment_compression_choice', 'choice': choice,
        })
        self.assertEqual(status, 200, result)
        saved, _ = h.bridge.engine.state_store.load(state['key'])
        self.assertNotIn('portal_attachment_compression', saved)
        selected = original if choice.endswith('_original') else compressed
        self.assertEqual(saved['attachments'][0]['object_name'], selected['object_name'])
        self.assertEqual(saved['stage'], state['stage'])
        self.assertEqual(saved['fields'], state['fields'])

    def test_manual_icon_then_level_preview_and_keep_original(self):
        self.exercise('attachment_compression_use_original')

    def test_manual_icon_then_level_preview_and_use_compressed(self):
        self.exercise('attachment_compression_use_compressed')

    def test_other_account_cannot_start_manual_compression(self):
        state = self.h.seed_state()
        state['attachments'] = [self.h.attachment(state, 'owner.txt', b'owner' * 1000)]
        self.h.save(state)
        item = self.h.snapshot()[0]
        status, result = self.h.request('/portal/chat', {
            'action': 'attachment_compress', 'attachmentId': item['id'],
        }, token='bob')
        self.assertEqual(status, 422, result)
        saved, _ = self.h.bridge.engine.state_store.load(state['key'])
        self.assertNotIn('portal_attachment_compression', saved)


if __name__ == '__main__':
    unittest.main()
