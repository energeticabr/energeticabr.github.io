import ast
import __future__
import hashlib
import io
import os
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SOURCE = Path(os.environ['COMPRESSION_BACKEND_SOURCE']) if os.environ.get('COMPRESSION_BACKEND_SOURCE') else Path(__file__).resolve().parents[3] / 'compression-levels-backend'
sys.path.insert(0, str(SOURCE))
from compression import AttachmentCompressor, AttachmentCompressionError
from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, NameObject, TextStringObject, ArrayObject, FloatObject


class Repository:
    def __init__(self, content):
        self.content = content
        self.replacements = []

    def read(self, attachment):
        return self.content

    def replace(self, attachment, content, **kwargs):
        self.replacements.append(content)
        return {**attachment, **kwargs, 'object_name': 'candidate'}


def item(name='file.bin', **kwargs):
    return dict(object_name='original', original_name=name, sharepoint_name=name, size=999999999, **kwargs)


class CompressionLevelsTests(unittest.TestCase):
    def test_exact_decimal_caps_and_reductions(self):
        self.assertEqual(getattr(AttachmentCompressor, 'LEVELS', None), {
            'low': (10_000_000, 25), 'medium': (5_000_000, 50),
            'high': (1_000_000, 80), 'very_high': (500_000, 90),
        })

    def test_real_source_size_controls_target_and_stale_metadata_is_ignored(self):
        for level, expected in [('low', 75), ('medium', 50), ('high', 20), ('very_high', 10)]:
            repo = Repository(b'x' * 101)
            compressor = AttachmentCompressor(repo)
            seen = []
            def candidate(source, attachment, target, directory, deadline, selected):
                seen.append(target)
                output = directory / 'candidate'
                output.write_bytes(b'x' * target)
                return output, '.bin', 'application/octet-stream'
            with patch.object(compressor, '_compress_one_for_level', side_effect=candidate, create=True):
                result = compressor.compress([item()], 100_000_000, level=level)
            self.assertEqual(seen, [expected])
            self.assertEqual(result[0]['size'], expected)
            self.assertEqual(result[0]['sha256'], hashlib.sha256(repo.replacements[0]).hexdigest())

    def test_cap_still_applies_to_large_source(self):
        repo = Repository(b'x' * 10_000_001)
        compressor = AttachmentCompressor(repo)
        seen = []
        def candidate(source, attachment, target, directory, deadline, selected):
            seen.append(target)
            return source, None, None
        with patch.object(compressor, '_compress_one_for_level', side_effect=candidate, create=True):
            with self.assertRaises(AttachmentCompressionError):
                compressor.compress([item()], 100_000_000, level='high')
        self.assertEqual(seen, [1_000_000])
        self.assertEqual(repo.replacements, [])

    def test_reduction_failure_never_replaces_original(self):
        repo = Repository(os.urandom(10000))
        compressor = AttachmentCompressor(repo)
        with self.assertRaises(AttachmentCompressionError):
            compressor.compress([item()], 100000000, level='very_high')
        self.assertEqual(repo.replacements, [])

    def test_image_never_shrinks_below_useful_resolution(self):
        output = io.BytesIO()
        Image.effect_noise((1800, 1200), 100).convert('RGB').save(output, 'PNG')
        repo = Repository(output.getvalue())
        result = AttachmentCompressor(repo).compress([item('photo.png')], 100000000, level='low')
        with Image.open(io.BytesIO(repo.replacements[0])) as image:
            self.assertGreaterEqual(max(image.size), 1600)
            self.assertGreaterEqual(min(image.size), 800)
        self.assertTrue(result[0]['compressed'])

    def test_signature_link_pdf_refuses_compression(self):
        writer = PdfWriter()
        page = writer.add_blank_page(600, 800)
        page[NameObject('/Annots')] = ArrayObject([writer._add_object(DictionaryObject({
            NameObject('/Type'): NameObject('/Annot'), NameObject('/Subtype'): NameObject('/Link'),
            NameObject('/Rect'): ArrayObject([FloatObject(n) for n in (0, 0, 100, 100)]),
            NameObject('/A'): DictionaryObject({NameObject('/S'): NameObject('/URI'), NameObject('/URI'): TextStringObject('https://example.org/assinaturas/abc')}),
        }))])
        content = io.BytesIO()
        writer.write(content)
        repo = Repository(content.getvalue())
        with self.assertRaisesRegex(AttachmentCompressionError, 'assinatura|evidência'):
            AttachmentCompressor(repo).compress([item('signed.pdf')], 10000000, level='low')
        self.assertEqual(repo.replacements, [])

    def test_legacy_below_limit_still_returns_original(self):
        repo = Repository(b'original')
        result = AttachmentCompressor(repo).compress([item()], 1000)
        self.assertEqual(result[0]['object_name'], 'original')
        self.assertEqual(result[0]['size'], 8)
        self.assertEqual(repo.replacements, [])

    def test_older_signed_evidence_metadata_refuses_compression(self):
        writer = PdfWriter()
        writer.add_blank_page(600, 800)
        writer.add_metadata({'/Keywords': 'Energetico assinatura registro abc123'})
        content = io.BytesIO()
        writer.write(content)
        repo = Repository(content.getvalue())
        with self.assertRaisesRegex(AttachmentCompressionError, 'assinatura|evidência'):
            AttachmentCompressor(repo).compress([item('signed.pdf')], 10000000, level='low')
        self.assertEqual(repo.replacements, [])

    def test_tiny_file_failure_preserves_exact_bytes(self):
        repo = Repository(b'X')
        with self.assertRaises(AttachmentCompressionError):
            AttachmentCompressor(repo).compress([item()], 1000, level='very_high')
        self.assertEqual(repo.content, b'X')
        self.assertEqual(repo.replacements, [])

    def test_real_pdf_retains_searchable_text_and_public_uri(self):
        from reportlab.pdfgen import canvas
        from reportlab.lib.utils import ImageReader
        image = io.BytesIO()
        Image.effect_noise((1800, 1200), 100).convert('RGB').save(image, 'JPEG', quality=100)
        source = io.BytesIO()
        document = canvas.Canvas(source)
        document.drawImage(ImageReader(image), 0, 0, width=500, height=400)
        document.drawString(30, 500, 'Searchable invoice text 12345')
        document.linkURL('https://example.org/invoices/123', (20, 480, 400, 520))
        document.save()
        repo = Repository(source.getvalue())
        before = PdfReader(io.BytesIO(repo.content))
        result = AttachmentCompressor(repo).compress([item('invoice.pdf')], 100000000, level='low')
        after = PdfReader(io.BytesIO(repo.replacements[0]))
        self.assertEqual(after.pages[0].extract_text(), before.pages[0].extract_text())
        self.assertEqual(str(after.pages[0]['/Annots'][0].get_object()['/A']['/URI']), 'https://example.org/invoices/123')
        self.assertLessEqual(result[0]['size'], len(repo.content) * 75 // 100)

    def test_pdf_links_with_page_and_destination_references_preserved(self):
        from reportlab.pdfgen import canvas
        from reportlab.lib.utils import ImageReader
        image = io.BytesIO()
        Image.effect_noise((1800, 1200), 100).convert('RGB').save(image, 'JPEG', quality=100)
        source = io.BytesIO()
        document = canvas.Canvas(source)
        document.drawImage(ImageReader(image), 0, 0, width=500, height=400)
        document.drawString(30, 500, 'Searchable invoice text 12345')
        document.linkURL('https://example.org/invoices/123', (20, 480, 400, 520))
        document.save()
        writer = PdfWriter()
        writer.clone_document_from_reader(PdfReader(io.BytesIO(source.getvalue())))
        page = writer.pages[0]
        annotation = page['/Annots'][0].get_object()
        annotation[NameObject('/P')] = page.indirect_reference
        destination = DictionaryObject({
            NameObject('/Type'): NameObject('/Annot'), NameObject('/Subtype'): NameObject('/Link'),
            NameObject('/P'): page.indirect_reference,
            NameObject('/Rect'): ArrayObject([FloatObject(n) for n in (20, 440, 400, 480)]),
            NameObject('/Dest'): ArrayObject([page.indirect_reference, NameObject('/Fit')]),
        })
        page['/Annots'].append(writer._add_object(destination))
        modified = io.BytesIO()
        writer.write(modified)
        repo = Repository(modified.getvalue())
        before = PdfReader(io.BytesIO(repo.content))
        result = AttachmentCompressor(repo).compress([item('invoice.pdf')], 100000000, level='low')
        after = PdfReader(io.BytesIO(repo.replacements[0]))
        self.assertEqual(after.pages[0].extract_text(), before.pages[0].extract_text())
        actual = after.pages[0]['/Annots'][0].get_object()
        self.assertEqual(actual['/P'], after.pages[0])
        self.assertEqual(after.pages[0]['/Annots'][1].get_object()['/Dest'][0].get_object(), after.pages[0])
        self.assertEqual(str(actual['/A']['/URI']), 'https://example.org/invoices/123')
        self.assertLessEqual(result[0]['size'], len(repo.content) * 75 // 100)


def workflow_harness():
    tree = ast.parse((SOURCE / 'workflow.py').read_text(encoding='utf-8'))
    names = {'_handle_single_attachment_compression_reply', '_send_attachment_compression_question', '_send_attachment_compression_levels', '_finish_pending_attachment_compression'}
    methods = [node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name in names]
    cls = ast.ClassDef(name='Harness', bases=[], keywords=[], body=methods, decorator_list=[])
    namespace = {'_control_command': lambda value: value.strip().casefold(), '_human_size': str}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[cls], type_ignores=[])), '<workflow>', 'exec', flags=__future__.annotations.compiler_flag), namespace)
    harness = namespace['Harness']()
    harness._mark_processed = lambda *args: None
    harness._save = lambda *args: 'etag'
    harness.messages = []
    harness._send_actions = lambda *args: harness.messages.append(args)
    harness._compression_sequence_position = lambda state: (1, 2)
    harness._attachment_compression_target_label = lambda state: '500 KB'
    return harness


