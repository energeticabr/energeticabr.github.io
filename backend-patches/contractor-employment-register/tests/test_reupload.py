"""Real workflow, local media/store and REST client; only HTTP is synthetic."""
import copy
import json
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit
from unittest.mock import patch

import pytest

from rest_fixture import ROOT, Transport, client, field
from local_app import LocalMediaRepository, LocalStateStore
from workflow import WorkflowEngine
from test_workflow import Messenger, Summary


class RegistrationTransport:
    """Normal source registration routes; any source attachment download fails."""
    def __init__(self):
        self.target = Transport()
        self.source_rows = {}
        self.source_files = {}
        self.source_posts = 0
        self.source_file_posts = 0
        self.source_downloads = 0
        self.before_source_files = None

    def request(self, method, url, **kw):
        path = unquote(urlsplit(url).path.split('/_api/')[-1])
        if 'FUNCIONARIOSRH' in path:
            return self.target.request(method, url, **kw)
        if path == 'v2.0/drive':
            assert method == 'GET'
            return Transport.response({'quota': {'state': 'normal', 'remaining': 100000, 'used': 0}})
        match = re.fullmatch(r"web/lists/getbytitle\('FORNECEDORES'\)(.*)", path, re.I)
        assert match, (method, path)
        tail = match[1]
        if tail == '/fields':
            assert method == 'GET'
            names = ['__PowerAppsId__', 'TIPO', 'EMPREITEIRO', 'STATUS', 'VINCULO', 'CARGO']
            return Transport.response({'value': [field('Title', title='CADASTRO'), *[field(n) for n in names]]})
        if tail == '/items':
            if method == 'POST':
                self.source_posts += 1
                assert self.source_posts == 1, 'Do not repeat the original source POST'
                assert 'DATAADMISSAO' not in kw['json'] and 'DATADESLIGAMENTO' not in kw['json']
                self.source_rows[7] = {'Id': 7, **copy.deepcopy(kw['json'])}
                return Transport.response({'Id': 7}, 201)
            token = kw['params']['$filter'].split("'")[1]
            return Transport.response({'value': [r for r in self.source_rows.values() if r['__PowerAppsId__'] == token]})
        if tail == '/items(7)':
            assert method == 'GET'
            return Transport.response(self.source_rows[7])
        if tail == '/items(7)/AttachmentFiles':
            assert method == 'GET'
            if self.before_source_files:
                self.before_source_files()
            return Transport.response({'value': [{'FileName': n} for n in self.source_files]})
        match = re.fullmatch(r"/items\(7\)/AttachmentFiles/add\(FileName='(.*)'\)", tail)
        if match:
            assert method == 'POST'
            name = match[1].replace("''", "'")
            assert name not in self.source_files, 'Reattachment must reuse the frozen source attachment name'
            self.source_file_posts += 1
            self.source_files[name] = kw['data']
            return Transport.response(status=201)
        self.source_downloads += 1
        raise AssertionError('No source attachment download or recovery fallback is allowed')


class Recovery:
    def __init__(self, directory):
        self.directory = directory
        self.remote = RegistrationTransport()
        self.config = json.loads((ROOT / 'worker/workflow_config.json').read_text(encoding='utf-8'))
        self.sequence = 0
        self.restart(load=False)
        self.state = self.engine._new_state({'message_id': 'new', 'sender': 'qa',
            'conversation_id': 'qa', 'phone_number_id': 'portal-admin'}, 'reattach-session')
        self.state.update(flow='supply_supplier_registration', supplier_employment_version=2,
            fields={'CADASTRO': 'SYNTHETIC', 'TIPO': 'MÃO DE OBRA', 'EMPREITEIRO': 'SIM',
                'STATUS': 'ATIVO', 'VINCULO': 'CLT', 'CARGO': 'PEDREIRO I',
                'DATAADMISSAO': '2026-10-01T00:00:00Z'})
        self.engine._start_supplier_hr_cutover(self.state, None)

    def restart(self, load=True):
        self.store = LocalStateStore(self.directory / 'state')
        self.media = LocalMediaRepository(self.directory / 'media', None, 'synthetic')
        self.engine = WorkflowEngine(self.config, self.store, self.media, Messenger(),
            client(self.remote), summary_builder=Summary())
        if load:
            self.state, _ = self.store.load('reattach-session')

    def attach(self, original_name, content):
        self.sequence += 1
        upload = self.directory / f'incoming-{self.sequence}.bin'
        upload.write_bytes(content)
        event = {'message_id': f'upload-{self.sequence}', 'type': 'document',
            'timestamp': 1792490400 + self.sequence, 'original_filename': original_name,
            'local_path': str(upload), 'mime_type': 'application/pdf'}
        self.engine._append_attachment(event, self.state)
        return self.state['attachments'][-1]

    def commit(self):
        _, etag = self.store.load(self.state['key'])
        self.state.update(stage='committing', step_index=len(self.config['sharepoint']['supply_supplier_registration_flow']['steps']))
        with patch.object(self.engine, '_notify_completed', return_value={'status': 'completed'}):
            return self.engine._commit(self.state, etag)

    def partial_then_lose(self, originals, lost):
        for name, content in originals:
            self.attach(name, content)
        frozen_names = [a['sharepoint_name'] for a in self.state['attachments']]
        self.remote.target.fail_attachment_after = max(0, len(originals) - 1)
        assert self.commit()['status'] == 'submission_failed'
        assert self.remote.source_posts == self.remote.target.posts == 1
        self.frozen = copy.deepcopy(self.state['supplier_hr_submission'])
        for index in lost:
            self.media.delete(self.state['attachments'][index])
        self.restart()
        assert self.commit()['status'] == 'waiting_for_attachment_reupload'
        self.remote.target.fail_attachment_after = None
        self.restart()  # The reupload request and missing-slot identities are durable.
        return frozen_names


