"""Real repository methods, real temp files, synthetic bytes; no backend imports.

AST loading avoids local_app's unrelated worker imports and service setup. The
filename functions are the real, unmodified private production reference.
"""
import ast
from contextlib import nullcontext
from datetime import datetime, timezone
import hashlib
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sys
from types import SimpleNamespace
from urllib.parse import quote

import pytest


def load_repository():
    root = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
    reference = Path(os.environ['ENERGETICA_LOGIC_SOURCE'])
    namespace = dict(Path=Path, os=os, hashlib=hashlib, mimetypes=mimetypes,
                     re=re, datetime=datetime, timezone=timezone, quote=quote,
                     secrets=secrets, nullcontext=nullcontext, HTTP_TIMEOUT=(10, 120))
    logic = ast.parse(reference.read_text(encoding='utf-8'))
    functions = [node for node in logic.body if isinstance(node, ast.FunctionDef)
                 and node.name in {'safe_filename', 'destination_filename'}]
    assert len(functions) == 2, 'Private filename reference missing'
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(reference), 'exec'), namespace)
    source = root / 'local_app.py'
    tree = ast.parse(source.read_text(encoding='utf-8'))
    classes = [node for node in tree.body if isinstance(node, ast.ClassDef)
               and node.name == 'LocalMediaRepository']
    assert len(classes) == 1, 'Private repository class missing'
    exec(compile(ast.Module(body=classes, type_ignores=[]), str(source), 'exec'), namespace)
    return namespace['LocalMediaRepository']


@pytest.fixture
def case(tmp_path):
    repository = load_repository()(tmp_path / 'media', None, 'v25.0')
    source = tmp_path / 'source.bin'
    event = dict(local_path=str(source), message_id='m1', timestamp=0,
                 type='image', original_filename='foto.png', mime_type='image/png')
    return SimpleNamespace(repo=repository, source=source, event=event,
                           batch='b' * 24, key='a' * 64)


def stage(case):
    return case.repo.stage(case.event, case.batch, case.key)


def expected_target(case):
    # Independent expected key and literal path structure; never call stage helpers.
    media_key = hashlib.sha256(b'm1').hexdigest()[:24]
    return case.repo.directory / ('a' * 12) / ('b' * 12) / (media_key + '.png')


def files(case):
    return sorted(path.relative_to(case.repo.directory).as_posix()
                  for path in case.repo.directory.rglob('*') if path.is_file())


def guard_source(case, monkeypatch, *, fail_after=None, truncate_after=None, grow=None):
    original_open = Path.open
    reads = []

    class Reader:
        def __init__(self, stream):
            self.stream = stream

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return self.stream.__exit__(*args)

        def fileno(self):
            return self.stream.fileno()

        def read(self, size=-1):
            assert 0 < size <= 64 * 1024, 'local source read must be bounded to 64 KiB'
            if fail_after is not None and len(reads) >= fail_after:
                raise OSError('synthetic source read failure')
            if grow is not None and not reads:
                with original_open(case.source, 'ab') as stream:
                    stream.write(grow)
            reads.append(size)
            if truncate_after is not None and len(reads) > truncate_after:
                return b''
            return self.stream.read(size)

    def opened(path, *args, **kwargs):
        stream = original_open(path, *args, **kwargs)
        mode = args[0] if args else kwargs.get('mode', 'r')
        if path == case.source and mode == 'rb':
            return Reader(stream)
        return stream

    monkeypatch.setattr(Path, 'open', opened)
    return reads


def test_local_source_never_requires_an_unbounded_read(case, monkeypatch):
    payload = b'abc' * 50_000
    case.source.write_bytes(payload)
    guard_source(case, monkeypatch)
    result = stage(case)
    assert expected_target(case).read_bytes() == payload
    assert result['size'] == 150_000
    assert result['sha256'] == hashlib.sha256(payload).hexdigest()


def test_digest_is_incremental_and_matches_original_bytes(case, monkeypatch):
    payload = bytes(range(251)) * 600
    case.source.write_bytes(payload)
    expected_digest = hashlib.sha256(payload).hexdigest()
    real_sha256 = hashlib.sha256

    def bounded_sha256(data=b''):
        assert len(data) <= 64 * 1024, 'SHA must not receive the whole large file'
        inner = real_sha256(data)

        class Digest:
            def update(self, chunk):
                assert len(chunk) <= 64 * 1024
                inner.update(chunk)

            def hexdigest(self):
                return inner.hexdigest()

        return Digest()

    monkeypatch.setattr(hashlib, 'sha256', bounded_sha256)
    result = stage(case)
    assert result['sha256'] == expected_digest
    assert result['size'] == len(payload)


def test_metadata_and_deterministic_path_match_existing_contract(case):
    case.source.write_bytes(b'abc')
    result = stage(case)
    assert result == {
        'message_id': 'm1',
        'object_name': expected_target(case).relative_to(case.repo.directory).as_posix(),
        'sharepoint_name': '19700101-000000_m1_foto.png',
        'original_name': 'foto.png',
        'mime_type': 'image/png',
        'size': 3,
        'sha256': 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    }
    assert stage(case) == result
    assert files(case) == [result['object_name']]


def test_missing_mime_keeps_octet_stream_fallback(case):
    case.source.write_bytes(b'data')
    case.event.pop('mime_type')
    assert stage(case)['mime_type'] == 'application/octet-stream'


