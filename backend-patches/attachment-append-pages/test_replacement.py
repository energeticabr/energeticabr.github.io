import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest

from pypdf import PdfWriter

SPEC = importlib.util.spec_from_file_location('replacement', Path(__file__).with_name('replacement.py'))
replacement = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(replacement)


def pdf_bytes(pages=2):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(300, 400)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


class ReplacementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.key = 'c' * 64
        self.identity = {'oid': 'owner'}
        self.folder = self.root / self.key[:12]
        self.folder.mkdir()
        self.original = self.folder / 'original.jpg'
        self.original.write_bytes(b'original-photo')
        self.old_hash = hashlib.sha256(self.original.read_bytes()).hexdigest()
        self.state = {'key': self.key, 'batch_id': 'batch-1', 'flow': 'document_create',
                      'stage': 'awaiting_field', 'question': 'Qual a filial?', 'fields': {'FILIAL': 'A'},
                      'attachments': [{'message_id': 'source-1', 'object_name': self.key[:12] + '/original.jpg',
                                       'original_name': 'foto.jpg', 'sharepoint_name': 'unique-foto.jpg',
                                       'mime_type': 'image/jpeg', 'size': 14}]}
        self.saves = 0
        self.fail_save = False
        self.deny = False
        self.locked = False
        self.bridge = SimpleNamespace(lock=threading.RLock(),
            _portal_state=lambda identity: (self.key, copy.deepcopy(self.state)),
            portal_owners=SimpleNamespace(authorize=self.authorize),
            engine=SimpleNamespace(media_repository=SimpleNamespace(directory=self.root),
                state_store=SimpleNamespace(load=lambda key: (copy.deepcopy(self.state), 'etag-1'), save=self.save),
                _provision_attachments_locked=lambda state: self.locked),
            _portal_attachment_id=self.attachment_id,
            portal_attachment_snapshot=self.snapshot)
        self.old_id = self.attachment_id(self.identity, self.state, self.state['attachments'][0])
        self.upload_path = self.root / 'upload.pdf'
        self.upload_path.write_bytes(pdf_bytes())
        self.upload = SimpleNamespace(path=self.upload_path, file_name='foto.pdf', mime_type='application/pdf')
        self.request_id = '74728688-9c56-41d6-924a-7261dd4f7d10'

    def authorize(self, key, identity, **kwargs):
        if self.deny or identity.get('oid') != 'owner':
            raise PermissionError('Não autorizado')

    def save(self, key, state, etag):
        self.assertEqual(etag, 'etag-1')
        self.assertTrue(self.original.is_file(), 'original must exist until state commit')
        self.saves += 1
        if self.fail_save:
            raise RuntimeError('storage offline')
        self.state = copy.deepcopy(state)

    @staticmethod
    def attachment_id(identity, state, item):
        value = json.dumps([identity['oid'], state['batch_id'], item['message_id'], item['object_name']],
                           ensure_ascii=False, separators=(',', ':'))
        return hashlib.sha256(value.encode()).hexdigest()

    def snapshot(self, identity, media_store, **kwargs):
        return [{'id': self.attachment_id(identity, self.state, item), 'fileName': item['original_name'],
                 'mimeType': item['mime_type'], 'size': (self.root / item['object_name']).stat().st_size,
                 'mediaUrl': '/api/portal-media/' + item['message_id']}
                for item in self.state['attachments']]

    def replace(self, **kwargs):
        args = dict(attachment_id=self.old_id, expected_sha256=self.old_hash,
                    request_id=self.request_id, allowed_emails={'owner@example.test'})
        args.update(kwargs)
        return replacement.portal_replace_attachment(self.bridge, self.identity, self.upload, None, **args)

    def test_replaces_only_target_after_single_commit_without_advancing_question(self):
        previous = copy.deepcopy(self.state)
        result = self.replace()
        self.assertEqual(result['operation'], 'attachment_replaced')
        self.assertEqual(result['requestId'], self.request_id)
        self.assertEqual(result['previousAttachmentId'], self.old_id)
        self.assertEqual(len(result['attachments']), 1)
        self.assertEqual(result['replacement']['fileName'], 'foto.pdf')
        self.assertNotEqual(result['replacement']['id'], self.old_id)
        self.assertEqual(self.saves, 1)
        for field in ['flow', 'stage', 'question', 'fields', 'batch_id']:
            self.assertEqual(self.state[field], previous[field])
        new = self.root / self.state['attachments'][0]['object_name']
        self.assertEqual(new.read_bytes(), self.upload_path.read_bytes())
        self.assertTrue(self.original.exists(), 'retain recoverable source; do not delete media in replacement')

    def test_lost_response_retry_is_idempotent_and_different_body_is_rejected(self):
        first = self.replace()
        again = self.replace()
        self.assertEqual(first['replacement'], again['replacement'])
        self.assertEqual(self.saves, 1)
        self.upload_path.write_bytes(pdf_bytes(3))
        with self.assertRaisesRegex(ValueError, 'tentativa|identificador|conteúdo'):
            self.replace()
        self.assertEqual(self.saves, 1)

    def test_stale_hash_or_unknown_id_cannot_replace_homonymous_attachment(self):
        for params in [{'expected_sha256': '0' * 64}, {'attachment_id': 'a' * 64}]:
            with self.subTest(params=params), self.assertRaises(ValueError):
                self.replace(**params)
        self.assertEqual(self.saves, 0)
        self.assertEqual(self.state['attachments'][0]['original_name'], 'foto.jpg')

    def test_owner_and_readonly_and_committing_guards_preserve_original(self):
        self.deny = True
        with self.assertRaises(PermissionError):
            self.replace()
        self.deny = False
        for update in [{'read_only': True}, {'existing_attachment': True}]:
            self.state['attachments'][0].update(update)
            with self.assertRaises(ValueError):
                self.replace()
            for key in update:
                del self.state['attachments'][0][key]
        self.state['stage'] = 'committing'
        with self.assertRaises(ValueError):
            self.replace()
        self.assertEqual(self.saves, 0)

    def test_malformed_or_empty_or_excessive_page_pdf_never_changes_state(self):
        for content in [b'not a pdf', b'', pdf_bytes(201)]:
            self.upload_path.write_bytes(content)
            with self.subTest(size=len(content)), self.assertRaises(ValueError):
                self.replace()
        self.assertEqual(self.saves, 0)

    def test_failed_save_keeps_original_and_same_request_can_retry(self):
        self.fail_save = True
        with self.assertRaisesRegex(RuntimeError, 'storage offline'):
            self.replace()
        self.assertEqual(self.state['attachments'][0]['original_name'], 'foto.jpg')
        self.assertTrue(self.original.exists())
        self.fail_save = False
        self.replace()
        self.assertEqual(len(self.state['attachments']), 1)

    def test_altered_original_and_unsafe_path_are_never_overwritten(self):
        self.original.write_bytes(b'new content')
        with self.assertRaises(ValueError):
            self.replace()
        self.original.write_bytes(b'original-photo')
        self.state['attachments'][0]['object_name'] = '../outside.pdf'
        self.old_id = self.attachment_id(self.identity, self.state, self.state['attachments'][0])
        with self.assertRaises(ValueError):
            self.replace()
        self.assertEqual(self.saves, 0)


if __name__ == '__main__':
    unittest.main()
