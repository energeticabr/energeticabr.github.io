"""Real workflow/mixins against synthetic records; private source is never copied here."""
import copy
import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

if not os.getenv('ENERGETICA_BACKEND_TEST_ROOT'):
    raise unittest.SkipTest('Requires a private fresh backend source snapshot')
ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path[:0] = [str(ROOT), str(ROOT / 'worker'), str(ROOT / 'tests')]
fixture_path = Path(__file__).resolve().parents[2] / 'provision-settlement-batch-review/tests/test_batch_review.py'
spec = importlib.util.spec_from_file_location('partial_review_fixture', fixture_path)
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
from document_item_lock import document_item_lock


class PartialSettlementTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.BatchReviewTests('runTest')
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.h = self.case.h
        self.errors = []
        failure = self.h.engine._submission_failed
        def record_failure(state, etag, error):
            self.errors.append(str(error))
            return failure(state, etag, error)
        self.h.engine._submission_failed = record_failure
        # Exercise a real cross-platform file lock in place of Linux flock at
        # the synthetic attachment transport boundary when running on Windows.
        if os.name == 'nt':
            locking = patch('provision_attachment_sync.parent_lock',
                lambda directory, parent: document_item_lock(3 * 10**18 + int(parent)))
            locking.start()
            self.addCleanup(locking.stop)
        def find(token, target_list=None, idempotency_field=None):
            ident = self.h.sharepoint.tokens.get(f'{target_list}:{token}')
            return {'Id': ident} if ident else None
        self.h.sharepoint._find_item = find

    def state(self):
        return self.case.state()

    def save(self, state):
        _, etag = self.h.state.load(state['key'])
        self.h.state.save(state['key'], state, etag)

    def three_pending(self):
        self.case.child_ids = [11, 12, 13]
        self.h.sharepoint.items.pop(14)

    def prepare(self, ids, *, launch=True, payment_date='2026-10-28'):
        self.case.open()
        result = self.h.reply(reply_id='description_review_submit:' + ','.join(ids))
        self.assertEqual(result.get('field'), 'data_pgto_efetuado_baixa', result)
        self.h.reply(reply_id='date_today')
        self.case.choose_value('ENERGÉTICA - CAIXA')
        self.h.reply(reply_id='description_observation_blank')
        result = self.case.choose_value('SIM' if launch else 'NÃO')
        if launch:
            self.assertEqual(result.get('field'), 'etapa_baixa', result)
            result = self.case.choose_value('FUNDAÇÃO')
        if result.get('status') == 'awaiting_attachment_decision':
            result = self.h.reply('NÃO')
        self.assertEqual(result.get('status'), 'awaiting_confirmation', (result, self.errors))
        state = copy.deepcopy(self.state())
        state['provision_description']['common']['DATA PGTO EFETUADO'] = payment_date
        state['fields']['DATA PGTO EFETUADO'] = payment_date
        self.save(state)

    def complete(self):
        result = self.h.reply('SIM')
        self.assertEqual(result.get('status'), 'completed', (result, self.errors))
        return self.state()['sharepoint']

    def records(self, kind):
        return {ident: row for ident, row in self.h.sharepoint.items.items() if row['target_list'] == kind}

    def test_review_default_selected_ids_and_paid_row_are_readonly_with_exact_cents(self):
        self.case.open()
        table = self.case.table()
        self.assertTrue(table.get('selectionEnabled'))
        self.assertEqual(table['selectedIds'], ['11', '12', '13'])
        self.assertEqual([row['selected'] for row in table['rows']], [True, True, True, False])
        self.assertEqual([row['totalCents'] for row in table['rows']], ['2400', '2000', '1600', '500'])
        self.assertTrue(table['rows'][-1]['paid'])
        self.case.no_writes()

    def test_suspended_unpaid_row_has_safe_readonly_label_without_changing_eligibility(self):
        self.h.sharepoint.items[12]['fields']['STATUS'] = 'SUSPENSO'
        self.case.open()
        rows = {row['id']: row for row in self.case.table()['rows']}
        self.assertEqual(rows['12'].get('readonlyLabel'), 'Indisponível para baixa — somente consulta')
        self.assertTrue(rows['12']['paid'], 'Legacy flag still prevents selection')
        self.assertFalse(rows['12']['selected'])
        self.assertFalse(rows['12']['canSubmit'])
        self.assertNotIn('readonlyLabel', rows['14'], 'Actually paid rows retain their legacy label')
        self.case.no_writes()

    def test_paid_marker_without_valid_effective_date_does_not_claim_paid_in_readonly_label(self):
        self.h.sharepoint.items[12]['fields'].update({'PGTOAGENDADO': 'PAGO', 'DATA PGTO EFETUADO': '2026-99-99'})
        self.case.open()
        row = next(row for row in self.case.table()['rows'] if row['id'] == '12')
        self.assertEqual(row.get('readonlyLabel'), 'Indisponível para baixa — somente consulta')
        self.assertTrue(row['paid'])
        self.assertFalse(row['canSubmit'])
        self.case.no_writes()

    def test_pending_total_is_all_pending_rows_after_persisting_a_subset(self):
        self.case.open()
        self.h.reply(reply_id='description_review_edit:12')
        self.h.reply(reply_id='description_edit_back')
        table = self.case.table()
        self.assertEqual(table['selectedIds'], ['12'])
        self.assertEqual(table['pendingTotalDisplay'], 'R$ 60,00')
        self.assertEqual([row['totalCents'] for row in table['rows'] if row['selected']], ['2000'])
        self.case.no_writes()

    def test_unknown_unselected_pending_total_does_not_invalidate_selected_subset(self):
        self.h.sharepoint.items[12]['fields']['QTD'] = None
        self.case.open()
        self.h.reply(reply_id='description_review_edit:11')
        self.h.reply(reply_id='description_edit_back')
        table = self.case.table()
        self.assertEqual(table['pendingTotalDisplay'], 'VALOR PENDENTE')
        self.assertTrue(table['selectedValid'])
        self.assertFalse(table['canSubmit'], 'Legacy global guard still represents all pending values')
        self.assertEqual(table['selectedIds'], ['11'])
        self.case.no_writes()

    def test_post_submit_projection_still_retains_all_original_pending_amounts(self):
        from provision_description_review import review_table
        self.case.open()
        self.h.reply(reply_id='description_review_submit:11')
        table = review_table(self.state()['provision_description'])
        self.assertEqual(table['pendingTotalDisplay'], 'R$ 60,00')
        rows = {row['id']: row for row in table['rows']}
        self.assertFalse(rows['12']['paid'])
        self.assertFalse(rows['13']['paid'])
        self.case.no_writes()

    def test_first_subset_then_second_date_reuses_one_order_and_parent_closes_only_at_end(self):
        self.three_pending()
        untouched = {
            ident: copy.deepcopy(self.h.sharepoint.items[ident]) for ident in (12, 13)}
        self.prepare(['11'], payment_date='2026-10-28')
        self.assertEqual([e['fields']['ID PROVISÃO'] for e in self.state()['provision_description']['entries']], ['11'])
        receipt = self.complete()
        self.assertEqual([r['item_id'] for r in receipt['line_items']], [11])
        self.assertFalse(receipt['parent_paid'])
        self.assertFalse(self.h.sharepoint.items[7]['fields'].get('DATA PGTO EFETUADO'))
        self.assertEqual({i: self.h.sharepoint.items[i] for i in (12, 13)}, untouched)
        orders = self.records('NOTASPENDENTES')
        self.assertEqual(len(orders), 1)
        order_id = next(iter(orders))
        self.assertEqual(orders[order_id]['fields']['VALORTOTAL'], '24')
        self.assertEqual(len(self.records('LANCAMENTOS')), 1)
        self.prepare(['12', '13'], payment_date='2026-10-29')
        receipt = self.complete()
        self.assertEqual(receipt['selected_ids'], ['12', '13'])
        self.assertTrue(receipt['parent_paid'])
        self.assertEqual(len(self.records('NOTASPENDENTES')), 1)
        self.assertEqual(self.records('NOTASPENDENTES')[order_id]['fields']['VALORTOTAL'], '60')
        self.assertEqual(self.records('NOTASPENDENTES')[order_id]['fields']['DATA PEDIDO'], '2026-10-28')
        self.assertEqual({self.h.sharepoint.items[i]['fields']['IDPEDIDO'] for i in (11, 12, 13)}, {str(order_id)})
        self.assertEqual(self.h.sharepoint.items[7]['fields']['VALORTOTAL'], '60')
        self.assertEqual(self.h.sharepoint.items[7]['fields']['DATA PGTO EFETUADO'], '2026-10-29')

    def test_subset_summary_and_edit_persistence_exclude_unselected_from_payment(self):
        self.case.open()
        result = self.h.reply(reply_id='description_review_edit:12')
        self.assertEqual(result.get('status'), 'awaiting_description_edit_choice')
        group = self.state()['provision_description']
        self.assertEqual(group['selected_ids'], ['12'])
        self.assertEqual(len(group['entries']), 3, 'Edit preserves all drafts')
        self.h.reply(reply_id='description_edit_back')
        self.assertEqual(self.case.table()['selectedIds'], ['12'])
        self.assertEqual(self.h.reply(reply_id='description_review_submit').get('field'), 'data_pgto_efetuado_baixa')
        self.assertEqual([c['Id'] for c in self.state()['provision_description']['children']], [12])
        self.case.no_writes()

    def test_invalid_selections_never_change_selection_or_write(self):
        self.case.open()
        for value in ('', '999', '14', '11,11', '0', '-1', '01', '11,999', '11,14', '11,'):
            for action in ('submit', 'edit'):
                with self.subTest(value=value, action=action):
                    before = copy.deepcopy(self.state()['provision_description'])
                    self.h.reply(reply_id=f'description_review_{action}:{value}')
                    self.assertEqual(self.state()['provision_description'], before)
                    self.case.no_writes()

    def test_stale_row_after_review_is_rejected_before_any_financial_write(self):
        self.case.open()
        self.h.sharepoint.items[11]['fields']['PGTOAGENDADO'] = 'PAGO'
        self.h.sharepoint.items[11]['fields']['DATA PGTO EFETUADO'] = '2026-10-27'
        result = self.h.reply(reply_id='description_review_submit:11')
        self.assertNotEqual(result.get('field'), 'data_pgto_efetuado_baixa')
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_zero_selected_value_blocks_submit_even_with_valid_other_rows(self):
        self.h.sharepoint.items[12]['fields']['VALOR TOTAL'] = '0'
        self.case.open()
        self.assertFalse(self.case.table()['canSubmit'], 'Legacy overview still requires all pending values')
        self.assertNotIn('totalCents', self.case.table()['rows'][1])
        result = self.h.reply(reply_id='description_review_submit:12')
        self.assertEqual(result.get('field'), 'description_review')
        self.case.no_writes()

    def test_selected_valid_subset_can_submit_despite_unselected_invalid_amount(self):
        self.h.sharepoint.items[12]['fields']['VALOR TOTAL'] = None
        self.case.open()
        self.assertFalse(self.case.table()['canSubmit'])
        self.assertTrue(self.case.table()['rows'][0]['canSubmit'])
        result = self.h.reply(reply_id='description_review_submit:11')
        self.assertEqual(result.get('field'), 'data_pgto_efetuado_baixa')
        self.case.no_writes()

    def test_suspended_row_is_not_paid_and_prevents_parent_closure(self):
        self.h.sharepoint.items[12]['fields']['STATUS'] = 'SUSPENSO'
        self.prepare(['11', '13'], launch=False)
        receipt = self.complete()
        self.assertFalse(receipt['parent_paid'])
        self.assertFalse(self.h.sharepoint.items[7]['fields'].get('DATA PGTO EFETUADO'))
        self.assertFalse(self.h.sharepoint.items[12]['fields'].get('DATA PGTO EFETUADO'))

    def test_conflicting_order_links_across_unselected_children_reject_before_writes(self):
        self.h.sharepoint.items[12]['fields']['IDPEDIDO'] = '901'
        self.h.sharepoint.items[13]['fields']['IDPEDIDO'] = '902'
        self.prepare(['11'])
        result = self.h.reply('SIM')
        self.assertEqual(result.get('status'), 'submission_failed')
        self.assertEqual(self.h.sharepoint.update_calls, [])
        self.assertFalse(self.records('NOTASPENDENTES'))

    def test_foreign_description_order_cannot_be_reused_when_own_token_is_missing(self):
        sp = self.h.sharepoint
        owner = sp.items[11]['fields']
        foreign = sp.ensure_item('WA-BAIXA-PEDIDO-DESCRITIVO-999', {
            'FILIAL': owner['FILIAL'], 'FORNECEDOR': owner['FORNECEDOR'],
            'VALORTOTAL': '777', 'DATA PEDIDO': '2026-10-20',
            'STATUS': 'PENDENTE AUDITORIA', 'FORMAPGTO': 'ENERGÉTICA - CAIXA',
            'NOTA FISCAL': 'PENDENTE'}, target_list='NOTASPENDENTES',
            idempotency_field='Title', merge_existing=False)
        sp.items[12]['fields']['IDPEDIDO'] = str(foreign)
        before = copy.deepcopy(sp.items[foreign])
        self.prepare(['11'])
        result = self.h.reply('SIM')
        self.assertEqual(result.get('status'), 'submission_failed')
        self.assertEqual(sp.items[foreign], before)
        self.assertEqual(sp.update_calls, [])
        self.assertFalse(sp.items[11]['fields'].get('DATA PGTO EFETUADO'))

    def test_order_identity_changed_between_lookup_and_cas_read_cannot_be_reused(self):
        sp = self.h.sharepoint
        owner = sp.items[11]['fields']
        ident = sp.ensure_item('WA-BAIXA-PEDIDO-DESCRITIVO-7', {
            'FILIAL': owner['FILIAL'], 'FORNECEDOR': owner['FORNECEDOR'],
            'VALORTOTAL': '777', 'DATA PEDIDO': '2026-10-20',
            'STATUS': 'PENDENTE AUDITORIA', 'FORMAPGTO': 'ENERGÉTICA - CAIXA',
            'NOTA FISCAL': 'PENDENTE'}, target_list='NOTASPENDENTES',
            idempotency_field='Title', merge_existing=False)
        sp.items[12]['fields']['IDPEDIDO'] = str(ident)
        self.prepare(['11'])
        find = sp._find_item
        def rename_after_read(token, **kwargs):
            found = find(token, **kwargs)
            if found:
                sp.items[ident]['fields']['Title'] = 'WA-BAIXA-PEDIDO-DESCRITIVO-999'
                sp.items[ident]['_version'] = sp.items[ident].get('_version', 1) + 1
            return found
        sp._find_item = rename_after_read
        result = self.h.reply('SIM')
        self.assertEqual(result.get('status'), 'submission_failed')
        self.assertEqual(sp.items[ident]['fields']['VALORTOTAL'], '777')
        self.assertEqual(sp.update_calls, [])

    def lost_final_ack_and_late_conflict(self):
        self.three_pending()
        self.prepare(['11', '12', '13'])
        sp = self.h.sharepoint
        update = sp.update_item_with_etag
        lost = []
        def lose(ident, fields, etag, target_list=None):
            result = update(ident, fields, etag, target_list=target_list)
            if target_list == 'DESCRITIVOPROVISAO' and fields.get('DATA PGTO EFETUADO') and not lost:
                lost.append(True)
                raise RuntimeError('synthetic final parent acknowledgement lost')
            return result
        sp.update_item_with_etag = lose
        self.assertEqual(self.h.reply('SIM').get('status'), 'submission_failed')
        self.assertTrue(sp.items[7]['fields'].get('DATA PGTO EFETUADO'))
        row = copy.deepcopy(sp.items[12])
        row['fields'].update({'Id': 15, 'IDPEDIDO': '999999', 'IDLANCAMENTOS': None})
        sp.items[15] = row
        self.case.child_ids.append(15)

    def assert_selected_writes_are_not_repeated(self):
        self.assertTrue(all(self.h.sharepoint.items[i]['fields'].get('DATA PGTO EFETUADO') for i in (11, 12, 13)))
        self.assertEqual(len(self.records('NOTASPENDENTES')), 1)
        self.assertEqual(len(self.records('LANCAMENTOS')), 3)
        self.assertEqual(sum(call['target_list'] == 'PROVISÃO PGTOS' for call in self.h.sharepoint.update_calls), 3)

    def test_conflicting_paid_child_after_lost_final_ack_reopens_owned_parent_before_preflight(self):
        self.lost_final_ack_and_late_conflict()
        result = self.h.reply(reply_id='error_retry')
        self.assertEqual(result.get('status'), 'submission_failed')
        self.assertFalse(self.h.sharepoint.items[7]['fields'].get('DATA PGTO EFETUADO'))
        self.assert_selected_writes_are_not_repeated()

    def test_lost_final_ack_recovery_never_clears_another_writers_parent_fields_or_date(self):
        self.lost_final_ack_and_late_conflict()
        sp = self.h.sharepoint
        sp.update_item(7, {'OBS': 'outro gravador fictício', 'DATA PGTO EFETUADO': '2026-10-29'},
            target_list='DESCRITIVOPROVISAO')
        before = copy.deepcopy(sp.items[7])
        calls = len(sp.update_calls)
        self.assertEqual(self.h.reply(reply_id='error_retry').get('status'), 'submission_failed')
        self.assertEqual(sp.items[7], before)
        self.assertEqual(len(sp.update_calls), calls)
        self.assert_selected_writes_are_not_repeated()

    def test_lost_final_ack_recovery_never_clears_another_writers_parent_owner(self):
        self.lost_final_ack_and_late_conflict()
        sp = self.h.sharepoint
        sp.update_item(7, {'FILIAL': 'OUTRA FILIAL FICTÍCIA'}, target_list='DESCRITIVOPROVISAO')
        before = copy.deepcopy(sp.items[7])
        calls = len(sp.update_calls)
        self.assertEqual(self.h.reply(reply_id='error_retry').get('status'), 'submission_failed')
        self.assertEqual(sp.items[7], before)
        self.assertEqual(len(sp.update_calls), calls)
        self.assert_selected_writes_are_not_repeated()

    def test_reopening_lost_ack_is_recoverable_without_repeating_selected_children(self):
        self.lost_final_ack_and_late_conflict()
        sp = self.h.sharepoint
        update = sp.update_item_with_etag
        lost = []
        def lose_clear(ident, fields, etag, target_list=None):
            result = update(ident, fields, etag, target_list=target_list)
            if target_list == 'DESCRITIVOPROVISAO' and fields.get('DATA PGTO EFETUADO') is None and not lost:
                lost.append(True)
                raise RuntimeError('synthetic parent reopen acknowledgement lost')
            return result
        sp.update_item_with_etag = lose_clear
        self.assertEqual(self.h.reply(reply_id='error_retry').get('status'), 'submission_failed')
        self.assertFalse(sp.items[7]['fields'].get('DATA PGTO EFETUADO'))
        self.assertEqual(self.h.reply(reply_id='error_retry').get('status'), 'submission_failed')
        self.assertFalse(sp.items[7]['fields'].get('DATA PGTO EFETUADO'))
        self.assert_selected_writes_are_not_repeated()

    def test_reopening_parent_cas_preserves_a_writer_racing_after_the_ownership_read(self):
        self.lost_final_ack_and_late_conflict()
        sp = self.h.sharepoint
        update = sp.update_item_with_etag
        raced = []
        def race(ident, fields, etag, target_list=None):
            if target_list == 'DESCRITIVOPROVISAO' and fields.get('DATA PGTO EFETUADO') is None and not raced:
                raced.append(True)
                sp.update_item(7, {'OBS': 'alteração concorrente fictícia',
                    'DATA PGTO EFETUADO': '2026-10-29'}, target_list='DESCRITIVOPROVISAO')
            return update(ident, fields, etag, target_list=target_list)
        sp.update_item_with_etag = race
        self.assertEqual(self.h.reply(reply_id='error_retry').get('status'), 'submission_failed')
        self.assertTrue(raced, 'Recovery must actually attempt the conditional reopen')
        self.assertEqual(sp.items[7]['fields']['OBS'], 'alteração concorrente fictícia')
        self.assertEqual(sp.items[7]['fields']['DATA PGTO EFETUADO'], '2026-10-29')
        calls = len(sp.update_calls)
        self.assertEqual(self.h.reply(reply_id='error_retry').get('status'), 'submission_failed')
        self.assertEqual(len(sp.update_calls), calls)
        self.assert_selected_writes_are_not_repeated()

    def test_lost_child_ack_retries_only_frozen_subset_once(self):
        self.three_pending()
        self.prepare(['11'])
        update = self.h.sharepoint.update_item_with_etag
        lost = []
        def lose(ident, fields, etag, target_list=None):
            result = update(ident, fields, etag, target_list=target_list)
            if target_list == 'PROVISÃO PGTOS' and int(ident) == 11 and not lost:
                lost.append(True)
                raise RuntimeError('synthetic paid acknowledgement lost')
            return result
        self.h.sharepoint.update_item_with_etag = lose
        self.assertEqual(self.h.reply('SIM').get('status'), 'submission_failed')
        result = self.h.reply(reply_id='error_retry')
        self.assertEqual(result.get('status'), 'completed', (result, self.errors))
        self.assertEqual(len(self.records('LANCAMENTOS')), 1)
        self.assertEqual(len(self.records('NOTASPENDENTES')), 1)
        self.assertEqual(sum(c['target_list'] == 'PROVISÃO PGTOS' and c['item_id'] == 11 for c in self.h.sharepoint.update_calls), 1)
        self.assertFalse(self.h.sharepoint.items[12]['fields'].get('DATA PGTO EFETUADO'))

    def test_order_created_before_first_link_is_reused_after_lost_ack(self):
        self.three_pending()
        self.prepare(['11'])
        ensure = self.h.sharepoint.ensure_item
        lost = []
        def lose(token, fields, target_list=None, **kwargs):
            ident = ensure(token, fields, target_list=target_list, **kwargs)
            if target_list == 'NOTASPENDENTES' and not lost:
                lost.append(True)
                raise RuntimeError('synthetic order acknowledgement lost')
            return ident
        self.h.sharepoint.ensure_item = lose
        self.assertEqual(self.h.reply('SIM').get('status'), 'submission_failed')
        result = self.h.reply(reply_id='error_retry')
        self.assertEqual(result.get('status'), 'completed', (result, self.errors))
        self.assertEqual(len(self.records('NOTASPENDENTES')), 1)
        self.assertEqual(len(self.records('LANCAMENTOS')), 1)

    def test_frozen_subset_cannot_be_expanded_after_an_ambiguous_write(self):
        self.prepare(['11'])
        update = self.h.sharepoint.update_item_with_etag
        def fail(*args, **kwargs):
            raise RuntimeError('synthetic ambiguous parent write')
        self.h.sharepoint.update_item_with_etag = fail
        self.assertEqual(self.h.reply('SIM').get('status'), 'submission_failed')
        state = copy.deepcopy(self.state())
        state['provision_description']['selected_ids'] = ['11', '12']
        self.save(state)
        self.h.sharepoint.update_item_with_etag = update
        self.assertEqual(self.h.reply(reply_id='error_retry').get('status'), 'submission_failed')
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_new_pending_child_added_during_paid_write_keeps_parent_open_and_is_never_settled(self):
        self.three_pending()
        self.prepare(['11', '12', '13'])
        update = self.h.sharepoint.update_item_with_etag
        added = []
        def add_pending(ident, fields, etag, target_list=None):
            result = update(ident, fields, etag, target_list=target_list)
            if target_list == 'PROVISÃO PGTOS' and int(ident) == 13 and not added:
                added.append(True)
                row = copy.deepcopy(self.h.sharepoint.items[12])
                row['fields'].update({'Id': 15, 'DATA PGTO EFETUADO': None,
                    'PGTOAGENDADO': None, 'IDPEDIDO': None, 'IDLANCAMENTOS': None})
                self.h.sharepoint.items[15] = row
                self.case.child_ids.append(15)
            return result
        self.h.sharepoint.update_item_with_etag = add_pending
        receipt = self.complete()
        self.assertFalse(receipt['parent_paid'])
        self.assertFalse(self.h.sharepoint.items[7]['fields'].get('DATA PGTO EFETUADO'))
        self.assertEqual(self.h.sharepoint.items[7]['fields']['VALORTOTAL'], '80')
        self.assertFalse(self.h.sharepoint.items[15]['fields'].get('DATA PGTO EFETUADO'))
        self.assertEqual(len(self.records('LANCAMENTOS')), 3)
        self.assertEqual(next(iter(self.records('NOTASPENDENTES').values()))['fields']['VALORTOTAL'], '60')

    def test_subset_never_mutates_unselected_child_attachments(self):
        self.h.sharepoint.items[7]['attachments']['comprovante-ficticio.pdf'] = b'fake only'
        before = {ident: copy.deepcopy(self.h.sharepoint.items[ident]) for ident in (11, 13, 14)}
        self.prepare(['12'])
        self.complete()
        self.assertEqual({i: self.h.sharepoint.items[i] for i in before}, before)
        launch = next(iter(self.records('LANCAMENTOS').values()))
        self.assertTrue(launch['attachments'], 'Selected destination retains group evidence')
        self.assertTrue(next(iter(self.records('NOTASPENDENTES').values()))['attachments'])

    def test_new_pending_before_confirmation_blocks_all_writes_until_new_review(self):
        self.prepare(['11'])
        row = copy.deepcopy(self.h.sharepoint.items[12])
        row['fields']['Id'] = 15
        self.h.sharepoint.items[15] = row
        self.case.child_ids.append(15)
        self.assertEqual(self.h.reply('SIM').get('status'), 'submission_failed')
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_final_parent_ack_loss_retries_without_duplicate_child_or_order(self):
        self.three_pending()
        self.prepare(['11', '12', '13'])
        update = self.h.sharepoint.update_item_with_etag
        lost = []
        def lose(ident, fields, etag, target_list=None):
            result = update(ident, fields, etag, target_list=target_list)
            if target_list == 'DESCRITIVOPROVISAO' and fields.get('DATA PGTO EFETUADO') and not lost:
                lost.append(True)
                raise RuntimeError('synthetic final parent acknowledgement lost')
            return result
        self.h.sharepoint.update_item_with_etag = lose
        self.assertEqual(self.h.reply('SIM').get('status'), 'submission_failed')
        result = self.h.reply(reply_id='error_retry')
        self.assertEqual(result.get('status'), 'completed', (result, self.errors))
        self.assertTrue(self.state()['sharepoint']['parent_paid'])
        self.assertEqual(len(self.records('NOTASPENDENTES')), 1)
        self.assertEqual(len(self.records('LANCAMENTOS')), 3)
        self.assertEqual(sum(c['target_list'] == 'PROVISÃO PGTOS' for c in self.h.sharepoint.update_calls), 3)

    def test_final_parent_date_is_maximum_actual_child_date_even_if_last_partial_is_earlier(self):
        self.three_pending()
        self.prepare(['11'], payment_date='2026-10-29')
        self.complete()
        self.prepare(['12', '13'], payment_date='2026-10-28')
        self.complete()
        self.assertEqual(self.h.sharepoint.items[7]['fields']['DATA PGTO EFETUADO'], '2026-10-29')
        order = next(iter(self.records('NOTASPENDENTES').values()))
        self.assertEqual(order['fields']['DATA PEDIDO'], '2026-10-29')

    def test_diversos_owner_survives_homogeneous_first_and_second_partial(self):
        self.three_pending()
        self.h.sharepoint.items[7]['fields']['FORNECEDOR'] = 'DIVERSOS'
        self.h.sharepoint.items[12]['fields']['FORNECEDOR'] = 'Fornecedor alternativo fictício'
        self.prepare(['11'])
        self.complete()
        order_id = next(iter(self.records('NOTASPENDENTES')))
        self.assertEqual(self.h.sharepoint.items[order_id]['fields']['FORNECEDOR'], 'DIVERSOS')
        self.prepare(['12', '13'], payment_date='2026-10-29')
        self.complete()
        self.assertEqual(len(self.records('NOTASPENDENTES')), 1)
        self.assertEqual(self.h.sharepoint.items[order_id]['fields']['FORNECEDOR'], 'DIVERSOS')

    def test_new_pending_after_final_parent_write_is_reconciled_before_success(self):
        self.three_pending()
        self.prepare(['11', '12', '13'])
        update = self.h.sharepoint.update_item_with_etag
        added = []
        def add_pending(ident, fields, etag, target_list=None):
            result = update(ident, fields, etag, target_list=target_list)
            if target_list == 'DESCRITIVOPROVISAO' and fields.get('DATA PGTO EFETUADO') and not added:
                added.append(True)
                row = copy.deepcopy(self.h.sharepoint.items[12])
                row['fields'].update({'Id': 15, 'DATA PGTO EFETUADO': None,
                    'PGTOAGENDADO': None, 'IDPEDIDO': None, 'IDLANCAMENTOS': None})
                self.h.sharepoint.items[15] = row
                self.case.child_ids.append(15)
            return result
        self.h.sharepoint.update_item_with_etag = add_pending
        receipt = self.complete()
        self.assertFalse(receipt['parent_paid'])
        self.assertFalse(self.h.sharepoint.items[7]['fields'].get('DATA PGTO EFETUADO'))
        self.assertEqual(self.h.sharepoint.items[7]['fields']['VALORTOTAL'], '80')

    def reject_unreviewed_paid_child(self, *, during_closure=False, conflicting_order=False):
        self.three_pending()
        self.prepare(['11', '12', '13'])
        update = self.h.sharepoint.update_item_with_etag
        added = []
        def add_paid(ident, fields, etag, target_list=None):
            result = update(ident, fields, etag, target_list=target_list)
            trigger = (target_list == 'DESCRITIVOPROVISAO' and fields.get('DATA PGTO EFETUADO')) if during_closure else (
                target_list == 'PROVISÃO PGTOS' and int(ident) == 13)
            if trigger and not added:
                added.append(True)
                row = copy.deepcopy(self.h.sharepoint.items[12])
                row['fields']['Id'] = 15
                if conflicting_order:
                    row['fields']['IDPEDIDO'] = '999999'
                self.h.sharepoint.items[15] = row
                self.case.child_ids.append(15)
            return result
        self.h.sharepoint.update_item_with_etag = add_paid
        result = self.h.reply('SIM')
        self.assertEqual(result.get('status'), 'submission_failed', (result, self.errors))
        self.assertFalse(self.h.sharepoint.items[7]['fields'].get('DATA PGTO EFETUADO'))
        self.assertEqual(len(self.records('NOTASPENDENTES')), 1)
        self.assertEqual(len(self.records('LANCAMENTOS')), 3)
        self.assertTrue(all(self.h.sharepoint.items[ident]['fields'].get('DATA PGTO EFETUADO') for ident in (11, 12, 13)))
        self.assertFalse(any(call['target_list'] == 'PROVISÃO PGTOS' and call['item_id'] == 15
            for call in self.h.sharepoint.update_calls))

    def test_new_paid_child_in_same_order_requires_review_instead_of_inconsistent_completion(self):
        self.reject_unreviewed_paid_child()

    def test_new_paid_child_with_conflicting_order_is_rejected_before_parent_closure(self):
        self.reject_unreviewed_paid_child(conflicting_order=True)

    def test_new_paid_child_after_parent_write_reopens_parent_before_reporting_error(self):
        self.reject_unreviewed_paid_child(during_closure=True)

    def test_conflicting_new_paid_child_after_parent_write_reopens_parent_before_reporting_error(self):
        self.reject_unreviewed_paid_child(during_closure=True, conflicting_order=True)

    def test_valid_subset_settles_with_unknown_unselected_value_preserving_known_parent_total(self):
        self.h.sharepoint.items[12]['fields']['VALOR TOTAL'] = None
        original = copy.deepcopy(self.h.sharepoint.items[12])
        self.prepare(['11'])
        receipt = self.complete()
        self.assertFalse(receipt['parent_paid'])
        self.assertEqual(self.h.sharepoint.items[12], original)
        self.assertEqual(self.h.sharepoint.items[7]['fields']['VALORTOTAL'], '65')
        self.assertFalse(self.h.sharepoint.items[7]['fields'].get('DATA PGTO EFETUADO'))
        self.assertEqual(next(iter(self.records('NOTASPENDENTES').values()))['fields']['VALORTOTAL'], '29')

    def test_valid_subset_skips_unknown_parent_total_and_unknown_unselected_quantity(self):
        self.h.sharepoint.items[12]['fields']['QTD'] = None
        self.h.sharepoint.items[7]['fields']['VALORTOTAL'] = None
        original = copy.deepcopy(self.h.sharepoint.items[12])
        self.prepare(['11'])
        receipt = self.complete()
        self.assertFalse(receipt['parent_paid'])
        self.assertEqual(self.h.sharepoint.items[12], original)
        self.assertIsNone(self.h.sharepoint.items[7]['fields']['VALORTOTAL'])
        self.assertFalse(self.h.sharepoint.items[7]['fields'].get('DATA PGTO EFETUADO'))
        self.assertFalse(any('VALORTOTAL' in call['fields'] for call in self.h.sharepoint.update_calls
            if call['target_list'] == 'DESCRITIVOPROVISAO'))

    def test_actual_partial_group_registers_stage_and_returns_selected_context_without_financial_writes(self):
        self.case.open()
        self.h.reply(reply_id='description_review_submit:11,13')
        self.h.reply(reply_id='date_today')
        self.case.choose_value('ENERGÉTICA - CAIXA')
        self.h.reply(reply_id='description_observation_blank')
        result = self.case.choose_value('SIM')
        self.assertEqual(result.get('field'), 'etapa_baixa')
        parent = copy.deepcopy(self.state())
        self.h.sharepoint.options_by_key['filial_cadastro_etapa_obra'] = [
            {'id': 420, 'title': '004 - FILIAL FICTÍCIA', 'value': '004 - FILIAL FICTÍCIA'}]
        result = self.h.reply(reply_id='NOVA_ETAPA_BAIXA_PROVISAO')
        self.assertEqual(result.get('field'), 'filial_cadastro_etapa_obra')
        child, _ = self.h.state.load(parent['key'])
        self.assertEqual(child['flow'], 'construction_stage_registration')
        self.assertNotIn('provision_description', child)
        self.assertEqual(child['embedded_return']['state']['provision_description'], parent['provision_description'])
        def reply(text=None, reply_id=None):
            current, _ = self.h.state.load(parent['key'])
            step = self.h.engine._current_step(current)
            if text and text.isdigit() and reply_id is None and step.get('kind') == 'selection':
                reply_id = f"choice:{step['key']}:{text}"
            return self.h.reply(text, reply_id=reply_id)
        reply('420')
        reply('ETAPA PARCIAL FICTÍCIA')
        reply('1')
        reply(reply_id='construction_stage_start_blank')
        reply(reply_id='construction_stage_deadline_blank')
        reply(reply_id='construction_stage_end_blank')
        reply('0')
        self.assertEqual(reply('NÃO').get('status'), 'awaiting_confirmation')
        result = reply('SIM')
        self.assertTrue(result.get('embedded_settlement_stage_registered'), result)
        restored = self.state()
        self.assertEqual(restored['provision_description']['selected_ids'], ['11', '13'])
        self.assertEqual(restored['provision_description']['original_children'], parent['provision_description']['original_children'])
        self.assertEqual(restored['provision_description']['common'], parent['provision_description']['common'])
        self.assertEqual([entry['fields']['ID PROVISÃO'] for entry in restored['provision_description']['entries']], ['11', '13'])
        self.assertEqual(restored['fields']['ETAPA'], 'ETAPA PARCIAL FICTÍCIA')
        if result.get('status') == 'awaiting_attachment_decision':
            result = reply('NÃO')
            restored = self.state()
        self.assertEqual(result.get('status'), 'awaiting_confirmation')
        self.assertEqual(restored['provision_description']['launch_settings']['ETAPA'], 'ETAPA PARCIAL FICTÍCIA')
        self.assertEqual(len(self.records('LANCAMENTOOBRA')), 1)
        self.assertFalse(self.records('LANCAMENTOS'))
        self.assertFalse(self.records('NOTASPENDENTES'))
        self.assertEqual(self.h.sharepoint.update_calls, [])


if __name__ == '__main__':
    unittest.main()