class WorkflowLevelsTests(unittest.TestCase):
    def test_yes_asks_level_before_converter(self):
        harness = workflow_harness()
        harness._finish_pending_attachment_compression = lambda *args: self.fail('compressed before selecting level')
        state = {'stage': 'confirming_attachment_compression', 'batch_id': 'batch', 'pending_attachment_compression': {'attachment': item()}}
        result = harness._handle_single_attachment_compression_reply({'message_id': 'yes', 'reply_id': 'compress_attachments_yes'}, state, None)
        self.assertEqual(result['status'], 'awaiting_attachment_compression_level')
        self.assertTrue(state['pending_attachment_compression']['awaiting_level'])
        self.assertEqual([a['id'] for a in harness.messages[-1][-1]], ['compression_level_low', 'compression_level_medium', 'compression_level_high', 'compression_level_very_high', 'compress_attachments_no'])
        self.assertEqual([a['title'].split(' —')[0] for a in harness.messages[-1][-1]][:4], ['BAIXA COMPRESSÃO', 'MÉDIA COMPRESSÃO', 'ALTA COMPRESSÃO', 'MUITO ALTA COMPRESSÃO'])

    def test_level_menu_can_keep_original_before_conversion(self):
        harness = workflow_harness()
        state = {'stage': 'confirming_attachment_compression', 'batch_id': 'batch', 'attachment_compression_all_approved': True,
                 'pending_attachment_compression': {'attachment': item(), 'event': {'message_id': 'upload'}, 'compress': True, 'awaiting_level': True}}
        kept = []
        harness._complete_pending_attachment_selection = lambda state, etag, attachment, decision: kept.append(decision) or {'status': decision}
        result = harness._handle_single_attachment_compression_reply({'message_id': 'no', 'reply_id': 'compress_attachments_no'}, state, None)
        self.assertEqual(result['status'], 'kept_original')
        self.assertEqual(kept, ['kept_original'])
        self.assertFalse(state.get('attachment_compression_all_approved'))

    def test_all_uses_chosen_level(self):
        harness = workflow_harness()
        harness._finish_pending_attachment_compression = lambda *args: {'status': 'compressed'}
        state = {'stage': 'confirming_attachment_compression', 'batch_id': 'batch', 'pending_attachment_compression': {'attachment': item()}}
        harness._handle_single_attachment_compression_reply({'message_id': 'all', 'reply_id': 'compress_all_attachments'}, state, None)
        harness._handle_single_attachment_compression_reply({'message_id': 'level', 'reply_id': 'compression_level_high'}, state, None)
        self.assertEqual(state['pending_attachment_compression']['level'], 'high')
        self.assertEqual(state['attachment_compression_all_level'], 'high')

    def test_oversized_original_still_requires_preview_choice(self):
        harness = workflow_harness()
        state = {'stage': 'confirming_attachment_compression', 'batch_id': 'batch', 'pending_attachment_compression': {'attachment': item(), 'event': {'message_id': 'upload'}, 'compress': True, 'level': 'high'}}
        received = []
        harness.attachment_compressor = SimpleNamespace(compress=lambda items, limit, **kwargs: received.append(kwargs) or [{**item(), 'size': 100}])
        harness._attachment_size_limit = lambda: 25000000
        harness._send_text = lambda *args: None
        harness._send_attachment_version_preview = lambda *args: None
        harness._send_compressed_attachment_choice = lambda *args: None
        harness._complete_pending_attachment_selection = lambda *args: self.fail('accepted without preview choice')
        result = harness._finish_pending_attachment_compression(state, None)
        self.assertEqual(received, [{'level': 'high'}])
        self.assertEqual(result['status'], 'awaiting_compressed_attachment_choice')


