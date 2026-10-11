import ast
import __future__
import hashlib
import os
from pathlib import Path
from types import SimpleNamespace
import unittest

SOURCE = Path(os.environ['POSTING_LIMIT_SOURCE'])
METHODS = ('_attachment_size_limit', '_declared_attachment_total',
           '_request_received_attachment_compression', '_handle_attachment_compression_reply',
           '_attachment_total_or_request_reupload')
tree = ast.parse((SOURCE / 'workflow.py').read_text(encoding='utf-8'))
engine = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'WorkflowEngine')
scope = {'_control_command': lambda value: str(value).casefold().strip()}
for node in engine.body:
    if isinstance(node, ast.FunctionDef) and node.name in METHODS:
        node.decorator_list = []
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<live-workflow>', 'exec',
                     flags=__future__.annotations.compiler_flag), scope)


class PostingLimitTests(unittest.TestCase):
    def harness(self, config=None):
        harness = SimpleNamespace(config=config or {})
        for name in METHODS:
            setattr(harness, name, scope[name] if name == '_declared_attachment_total' else scope[name].__get__(harness))
        harness._send_text = lambda *args: None
        harness._start_action_menu = lambda *args: self.fail('Must not cancel or reset a valid attachment batch')
        harness._compress_attachments = lambda *args: self.fail('Must not force original compression')
        return harness

    def test_default_allows_the_full_supported_sixty_mb_batch(self):
        engine = self.harness()
        self.assertGreater(engine._attachment_size_limit(), 60_000_000)

    def test_legacy_total_key_cannot_reintroduce_ten_mb_limit(self):
        engine = self.harness({'limits': {'max_total_attachment_bytes': 10_000_000,
                                         'max_input_attachment_bytes': 60_000_000,
                                         'max_attachments_per_batch': 20}})
        self.assertGreater(engine._attachment_size_limit(), 60_000_000)

    def test_declining_optional_compression_never_forces_size_consent(self):
        for sizes in ([13_600_000], [30_000_000] * 2):
            engine = self.harness()
            engine._request_attachment_compression = lambda *args, **kwargs: self.fail('Forced compression')
            state = {'key': 'test', 'attachments': [{'size': size, 'compression_decision': 'original'} for size in sizes]}
            self.assertIsNone(engine._request_received_attachment_compression(state, 'etag', 'collecting_attachments'))

    def test_obsolete_consent_preserves_original_and_continues_to_review(self):
        content = b'%PDF-test-original\n' + bytes(13_600_000)
        digest = hashlib.sha256(content).hexdigest()
        for reply in ('compress_attachments_no', 'compress_attachments_yes'):
            engine = self.harness()
            engine.media_repository = SimpleNamespace(read=lambda item: content)
            engine._mark_processed = lambda *args: None
            engine._save = lambda *args: 'new-etag'
            engine._summarize_and_confirm = lambda *args: {'status': 'awaiting_confirmation'}
            engine._compress_attachments = lambda *args: self.fail('Original must not be automatically compressed')
            engine._delete_staged_attachments = lambda *args, **kwargs: self.fail('Original must not be deleted')
            engine._start_action_menu = lambda *args: self.fail('Must not reset the form')
            attachment = {'object_name': 'original.pdf', 'size': len(content)}
            state = {'key': 'test', 'attachments': [attachment], 'stage': 'awaiting_attachment_compression_consent'}
            result = engine._handle_attachment_compression_reply({'reply_id': reply, 'message_id': 'reply'}, state, 'etag')
            self.assertEqual(result['status'], 'awaiting_confirmation')
            self.assertEqual(state['stage'], 'summarizing')
            self.assertEqual(state['attachments'], [attachment])
            self.assertEqual(hashlib.sha256(engine.media_repository.read(attachment)).hexdigest(), digest)

    def test_obsolete_consent_returns_to_original_stage_without_posting(self):
        engine = self.harness()
        engine.media_repository = SimpleNamespace(read=lambda item: bytes(12_000_000))
        engine._mark_processed = lambda *args: None
        engine._save = lambda *args: 'new-etag'
        engine._resend_current_prompt = lambda *args: {'status': 'prompt_resent'}
        state = {'key': 'test', 'attachments': [{'object_name': 'original'}],
                 'attachment_compression_resume_stage': 'collecting_attachments',
                 'stage': 'awaiting_attachment_compression_consent'}
        result = engine._handle_attachment_compression_reply({'reply_id': 'compress_attachments_no', 'message_id': 'r'}, state, 'e')
        self.assertEqual(result['status'], 'prompt_resent')
        self.assertEqual(state['stage'], 'collecting_attachments')

    def test_missing_source_still_requests_reupload_without_posting(self):
        engine = self.harness()
        def missing(item):
            raise FileNotFoundError()
        engine.media_repository = SimpleNamespace(read=missing)
        engine._mark_processed = lambda *args: None
        engine._save = lambda *args: 'new-etag'
        engine._send_attachment_upload_question = lambda *args: None
        state = {'key': 'test', 'attachments': [{'object_name': 'missing', 'original_name': 'original.pdf'}],
                 'batch_id': 'batch', 'stage': 'awaiting_attachment_compression_consent'}
        result = engine._handle_attachment_compression_reply({'reply_id': 'compress_attachments_no', 'message_id': 'r'}, state, 'e')
        self.assertEqual(result['status'], 'waiting_for_attachment_reupload')
        self.assertEqual(state['stage'], 'collecting_attachments')


if __name__ == '__main__':
    unittest.main()
