"""Real workflow, fake in-memory SharePoint; never writes business records."""
import copy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import time
import tempfile
import unittest
from unittest.mock import patch
import requests

ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path.insert(0, str(ROOT / 'worker'))
import workflow
from workflow import WorkflowEngine
from clients import SharePointClient

BRANCH = '004 - OBRA QA'


class Clock(datetime):
    instant = datetime(2026, 10, 20, 22, 0, tzinfo=timezone.utc)

    @classmethod
    def now(cls, tz=None):
        return cls.instant.astimezone(tz) if tz else cls.instant.replace(tzinfo=None)


class Store:
    def __init__(self):
        self.values = {}

    def load(self, key):
        return copy.deepcopy(self.values.get(key)), 'saved' if key in self.values else None

    def save(self, key, state, etag):
        self.values[key] = copy.deepcopy(state)
        return 'saved'


class Messenger:
    def __init__(self):
        self.sent = []

    def send_text(self, state, body):
        self.sent.append({'body': body})

    def send_options(self, state, step, options, maximum):
        self.sent.append({'step': copy.deepcopy(step), 'options': copy.deepcopy(options[:maximum])})

    send_filtered_options = send_options

    def send_actions(self, state, body, actions):
        self.sent.append({'body': body, 'actions': copy.deepcopy(actions)})

    def send_image(self, *args, **kwargs):
        pass


class Summary:
    def build(self, *args, **kwargs):
        return {'path': 'qa-only.png', 'filename': 'qa-only.png', 'width': 100, 'height': 100}


class Catalog:
    def __init__(self):
        self.diaries = []
        self.writes = []
        self.tokens = {}
        self.query_failure = False
        self.queries = []

    def get_options(self, step, context):
        source = step['source']
        if source['type'] == 'static':
            return copy.deepcopy(source['options'])
        if source.get('list') != 'DIÁRIO DE OBRAS':
            return []
        if self.query_failure:
            raise RuntimeError('SharePoint unavailable')
        self.queries.append(copy.deepcopy(source))
        rows = copy.deepcopy(self.diaries)
        for item in source.get('filters', []):
            value = context.get(item['value_from']) if 'value_from' in item else item.get('equals')
            if item['field'] == 'DATA':
                rows = [row for row in rows if str(row.get('DATA', ''))[:10] == str(value)[:10]]
            else:
                rows = [row for row in rows if row.get(item['field']) == value]
        return [{'id': row['Id'], 'title': str(row['Id']), 'value': row['Id'],
                 'source_values': row} for row in rows[:source.get('top', 5000)]]

    def ensure_item(self, token, fields, *, target_list, **kwargs):
        if token in self.tokens:
            return self.tokens[token]
        if target_list == 'DIÁRIO DE OBRAS':
            time.sleep(0.03)  # Simulate a slow external create for the concurrency contract.
        item_id = len(self.writes) + 100
        self.tokens[token] = item_id
        self.writes.append({'Id': item_id, 'list': target_list, 'fields': copy.deepcopy(fields), 'token': token})
        if target_list == 'DIÁRIO DE OBRAS':
            self.diaries.append({'Id': item_id, **copy.deepcopy(fields)})
        return item_id

    def verify_item(self, *args, **kwargs):
        return {'fields': True, 'attachments': True}

    def item_exists(self, item_id, target_list=None):
        return any(row['Id'] == item_id for row in self.diaries)


