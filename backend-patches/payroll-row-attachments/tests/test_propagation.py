"""Real settlement code; only SharePoint/media/state boundaries are synthetic."""
import copy
import os
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path.insert(0, str(ROOT / 'worker'))
from workflow import WorkflowEngine
from provision_description_settlement import _same

CHILD = 'PROVISÃO PGTOS'
PARENT = 'DESCRITIVOPROVISAO'


class Response:
    def __init__(self, content): self.content = content
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def iter_content(self, size): yield self.content


class Connector:
    site_url = 'https://synthetic.invalid/site'
    def __init__(self):
        self.items, self.files, self.tokens, self.writes = {}, {}, {}, []
        self.uploads = []
        self.fail_child = self.lose_child = None
        self.fail_upload = self.lose_upload = self.corrupt_upload = False
        self.bad_launch = False
        self.on_read = None
        for child in (11, 12):
            self.items[CHILD, child] = {
                'Id': child, 'DESCRITIVOPROVISAO': '7', 'STATUS': 'PAGAMENTO PREVISTO',
                'FORNECEDOR': 'Supplier', 'FILIAL': 'Branch', 'PRODUTO': str(child),
                'QTD': '2', 'VALOR TOTAL': '10', 'FRETE': '0',
                'DATA PREVISTO PGTO': '2026-10-19', 'IDPEDIDO': None, 'IDLANCAMENTOS': None,
                'DATA PGTO EFETUADO': None, 'PGTOAGENDADO': None, 'FORMAPGTO': None, 'OBS': None}
            self.files[CHILD, child] = {'proof.pdf': str(child).encode()}
        self.items[PARENT, 7] = {'Id': 7, 'FORNECEDOR': 'Supplier', 'FILIAL': 'Branch',
            'VALORTOTAL': '40', 'DATA PREVISTO PGTO': '2026-10-19'}
        self.files[PARENT, 7] = {'sibling-aggregate.pdf': b'parent only'}

    def get_item_fields_with_etag(self, item, fields, target_list=None):
        row = self.items[target_list, int(item)]
        return {k: row.get(k) for k in fields}, 'etag'

    def get_provision_description_for_settlement(self, item):
        return {**copy.deepcopy(self.items[PARENT, int(item)]),
                'CHILDREN': [copy.deepcopy(self.items[CHILD, i]) for i in (11, 12)]}

    def ensure_item(self, token, fields, target_list=None, **kwargs):
        key = target_list, token
        if key not in self.tokens:
            item = 500 + len(self.tokens)
            self.tokens[key] = item
            self.items[target_list, item] = copy.deepcopy(fields)
            self.writes.append(('create', target_list, item))
            if target_list == 'LANCAMENTOS' and self.bad_launch:
                self.items[target_list, item]['IDPGTOAGENDADO'] = '999'
        return self.tokens[key]

    def verify_item(self, item, fields, names, target_list=None):
        row = self.items[target_list, int(item)]
        return {'fields': all(_same(k, row.get(k), v) for k, v in fields.items()),
                'attachments': set(names) <= self.files.get((target_list, int(item)), {}).keys()}

    def update_item_with_etag(self, item, fields, etag, target_list=None):
        assert etag == 'etag'
        if target_list == CHILD and item == self.fail_child:
            self.fail_child = None
            raise RuntimeError('child unavailable')
        self.items[target_list, int(item)].update(copy.deepcopy(fields))
        self.writes.append(('update', target_list, item))
        if target_list == CHILD and item == self.lose_child:
            self.lose_child = None
            raise RuntimeError('lost child response')

    def update_item(self, item, fields, target_list=None):
        self.update_item_with_etag(item, fields, 'etag', target_list)

    def _list_endpoint(self, kind): return kind

    def _request(self, method, endpoint, **kwargs):
        from urllib.parse import unquote
        assert method == 'GET'
        endpoint = endpoint.removeprefix(self.site_url + '/_api/')
        match = re.fullmatch(r"(.+)/items\((\d+)\)/AttachmentFiles(?:/getByFileName\('(.+)'\)/\$value)?", endpoint)
        assert match, endpoint
        kind, item, name = match.groups()
        files = self.files.setdefault((kind, int(item)), {})
        if name:
            if self.on_read: self.on_read()
            return Response(files[unquote(name).replace("''", "'")])
        return {'value': [{'FileName': name} for name in files]}

    def _ensure_attachment_local(self, item, name, data, mime_type=None, target_list=None):
        if self.fail_upload:
            self.fail_upload = False
            raise RuntimeError('upload unavailable')
        files = self.files.setdefault((target_list, int(item)), {})
        if name not in files:
            files[name] = b'corrupt' if self.corrupt_upload else data
            self.uploads.append((target_list, int(item), name))
        if self.lose_upload:
            self.lose_upload = False
            raise RuntimeError('lost upload response')

    ensure_attachment = _ensure_attachment_local