@pytest.mark.parametrize(('originals', 'lost', 'arrival'), [
    ([('one.pdf', b'ONE')], [0], [0]),
    ([('one.pdf', b'ONE'), ('two.pdf', b'TWO')], [0], [0]),
    ([('one.pdf', b'ONE'), ('two.pdf', b'TWO')], [0, 1], [1, 0]),
    ([('same.pdf', b'SAME'), ('same.pdf', b'SAME')], [0, 1], [1, 0]),
])
def test_explicit_reattach_reuses_frozen_names_order_and_single_source_target_posts(tmp_path, originals, lost, arrival):
    run = Recovery(tmp_path)
    frozen_names = run.partial_then_lose(originals, lost)
    for index in arrival:
        replacement = run.attach(*originals[index])
        assert replacement['sharepoint_name'] not in frozen_names
    def persisted_before_source_upload():
        stored, _ = run.store.load(run.state['key'])
        assert [a['sharepoint_name'] for a in stored['attachments']] == frozen_names
        assert stored['supplier_hr_submission'] == run.frozen
        assert [run.media.read(a) for a in stored['attachments']] == [b for _, b in originals]
    run.remote.before_source_files = persisted_before_source_upload
    assert run.commit()['status'] == 'completed'
    assert [a['sharepoint_name'] for a in run.state['attachments']] == frozen_names
    assert run.remote.source_files == run.remote.target.files[101]
    assert list(run.remote.source_files) == frozen_names
    assert list(run.remote.target.files[101]) == frozen_names
    assert run.remote.source_file_posts == len(originals)
    assert run.remote.target.attachment_posts == len(originals)
    assert run.remote.source_posts == run.remote.target.posts == 1
    assert run.remote.source_downloads == 0
    assert run.state['supplier_hr_submission'] == run.frozen
    for entry, (original_name, _) in zip(run.frozen['files'], originals):
        assert entry['original_name'] == original_name
    run.restart()
    assert run.commit()['status'] == 'completed'
    assert run.remote.source_posts == run.remote.target.posts == 1


@pytest.mark.parametrize(('originals', 'replacement'), [
    ([('one.pdf', b'ONE')], [('one.pdf', b'BAD')]),
    ([('one.pdf', b'ONE')], [('different.pdf', b'ONE')]),
    ([('one.pdf', b'ONE'), ('two.pdf', b'TWO')], [('one.pdf', b'ONE')]),
    ([('same.pdf', b'SAME'), ('same.pdf', b'SAME')], [('same.pdf', b'SAME')]),
    ([('one.pdf', b'ONE')], [('one.pdf', b'ONE'), ('extra.pdf', b'EXTRA')]),
])
def test_reattach_rejects_changed_name_bytes_or_wrong_multiplicity_before_more_writes(tmp_path, originals, replacement):
    run = Recovery(tmp_path)
    run.partial_then_lose(originals, list(range(len(originals))))
    source_files = copy.deepcopy(run.remote.source_files)
    target_files = copy.deepcopy(run.remote.target.files[101])
    for name, content in replacement:
        run.attach(name, content)
    assert run.commit()['status'] == 'submission_failed'
    assert run.remote.source_files == source_files
    assert run.remote.target.files[101] == target_files
    assert run.remote.source_posts == run.remote.target.posts == 1
    assert run.remote.source_downloads == 0
