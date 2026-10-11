import copy
import sys
import unittest
import tempfile
import threading
from types import SimpleNamespace
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))

from provision_description_settlement import (
    ProvisionDescriptionSettlement, group_options, group_snapshot,
)


def child(item_id, **fields):
    return {'Id': item_id, 'DESCRITIVOPROVISAO': '7', 'STATUS': 'PAGAMENTO PREVISTO',
            'QTD': '2', 'VALOR TOTAL': '10.50', 'FRETE': '3',
            'FORNECEDOR': 'Fornecedor ficticio', 'PRODUTO': 'Produto ficticio',
            'FILIAL': 'Filial ficticia', 'IMOVEL': 'Imovel ficticio', 'DATA PREVISTO PGTO': '2026-10-11',
            'DATA PGTO EFETUADO': None, 'PGTOAGENDADO': None, 'OBS': None,
            'FORMAPGTO': None, 'IDLANCAMENTOS': None, 'IDPEDIDO': None, **fields}


def group():
    return {'Id': 7, 'FORNECEDOR': 'Referencia ficticia', 'FILIAL': 'Filial ficticia',
            'DATA PREVISTO PGTO': '2026-10-11', 'DATA PGTO EFETUADO': None,
            'FORMAPGTO': None, 'OBS': None, 'PGTOAGENDADO': None,
            'CHILDREN': [child(12), child(11)], 'PENDING CHILD IDS': ['11', '12'],
            'VALOR TOTAL DESCRITIVO': '48', 'totalDisplay': 'R$ 48,00'}


class Connector:
    def __init__(self):
        self.group = group()
        self.events = []
        self.fail_child = None
        self.parent_response_lost = False

    def get_pending_provision_descriptions(self):
        return [copy.deepcopy(self.group)]

    def get_provision_description(self, item_id):
        assert int(item_id) == 7
        return copy.deepcopy(self.group)

    def get_item_fields_with_etag(self, item_id, fields, target_list=None):
        row = self.group if target_list == 'DESCRITIVOPROVISAO' else next(
            item for item in self.group['CHILDREN'] if int(item['Id']) == int(item_id))
        return {key: row.get(key) for key in fields}, 'version-' + str(item_id)

    def update_item_with_etag(self, item_id, fields, etag, target_list=None):
        self.events.append(('update', target_list, int(item_id), copy.deepcopy(fields)))
        if target_list == 'DESCRITIVOPROVISAO':
            self.group.update(fields)
            if self.parent_response_lost:
                self.parent_response_lost = False
                raise RuntimeError('synthetic parent response lost after write')

    def verify_item(self, item_id, fields, names, target_list=None):
        self.events.append(('verify', target_list, int(item_id)))
        return {'fields': True, 'attachments': True}


class Engine(ProvisionDescriptionSettlement):
    def __init__(self):
        self.sharepoint = Connector()
        self.saved = []
        self.child_response_lost = False
        self.messenger = SimpleNamespace(send_actions=lambda *args, **kwargs: None)

    def _save(self, state, etag):
        self.saved.append(copy.deepcopy(state))
        return str(len(self.saved))

    def _commit_payment_settlement(self, state, etag, flow, *, on_prepared=None):
        item_id = int(state['fields']['ID PROVISÃO'])
        self.sharepoint.events.append(('child', item_id, copy.deepcopy(state['fields'])))
        if self.sharepoint.fail_child == item_id:
            raise RuntimeError('synthetic child failure')
        update = {key: state['fields'].get(key) for key in ('DATA PGTO EFETUADO', 'FORMAPGTO', 'OBS', 'QTD', 'VALOR TOTAL', 'FRETE')}
        update['PGTOAGENDADO'] = 'PAGO'
        record = {'item_id': item_id, 'verified': {'fields': True, 'attachments': True},
                  'related_item': None, 'launch_item': None, 'attachment_names': []}
        if on_prepared:
            on_prepared(update, record)
        source = next(item for item in self.sharepoint.group['CHILDREN'] if item['Id'] == item_id)
        source.update(state['fields'])
        source['PGTOAGENDADO'] = 'PAGO'
        if self.child_response_lost:
            self.child_response_lost = False
            raise RuntimeError('synthetic child response lost after write')
        return record

    def _submission_failed(self, state, etag, error):
        state['error'] = str(error)
        self._save(state, etag)
        return {'status': 'submission_failed'}

    def _notify_completed(self, state, etag):
        return {'status': 'completed'}

    def _send_text(self, state, text):
        pass