@pytest.mark.parametrize('payload,limit', [(b'', 0), (b'abc', 3)])
def test_empty_and_exact_limit_inputs_are_preserved(case, payload, limit):
    case.source.write_bytes(payload)
    case.repo.max_bytes = limit
    result = stage(case)
    assert result['size'] == len(payload)
    assert expected_target(case).read_bytes() == payload


def test_oversize_input_does_not_publish_an_attachment(case):
    case.source.write_bytes(b'abcd')
    case.repo.max_bytes = 3
    with pytest.raises(ValueError, match='Anexo excede o limite configurado'):
        stage(case)
    assert files(case) == []


def test_growth_during_copy_still_enforces_the_actual_byte_limit(case, monkeypatch):
    case.source.write_bytes(b'abc')
    case.repo.max_bytes = 4
    guard_source(case, monkeypatch, grow=b'de')
    with pytest.raises(ValueError, match='Anexo excede o limite configurado'):
        stage(case)
    assert files(case) == []


def test_truncated_copy_never_publishes_partial_content(case, monkeypatch):
    case.source.write_bytes(b'x' * 80_000)
    guard_source(case, monkeypatch, truncate_after=1)
    with pytest.raises(ValueError, match='alterado|incompleto'):
        stage(case)
    assert files(case) == []


def test_source_read_error_cleans_staging_and_preserves_source(case, monkeypatch):
    case.source.write_bytes(b'x' * 80_000)
    guard_source(case, monkeypatch, fail_after=1)
    with pytest.raises(OSError, match='synthetic source read failure'):
        stage(case)
    assert files(case) == []
    assert case.source.stat().st_size == 80_000


def test_destination_write_error_cleans_staging(case, monkeypatch):
    case.source.write_bytes(b'abc')
    real_fdopen = os.fdopen

    class FailingWriter:
        def __init__(self, stream):
            self.stream = stream

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return self.stream.__exit__(*args)

        def write(self, data):
            self.stream.write(data[:1])
            raise OSError('synthetic disk write failure')

    monkeypatch.setattr(os, 'fdopen', lambda fd, *a, **k: FailingWriter(real_fdopen(fd, *a, **k)))
    with pytest.raises(OSError, match='synthetic disk write failure'):
        stage(case)
    assert files(case) == []


def test_publication_error_cleans_completed_temporary_file(case, monkeypatch):
    case.source.write_bytes(b'abc')

    def cannot_publish(*args, **kwargs):
        raise OSError('synthetic publication failure')

    monkeypatch.setattr(os, 'link', cannot_publish)
    with pytest.raises(OSError, match='synthetic publication failure'):
        stage(case)
    assert files(case) == []


def test_target_becomes_visible_only_after_complete_copy(case, monkeypatch):
    payload = b'q' * 80_000
    case.source.write_bytes(payload)
    real_link = os.link
    published = []

    def publish(source, target, *args, **kwargs):
        assert not Path(target).exists()
        assert Path(source).read_bytes() == payload
        real_link(source, target, *args, **kwargs)
        published.append(Path(target).read_bytes())

    monkeypatch.setattr(os, 'link', publish)
    stage(case)
    assert published == [payload]
    assert files(case) == [expected_target(case).relative_to(case.repo.directory).as_posix()]


def test_existing_target_is_not_overwritten_and_metadata_still_describes_input(case, monkeypatch):
    case.source.write_bytes(b'old target')
    stage(case)
    case.source.write_bytes(b'abc')
    guard_source(case, monkeypatch)
    result = stage(case)
    assert expected_target(case).read_bytes() == b'old target'
    assert result['size'] == 3
    assert result['sha256'] == 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    assert files(case) == [result['object_name']]


def test_late_existing_target_is_preserved(case, monkeypatch):
    case.source.write_bytes(b'abc')
    real_link = os.link

    def race(source, target, *args, **kwargs):
        Path(target).write_bytes(b'concurrent target')
        real_link(source, target, *args, **kwargs)

    monkeypatch.setattr(os, 'link', race)
    result = stage(case)
    assert expected_target(case).read_bytes() == b'concurrent target'
    assert result['size'] == 3
    assert files(case) == [result['object_name']]


def test_read_failure_never_removes_an_existing_target(case, monkeypatch):
    case.source.write_bytes(b'old target')
    stage(case)
    case.source.write_bytes(b'q' * 80_000)
    guard_source(case, monkeypatch, fail_after=1)
    with pytest.raises(OSError, match='synthetic source read failure'):
        stage(case)
    assert expected_target(case).read_bytes() == b'old target'
    assert len(files(case)) == 1


def test_remote_download_path_keeps_mime_metadata_and_limit_contract(case, monkeypatch):
    case.event.pop('local_path')
    case.event['media_id'] = 'synthetic-media'
    case.repo.meta_token = 'synthetic-token'
    responses = iter([
        SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'url': 'https://example.invalid/media'}),
        SimpleNamespace(raise_for_status=lambda: None, content=b'abc'),
    ])
    monkeypatch.setitem(sys.modules, 'requests', SimpleNamespace(get=lambda *a, **k: next(responses)))
    result = stage(case)
    assert result['size'] == 3
    assert result['mime_type'] == 'image/png'
    assert result['sha256'] == 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    assert expected_target(case).read_bytes() == b'abc'


def test_path_escape_is_rejected_before_publication(case):
    case.source.write_bytes(b'abc')
    with pytest.raises(ValueError, match='Nome de mídia inválido'):
        case.repo.stage(case.event, case.batch, '../../outside')
    assert files(case) == []
