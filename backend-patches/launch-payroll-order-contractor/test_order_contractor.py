"""Regression cases for the shared backend, using the production workflow code."""
import copy
from contextlib import ExitStack, nullcontext
from datetime import datetime
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

from workflow import WorkflowEngine


class OrderContractorTests(unittest.TestCase):
    def setUp(self):
        engine = WorkflowEngine.__new__(WorkflowEngine)
        self.engine = engine
        self.state = {'flow': 'launch', 'batch_id': 'test', 'sharepoint': {}}
        self.rows = []
        self.polls = []
        self.engine._save = lambda state, etag: 'checkpoint'
        self.engine._send_text = lambda *_: None
        self.engine._send_options = lambda state, step, options: self.polls.append((step, options))
        self.engine._send_actions = lambda state, prompt, options, **kwargs: self.polls.append((prompt, options))
        self.engine._continue_launch_after_payroll = lambda state, etag: {'status': 'completed'}
        self.engine._launch_payroll_supplier_contractor = lambda name, **kwargs: name == 'EMPREITEIRO A'
        self.engine.sharepoint = self
        self.engine._record_launch_payroll_type = self.record
        self.engine._mark_processed = lambda state, message: state.setdefault('processed_message_ids', []).append(message)
        self.entries = [self.entry(101, 'EMPREITEIRO A', 'SIM'),
                        self.entry(102, 'LOJA B', 'NÃO'),
                        self.entry(103, 'OUTRO EMPREITEIRO', 'SIM')]

    @staticmethod
    def entry(identifier, supplier, contractor, order='55'):
        return {'item_id': identifier, 'supplier_source_values': {'EMPREITEIRO': contractor},
                'fields': {'AGRUPAR': order, 'FORNECEDOR': supplier, 'PRODUTO': 'MATERIAL',
                           'VALOR UNITÁRIO': '12', 'QUANTIDADE': '1', 'DATA': '2026-11-27'}}

    def get_item_fields(self, identifier, fields, target):
        assert identifier == 55 and fields == ['FORNECEDOR'] and target == 'NOTASPENDENTES'
        return {'FORNECEDOR': 'EMPREITEIRO A'}

    def record(self, state, entry, payment_type):
        self.rows.append((entry['item_id'], entry.get('payroll_supplier') or entry['supplier'],
                          entry['IDFOLHA'], payment_type))
        entry['FOLHAPGTO_ID'] = 1000 + entry['item_id']

    def choose(self, reply, method):
        return method({'reply_id': reply, 'message_id': reply}, self.state, 'checkpoint')

    def assign_month(self, ids):
        today = datetime.now(ZoneInfo('America/Sao_Paulo')).date()
        def sheets(supplier, *, month_key=None):
            if supplier != 'EMPREITEIRO A':
                raise AssertionError(supplier)
            return [{'id': 81, 'value': '81', 'source_values': {
                'Id': 81, 'FORNECEDOR': supplier, 'MESREFERENCIA': f'{today:%m/%Y}'}}]
        self.engine._launch_payroll_sheets_for_supplier = sheets
        self.choose('launch_payroll_selected:' + ids, self.engine._handle_launch_payroll_entries_reply)
        self.choose('launch_payroll_sheet_mode_shared', self.engine._handle_launch_payroll_sheet_reply)
        return self.choose('choice:launch_payroll_shared_month:0', self.engine._handle_launch_payroll_sheet_reply)

    def test_selected_foreign_row_uses_order_sheet_and_unselected_row_is_untouched(self):
        self.engine._maybe_prompt_launch_payroll(self.state, None, self.entries)
        _, options = self.polls[-1]
        self.assertFalse(any(option.get('disabled') for option in options))
        self.assertIn('AJUDA DE CUSTO', options[1]['title'])
        result = self.assign_month('101,102')
        self.assertEqual(result['status'], 'awaiting_launch_payroll_type')
        self.assertEqual(self.rows, [(102, 'EMPREITEIRO A', 81, 'AJUDA DE CUSTO')])
        self.engine._apply_launch_payroll_type(self.state, 'checkpoint', 'SALÁRIO')
        self.assertEqual(self.rows, [(102, 'EMPREITEIRO A', 81, 'AJUDA DE CUSTO'),
                                     (101, 'EMPREITEIRO A', 81, 'SALÁRIO')])
        self.assertEqual(self.entries[1]['fields']['FORNECEDOR'], 'LOJA B')

    def test_single_foreign_row_requires_checkbox_consent(self):
        result = self.engine._maybe_prompt_launch_payroll(self.state, None, self.entries[1:2])
        self.assertEqual(result['status'], 'awaiting_launch_payroll_selection')
        self.choose('launch_payroll_selected:', self.engine._handle_launch_payroll_entries_reply)
        self.assertEqual(self.rows, [])

    def test_other_contractor_also_defaults_to_allowance_on_order_contractors_sheet(self):
        self.engine._maybe_prompt_launch_payroll(self.state, None, self.entries)
        self.assertEqual(self.assign_month('102,103')['status'], 'completed')
        self.assertEqual(self.rows, [(102, 'EMPREITEIRO A', 81, 'AJUDA DE CUSTO'),
                                     (103, 'EMPREITEIRO A', 81, 'AJUDA DE CUSTO')])

    def test_batch_without_contractor_order_preserves_eligibility(self):
        self.get_item_fields = lambda *_: {'FORNECEDOR': 'LOJA B'}
        self.engine._maybe_prompt_launch_payroll(self.state, None, self.entries)
        _, options = self.polls[-1]
        self.assertTrue(options[1]['disabled'])
        self.assertFalse(options[2].get('disabled'))
        self.assertEqual(self.choose('launch_payroll_selected:102',
                                    self.engine._handle_launch_payroll_entries_reply)['status'],
                         'invalid_launch_payroll_selection')

    def test_failed_automatic_write_checkpoints_progress_and_needs_explicit_retry(self):
        self.engine._maybe_prompt_launch_payroll(self.state, None, self.entries)
        attempts = []
        def record(state, entry, payment_type):
            attempts.append(entry['item_id'])
            if attempts == [102, 103]:
                raise RuntimeError('uncertain write')
            self.record(state, entry, payment_type)
        self.engine._record_launch_payroll_type = record
        result = self.assign_month('102,103')
        self.assertEqual(result['status'], 'awaiting_launch_payroll_allowance_retry')
        self.engine._prompt_launch_payroll_type(self.state, 'checkpoint')
        self.assertEqual(attempts, [102, 103])
        result = self.choose('launch_payroll_allowance_retry', self.engine._handle_launch_payroll_type_reply)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(attempts, [102, 103, 103])

    def test_resumed_selection_gains_new_options_without_marking_them(self):
        entries = [{'item_id': item['item_id'], 'fields': copy.deepcopy(item['fields']),
                    'supplier': item['fields']['FORNECEDOR'], 'eligible': index != 1}
                   for index, item in enumerate(self.entries)]
        self.state['pending_launch_payroll'] = {
            'entries': entries, 'eligible_ids': ['101', '103'], 'launch_item_ids': [101,102,103]}
        self.engine._send_launch_payroll_entry_selection(self.state, 'checkpoint')
        _, options = self.polls[-1]
        self.assertFalse(options[1].get('disabled'))
        self.choose('launch_payroll_selected:', self.engine._handle_launch_payroll_entries_reply)
        self.assertEqual(self.rows, [])

    def test_persisted_supplier_matches_sheet_and_source_stays_intact(self):
        entry = self.entry(102, 'LOJA B', 'NÃO')
        entry.update(supplier='LOJA B', payroll_supplier='EMPREITEIRO A', IDFOLHA=81)
        self.ensure_item = lambda token, fields, **kwargs: 701
        self.verify_item = lambda *args, **kwargs: {'fields': True, 'attachments': True}
        with ExitStack() as mocks:
            mocks.enter_context(patch('payroll_pending.legacy_origin_write', return_value=nullcontext()))
            attachments = mocks.enter_context(patch('workflow.copy_launch_to_payroll', return_value=['receipt.pdf']))
            WorkflowEngine._record_launch_payroll_type(self.engine, self.state, entry, 'AJUDA DE CUSTO')
        receipt = self.state['sharepoint']['folhapgto_rows'][0]
        self.assertEqual(receipt['fields']['FORNECEDOR'], 'EMPREITEIRO A')
        self.assertEqual(receipt['fields']['IDFOLHA'], 81)
        self.assertEqual(receipt['fields']['IDLANCAMENTO'], 102)
        self.assertEqual(attachments.call_args.args[-1]['FORNECEDOR'], 'LOJA B')
        self.assertEqual(receipt['attachments'], ['receipt.pdf'])

    def test_attachment_guard_accepts_original_supplier_and_order_contractor(self):
        from payroll_row_attachments import copy_launch_to_payroll

        source = {'FORNECEDOR': 'LOJA B', 'FILIAL': 'OBRA A'}
        expected = {'IDLANCAMENTO': 102, 'FORNECEDOR': 'EMPREITEIRO A'}
        class Client:
            def get_item_fields_with_etag(self, *_args, **_kwargs):
                return source, 'etag'
            def verify_item(self, *_args, **_kwargs):
                return True
        with patch('payroll_row_attachments.SharePointStore') as store:
            store.return_value.names.return_value = []
            self.assertEqual(copy_launch_to_payroll(Client(), 102, 81, expected, source), [])
            with self.assertRaises(RuntimeError):
                copy_launch_to_payroll(Client(), 102, 81, expected, {**source, 'FORNECEDOR': 'LOJA C'})


if __name__ == '__main__':
    unittest.main()