def prepared(engine):
    state = {'flow': 'payment_settlement', 'batch_id': 'fake-batch', 'key': 'fake',
             'fields': {}, 'answers': {}, 'display_values': {}, 'selections': {},
             'attachments': [], 'step_index': 1, 'options': []}
    engine._description_start(state, group())
    entries = []
    for item in state['provision_description']['children']:
        entries.append({'fields': {**item, 'ID PROVISÃO': str(item['Id']),
                                   'DATA PGTO EFETUADO': '2026-10-11',
                                   'FORMAPGTO': 'Conta ficticia', 'OBS': 'Observacao comum'},
                        'answers': {'submeter_lancamentos': 'NÃO'}, 'display_values': {},
                        'relink_authorized': False})
    state['provision_description']['entries'] = entries
    state['provision_description']['common'] = {
        'DATA PGTO EFETUADO': '2026-10-11', 'FORMAPGTO': 'Conta ficticia',
        'OBS': 'Observacao comum'}
    state['provision_description']['prepared'] = True
    return state


class DescriptionSettlementTests(unittest.TestCase):
    def test_blank_observation_round_trips_production_serializer_and_partial_retry(self):
        from clients import SharePointClient
        engine = Engine()
        state = prepared(engine)
        state['provision_description']['common']['OBS'] = None
        serializer = SharePointClient.__new__(SharePointClient)
        serializer.target_list = 'DESCRITIVOPROVISAO'
        serializer._field_type_cache = {'DESCRITIVOPROVISAO': {'OBS': 'Note'}}
        serializer._internal_field = lambda target, field: field
        update = engine.sharepoint.update_item_with_etag
        def production_update(item_id, fields, etag, target_list=None):
            update(item_id, serializer._target_payload(fields, target_list), etag, target_list)
        engine.sharepoint.update_item_with_etag = production_update
        engine.sharepoint.fail_child = 12
        self.assertEqual(engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})['status'], 'submission_failed')
        engine.sharepoint.fail_child = None
        self.assertEqual(engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})['status'], 'completed')
        self.assertEqual(engine.sharepoint.group['OBS'], '')

    def test_definitive_parent_rejection_unfreezes_without_financial_effects(self):
        from requests import HTTPError, Response
        engine = Engine()
        state = prepared(engine)
        def rejected(*args, **kwargs):
            response = Response()
            response.status_code = 412
            raise HTTPError('Synthetic parent version rejected', response=response)
        engine.sharepoint.update_item_with_etag = rejected
        self.assertEqual(engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})['status'], 'submission_failed')
        self.assertFalse(state['provision_description']['journal'].get('intent'))
        self.assertEqual(engine.sharepoint.events, [])

    def test_ambiguous_parent_attempt_stays_frozen_even_if_later_attempt_is_rejected(self):
        from requests import HTTPError, Response
        engine = Engine()
        state = prepared(engine)
        def lost(*args, **kwargs):
            raise RuntimeError('Synthetic timeout without a known write outcome')
        engine.sharepoint.update_item_with_etag = lost
        self.assertEqual(engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})['status'], 'submission_failed')
        def rejected(*args, **kwargs):
            response = Response()
            response.status_code = 412
            raise HTTPError('Synthetic later rejection', response=response)
        engine.sharepoint.update_item_with_etag = rejected
        engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})
        self.assertTrue(state['provision_description']['journal'].get('intent'))

    def test_parent_keeps_scheduled_date_and_writes_only_shared_payment_facts(self):
        engine = Engine()
        source = group()
        source['PGTOAGENDADO'] = '2026-10-10T03:00:00Z'
        engine.sharepoint.group = copy.deepcopy(source)
        state = prepared(engine)
        state['provision_description']['parent']['PGTOAGENDADO'] = source['PGTOAGENDADO']
        self.assertEqual(engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})['status'], 'completed')
        parent_update = engine.sharepoint.events[0][3]
        self.assertEqual(set(parent_update), {'DATA PGTO EFETUADO', 'FORMAPGTO', 'OBS', 'VALORTOTAL'})
        self.assertEqual(engine.sharepoint.group['PGTOAGENDADO'], source['PGTOAGENDADO'])

    def test_stale_review_button_cannot_unlock_retry_with_lost_parent_response(self):
        from requests import HTTPError, Response
        engine = Engine()
        state = prepared(engine)
        original_update = engine.sharepoint.update_item_with_etag
        def rejected(*args, **kwargs):
            response = Response()
            response.status_code = 412
            raise HTTPError('Synthetic first rejection', response=response)
        engine.sharepoint.update_item_with_etag = rejected
        engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})
        self.assertTrue(state['provision_description']['review_required'])
        engine.sharepoint.update_item_with_etag = original_update
        engine.sharepoint.parent_response_lost = True
        engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})
        journal = copy.deepcopy(state['provision_description']['journal'])
        self.assertTrue(journal['intent'])
        # Exercise an already-rendered action as well as stale persisted state.
        state['provision_description']['review_required'] = True
        engine._mark_processed = lambda current, message_id: current.setdefault('processed_message_ids', []).append(message_id)
        result = engine._handle_frozen_provision(
            {'kind': 'text', 'reply_id': 'description_review_again', 'message_id': 'stale-review'}, state, None)
        self.assertEqual(result['status'], 'provision_submission_locked')
        self.assertEqual(state['provision_description']['journal'], journal)
        self.assertTrue(state['provision_description']['journal']['intent'])

    def test_invalid_group_is_visible_but_not_selectable_or_prepared(self):
        invalid = {**group(), 'settlementBlocked': True, 'amountError': 'Valor inválido em uma provisão.',
                   'VALOR TOTAL DESCRITIVO': None, 'totalDisplay': '—'}
        snap = group_snapshot([invalid], date(2026, 10, 11))
        self.assertTrue(snap['rows'][0]['settlementBlocked'])
        self.assertIsNone(snap['rows'][0]['total'])
        self.assertIn('inválido', snap['rows'][0]['amountError'])
        self.assertEqual(group_options([invalid]), [])
        engine = Engine()
        with self.assertRaisesRegex(ValueError, 'inválido'):
            engine._description_start({}, invalid)
        self.assertEqual(engine.sharepoint.events, [])

    def test_related_pending_report_shows_unknown_total_without_hiding_valid_groups(self):
        from provision_alerts import ProvisionAlertCardBuilder
        from datetime import datetime
        from zoneinfo import ZoneInfo
        invalid = {**group(), 'Id': 8, 'sourceKind': 'provision-description', 'settlementBlocked': True,
                   'VALOR TOTAL DESCRITIVO': None, 'totalDisplay': '—', 'amountError': 'Valor inválido'}
        with tempfile.TemporaryDirectory() as directory:
            builder = ProvisionAlertCardBuilder(Path(directory))
            cards = builder.build_pending_table([{**group(), 'sourceKind': 'provision-description'}, invalid],
                datetime(2026, 10, 11, tzinfo=ZoneInfo('America/Sao_Paulo')), 'FICTICIO')
            self.assertEqual([row['total'] for row in cards[0]['rows']], ['R$ 48,00', '— (valor inválido)'])

    def test_options_namespace_is_not_a_child_id(self):
        option = group_options([group()])[0]
        self.assertEqual(option['id'], 'provision_description:7')
        self.assertIn('R$ 48,00', option['title'])

    def test_snapshot_uses_parent_totals_and_two_day_window(self):
        future = {**group(), 'Id': 8, 'DATA PREVISTO PGTO': '2026-10-14'}
        snap = group_snapshot([group(), future], date(2026, 10, 11))
        self.assertEqual(snap['sourceKind'], 'provision-description')
        self.assertEqual([row['id'] for row in snap['rows']], ['7'])
        self.assertEqual(snap['rows'][0]['total'], '48')
        self.assertEqual(snap['rows'][0]['childCount'], 2)

    def bridge(self, reader):
        from channel_bridge import ChannelBridge
        engine = SimpleNamespace(sharepoint=SimpleNamespace(get_pending_provision_descriptions=reader),
                                 _pending_provision_due_date=lambda row: date(2026, 10, 11))
        fake = SimpleNamespace(lock=threading.RLock(), engine=engine,
                               _portal_state=lambda identity: ('fake', None),
                               portal_owners=SimpleNamespace(authorize=lambda *args, **kwargs: None))
        return ChannelBridge.portal_pending_provision_snapshot(fake, {'oid': 'fictional'}, allowed_emails=set())

    def test_bridge_keeps_parent_identity_and_confirmed_total(self):
        result = self.bridge(lambda: [group()])
        snapshot = result['pendingProvisions']
        self.assertEqual(snapshot['sourceKind'], 'provision-description')
        self.assertEqual(snapshot['rows'][0]['id'], '7')
        self.assertEqual(snapshot['rows'][0]['total'], '48')

    def test_bridge_failed_group_query_is_not_successful_empty_list(self):
        def unavailable():
            raise RuntimeError('query incomplete')
        with self.assertRaisesRegex(RuntimeError, 'query incomplete'):
            self.bridge(unavailable)

    def test_related_pending_report_uses_sum_not_parent_missing_unit_fields(self):
        from provision_alerts import ProvisionAlertCardBuilder
        from datetime import datetime
        from zoneinfo import ZoneInfo
        with tempfile.TemporaryDirectory() as directory:
            builder = ProvisionAlertCardBuilder(Path(directory))
            row = {**group(), 'sourceKind': 'provision-description'}
            cards = builder.build_pending_table([row], datetime(2026, 10, 11, tzinfo=ZoneInfo('America/Sao_Paulo')), 'FICTICIO')
            self.assertEqual(cards[0]['rows'][0]['total'], 'R$ 48,00')
            self.assertIn('DESCRITIVO 7', cards[0]['rows'][0]['fornecedor'])

    def test_start_prepares_first_child_without_writes(self):
        engine = Engine()
        state = prepared(engine)
        self.assertEqual(state['fields']['ID PROVISÃO'], '11')
        self.assertEqual(engine.sharepoint.events, [])

    def test_parent_is_updated_and_verified_before_children_in_id_order(self):
        engine = Engine()
        state = prepared(engine)
        self.assertEqual(engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})['status'], 'completed')
        events = engine.sharepoint.events
        self.assertEqual(events[0][:3], ('update', 'DESCRITIVOPROVISAO', 7))
        self.assertEqual(events[1], ('verify', 'DESCRITIVOPROVISAO', 7))
        self.assertEqual([e[1] for e in events if e[0] == 'child'], [11, 12])
        self.assertTrue(all(e[2]['OBS'] == 'Observacao comum' for e in events if e[0] == 'child'))

    def test_partial_failure_retains_progress_and_retries_only_unfinished_child(self):
        engine = Engine()
        state = prepared(engine)
        engine.sharepoint.fail_child = 12
        self.assertEqual(engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})['status'], 'submission_failed')
        self.assertEqual(list(state['provision_description']['journal']['children']), ['11'])
        engine.sharepoint.fail_child = None
        self.assertEqual(engine._description_commit(state, str(len(engine.saved)), {'target_list': 'PROVISÃO PGTOS'})['status'], 'completed')
        self.assertEqual([e[1] for e in engine.sharepoint.events if e[0] == 'child'], [11, 12, 12])

    def test_changed_link_blocks_even_parent_write(self):
        engine = Engine()
        state = prepared(engine)
        engine.sharepoint.group['CHILDREN'][0]['DESCRITIVOPROVISAO'] = '99'
        result = engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})
        self.assertEqual(result['status'], 'submission_failed')
        self.assertEqual(engine.sharepoint.events, [])

    def test_external_payment_is_not_overwritten(self):
        engine = Engine()
        state = prepared(engine)
        engine.sharepoint.group['CHILDREN'][0]['DATA PGTO EFETUADO'] = '2026-10-10'
        result = engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})
        self.assertEqual(result['status'], 'submission_failed')
        self.assertEqual(engine.sharepoint.events, [])

    def test_new_child_after_selection_blocks_write(self):
        engine = Engine()
        state = prepared(engine)
        engine.sharepoint.group['CHILDREN'].append(child(13))
        result = engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})
        self.assertEqual(result['status'], 'submission_failed')
        self.assertEqual(engine.sharepoint.events, [])

    def test_parent_success_with_lost_response_is_recovered_without_second_write(self):
        engine = Engine()
        state = prepared(engine)
        engine.sharepoint.parent_response_lost = True
        self.assertEqual(engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})['status'], 'submission_failed')
        self.assertEqual(engine._description_commit(state, str(len(engine.saved)), {'target_list': 'PROVISÃO PGTOS'})['status'], 'completed')
        self.assertEqual(sum(e[0] == 'update' for e in engine.sharepoint.events), 1)

    def test_child_success_with_lost_response_is_verified_not_reposted(self):
        engine = Engine()
        state = prepared(engine)
        engine.child_response_lost = True
        self.assertEqual(engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})['status'], 'submission_failed')
        self.assertEqual(engine._description_commit(state, str(len(engine.saved)), {'target_list': 'PROVISÃO PGTOS'})['status'], 'completed')
        self.assertEqual([e[1] for e in engine.sharepoint.events if e[0] == 'child'], [11, 12])

    def test_false_fields_verification_never_reports_success(self):
        engine = Engine()
        state = prepared(engine)
        engine.sharepoint.verify_item = lambda *a, **kw: {'fields': False, 'attachments': True}
        self.assertEqual(engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})['status'], 'submission_failed')
        self.assertEqual([e for e in engine.sharepoint.events if e[0] == 'child'], [])