class PortalLevelsTests(unittest.TestCase):
    def test_portal_two_phase_compression_never_replaces_before_preview_choice(self):
        tree = ast.parse((SOURCE / 'channel_bridge.py').read_text(encoding='utf-8'))
        names = {'portal_attachment_compress', 'portal_attachment_compression_choice', '_portal_attachment_id', 'portal_attachment_delete', 'portal_attachment_delete_all'}
        methods = [node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name in names]
        cls = ast.ClassDef(name='Harness', bases=[], keywords=[], body=methods, decorator_list=[])
        namespace = {'Path': Path, 'PortalMediaStore': object, 'json': __import__('json'), 'hashlib': hashlib, 're': __import__('re'), 'hmac': __import__('hmac'),
                     'dataclass': __import__('dataclasses').dataclass, 'threading': threading,
                     'time': __import__('time'), 'uuid': __import__('uuid'), 'mimetypes': __import__('mimetypes'),
                     '_workflow_data_root': lambda root: Path(root).resolve()}
        media_classes = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name in {'PortalMedia', 'PortalMediaStore'}]
        exec(compile(ast.fix_missing_locations(ast.Module(body=media_classes, type_ignores=[])), '<media>', 'exec', flags=__future__.annotations.compiler_flag), namespace)
        exec(compile(ast.fix_missing_locations(ast.Module(body=[cls], type_ignores=[])), '<bridge>', 'exec', flags=__future__.annotations.compiler_flag), namespace)
        harness = namespace['Harness']()
        with tempfile.TemporaryDirectory() as temp:
            media_store = namespace['PortalMediaStore'](data_root=Path(temp))
            Path(temp, 'original').write_bytes(b'original' * 100)
            original = item(message_id='upload')
            state = {'stage': 'waiting_for_attachments', 'batch_id': 'batch', 'attachments': [original]}
            calls = []
            def compress(items, limit, **kwargs):
                calls.append(kwargs)
                Path(temp, 'candidate').write_bytes(b'candidate')
                return [{**original, 'object_name': 'candidate', 'size': 9}]
            harness.lock = threading.Lock()
            harness._portal_state = lambda identity: ('key', state)
            harness._portal_attachment_selection = lambda *args: (0, state['attachments'][0])
            harness.portal_owners = SimpleNamespace(authorize=lambda *args, **kwargs: None)
            harness.engine = SimpleNamespace(_provision_attachments_locked=lambda state: False, attachment_compressor=SimpleNamespace(compress=compress),
                media_repository=SimpleNamespace(directory=temp), state_store=SimpleNamespace(load=lambda key: (state, None), save=lambda *args: None),
                _attachment_size_limit=lambda: 25000000, _delete_staged_attachments=lambda *args, **kwargs: None)
            identity = {'oid': 'owner'}
            result = harness.portal_attachment_compress(identity, 'a' * 64, None, allowed_emails=set())
            self.assertEqual(calls, [])
            self.assertEqual(state['portal_attachment_compression']['phase'], 'level')
            self.assertEqual([o['id'] for o in result['messages'][0]['options']], ['attachment_compression_level_low', 'attachment_compression_level_medium', 'attachment_compression_level_high', 'attachment_compression_level_very_high', 'attachment_compression_use_original'])
            self.assertEqual([o['label'].split(' —')[0] for o in result['messages'][0]['options']][:4], ['BAIXA COMPRESSÃO', 'MÉDIA COMPRESSÃO', 'ALTA COMPRESSÃO', 'MUITO ALTA COMPRESSÃO'])
            recovered = harness.portal_attachment_compress(identity, 'a' * 64, media_store, allowed_emails=set())
            self.assertEqual(recovered['messages'][0]['options'], result['messages'][0]['options'])
            self.assertEqual(calls, [])
            self.assertEqual(state['attachments'][0]['object_name'], 'original')
            with self.assertRaisesRegex(ValueError, 'pendente'):
                harness.portal_attachment_compress(identity, 'b' * 64, media_store, allowed_emails=set())
            harness.portal_attachment_compression_choice(identity, 'attachment_compression_use_original', None, allowed_emails=set())
            self.assertEqual(calls, [])
            self.assertNotIn('portal_attachment_compression', state)
            harness.portal_attachment_compress(identity, 'a' * 64, None, allowed_emails=set())
            result = harness.portal_attachment_compression_choice(identity, 'attachment_compression_level_high', media_store, allowed_emails=set())
            self.assertEqual(calls, [{'level': 'high'}])
            self.assertEqual(state['attachments'][0]['object_name'], 'original')
            self.assertEqual(state['portal_attachment_compression']['phase'], 'preview')
            self.assertEqual(result['messages'][-1]['type'], 'poll')
            preview = result['messages'][-1]['attachment_compression_preview']
            self.assertEqual(preview['original']['size'], 800)
            self.assertEqual(preview['compressed']['size'], 9)
            self.assertNotEqual(preview['original']['id'], preview['compressed']['id'])
            for version in ('original', 'compressed'):
                token = preview[version]['mediaUrl'].split('/')[-1]
                self.assertEqual(media_store.resolve(token, identity).path.name, 'original' if version == 'original' else 'candidate')
                with self.assertRaises(PermissionError):
                    media_store.resolve(token, {'oid': 'other'})
            harness.portal_attachment_compression_choice(identity, 'attachment_compression_use_original', None, allowed_emails=set())
            self.assertEqual(state['attachments'][0]['object_name'], 'original')
            harness.portal_attachment_compress(identity, 'a' * 64, None, allowed_emails=set())
            harness._portal_attachment_selection = lambda *args: (_ for _ in ()).throw(ValueError('stale attachment'))
            with self.assertRaisesRegex(ValueError, 'stale'):
                harness.portal_attachment_compression_choice(identity, 'attachment_compression_level_high', None, allowed_emails=set())
            self.assertNotIn('portal_attachment_compression', state)
            self.assertEqual(state['attachments'][0]['object_name'], 'original')
            harness._portal_attachment_selection = lambda *args: (0, state['attachments'][0])
            deleted = []
            harness.engine.media_repository.delete = lambda attachment: deleted.append(attachment['object_name'])
            harness.engine._delete_staged_attachments = lambda items, **kwargs: deleted.extend(attachment['object_name'] for attachment in items)
            harness.engine._all_state_attachments = lambda state: state['attachments']
            harness.engine.allows_portal_bulk_attachment_delete = lambda state: True
            # Both single and bulk delete release a pending level request;
            # deleting after preview also disposes the unaccepted candidate.
            for bulk in (False, True):
                for preview_ready in (False, True):
                    state['attachments'] = [original]
                    original_id = harness._portal_attachment_id(identity, state, original)
                    harness.portal_attachment_compress(identity, original_id, media_store, allowed_emails=set())
                    if preview_ready:
                        harness.portal_attachment_compression_choice(identity, 'attachment_compression_level_high', media_store, allowed_emails=set())
                    deleted.clear()
                    if bulk:
                        harness.portal_attachment_delete_all(identity, allowed_emails=set())
                    else:
                        harness.portal_attachment_delete(identity, original_id, allowed_emails=set())
                    self.assertNotIn('portal_attachment_compression', state)
                    self.assertIn('original', deleted)
                    if preview_ready:
                        self.assertIn('candidate', deleted)
                    replacement = {**original, 'message_id': 'replacement'}
                    state['attachments'] = [replacement]
                    replacement_id = harness._portal_attachment_id(identity, state, replacement)
                    result = harness.portal_attachment_compress(identity, replacement_id, media_store, allowed_emails=set())
                    self.assertEqual(result['operation'], 'awaiting_portal_attachment_compression_level')
                    harness.portal_attachment_compression_choice(identity, 'attachment_compression_use_original', media_store, allowed_emails=set())


if __name__ == '__main__':
    unittest.main()