class VisitDiaryTests(unittest.TestCase):
    def setUp(self):
        config = json.loads((ROOT / 'worker/workflow_config.json').read_text(encoding='utf-8'))
        self.catalog, self.messenger = Catalog(), Messenger()
        self.engine = WorkflowEngine(config, Store(), None, self.messenger, self.catalog, summary_builder=Summary())
        self.state = self.engine._new_state({'message_id': 'start', 'sender': 'qa',
            'conversation_id': 'qa', 'phone_number_id': 'portal-admin'}, 'qa')
        self.state.update(flow='construction_visit', stage='selecting_fields', step_index=2,
            fields={'FILIAL': BRANCH, 'VALOR UNITÁRIO': '175.50'},
            answers={'filial_visita_obra': BRANCH, 'valor_visita_obra': '175.50'})
        Clock.instant = datetime(2026, 10, 20, 22, 0, tzinfo=timezone.utc)
        self.clock = patch.object(workflow, 'datetime', Clock)
        self.clock.start()
        self.addCleanup(self.clock.stop)

    def existing(self, status='PENDENTE', filial=BRANCH, day='2026-10-20'):
        self.catalog.diaries.append({'Id': 221, 'FILIAL': filial, 'DATA': day, 'STATUS': status})

    def commit(self):
        with patch.object(self.engine, '_notify_completed', return_value={'status': 'completed'}):
            return self.engine._commit_construction_visit(self.state, None, self.engine._flow_config(self.state))

    def test_existing_diary_skips_question_for_any_status(self):
        for status in ['PENDENTE', 'CONCLUÍDO', 'EM ANDAMENTO', '', None]:
            with self.subTest(status=status):
                self.catalog.diaries = []
                self.existing(status=status)
                self.state.update(step_index=2)
                result = self.engine._prompt_next_or_summary(self.state, None)
                self.assertEqual(result['status'], 'awaiting_confirmation')
                self.assertEqual(self.state['answers'].get('criar_diario_obra'), 'NÃO')
                self.assertFalse(any(x.get('step', {}).get('key') == 'criar_diario_obra' for x in self.messenger.sent))
        self.assertEqual(self.catalog.writes, [])

    def test_no_diary_keeps_yes_and_no_actions(self):
        result = self.engine._prompt_next_or_summary(self.state, None)
        self.assertEqual(result['field'], 'criar_diario_obra')
        self.assertEqual({x.get('value') for x in self.state['options']}, {'SIM', 'NÃO'})

    def test_yesterday_other_branch_and_tomorrow_do_not_hide_question(self):
        self.existing(day='2026-10-19')
        self.existing(day='2026-10-21')
        self.existing(filial='003 - OUTRA OBRA QA')
        self.assertEqual(self.engine._current_step(self.state)['key'], 'criar_diario_obra')

    def test_current_day_is_sao_paulo_not_utc(self):
        Clock.instant = datetime(2026, 10, 21, 1, 30, tzinfo=timezone.utc)
        self.existing(day='2026-10-20T03:00:00Z')
        self.assertIsNone(self.engine._current_step(self.state))

    def test_branch_edit_rechecks_without_reusing_previous_branch_result(self):
        self.existing()
        self.engine._current_step(self.state)
        self.state.update(step_index=2, fields={'FILIAL': '003 - OUTRA OBRA QA'})
        self.assertEqual(self.engine._current_step(self.state)['key'], 'criar_diario_obra')
        self.assertNotIn('criar_diario_obra', self.state['answers'])

    def test_query_failure_does_not_offer_creation(self):
        self.catalog.query_failure = True
        with self.assertRaisesRegex(RuntimeError, 'SharePoint unavailable'):
            self.engine._prompt_next_or_summary(self.state, None)
        self.assertEqual(self.catalog.writes, [])
        self.assertEqual(self.messenger.sent, [])

    def test_legacy_yes_is_rechecked_at_commit_without_touching_existing_diary(self):
        self.existing(status='CONCLUÍDO')
        before = copy.deepcopy(self.catalog.diaries)
        self.state['answers']['criar_diario_obra'] = 'SIM'
        result = self.commit()
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(self.catalog.diaries, before)
        self.assertEqual([x['list'] for x in self.catalog.writes], ['NOTASPENDENTES', 'LANCAMENTOS'])

    def test_commit_query_failure_precedes_financial_writes(self):
        self.state['answers']['criar_diario_obra'] = 'SIM'
        self.catalog.query_failure = True
        self.assertEqual(self.commit()['status'], 'submission_failed')
        self.assertEqual(self.catalog.writes, [])

    def test_two_visits_same_day_and_branch_create_only_one_diary(self):
        self.state['answers']['criar_diario_obra'] = 'SIM'
        self.assertEqual(self.commit()['status'], 'completed')
        first = copy.deepcopy(self.state)
        first.update(batch_id='visit-two', stage='committing')
        self.state = first
        self.state['answers']['criar_diario_obra'] = 'SIM'
        self.assertEqual(self.commit()['status'], 'completed')
        self.assertEqual(len(self.catalog.diaries), 1)
        self.assertEqual(len([x for x in self.catalog.writes if x['list'] == 'LANCAMENTOS']), 2)

    def test_declining_diary_still_never_creates_one(self):
        self.state['answers']['criar_diario_obra'] = 'NÃO'
        self.assertEqual(self.commit()['status'], 'completed')
        self.assertEqual(self.catalog.diaries, [])

    def test_simultaneous_visits_cannot_race_two_diary_creates(self):
        states = [copy.deepcopy(self.state) for _ in range(2)]
        for index, state in enumerate(states):
            state['batch_id'] = f'parallel-{index}'
            state['answers']['criar_diario_obra'] = 'SIM'
        def run(state):
            return self.engine._commit_construction_visit(state, None, self.engine._flow_config(state))
        with patch.object(self.engine, '_notify_completed', return_value={'status': 'completed'}):
            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(run, states))
        self.assertEqual([x['status'] for x in results], ['completed', 'completed'])
        self.assertEqual(len(self.catalog.diaries), 1)
        self.assertEqual(len([x for x in self.catalog.writes if x['list'] == 'LANCAMENTOS']), 2)

    def test_lookup_is_bounded_read_only_by_branch_and_full_calendar_day_without_status_filter(self):
        client = SharePointClient('qa.invalid', '/sites/qa', '', '', '', '', 'DIÁRIO DE OBRAS')
        self.engine.sharepoint = client
        with patch.object(client, '_internal_field', side_effect=lambda _, name: name), \
             patch.object(client, '_request', return_value={'value': [{'Id': 221}]}) as request:
            self.assertIsNone(self.engine._current_step(self.state))
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args[0], 'GET')
        params = request.call_args.kwargs['params']
        self.assertEqual(params['$top'], '1')
        self.assertEqual(params['$filter'], "FILIAL eq '004 - OBRA QA' and DATA ge datetime'2026-10-20T00:00:00Z' and DATA lt datetime'2026-10-21T00:00:00Z'")

    def test_stale_yes_from_old_poll_advances_to_summary_without_answer_or_write(self):
        self.existing()
        self.state['options'] = copy.deepcopy(self.engine._flow_config(self.state)['steps'][2]['source']['options'])
        result = self.engine._handle_step_reply({'kind': 'text', 'message_id': 'old-yes',
            'text': 'SIM', 'reply_id': 'choice:criar_diario_obra:1'}, self.state, None)
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(self.state['answers']['criar_diario_obra'], 'NÃO')
        self.assertEqual(self.catalog.writes, [])

    def test_lost_create_response_cannot_issue_another_post_before_reconciliation(self):
        client = SharePointClient('qa.invalid', '/sites/qa', '', '', '', '', 'DIÁRIO DE OBRAS')
        pending = []
        visible = False
        def remote(method, endpoint, **kwargs):
            if method == 'GET':
                return {'value': copy.deepcopy(pending) if visible else []}
            if method == 'POST':
                pending.append({'Id': 900 + len(pending), **kwargs['json']})
                raise requests.Timeout('create accepted remotely, response not yet known')
            raise AssertionError('Unexpected remote method')
        original_ensure = self.catalog.ensure_item
        original_options = self.catalog.get_options
        self.catalog.ensure_item = lambda token, fields, **kwargs: client.ensure_item(token, fields, **kwargs) \
            if kwargs['target_list'] == 'DIÁRIO DE OBRAS' else original_ensure(token, fields, **kwargs)
        self.catalog.get_options = lambda step, context: client.get_options(step, context) \
            if step['source'].get('list') == 'DIÁRIO DE OBRAS' else original_options(step, context)
        with patch.object(client, '_internal_field', side_effect=lambda _, name: name), \
             patch.object(client, '_target_payload', side_effect=lambda fields, _: fields), \
             patch.object(client, '_request', side_effect=remote):
            self.state['answers']['criar_diario_obra'] = 'SIM'
            self.assertEqual(self.commit()['status'], 'submission_failed')
            # A second conversation/worker shares durable state, not the prior conversation object.
            self.engine = WorkflowEngine(self.engine.config, self.engine.state_store, None,
                                         self.messenger, self.catalog, summary_builder=Summary())
            self.state['batch_id'] = 'after-lost-response'
            self.state['stage'] = 'committing'
            self.state['answers']['criar_diario_obra'] = 'SIM'
            self.assertEqual(self.commit()['status'], 'submission_failed')
            self.assertEqual(len(pending), 1, 'the uncertain first POST must not be repeated')
            visible = True
            self.state.update(stage='selecting_fields', step_index=2)
            self.assertIsNone(self.engine._current_step(self.state))
            self.assertEqual(self.state['answers']['criar_diario_obra'], 'NÃO')
            self.assertEqual(len(pending), 1)

    def test_known_create_receipt_blocks_duplicate_when_list_read_is_temporarily_empty(self):
        self.state['answers']['criar_diario_obra'] = 'SIM'
        self.assertEqual(self.commit()['status'], 'completed')
        original_get = self.catalog.get_options
        self.catalog.get_options = lambda step, context: [] \
            if step['source'].get('list') == 'DIÁRIO DE OBRAS' else original_get(step, context)
        self.state.update(step_index=2, batch_id='after-stale-list')
        self.assertIsNone(self.engine._current_step(self.state))
        self.assertEqual(len(self.catalog.diaries), 1)

    def test_production_lock_uses_shared_state_directory_not_service_private_tmp(self):
        import construction_visit_diary
        with tempfile.TemporaryDirectory() as shared:
            self.engine.state_store.directory = Path(shared)
            self.state['answers']['criar_diario_obra'] = 'SIM'
            with patch.object(construction_visit_diary.tempfile, 'gettempdir',
                              side_effect=AssertionError('service PrivateTmp is not shared')):
                self.assertEqual(self.commit()['status'], 'completed')
            self.assertEqual(len(list((Path(shared) / '.visit-diary-locks').glob('*.lock'))), 1)


if __name__ == '__main__':
    unittest.main()