if __name__ == '__main__':
    unittest.main()


class DescriptionWorkflowIntegrationTests(unittest.TestCase):
    def test_parent_rejection_then_changed_child_preserves_recoverable_draft(self):
        from requests import HTTPError, Response
        self.use_real_memory_records()
        self.reach_group_confirmation(attachments=True)
        update = self.h.sharepoint.update_item_with_etag
        def rejected(*args, **kwargs):
            self.h.sharepoint.update_item_with_etag = update
            response = Response()
            response.status_code = 412
            raise HTTPError('Synthetic rejected version', response=response)
        self.h.sharepoint.update_item_with_etag = rejected
        self.h.reply('SIM')
        self.h.sharepoint.items[11]['fields']['QTD'] = '3'
        result = self.h.reply(reply_id='retry_submission')
        self.assertEqual(result['status'], 'submission_failed')
        state = next(iter(self.h.state.values.values()))[0]
        self.assertFalse(self.h.engine._provision_attachments_locked(state))
        self.assertTrue(state['provision_description']['review_required'])
        self.assertEqual(self.h.sharepoint.update_calls, [])
        self.assertEqual([item['sharepoint_name'] for item in state['attachments']], ['recibo-ficticio.pdf'])
        self.assertEqual(self.h.reply(reply_id='description_review_again').get('field'), 'validar_qtd_baixa')

    def test_rejected_parent_offers_fresh_review_preserving_attachments(self):
        from requests import HTTPError, Response
        self.use_real_memory_records()
        self.reach_group_confirmation(attachments=True)
        update = self.h.sharepoint.update_item_with_etag
        def rejected(*args, **kwargs):
            self.h.sharepoint.update_item_with_etag = update
            response = Response()
            response.status_code = 412
            raise HTTPError('Synthetic rejected version', response=response)
        self.h.sharepoint.update_item_with_etag = rejected
        self.h.reply('SIM')
        state = next(iter(self.h.state.values.values()))[0]
        self.assertFalse(self.h.engine._provision_attachments_locked(state))
        self.assertEqual(self.h.sharepoint.update_calls, [])
        reviewed = self.h.reply(reply_id='description_review_again')
        self.assertEqual(reviewed.get('field'), 'validar_qtd_baixa')
        state = next(iter(self.h.state.values.values()))[0]
        self.assertEqual([item['sharepoint_name'] for item in state['attachments']], ['recibo-ficticio.pdf'])
        self.assertFalse(state['provision_description'].get('journal'))

    def test_summary_common_editor_applies_blank_observation_to_all_children(self):
        self.use_real_memory_records()
        self.reach_group_confirmation()
        self.h.reply('EDITAR')
        self.h.reply(reply_id='description_edit_common')
        state = next(iter(self.h.state.values.values()))[0]
        self.assertEqual([item['value'] for item in state['options'] if isinstance(item['value'], int)], [3, 4, 5])
        self.h.reply(reply_id='6')
        result = self.h.reply(reply_id='description_observation_blank')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        state = next(iter(self.h.state.values.values()))[0]
        self.assertEqual(state['provision_description']['common']['OBS'], '')
        self.assertEqual(self.h.reply('SIM')['status'], 'completed')
        self.assertTrue(all(self.h.sharepoint.items[item_id]['fields']['OBS'] == '' for item_id in (7, 11, 12)))

    def test_summary_can_edit_both_prepared_children_and_commits_correct_totals(self):
        self.use_real_memory_records()
        self.reach_group_confirmation()
        for child_id, quantity in ((11, '5'), (12, '3')):
            self.h.reply('EDITAR')
            self.h.reply(reply_id=f'description_edit_child:{child_id}')
            self.h.reply(reply_id='2')
            self.assertEqual(self.h.reply(quantity)['status'], 'awaiting_confirmation')
        self.assertEqual(self.h.reply('SIM')['status'], 'completed')
        self.assertEqual(self.h.sharepoint.items[11]['fields']['QTD'], '5')
        self.assertEqual(self.h.sharepoint.items[12]['fields']['QTD'], '3')
        self.assertEqual(self.h.sharepoint.items[7]['fields']['VALORTOTAL'], '90')

    def test_summary_editor_identifies_each_child_and_changes_only_the_selected_one(self):
        self.reach_group_confirmation()
        edited = self.h.reply('EDITAR')
        self.assertEqual(edited['status'], 'awaiting_description_edit_choice')
        state = next(iter(self.h.state.values.values()))[0]
        self.assertTrue(any(item['id'] == 'description_edit_child:11' for item in state['options']))
        self.assertTrue(any(item['id'] == 'description_edit_child:12' for item in state['options']))
        self.h.reply(reply_id='description_edit_child:11')
        self.h.reply(reply_id='2')
        result = self.h.reply('5')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        state = next(iter(self.h.state.values.values()))[0]
        entries = state['provision_description']['entries']
        self.assertEqual(entries[0]['fields']['QTD'], '5')
        self.assertEqual(entries[1]['fields']['QTD'], '2')
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def setUp(self):
        from test_workflow import WorkflowTests as _WorkflowHarness
        self.h = _WorkflowHarness('runTest')
        self.h.setUp()
        self.h.sharepoint.get_pending_provision_descriptions = lambda: [group()]
        self.h.sharepoint.get_provision_description = lambda item_id: group()

    def start(self):
        self.h.reply('OPA')
        self.h.open_supply_provision_action('BAIXAR PAGAMENTO AGENDADO')
        return self.h.reply(reply_id='provision_description:7')

    def use_real_memory_records(self):
        parent = group()
        parent['VALORTOTAL'] = '48'
        self.h.sharepoint.items[7] = {'fields': {key: value for key, value in parent.items()
                                               if key not in {'Id', 'CHILDREN', 'PENDING CHILD IDS'}},
                                     'attachments': {}, 'target_list': 'DESCRITIVOPROVISAO'}
        for row in parent['CHILDREN']:
            self.h.sharepoint.items[row['Id']] = {'fields': copy.deepcopy(row), 'attachments': {}, 'target_list': 'PROVISÃO PGTOS'}
        def fresh(item_id=7):
            fields = copy.deepcopy(self.h.sharepoint.items[int(item_id)]['fields'])
            children = [copy.deepcopy(self.h.sharepoint.items[key]['fields']) for key in (11, 12)]
            return {**fields, 'Id': int(item_id), 'CHILDREN': children,
                    'PENDING CHILD IDS': [str(item['Id']) for item in children if not item.get('DATA PGTO EFETUADO')]}
        self.h.sharepoint.get_provision_description = fresh
        self.h.sharepoint.get_pending_provision_descriptions = lambda: [fresh()]

    def reach_group_confirmation(self, launch='2', attachments=False):
        self.start()
        self.h.reply(reply_id='validar_qtd_baixa_keep')
        self.h.reply(reply_id='validar_valor_total_baixa_keep')
        self.h.reply(reply_id='date_today')
        self.h.reply('371')
        self.h.reply('Observacao comum')
        self.h.reply(launch)
        if launch == '1':
            self.h.reply('372')
        if attachments:
            self.h.reply('SIM')
            self.h.attachment('ficticio-recibo', 'recibo-ficticio.pdf', b'ficticio')
            self.h.reply('FINALIZAR')
        else:
            self.h.reply('NÃO')
        self.h.reply(reply_id='validar_qtd_baixa_keep')
        self.h.reply(reply_id='validar_valor_total_baixa_keep')
        result = self.h.reply(launch)
        if launch == '1':
            result = self.h.reply('372')
        self.assertEqual(result['status'], 'awaiting_confirmation')

    def test_new_selection_is_parent_namespaced_and_loads_first_child(self):
        result = self.start()
        self.assertEqual(result.get('field'), 'validar_qtd_baixa')
        state = next(iter(self.h.state.values.values()))[0]
        self.assertEqual(state['fields']['ID PROVISÃO'], '11')

    def test_two_children_prepare_without_any_financial_writes_and_common_questions_once(self):
        self.start()
        self.h.reply(reply_id='validar_qtd_baixa_keep')
        self.h.reply(reply_id='validar_valor_total_baixa_keep')
        self.h.reply(reply_id='date_today')
        result = self.h.reply('371')
        self.assertEqual(result.get('field'), 'observacao_grupo_baixa')
        result = self.h.reply('Observacao comum digitada')
        self.assertEqual(result.get('field'), 'submeter_lancamentos')
        self.h.reply('2')
        result = self.h.reply('NÃO')
        self.assertEqual(result.get('field'), 'validar_qtd_baixa')
        self.h.reply(reply_id='validar_qtd_baixa_keep')
        result = self.h.reply(reply_id='validar_valor_total_baixa_keep')
        self.assertEqual(result.get('field'), 'submeter_lancamentos')
        result = self.h.reply('2')
        self.assertEqual(result.get('status'), 'awaiting_confirmation')
        self.assertEqual(self.h.sharepoint.items, {})
        text = self.h.summary_text()
        self.assertIn('DESCRITIVO DE PROVISÃO', text)
        self.assertIn('PROVISÃO ID 11', text)
        self.assertIn('PROVISÃO ID 12', text)
        self.assertIn('R$ 48,00', text)

    def test_legacy_child_selection_remains_legacy(self):
        del self.h.sharepoint.get_pending_provision_descriptions
        self.h.reply('OPA')
        self.h.open_supply_provision_action('BAIXAR PAGAMENTO AGENDADO')
        result = self.h.reply('370')
        self.assertEqual(result.get('field'), 'validar_qtd_baixa')

    def test_started_group_cannot_be_abandoned_or_have_attachments_removed(self):
        state = {'flow': 'payment_settlement', 'batch_id': 'fake', 'stage': 'error',
                 'processed_message_ids': [], 'provision_description': {'journal': {'intent': {'FORMAPGTO': 'Ficticia'}}}}
        self.assertTrue(self.h.engine._provision_attachments_locked(state))
        self.h.engine._save = lambda s, e: 'saved'
        result = self.h.engine._handle_frozen_provision({'kind': 'text', 'reply_id': 'navigation_main_menu',
                                                       'message_id': 'fictional-home'}, state, None)
        self.assertEqual(result['status'], 'provision_submission_locked')
        self.assertEqual(state['flow'], 'payment_settlement')

    def test_real_engine_commits_parent_first_then_each_child_and_reports_all_ids(self):
        self.use_real_memory_records()
        self.reach_group_confirmation()
        completed = self.h.reply('SIM')
        self.assertEqual(completed['status'], 'completed')
        self.assertEqual([int(item['item_id']) for item in self.h.sharepoint.update_calls], [7, 11, 12])
        for key in (7, 11, 12):
            fields = self.h.sharepoint.items[key]['fields']
            self.assertEqual(fields['PGTOAGENDADO'], None if key == 7 else 'PAGO')
            self.assertEqual(fields['OBS'], 'OBSERVACAO COMUM')
        text = str(self.h.messenger.sent)
        self.assertIn('DESCRITIVO DE PROVISÃO: ID 7', text)
        self.assertIn('IDS 11, 12', text)

    def test_real_engine_creates_separate_orders_and_launches_with_group_receipt_only_on_parent(self):
        self.use_real_memory_records()
        self.reach_group_confirmation(launch='1', attachments=True)
        completed = self.h.reply('SIM')
        self.assertEqual(completed['status'], 'completed')
        items = list(self.h.sharepoint.items.values())
        self.assertEqual(sum(item['target_list'] == 'NOTASPENDENTES' for item in items), 2)
        self.assertEqual(sum(item['target_list'] == 'LANCAMENTOS' for item in items), 2)
        self.assertEqual(set(self.h.sharepoint.items[7]['attachments']), {'recibo-ficticio.pdf'})
        self.assertEqual(self.h.sharepoint.items[11]['attachments'], {})
        self.assertEqual(self.h.sharepoint.items[12]['attachments'], {})

    def test_real_engine_partial_retry_does_not_create_duplicate_orders_or_launches(self):
        self.use_real_memory_records()
        self.reach_group_confirmation(launch='1')
        update = self.h.sharepoint.update_item_with_etag
        def fail_second(item_id, fields, etag, target_list=None):
            if int(item_id) == 12:
                self.h.sharepoint.update_item_with_etag = update
                raise RuntimeError('FALHA SINTETICA')
            return update(item_id, fields, etag, target_list=target_list)
        self.h.sharepoint.update_item_with_etag = fail_second
        result = self.h.reply('SIM')
        self.assertEqual(result['status'], 'submission_failed')
        count_before = len(self.h.sharepoint.items)
        result = self.h.reply(reply_id='error_retry')
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(len(self.h.sharepoint.items), count_before)
        self.assertEqual([int(item['item_id']) for item in self.h.sharepoint.update_calls], [7, 11, 12])