class Fixture:
    def __init__(self, grouped=True, launch=True):
        self.client = Connector()
        self.engine = WorkflowEngine.__new__(WorkflowEngine)
        self.engine.sharepoint = self.client
        self.engine._context = lambda s: {**s['fields'], **s['answers']}
        self.engine._save = lambda s, e: 'state-etag'
        self.engine._notify_completed = lambda s, e: {'status': 'completed'}
        self.engine._submission_failed = lambda s, e, exc: {'status': 'failed', 'error': str(exc)}
        self.engine.media_repository = type('Media', (), {'read': lambda self, a: a['bytes']})()
        common = {'DATA PGTO EFETUADO': '2026-10-19', 'FORMAPGTO': 'Account', 'OBS': ''}
        rows = [copy.deepcopy(self.client.items[CHILD, i]) for i in (11, 12)]
        entries = [{'fields': {**row, **common, 'ID PROVISÃO': str(row['Id']), 'ETAPA': 'Stage'},
                    'answers': {'submeter_lancamentos': 'SIM' if launch else 'NÃO'},
                    'display_values': {}, 'relink_authorized': False} for row in rows]
        self.state = {'batch_id': 'synthetic', 'fields': entries[0]['fields'],
                      'answers': entries[0]['answers'], 'attachments': []}
        if grouped:
            self.state['provision_description'] = {'parent_id': '7',
                'parent': copy.deepcopy(self.client.items[PARENT, 7]), 'original_children': rows,
                'children': copy.deepcopy(rows), 'entries': entries, 'common': common, 'prepared': True,
                'launch_settings': {'submeter_lancamentos': 'SIM' if launch else 'NÃO',
                                    'ETAPA': 'Stage', 'relink_authorized': False}}
        self.flow = {'target_list': CHILD}

    def commit(self): return self.engine._commit_payment_settlement(self.state, None, self.flow)
    def files_for(self, kind, item): return self.client.files.get((kind, int(item)), {})
    def launch(self, child): return self.client.items[CHILD, child]['IDLANCAMENTOS']
    def order(self, child=11): return self.client.items[CHILD, child]['IDPEDIDO']


