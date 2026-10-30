"""Real settlement conversation with synthetic parent edits; no tenant calls."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('parent_edit_fixture',
    ROOT / 'backend-patches/provision-settlement-batch-review/tests/test_batch_review.py')
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


class ParentEditTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.BatchReviewTests('runTest')
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.h = self.case.h
        self.case.open()

    def state(self):
        return self.case.state()

    def table(self):
        return self.case.table()

    def save(self, state):
        _, etag = self.h.state.load(state['key'])
        self.h.state.save(state['key'], state, etag)

    def begin(self, ids='11,13'):
        result = self.h.reply(reply_id='description_review_parent_begin:7:' + ids)
        self.assertEqual(result.get('status'), 'awaiting_description_parent_editor', result)
        table = self.table()
        self.assertTrue(table['parentEditPending'])
        token = table['parentEditorToken']
        self.assertRegex(token, r'^[a-f0-9]{32}$')
        self.assertFalse(table['canSubmit'])
        return token

    def refresh(self, token):
        return self.h.reply(reply_id='description_review_parent_refresh:7:' + token)

    def change_branch(self, value='005 - FILIAL FICTÍCIA'):
        self.h.sharepoint.items[7]['fields']['FILIAL'] = value
        for ident in self.case.child_ids:
            self.h.sharepoint.items[ident]['fields']['FILIAL'] = value

    def test_exact_button_titles_and_parent_button_follows_line_edit(self):
        options = self.state()['options']
        self.assertEqual([row['id'] for row in options],
            ['description_review_submit', 'description_review_edit', 'description_review_edit_parent'])
        self.assertEqual(options[1]['title'], '✏️ EDITAR ALGUMA LINHA PROVISÃO')
        self.assertEqual(options[2]['title'], '✏️ EDITAR O DESCRITIVO PROVISÃO')

    def test_begin_preserves_selection_and_attachments_without_financial_writes(self):
        state = self.state()
        state['attachments'] = [{'id': 'qa', 'name': 'comprovante.pdf'}]
        self.save(state)
        self.begin()
        self.assertEqual(self.table()['selectedIds'], ['11', '13'])
        self.assertEqual(self.state()['attachments'], state['attachments'])
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_pending_parent_editor_blocks_legacy_and_selected_submit_and_line_edit(self):
        token = self.begin()
        for command in ['description_review_submit', 'description_review_submit:11',
                        'description_review_edit', 'description_review_edit:11']:
            with self.subTest(command=command):
                result = self.h.reply(reply_id=command)
                self.assertEqual(result.get('status'), 'description_parent_edit_pending')
                self.assertEqual(self.state()['provision_description']['review_phase'], 'overview')
                self.assertEqual(self.table()['parentEditorToken'], token)
                self.assertFalse(self.table()['canSubmit'])
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_cancel_refresh_with_empty_selection_clears_barrier_without_writes(self):
        token = self.begin('')
        result = self.refresh(token)
        self.assertEqual(result.get('status'), 'description_parent_refreshed')
        self.assertFalse(self.table()['parentEditPending'])
        self.assertEqual(self.table()['selectedIds'], [])
        self.assertFalse(self.table()['canSubmit'])
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_filial_fanout_is_reflected_in_all_settlement_snapshots(self):
        token = self.begin()
        self.change_branch()
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refreshed')
        state = self.state()
        group = state['provision_description']
        for row in [group['parent'], *group['original_children'], *group['children'],
                    *[entry['fields'] for entry in group['entries']], state['fields']]:
            self.assertEqual(row['FILIAL'], '005 - FILIAL FICTÍCIA')
        self.assertEqual(self.table()['selectedIds'], ['11', '13'])
        self.assertEqual(state['navigation_history'], [])
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_unrelated_line_drafts_survive_while_persisted_changed_fields_win(self):
        state = self.state()
        state['provision_description']['entries'][0]['fields']['QTD'] = '9'
        state['provision_description']['entries'][1]['fields']['VALOR TOTAL'] = '8'
        self.save(state)
        token = self.begin()
        self.change_branch()
        self.h.sharepoint.items[12]['fields']['VALOR TOTAL'] = '30'
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refreshed')
        group = self.state()['provision_description']
        entries = {entry['fields']['ID PROVISÃO']: entry['fields'] for entry in group['entries']}
        self.assertEqual(entries['11']['QTD'], '9')
        self.assertEqual(entries['12']['VALOR TOTAL'], '30')
        self.assertEqual(group['original_children'][0]['QTD'], '2')

    def test_incomplete_filial_fanout_is_rejected_without_clearing_barrier(self):
        token = self.begin()
        self.h.sharepoint.items[7]['fields']['FILIAL'] = '005 - FILIAL FICTÍCIA'
        self.h.sharepoint.items[11]['fields']['FILIAL'] = '005 - FILIAL FICTÍCIA'
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refresh_failed')
        self.assertTrue(self.table()['parentEditPending'])
        self.assertEqual(self.table()['parentEditorToken'], token)
        self.change_branch()
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refreshed')
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_read_failure_keeps_barrier_and_retry_does_not_resave_parent(self):
        token = self.begin()
        original = self.h.sharepoint.get_provision_description_for_settlement
        self.h.sharepoint.get_provision_description_for_settlement = lambda ident: (_ for _ in ()).throw(RuntimeError('QA indisponível'))
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refresh_failed')
        self.assertTrue(self.table()['parentEditPending'])
        self.h.sharepoint.get_provision_description_for_settlement = original
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refreshed')
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_wrong_parent_or_token_never_clears_the_active_edit(self):
        token = self.begin()
        for command in ['description_review_parent_refresh:8:' + token,
                        'description_review_parent_refresh:7:' + 'a' * 32,
                        'description_review_parent_begin:8:11']:
            result = self.h.reply(reply_id=command)
            self.assertEqual(result.get('status'), 'invalid_description_parent_edit', result)
            self.assertEqual(self.table()['parentEditorToken'], token)

    def test_repeat_begin_and_refresh_are_idempotent_but_old_token_cannot_clear_new_edit(self):
        first = self.begin()
        self.assertEqual(self.begin(), first)
        self.assertEqual(self.refresh(first).get('status'), 'description_parent_refreshed')
        self.assertEqual(self.refresh(first).get('status'), 'description_parent_refreshed')
        second = self.begin()
        self.assertNotEqual(second, first)
        self.assertEqual(self.refresh(first).get('status'), 'invalid_description_parent_edit')
        self.assertEqual(self.table()['parentEditorToken'], second)
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_new_child_is_shown_but_not_automatically_selected(self):
        token = self.begin('11')
        child = copy.deepcopy(self.h.sharepoint.items[12])
        child['fields']['Id'] = 15
        self.h.sharepoint.items[15] = child
        self.case.child_ids.append(15)
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refreshed')
        self.assertTrue(any(row['id'] == '15' for row in self.table()['rows']))
        self.assertEqual(self.table()['selectedIds'], ['11'])

    def test_paid_or_removed_selected_children_are_not_reselected(self):
        token = self.begin('11,13')
        self.case.child_ids.remove(13)
        self.h.sharepoint.items[11]['fields'].update(STATUS='PAGAMENTO EFETUADO',
            PGTOAGENDADO='PAGO', **{'DATA PGTO EFETUADO': '2026-10-30'})
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refreshed')
        self.assertEqual(self.table()['selectedIds'], [])
        self.assertTrue(next(row for row in self.table()['rows'] if row['id'] == '11')['paid'])

    def test_no_pending_children_return_to_selection_and_lost_reply_can_retry(self):
        token = self.begin()
        for ident in self.case.child_ids:
            self.h.sharepoint.items[ident]['fields'].update(STATUS='PAGAMENTO EFETUADO',
                PGTOAGENDADO='PAGO', **{'DATA PGTO EFETUADO': '2026-10-30'})
        result = self.refresh(token)
        self.assertEqual(result.get('status'), 'description_parent_refreshed')
        self.assertTrue(result['descriptionNoPending'])
        self.assertNotIn('provision_description', self.state())
        repeated = self.refresh(token)
        self.assertEqual(repeated.get('status'), 'description_parent_refreshed')
        self.assertTrue(repeated['descriptionNoPending'])
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_begin_rejects_foreign_paid_duplicate_and_malformed_ids(self):
        for ids in ['14', '99', '11,11', '01', '-1', '11,']:
            with self.subTest(ids=ids):
                result = self.h.reply(reply_id='description_review_parent_begin:7:' + ids)
                self.assertEqual(result.get('status'), 'invalid_description_parent_edit')
                self.assertNotIn('parent_editor', self.state()['provision_description'])
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_legacy_parent_button_is_safe_without_capable_app(self):
        result = self.h.reply(reply_id='description_review_edit_parent')
        self.assertEqual(result.get('field'), 'description_review')
        self.assertNotIn('parent_editor', self.state()['provision_description'])
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_frozen_settlement_cannot_open_parent_editor(self):
        state = self.state()
        state['provision_description']['journal'] = {'intent': {'OBS': 'QA já confirmado'}}
        self.save(state)
        result = self.h.reply(reply_id='description_review_parent_begin:7:11')
        self.assertEqual(result.get('status'), 'invalid_description_parent_edit')
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_forged_commit_while_editor_is_pending_cannot_write(self):
        token = self.begin()
        state = self.state()
        state['stage'] = 'awaiting_confirmation'
        self.save(state)
        result = self.h.reply('SIM')
        self.assertNotEqual(result.get('status'), 'completed')
        self.assertEqual(self.state()['provision_description']['parent_editor']['token'], token)
        self.assertEqual(self.h.sharepoint.update_calls, [])
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refreshed')

    def test_old_refresh_cannot_interrupt_a_new_line_edit(self):
        token = self.begin()
        self.refresh(token)
        self.h.reply(reply_id='description_review_edit:11')
        before = copy.deepcopy(self.state())
        self.assertEqual(self.refresh(token).get('status'), 'invalid_description_parent_edit')
        after = self.state()
        self.assertEqual(after['stage'], before['stage'])
        self.assertEqual(after['provision_description'].get('editing_phase'),
            before['provision_description'].get('editing_phase'))

    def test_changed_product_does_not_reuse_a_draft_expense_type(self):
        state = self.state()
        state['provision_description']['entries'][0]['fields']['TIPO DESPESA'] = 'TIPO ANTIGO QA'
        self.save(state)
        token = self.begin()
        self.h.sharepoint.items[11]['fields']['PRODUTO'] = 'NOVO PRODUTO QA'
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refreshed')
        entry = self.state()['provision_description']['entries'][0]['fields']
        self.assertEqual(entry['PRODUTO'], 'NOVO PRODUTO QA')
        self.assertNotEqual(entry.get('TIPO DESPESA'), 'TIPO ANTIGO QA')

    def test_old_begin_cannot_interrupt_line_edit_or_submitted_payment_questions(self):
        self.h.reply(reply_id='description_review_edit:11')
        before = copy.deepcopy(self.state())
        result = self.h.reply(reply_id='description_review_parent_begin:7:11')
        self.assertEqual(result.get('status'), 'invalid_description_parent_edit')
        self.assertEqual(self.state()['stage'], before['stage'])
        self.h.reply(reply_id='description_edit_back')
        self.h.reply(reply_id='description_review_submit:11')
        before = copy.deepcopy(self.state())
        result = self.h.reply(reply_id='description_review_parent_begin:7:11')
        self.assertEqual(result.get('status'), 'invalid_description_parent_edit')
        self.assertEqual(self.state()['step_index'], before['step_index'])

    def test_reloaded_engine_retains_the_barrier_until_valid_refresh(self):
        token = self.begin()
        # Recreate the engine object over the same durable state/fake transports.
        self.save(json.loads(json.dumps(self.state())))
        prior = self.h.engine
        resumed = copy.copy(prior)
        self.h.engine = resumed
        result = self.h.reply(reply_id='description_review_submit:11')
        self.assertEqual(result.get('status'), 'description_parent_edit_pending')
        self.assertEqual(self.table()['parentEditorToken'], token)
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refreshed')
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_stale_parent_command_after_session_expiry_is_safe(self):
        token = self.begin()
        self.h.state.values.clear()
        result = self.h.reply(reply_id='description_review_parent_refresh:7:' + token)
        self.assertIsInstance(result, dict)
        self.assertNotEqual(result.get('status'), 'completed')
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_parent_total_edit_waits_for_confirmed_child_amount(self):
        token = self.begin('11')
        self.case.child_ids = [11]
        self.h.sharepoint.items[7]['fields']['VALORTOTAL'] = '100'
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refresh_failed')
        self.assertTrue(self.table()['parentEditPending'])
        # 2 * 48.5 + 3 freight = 100, as computed by the existing parent editor.
        self.h.sharepoint.items[11]['fields']['VALOR TOTAL'] = '48.5'
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refreshed')
        self.assertEqual(self.table()['totalDisplay'], 'R$ 100,00')
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_changed_product_invalidates_an_old_persisted_expense_type(self):
        token = self.begin('11')
        self.h.sharepoint.items[11]['fields'].update(PRODUTO='NOVO PRODUTO QA',
            **{'TIPO DESPESA': 'TIPO ANTIGO QA'})
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refreshed')
        entry = self.state()['provision_description']['entries'][0]['fields']
        self.assertFalse(entry.get('TIPO DESPESA'))

    def test_all_scheduling_and_status_fanout_fields_must_be_confirmed(self):
        for field, value in [('PGTOAGENDADO', '2026-11-03T12:30:00Z'),
                             ('DATAPGTOAGENDADO', '2026-11-03T12:30:00Z'),
                             ('DATAEXECUCAOAGENDAMENTO', '2026-11-03T12:30:00Z'),
                             ('STATUS', 'SUSPENSO')]:
            with self.subTest(field=field):
                case = ParentEditTests('runTest')
                case.setUp()
                self.addCleanup(case.doCleanups)
                token = case.begin('13')
                case.h.sharepoint.items[7]['fields'][field] = value
                case.h.sharepoint.items[11]['fields'][field] = value
                self.assertEqual(case.refresh(token).get('status'), 'description_parent_refresh_failed')
                self.assertTrue(case.table()['parentEditPending'])
                for ident in case.case.child_ids:
                    case.h.sharepoint.items[ident]['fields'][field] = value
                self.assertEqual(case.refresh(token).get('status'), 'description_parent_refreshed')
                self.assertEqual(case.h.sharepoint.update_calls, [])

    def test_cleared_optional_column_requires_explicit_child_projection(self):
        token = self.begin('13')
        state = self.state()
        for field in ('DATAPGTOAGENDADO', 'DATAEXECUCAOAGENDAMENTO'):
            state['provision_description']['parent'][field] = '2026-11-03T12:30:00Z'
            self.h.sharepoint.items[7]['fields'][field] = None
            for ident in self.case.child_ids:
                self.h.sharepoint.items[ident]['fields'].pop(field, None)
        self.save(state)
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refresh_failed')
        for field in ('DATAPGTOAGENDADO', 'DATAEXECUCAOAGENDAMENTO'):
            for ident in self.case.child_ids:
                self.h.sharepoint.items[ident]['fields'][field] = None
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refreshed')
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_scheduling_fanout_accepts_same_instant_but_not_different_time(self):
        token = self.begin('13')
        self.h.sharepoint.items[7]['fields']['PGTOAGENDADO'] = '2026-11-03T12:30:00Z'
        for ident in self.case.child_ids:
            self.h.sharepoint.items[ident]['fields']['PGTOAGENDADO'] = '2026-11-03T09:31:00-03:00'
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refresh_failed')
        for ident in self.case.child_ids:
            self.h.sharepoint.items[ident]['fields']['PGTOAGENDADO'] = '2026-11-03T12:30:00'
        self.h.sharepoint.items[11]['fields']['PGTOAGENDADO'] = '2026-11-03T09:30:00-03:00'
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refreshed')
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_incomplete_or_contradicting_read_never_clears_barrier(self):
        token = self.begin()
        original = self.h.sharepoint.get_provision_description_for_settlement
        source = original(7)
        cases = [dict(source, partial=True), dict(source, complete=False),
                 {**source, 'CHILDREN': [source['CHILDREN'][-1]], 'PENDING CHILD IDS': ['11', '12', '13']}]
        missing = copy.deepcopy(source)
        for row in missing['CHILDREN']:
            row.pop('STATUS', None)
        cases.append(missing)
        for malformed in cases:
            with self.subTest(source=malformed):
                self.h.sharepoint.get_provision_description_for_settlement = lambda ident, value=malformed: copy.deepcopy(value)
                result = self.refresh(token)
                self.assertEqual(result.get('status'), 'description_parent_refresh_failed')
                self.assertEqual(self.table()['parentEditorToken'], token)
        self.h.sharepoint.get_provision_description_for_settlement = original
        self.assertEqual(self.refresh(token).get('status'), 'description_parent_refreshed')
        self.assertEqual(self.h.sharepoint.update_calls, [])


if __name__ == '__main__':
    unittest.main()
