"""Actual channel/workflow/optimistic store; only external data and media are fake."""
import copy
from datetime import datetime
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from zoneinfo import ZoneInfo

ROOT = Path(os.environ['PER_PAYMENT_SOURCE']).resolve()
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT), str(ROOT / 'tests')]
import test_workflow as fixtures
from channel_bridge import ChannelBridge, ChannelMessenger, normalize_channel_events, portal_channel_payload
from local_app import LocalStateStore


class PerPaymentTests(unittest.TestCase):
    def setUp(self):
        fixtures.WorkflowTests.setUp(self)
        self.config['limits']['inactivity_expiration_enabled'] = False
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = LocalStateStore(Path(self.directory.name))
        self.engine.state_store = self.state
        self.engine.messenger = self.messenger = ChannelMessenger()
        self.bridge = ChannelBridge.__new__(ChannelBridge)
        self.bridge.engine = self.engine
        self.bridge.messenger = self.messenger
        self.bridge.lock = threading.Lock()
        self.identity = {'oid': 'synthetic-payroll-per-payment', 'name': 'Teste isolado'}
        self.number = 0
        self.payloads = []
        incoming = normalize_channel_events(self.payload('seed', 'seed'))[0]
        self.key = fixtures.conversation_key(incoming)
        self.current = self.engine._new_state(incoming, self.key)
        self.current.update(flow='launch', fields={}, display_values={},
                            answers={'tipo_lancamento': 'LANÇAMENTO MÚLTIPLO'},
                            sharepoint={'item_id': 901}, attachments=[])
        month = datetime.now(ZoneInfo('America/Sao_Paulo')).strftime('%m/%Y')
        self.sheets = [self.sheet(31, 'FORNECEDOR TESTE A', month),
                       self.sheet(32, 'FORNECEDOR TESTE A', month),
                       self.sheet(41, 'FORNECEDOR TESTE B', month)]
        self.sharepoint.options_by_key['launch_payroll_sheets'] = copy.deepcopy(self.sheets)
        self.sharepoint.options_by_key['launch_payroll_all_supplier_sheets'] = copy.deepcopy(self.sheets)
        self.entries = [self.entry(901, 'FORNECEDOR TESTE A', '10', '2', '5'),
                        self.entry(902, 'FORNECEDOR TESTE A', '15', '2', '3'),
                        self.entry(903, 'FORNECEDOR TESTE B', '11', '3', '0')]
        # External read-only token lookup with the real SharePointClient signature.
        def find_item(token, target_list=None, idempotency_field=None):
            identifier = self.sharepoint.tokens.get(f"{target_list or 'DOCUMENTOS'}:{token}")
            return {'Id': identifier, 'Title': token} if identifier is not None else None
        self.sharepoint._find_item = find_item

    @staticmethod
    def sheet(identifier, supplier, month):
        return {'id': identifier, 'title': month, 'value': month,
                'source_values': {'Id': identifier, 'FORNECEDOR': supplier, 'MESREFERENCIA': month}}

    @staticmethod
    def entry(identifier, supplier, unit, quantity, freight):
        return {'item_id': identifier, 'supplier_source_values': {'EMPREITEIRO': 'SIM'},
                'fields': {'FORNECEDOR': supplier, 'PRODUTO': 'SERVIÇO TESTE',
                           'VALOR UNITÁRIO': unit, 'QUANTIDADE': quantity, 'FRETE': freight,
                           'DATA': '2026-10-08', 'FILIAL': 'FILIAL TESTE', 'ETAPA': 'ETAPA TESTE',
                           'CONTA': 'PIX', 'DESCRIÇÃO': 'Preservar a descrição', 'UN': 'UN'}}

    def payload(self, reply, message=None):
        self.number += 1
        return portal_channel_payload({'messageId': message or f'per-payment-{self.number}',
                                       'replyId': reply}, self.identity)

    def send(self, reply, message=None):
        result = self.bridge.handle(self.payload(reply, message))
        self.assertEqual(result['status'], 'processed', result)
        self.assertFalse(any('OCORREU UM ERRO' in m.get('text', '') for m in result['messages']), result)
        self.payloads.append(copy.deepcopy(result))
        return result['results'][0]

    def load(self):
        return self.state.load(self.key)

    def pending(self):
        return self.load()[0]['pending_launch_payroll']

    def start(self, identifiers=(901, 902)):
        self.engine._maybe_prompt_launch_payroll(self.current, None, self.entries)
        self.send('launch_payroll_yes')
        return self.send('launch_payroll_selected:' + ','.join(map(str, identifiers)))

    def choose(self, identifier):
        return self.send(self.option_reply(identifier))

    def option_reply(self, identifier):
        for packet in reversed(self.payloads):
            for message in reversed(packet['messages']):
                if message.get('type') != 'poll':
                    continue
                for option in message.get('options', []):
                    if str(option.get('reply', '')).endswith(':' + str(identifier)):
                        return option['reply']
                return str(identifier)
        return str(identifier)

    def rows(self):
        return sorted((row['fields'] for row in self.sharepoint.items.values()
                       if row['target_list'] == 'FOLHAPGTO'), key=lambda row: row['IDLANCAMENTO'])

    def assert_current_prompt(self, identifier, total):
        messages = self.payloads[-1]['messages']
        body = '\n'.join(message.get('text', '') or message.get('question', '') for message in messages)
        self.assertIn(str(identifier), body, messages)
        self.assertIn(total, body, messages)
        self.assertIn('FORNECEDOR TESTE', body, messages)
        self.assertEqual(self.load()[0]['stage'], 'selecting_launch_payroll_sheet')

    def test_prompt_identifies_first_payment_and_total_without_financial_writes(self):
        result = self.start()
        self.assertEqual(result['status'], 'awaiting_launch_payroll_sheet')
        self.assert_current_prompt(901, 'R$ 25,00')
        self.assertEqual(self.rows(), [])

    def test_sheet_answer_only_changes_current_payment_then_asks_for_same_supplier_next_line(self):
        self.start()
        result = self.choose(31)
        self.assertEqual(result['status'], 'awaiting_launch_payroll_sheet')
        self.assert_current_prompt(902, 'R$ 33,00')
        self.assertEqual([entry.get('IDFOLHA') for entry in self.pending()['selected_entries']], [31, None])
        self.assertEqual(self.rows(), [])

    def test_same_supplier_two_independent_sheets_are_persisted_on_the_correct_payments(self):
        self.start()
        self.choose(31)
        self.choose(32)
        first = self.send('launch_payroll_type_salary')
        self.assertEqual(first['status'], 'awaiting_launch_payroll_type')
        self.assertEqual(first['launch_id'], 902)
        last = self.send('launch_payroll_type_allowance')
        self.assertEqual(last['status'], 'completed')
        self.assertEqual([(row['IDLANCAMENTO'], row['IDFOLHA'], row['TIPOPGTO']) for row in self.rows()],
                         [(901, 31, 'SALÁRIO'), (902, 32, 'AJUDA DE CUSTO')])
        self.assertEqual([(row['VALORUNITARIO'], row['QTD']) for row in self.rows()], [('10', '2'), ('15', '2')])

    def test_each_payment_is_prompted_in_selection_order_across_suppliers(self):
        self.start((901, 902, 903))
        self.choose(31)
        self.assert_current_prompt(902, 'R$ 33,00')
        self.choose(32)
        self.assert_current_prompt(903, 'R$ 33,00')
        self.choose(41)
        for _ in range(3):
            self.send('launch_payroll_type_salary')
        self.assertEqual([(row['IDLANCAMENTO'], row['IDFOLHA']) for row in self.rows()],
                         [(901, 31), (902, 32), (903, 41)])

    def test_one_available_sheet_still_requires_an_answer_for_each_payment(self):
        self.sharepoint.options_by_key['launch_payroll_sheets'] = [self.sheets[0]]
        self.start()
        self.choose(31)
        self.assert_current_prompt(902, 'R$ 33,00')
        self.choose(31)
        self.send('launch_payroll_type_salary')
        self.send('launch_payroll_type_salary')
        self.assertEqual([(row['IDLANCAMENTO'], row['IDFOLHA']) for row in self.rows()], [(901, 31), (902, 31)])

    def test_unselected_and_noncontractor_entries_never_receive_a_sheet_or_payment(self):
        self.entries[1]['supplier_source_values']['EMPREITEIRO'] = 'NÃO'
        self.start((901, 903))
        self.choose(31)
        self.assert_current_prompt(903, 'R$ 33,00')
        self.choose(41)
        self.send('launch_payroll_type_salary')
        self.send('launch_payroll_type_salary')
        self.assertEqual([row['IDLANCAMENTO'] for row in self.rows()], [901, 903])

    def test_duplicate_sheet_message_does_not_advance_or_assign_the_next_payment(self):
        self.start()
        packet = self.payload(self.option_reply(31), 'repeat-sheet')
        first = self.bridge.handle(packet)
        self.assertEqual(first['results'][0]['status'], 'awaiting_launch_payroll_sheet')
        repeated = self.bridge.handle(packet)
        self.assertEqual(repeated['results'][0]['status'], 'duplicate')
        self.assertEqual([entry.get('IDFOLHA') for entry in self.pending()['selected_entries']], [31, None])
        self.assertEqual(self.rows(), [])

    def test_stale_previous_payment_button_with_new_message_id_cannot_bind_next_payment(self):
        self.start()
        old_reply = self.option_reply(31)
        self.choose(31)
        result = self.send(old_reply, 'late-old-button')
        self.assertEqual(result['status'], 'invalid_launch_payroll_sheet')
        self.assert_current_prompt(902, 'R$ 33,00')
        self.assertEqual([entry.get('IDFOLHA') for entry in self.pending()['selected_entries']], [31, None])
        self.assertEqual(self.rows(), [])

    def test_reloading_persisted_state_keeps_the_current_payment_and_previous_choice(self):
        self.start()
        self.choose(31)
        self.state = LocalStateStore(Path(self.directory.name))
        self.engine.state_store = self.state
        result = self.choose(32)
        self.assertEqual(result['status'], 'awaiting_launch_payroll_type')
        self.assertEqual([entry.get('IDFOLHA') for entry in self.pending()['selected_entries']], [31, 32])

    def test_invalid_or_other_supplier_sheet_does_not_bind_or_advance(self):
        self.start()
        self.assertEqual(self.choose(999)['status'], 'invalid_launch_payroll_sheet')
        state, etag = self.load()
        state['options'] = [copy.deepcopy(self.sheets[2])]
        self.state.save(self.key, state, etag)
        self.assertEqual(self.choose(41)['status'], 'invalid_launch_payroll_sheet')
        self.assert_current_prompt(901, 'R$ 25,00')
        self.assertEqual([entry.get('IDFOLHA') for entry in self.pending()['selected_entries']], [None, None])
        self.assertEqual(self.rows(), [])

    def test_sheet_lookup_failure_keeps_cursor_clears_stale_options_and_allows_retry(self):
        self.start((901, 903))
        original = self.sharepoint.get_options
        once = True
        def failing_lookup(step, context=None):
            nonlocal once
            if once and step['key'] == 'launch_payroll_sheets':
                once = False
                raise RuntimeError('Synthetic external lookup failure')
            return original(step, context)
        self.sharepoint.get_options = failing_lookup
        self.assertEqual(self.choose(31)['status'], 'launch_payroll_sheet_load_failed')
        self.assertEqual(self.load()[0]['options'], [])
        self.assertEqual([entry.get('IDFOLHA') for entry in self.pending()['selected_entries']], [31, None])
        self.assertEqual(self.send('retry lookup')['status'], 'invalid_launch_payroll_sheet')
        self.assert_current_prompt(903, 'R$ 33,00')
        self.choose(41)
        self.assertEqual(self.rows(), [])

    def test_supplier_without_sheet_is_skipped_without_binding_other_supplier_payments(self):
        self.sharepoint.options_by_key['launch_payroll_sheets'] = [self.sheets[2]]
        self.start((901, 902, 903))
        self.assert_current_prompt(903, 'R$ 33,00')
        self.choose(41)
        self.send('launch_payroll_type_salary')
        self.assertEqual([(row['IDLANCAMENTO'], row['IDFOLHA']) for row in self.rows()], [(903, 41)])

    def test_write_verification_failure_retries_same_sheet_and_does_not_duplicate_payment(self):
        self.start()
        self.choose(31)
        self.choose(32)
        original = self.sharepoint.verify_item
        once = True
        def failing_verify(*args, **kwargs):
            nonlocal once
            if once and kwargs.get('target_list') == 'FOLHAPGTO':
                once = False
                raise RuntimeError('Synthetic external verification failure')
            return original(*args, **kwargs)
        self.sharepoint.verify_item = failing_verify
        self.assertEqual(self.send('launch_payroll_type_salary')['status'], 'awaiting_launch_payroll_type')
        self.assertEqual(len(self.rows()), 1)
        self.send('launch_payroll_type_salary')
        self.send('launch_payroll_type_allowance')
        self.assertEqual([(row['IDLANCAMENTO'], row['IDFOLHA']) for row in self.rows()], [(901, 31), (902, 32)])

    def legacy(self, stage, posted=False):
        self.start()
        state, etag = self.load()
        pending = state['pending_launch_payroll']
        pending.pop('sheet_entry_index', None)
        pending.pop('current_sheet_launch_id', None)
        pending.update(sheet_suppliers=['FORNECEDOR TESTE A'], sheet_supplier_index=0,
                       current_sheet_supplier='FORNECEDOR TESTE A', type_index=1 if posted else 0)
        for entry in pending['selected_entries']:
            entry['IDFOLHA'] = 31
        if posted:
            fields = {'FORNECEDOR': 'FORNECEDOR TESTE A', 'TIPOPGTO': 'SALÁRIO',
                      'VALORUNITARIO': '10', 'QTD': '2', 'DATA': '2026-10-08', 'IDFOLHA': 31, 'IDLANCAMENTO': 901}
            identifier = self.sharepoint.ensure_item('legacy-posted', fields, target_list='FOLHAPGTO')
            pending['selected_entries'][0]['FOLHAPGTO_ID'] = identifier
            state['sharepoint']['folhapgto_rows'] = [{'item_id': identifier, 'launch_item_id': 901,
                                                   'fields': fields, 'verified': {'fields': True}}]
        state['stage'] = stage
        self.state.save(self.key, state, etag)

    def test_legacy_group_sheet_question_is_reissued_per_payment_without_using_old_bulk_answer(self):
        self.legacy('selecting_launch_payroll_sheet')
        result = self.choose(31)
        self.assertEqual(result['status'], 'awaiting_launch_payroll_sheet')
        self.assert_current_prompt(901, 'R$ 25,00')
        self.assertEqual([entry.get('IDFOLHA') for entry in self.pending()['selected_entries']], [None, None])
        self.choose(31)
        self.assert_current_prompt(902, 'R$ 33,00')

    def test_legacy_type_stage_reasks_unposted_payment_sheet_and_preserves_verified_payment(self):
        self.legacy('selecting_launch_payroll_type', posted=True)
        result = self.send('launch_payroll_type_allowance')
        self.assertEqual(result['status'], 'awaiting_launch_payroll_sheet')
        self.assert_current_prompt(902, 'R$ 33,00')
        self.assertEqual([(row['IDLANCAMENTO'], row['IDFOLHA']) for row in self.rows()], [(901, 31)])
        self.choose(32)
        self.send('launch_payroll_type_allowance')
        self.assertEqual([(row['IDLANCAMENTO'], row['IDFOLHA']) for row in self.rows()], [(901, 31), (902, 32)])

    def uncertain_legacy_payment(self):
        self.legacy('selecting_launch_payroll_type')
        state, _ = self.load()
        fields = {'FORNECEDOR': 'FORNECEDOR TESTE A', 'TIPOPGTO': 'SALÁRIO',
                  'VALORUNITARIO': '10', 'QTD': '2', 'DATA': '2026-10-08', 'IDFOLHA': 31, 'IDLANCAMENTO': 901}
        token = f"WA-launch-payroll-{state['batch_id']}-901"
        identifier = self.sharepoint.ensure_item(token, fields, target_list='FOLHAPGTO',
                                                idempotency_field='Title', merge_existing=False)
        return identifier

    def test_uncertain_legacy_write_is_verified_read_only_and_next_payment_can_choose_another_sheet(self):
        identifier = self.uncertain_legacy_payment()
        original_rows = copy.deepcopy(self.rows())
        result = self.send('launch_payroll_type_salary')
        self.assertEqual(result['status'], 'awaiting_launch_payroll_sheet')
        self.assert_current_prompt(902, 'R$ 33,00')
        self.assertEqual(self.rows(), original_rows)
        self.assertEqual(self.pending()['selected_entries'][0]['FOLHAPGTO_ID'], identifier)
        self.choose(32)
        result = self.send('launch_payroll_type_allowance')
        self.assertEqual(result['status'], 'completed')
        self.assertEqual([(row['IDLANCAMENTO'], row['IDFOLHA']) for row in self.rows()], [(901, 31), (902, 32)])
        self.assertEqual(len(self.load()[0]['sharepoint']['folhapgto_rows']), 2)

    def test_failed_legacy_reconciliation_keeps_original_sheet_and_can_retry_without_writes(self):
        self.uncertain_legacy_payment()
        original = self.sharepoint._find_item
        self.sharepoint._find_item = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('Read failure'))
        self.assertEqual(self.send('launch_payroll_type_salary')['status'], 'launch_payroll_reconciliation_failed')
        self.assertNotIn('sheet_entry_index', self.pending())
        self.assertEqual([entry.get('IDFOLHA') for entry in self.pending()['selected_entries']], [31, 31])
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.load()[0]['options'], [])
        self.sharepoint._find_item = original
        self.send('retry reconciliation')
        self.assert_current_prompt(902, 'R$ 33,00')
        self.assertEqual(len(self.rows()), 1)

    def test_conflicting_legacy_existing_row_is_not_relinked_or_checkpointed(self):
        identifier = self.uncertain_legacy_payment()
        self.sharepoint.items[identifier]['fields']['IDFOLHA'] = 32
        self.assertEqual(self.send('launch_payroll_type_salary')['status'], 'launch_payroll_reconciliation_failed')
        self.assertNotIn('FOLHAPGTO_ID', self.pending()['selected_entries'][0])
        self.assertEqual([entry.get('IDFOLHA') for entry in self.pending()['selected_entries']], [31, 31])
        self.assertEqual(self.rows()[0]['IDFOLHA'], 32)
        self.assertEqual(len(self.rows()), 1)

    def test_legacy_reconciliation_verification_failure_retries_then_preserves_payment(self):
        self.uncertain_legacy_payment()
        original = self.sharepoint.verify_item
        self.sharepoint.verify_item = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('Verify failure'))
        self.assertEqual(self.send('launch_payroll_type_salary')['status'], 'launch_payroll_reconciliation_failed')
        self.assertNotIn('sheet_entry_index', self.pending())
        self.assertEqual([entry.get('IDFOLHA') for entry in self.pending()['selected_entries']], [31, 31])
        self.sharepoint.verify_item = original
        self.send('retry reconciliation')
        self.assert_current_prompt(902, 'R$ 33,00')
        self.assertEqual(len(self.rows()), 1)

    def test_single_launch_still_asks_one_sheet_and_creates_one_verified_payment(self):
        self.engine._maybe_prompt_launch_payroll(self.current, None, self.entries[:1])
        self.assertEqual(self.send('launch_payroll_yes')['status'], 'awaiting_launch_payroll_sheet')
        self.choose(31)
        self.assertEqual(self.send('launch_payroll_type_salary')['status'], 'completed')
        self.assertEqual([(row['IDLANCAMENTO'], row['IDFOLHA']) for row in self.rows()], [(901, 31)])


if __name__ == '__main__':
    unittest.main(verbosity=2)