class PropagationTests(unittest.TestCase):
    def test_each_child_only_its_launch_and_shared_order_union(self):
        f = Fixture()
        self.assertEqual(f.commit()['status'], 'completed')
        self.assertEqual(set(f.files_for('LANCAMENTOS', f.launch(11)).values()), {b'11'})
        self.assertEqual(set(f.files_for('LANCAMENTOS', f.launch(12)).values()), {b'12'})
        self.assertEqual(set(f.files_for('NOTASPENDENTES', f.order()).values()), {b'11', b'12'})
        self.assertEqual(f.files_for(CHILD, 11), {'proof.pdf': b'11'})
        self.assertEqual(f.files_for(CHILD, 12), {'proof.pdf': b'12'})
        self.assertEqual(len([k for k in f.client.items if k[0] == 'NOTASPENDENTES']), 1)

    def test_single_settlement_propagates_persisted_and_session_files(self):
        f = Fixture(grouped=False)
        f.state['attachments'] = [{'sharepoint_name': 'now.pdf', 'bytes': b'now'}]
        self.assertEqual(f.commit()['status'], 'completed')
        self.assertEqual(set(f.files_for('LANCAMENTOS', f.launch(11)).values()), {b'11', b'now'})

    def test_completed_journal_child_reconciles_deleted_copies(self):
        f = Fixture(); f.client.fail_child = 12
        self.assertEqual(f.commit()['status'], 'failed')
        f.files_for('LANCAMENTOS', f.launch(11)).clear()
        f.files_for('NOTASPENDENTES', f.order()).clear()
        creates = len(f.client.tokens)
        self.assertEqual(f.commit()['status'], 'completed')
        self.assertEqual(set(f.files_for('LANCAMENTOS', f.launch(11)).values()), {b'11'})
        self.assertEqual(set(f.files_for('NOTASPENDENTES', f.order()).values()), {b'11', b'12'})
        self.assertEqual(len(f.client.tokens), creates)

    def test_upload_failure_does_not_mark_child_paid(self):
        f = Fixture(); f.client.fail_upload = True
        self.assertEqual(f.commit()['status'], 'failed')
        self.assertIsNone(f.client.items[CHILD, 11]['PGTOAGENDADO'])
        self.assertEqual(f.commit()['status'], 'completed')

    def test_lost_upload_response_recovers_by_bytes_without_duplicate(self):
        f = Fixture(); f.client.lose_upload = True
        self.assertEqual(f.commit()['status'], 'completed')
        self.assertEqual(len(f.client.uploads), 4)

    def test_identical_bytes_reuse_existing_name_and_preserve_homonym(self):
        f = Fixture(); f.client.files['NOTASPENDENTES', 500] = {'proof.pdf': b'foreign', 'old.pdf': b'11'}
        self.assertEqual(f.commit()['status'], 'completed')
        files = f.files_for('NOTASPENDENTES', f.order())
        self.assertEqual(files['proof.pdf'], b'foreign')
        self.assertEqual(list(files.values()).count(b'11'), 1)
        self.assertIn(b'12', files.values())

    def test_corrupt_copy_cannot_complete(self):
        f = Fixture(); f.client.corrupt_upload = True
        self.assertEqual(f.commit()['status'], 'failed')
        self.assertIsNone(f.client.items[CHILD, 11]['PGTOAGENDADO'])

    def test_foreign_created_launch_blocks_all_copies_and_completion(self):
        f = Fixture(); f.client.bad_launch = True
        self.assertEqual(f.commit()['status'], 'failed')
        self.assertEqual(f.client.uploads, [])
        self.assertIsNone(f.client.items[CHILD, 11]['PGTOAGENDADO'])

    def test_changed_completed_launch_backlink_fails_closed(self):
        f = Fixture(); f.client.fail_child = 12
        self.assertEqual(f.commit()['status'], 'failed')
        f.client.items['LANCAMENTOS', int(f.launch(11))]['IDPGTOAGENDADO'] = '12'
        self.assertEqual(f.commit()['status'], 'failed')

    def test_source_link_changes_during_preflight_block_copies(self):
        f = Fixture()
        f.client.on_read = lambda: f.client.items[CHILD, 11].update({'DESCRITIVOPROVISAO': '999'})
        self.assertEqual(f.commit()['status'], 'failed')
        self.assertEqual(f.client.uploads, [])

    def test_no_launch_choice_invents_no_financial_targets(self):
        f = Fixture(launch=False)
        self.assertEqual(f.commit()['status'], 'completed')
        self.assertEqual(f.client.tokens, {})
        self.assertEqual(f.client.uploads, [])

    def test_lost_child_response_keeps_one_order_and_two_launches(self):
        f = Fixture(); f.client.lose_child = 11
        self.assertEqual(f.commit()['status'], 'failed')
        self.assertEqual(f.commit()['status'], 'completed')
        self.assertEqual(len(f.client.tokens), 3)
        self.assertEqual(set(f.files_for('NOTASPENDENTES', f.order()).values()), {b'11', b'12'})

    def test_single_lost_paid_response_recovers_without_new_records(self):
        f = Fixture(grouped=False); f.client.lose_child = 11
        self.assertEqual(f.commit()['status'], 'failed')
        f.files_for('LANCAMENTOS', f.launch(11)).clear()
        self.assertEqual(f.commit()['status'], 'completed')
        self.assertEqual(len(f.client.tokens), 2)
        self.assertEqual(set(f.files_for('LANCAMENTOS', f.launch(11)).values()), {b'11'})

    def test_forged_completed_child_order_link_blocks_reconciliation(self):
        f = Fixture(); f.client.fail_child = 12
        self.assertEqual(f.commit()['status'], 'failed')
        f.client.items[CHILD, 11]['IDPEDIDO'] = '999'
        self.assertEqual(f.commit()['status'], 'failed')

    def test_new_attachment_on_completed_journal_child_is_reconciled(self):
        f = Fixture(); f.client.fail_child = 12
        self.assertEqual(f.commit()['status'], 'failed')
        f.files_for(CHILD, 11)['later.pdf'] = b'later'
        self.assertEqual(f.commit()['status'], 'completed')
        self.assertEqual(set(f.files_for('LANCAMENTOS', f.launch(11)).values()), {b'11', b'later'})
        self.assertNotIn(b'later', f.files_for('LANCAMENTOS', f.launch(12)).values())

    def test_deterministic_name_collision_never_overwrites(self):
        f = Fixture()
        from provision_attachment_sync import copy_name, sha
        collision = copy_name(11, sha(b'11'), 'proof.pdf')
        f.client.files['NOTASPENDENTES', 500] = {collision: b'foreign'}
        self.assertEqual(f.commit()['status'], 'failed')
        self.assertEqual(f.files_for('NOTASPENDENTES', 500)[collision], b'foreign')
        self.assertEqual(f.client.uploads, [])

    def test_malformed_source_filename_preflights_before_any_copy(self):
        f = Fixture()
        f.files_for(CHILD, 11)['bad/name.pdf'] = b'invalid'
        self.assertEqual(f.commit()['status'], 'failed')
        self.assertEqual(f.client.uploads, [])

    def test_session_bytes_already_on_both_targets_reuse_any_filename(self):
        f = Fixture(grouped=False)
        f.state['attachments'] = [{'sharepoint_name': 'session.pdf', 'bytes': b'session'}]
        f.client.files['NOTASPENDENTES', 500] = {'legacy-order.bin': b'11', 'old-session.png': b'session'}
        f.client.files['LANCAMENTOS', 501] = {'other-launch.jpg': b'11', 'renamed-session.dat': b'session'}
        self.assertEqual(f.commit()['status'], 'completed')
        original_records = copy.deepcopy(f.client.tokens)
        original_files = copy.deepcopy(f.client.files)
        self.assertEqual(f.commit()['status'], 'completed')
        self.assertEqual(f.client.tokens, original_records)
        self.assertEqual(len(f.client.tokens), 2)
        self.assertEqual(f.client.files, original_files)
        # Only the session original is written to its own provision. Neither
        # financial target receives a duplicate of content it already holds.
        self.assertEqual(f.client.uploads, [(CHILD, 11, 'session.pdf')])

    def test_group_existing_destination_content_and_second_commit_add_no_records_or_files(self):
        f = Fixture()
        f.client.files['NOTASPENDENTES', 500] = {'old-first.jpg': b'11', 'old-second.bin': b'12'}
        f.client.files['LANCAMENTOS', 501] = {'first-original.png': b'11'}
        f.client.files['LANCAMENTOS', 502] = {'second-original.dat': b'12'}
        self.assertEqual(f.commit()['status'], 'completed')
        original_records = copy.deepcopy(f.client.tokens)
        original_files = copy.deepcopy(f.client.files)
        self.assertEqual(f.commit()['status'], 'completed')
        self.assertEqual(f.client.tokens, original_records)
        self.assertEqual(len(f.client.tokens), 3)  # one order and two own launches
        self.assertEqual(f.client.files, original_files)
        self.assertEqual(f.client.uploads, [])


if __name__ == '__main__': unittest.main()
