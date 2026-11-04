"""Real shared workflow/channel/state with synthetic SharePoint records only."""
import copy
from datetime import datetime
from zoneinfo import ZoneInfo
import test_settlement_payroll as fixture


class BatchAssignmentTests(fixture.SettlementPayrollTests):
    def begin(self, settlement=True, ids=None):
        if settlement:
            self.settlement(multi=True)
            ids = ids or (11, 12, 13)
        else:
            self.engine._maybe_prompt_launch_payroll(self.current, None, self.entries)
            ids = ids or (901, 902, 903)
        self.send('launch_payroll_yes')
        return self.send('launch_payroll_selected:' + ','.join(map(str, ids)))

    def unique_sheets(self):
        self.sharepoint.options_by_key['launch_payroll_sheets'] = [self.sheets[0], self.sheets[2]]

    def sheet_mode(self, mode):
        return self.send('launch_payroll_sheet_mode_' + mode)

    def type_mode(self, mode):
        return self.send('launch_payroll_type_mode_' + mode)

    def month(self, offset=0):
        return self.send('choice:launch_payroll_shared_month:' + str(offset))

    def assignments(self):
        return [entry.get('IDFOLHA') for entry in self.pending()['selected_entries']]

    def test_mode_precedes_first_sheet_and_no_financial_write(self):
        self.assertEqual(self.begin()['status'], 'awaiting_launch_payroll_sheet_mode')
        self.assertFalse(self.rows())
        self.assertEqual(self.assignments(), [None, None, None])

    def test_individual_sheets_and_individual_types_keep_distinct_values(self):
        self.begin()
        self.assertEqual(self.sheet_mode('individual')['status'], 'awaiting_launch_payroll_sheet')
        self.choose(31)
        self.choose(32)
        self.assertEqual(self.choose(41)['status'], 'awaiting_launch_payroll_type_mode')
        self.type_mode('individual')
        self.send('launch_payroll_type_salary')
        self.send('launch_payroll_type_allowance')
        self.assertEqual(self.send('launch_payroll_type_meal')['status'], 'completed')
        self.assertEqual([(r['IDPROVISAO'], r['IDFOLHA'], r['TIPOPGTO']) for r in self.rows()],
                         [(11, 31, 'SALÁRIO'), (12, 32, 'AJUDA DE CUSTO'), (13, 41, 'VALE REFEIÇÃO')])

    def test_shared_current_month_resolves_each_supplier_own_id(self):
        self.unique_sheets()
        self.begin()
        self.assertEqual(self.sheet_mode('shared')['status'], 'awaiting_launch_payroll_shared_month')
        self.assertEqual(self.month()['status'], 'awaiting_launch_payroll_type_mode')
        self.assertEqual(self.assignments(), [31, 31, 41])
        self.assertFalse(self.rows())
        self.type_mode('shared')
        self.assertEqual(self.send('launch_payroll_type_salary')['status'], 'completed')
        self.assertEqual([(r['IDFOLHA'], r['TIPOPGTO']) for r in self.rows()],
                         [(31, 'SALÁRIO'), (31, 'SALÁRIO'), (41, 'SALÁRIO')])

    def test_previous_and_next_month_resolve_separately(self):
        for offset, month in ((-1, '12/2025'), (1, '02/2026')):
            with self.subTest(offset=offset):
                self.setUp()
                import workflow
                real_datetime = workflow.datetime
                class January(datetime):
                    @classmethod
                    def now(cls, tz=None):
                        return cls(2026, 1, 15, 12, tzinfo=tz)
                workflow.datetime = January
                try:
                    self.sharepoint.options_by_key['launch_payroll_sheets'] = [
                        self.sheet(51, 'FORNECEDOR TESTE A', month),
                        self.sheet(61, 'FORNECEDOR TESTE B', month)]
                    self.begin()
                    self.sheet_mode('shared')
                    self.month(offset)
                    self.assertEqual(self.assignments(), [51, 51, 61])
                finally:
                    workflow.datetime = real_datetime

    def test_ambiguous_month_asks_only_unresolved_payments_individually(self):
        self.begin()
        self.sheet_mode('shared')
        self.assertEqual(self.month()['status'], 'awaiting_launch_payroll_sheet')
        self.assertEqual(self.assignments(), [None, None, 41])
        self.choose(31)
        self.assertEqual(self.choose(32)['status'], 'awaiting_launch_payroll_type_mode')
        self.assertEqual(self.assignments(), [31, 32, 41])

    def test_missing_selected_month_never_uses_other_month_or_supplier(self):
        self.unique_sheets()
        today = datetime.now(ZoneInfo('America/Sao_Paulo'))
        previous = self.engine._shift_launch_payroll_month((today.year, today.month), -1)
        self.sharepoint.options_by_key['launch_payroll_sheets'] = [self.sheets[0],
            self.sheet(42, 'FORNECEDOR TESTE B', f'{previous[1]:02d}/{previous[0]}')]
        self.begin()
        self.sheet_mode('shared')
        self.assertEqual(self.month()['status'], 'awaiting_launch_payroll_sheet')
        self.assertEqual(self.assignments(), [31, 31, None])
        self.assertEqual(self.choose(42)['status'], 'awaiting_launch_payroll_type_mode')
        self.assertEqual(self.assignments(), [31, 31, 42])

    def test_sheet_read_failure_keeps_month_for_retry_without_partial_assignment(self):
        self.unique_sheets()
        self.begin()
        self.sheet_mode('shared')
        original = self.sharepoint.get_options
        def fail(step, ctx=None):
            if step.get('key') == 'launch_payroll_sheets':
                raise RuntimeError('synthetic read outage')
            return original(step, ctx)
        self.sharepoint.get_options = fail
        self.assertEqual(self.month()['status'], 'launch_payroll_shared_month_load_failed')
        self.assertEqual(self.assignments(), [None, None, None])
        self.sharepoint.get_options = original
        self.assertEqual(self.month()['status'], 'awaiting_launch_payroll_type_mode')
        self.assertEqual(self.assignments(), [31, 31, 41])

    def test_single_payment_skips_both_mode_questions(self):
        self.settlement()
        self.assertEqual(self.send('launch_payroll_yes')['status'], 'awaiting_launch_payroll_sheet')
        self.assertEqual(self.choose(31)['status'], 'awaiting_launch_payroll_type')
        self.assertEqual(self.send('launch_payroll_type_salary')['status'], 'completed')
        self.assertEqual(len(self.rows()), 1)

    def test_individual_sheets_can_use_one_shared_payment_type(self):
        self.begin()
        self.sheet_mode('individual')
        for sheet in (31, 32, 41):
            self.choose(sheet)
        self.type_mode('shared')
        self.send('launch_payroll_type_allowance')
        self.assertEqual([r['TIPOPGTO'] for r in self.rows()], ['AJUDA DE CUSTO'] * 3)

    def test_shared_sheets_can_use_individual_payment_types(self):
        self.unique_sheets()
        self.begin()
        self.sheet_mode('shared')
        self.month()
        self.type_mode('individual')
        for kind in ('salary', 'allowance', 'meal'):
            self.send('launch_payroll_type_' + kind)
        self.assertEqual([r['TIPOPGTO'] for r in self.rows()], ['SALÁRIO', 'AJUDA DE CUSTO', 'VALE REFEIÇÃO'])

    def test_duplicate_month_reply_does_not_answer_type_mode(self):
        self.unique_sheets()
        self.begin()
        self.sheet_mode('shared')
        self.send('choice:launch_payroll_shared_month:0', message='same-month')
        self.send('choice:launch_payroll_shared_month:0', message='same-month')
        self.assertFalse(self.rows())
        self.assertEqual(self.load()[0]['stage'], 'selecting_launch_payroll_type')

    def test_invalid_and_stale_controls_cannot_select_modes_or_assign(self):
        self.begin()
        self.send('launch_payroll_type_mode_shared')
        self.assertEqual(self.assignments(), [None, None, None])
        self.sheet_mode('shared')
        self.send('choice:launch_payroll_sheet_11:31')
        self.assertEqual(self.assignments(), [None, None, None])
        self.send('choice:launch_payroll_shared_month:99')
        self.assertEqual(self.assignments(), [None, None, None])
        self.assertFalse(self.rows())

    def test_mid_draft_preserves_answered_sheet_and_only_assigns_remaining(self):
        self.begin()
        self.sheet_mode('individual')
        self.choose(32)
        state, etag = self.load()
        state['pending_launch_payroll'].pop('sheet_assignment_mode', None)
        self.engine._save(state, etag)
        self.send('old response')
        self.assertEqual(self.assignments(), [32, None, None])
        self.unique_sheets()
        self.sheet_mode('shared')
        self.month()
        self.assertEqual(self.assignments(), [32, 31, 41])

    def test_batch_retry_preserves_type_and_verified_rows_without_duplicates(self):
        self.unique_sheets()
        self.begin()
        self.sheet_mode('shared')
        self.month()
        self.type_mode('shared')
        original = self.sharepoint.verify_item
        failures = [True]
        def verify(identifier, fields, attachments, **kwargs):
            if fields.get('IDPROVISAO') == 12 and failures[0]:
                failures[0] = False
                return {'fields': False, 'attachments': True}
            return original(identifier, fields, attachments, **kwargs)
        self.sharepoint.verify_item = verify
        self.send('launch_payroll_type_salary')
        self.assertEqual(len(self.rows()), 2)
        self.assertTrue(self.pending()['selected_entries'][0].get('FOLHAPGTO_ID'))
        self.assertFalse(self.pending()['selected_entries'][1].get('FOLHAPGTO_ID'))
        self.send('launch_payroll_type_allowance')
        self.assertEqual(len(self.rows()), 2)
        self.assertEqual(self.send('launch_payroll_type_retry')['status'], 'completed')
        self.assertEqual([r['TIPOPGTO'] for r in self.rows()], ['SALÁRIO'] * 3)

    def test_multi_launch_uses_same_mode_choices(self):
        self.unique_sheets()
        self.assertEqual(self.begin(settlement=False)['status'], 'awaiting_launch_payroll_sheet_mode')
        self.sheet_mode('shared')
        self.month()
        self.type_mode('shared')
        self.assertEqual(self.send('launch_payroll_type_transport')['status'], 'completed')
        self.assertEqual([(r['IDLANCAMENTO'], r['IDFOLHA']) for r in self.rows()], [(901, 31), (902, 31), (903, 41)])

    def test_verified_payment_keeps_original_sheet_and_type(self):
        self.begin()
        self.sheet_mode('individual')
        for sheet in (32, 31, 41):
            self.choose(sheet)
        self.type_mode('individual')
        self.send('launch_payroll_type_allowance')
        state, etag = self.load()
        pending = state['pending_launch_payroll']
        pending.pop('type_assignment_mode', None)
        self.engine._save(state, etag)
        self.send('late old type')
        self.type_mode('shared')
        self.send('launch_payroll_type_salary')
        self.assertEqual([(r['IDFOLHA'], r['TIPOPGTO']) for r in self.rows()],
                         [(32, 'AJUDA DE CUSTO'), (31, 'SALÁRIO'), (41, 'SALÁRIO')])

    def test_no_supplier_sheets_skips_only_unavailable_supplier(self):
        self.sharepoint.options_by_key['launch_payroll_sheets'] = [self.sheets[0]]
        self.sharepoint.options_by_key['launch_payroll_all_supplier_sheets'] = [self.sheets[0]]
        self.begin()
        self.sheet_mode('shared')
        self.assertEqual(self.month()['status'], 'awaiting_launch_payroll_type_mode')
        self.assertEqual(self.assignments(), [31, 31])
        self.type_mode('shared')
        self.send('launch_payroll_type_salary')
        self.assertEqual([r['IDPROVISAO'] for r in self.rows()], [11, 12])

    def test_duplicate_type_reply_cannot_create_duplicate_payments(self):
        self.unique_sheets()
        self.begin()
        self.sheet_mode('shared')
        self.month()
        self.type_mode('shared')
        self.send('launch_payroll_type_salary', message='one-batch-type')
        self.send('launch_payroll_type_salary', message='one-batch-type')
        self.assertEqual(len(self.rows()), 3)

    def test_replay_resumes_mode_and_shared_month_without_writing(self):
        self.begin()
        state, etag = self.load()
        self.engine._retry_after_error(state, etag)
        self.sheet_mode('shared')
        state, etag = self.load()
        before = copy.deepcopy(state['pending_launch_payroll']['shared_month_options'])
        self.engine._retry_after_error(state, etag)
        self.assertEqual(self.pending()['shared_month_options'], before)
        self.assertFalse(self.rows())

    def test_individual_delayed_sheet_button_never_answers_next_line(self):
        self.begin()
        self.sheet_mode('individual')
        old = self.option_reply(31)
        self.choose(31)
        self.send(old)
        self.assertEqual(self.assignments(), [31, None, None])

    def test_shared_type_is_durable_before_first_external_write(self):
        self.unique_sheets()
        self.begin()
        self.sheet_mode('shared')
        self.month()
        self.type_mode('shared')
        original = self.sharepoint.ensure_item
        class ProcessStopped(BaseException):
            pass
        def stop(*args, **kwargs):
            raise ProcessStopped()
        self.sharepoint.ensure_item = stop
        with self.assertRaises(ProcessStopped):
            self.send('launch_payroll_type_salary')
        self.assertEqual(self.pending().get('shared_type'), 'SALÁRIO')
        self.sharepoint.ensure_item = original
        self.assertEqual(self.send('launch_payroll_type_retry')['status'], 'completed')
        self.assertEqual([r['TIPOPGTO'] for r in self.rows()], ['SALÁRIO'] * 3)

    def test_shared_launch_verification_failure_requires_retry(self):
        self.unique_sheets()
        self.begin(settlement=False)
        self.sheet_mode('shared')
        self.month()
        self.type_mode('shared')
        original = self.sharepoint.verify_item
        self.sharepoint.verify_item = lambda *args, **kwargs: {'fields': False, 'attachments': True}
        self.assertEqual(self.send('launch_payroll_type_salary')['status'], 'awaiting_launch_payroll_type_retry')
        self.assertFalse(self.pending()['selected_entries'][0].get('FOLHAPGTO_ID'))
        self.sharepoint.verify_item = original
        self.assertEqual(self.send('launch_payroll_type_retry')['status'], 'completed')
        self.assertEqual(len(self.rows()), 3)

    def test_individual_type_buttons_are_scoped_to_payment(self):
        self.unique_sheets()
        self.begin()
        self.sheet_mode('shared')
        self.month()
        self.type_mode('individual')
        salary = next(option['reply'] for message in self.payloads[-1]['messages']
                      for option in message.get('options', []) if option.get('label') == 'SALÁRIO')
        self.send(salary)
        self.send(salary)
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.pending()['type_index'], 1)

    def test_month_displayed_before_rollover_keeps_exact_reference(self):
        import workflow
        real_datetime = workflow.datetime
        class Boundary(datetime):
            month = 1
            @classmethod
            def now(cls, tz=None):
                return cls(2026, cls.month, 1, 12, tzinfo=tz)
        workflow.datetime = Boundary
        try:
            self.sharepoint.options_by_key['launch_payroll_sheets'] = [
                self.sheet(71, 'FORNECEDOR TESTE A', '12/2025'),
                self.sheet(81, 'FORNECEDOR TESTE B', '12/2025')]
            self.begin()
            self.sheet_mode('shared')
            Boundary.month = 2
            self.month(-1)
            pending = self.load()[0].get('pending_launch_payroll') or {}
            self.assertEqual([entry.get('IDFOLHA') for entry in pending.get('selected_entries', [])], [71, 71, 81])
        finally:
            workflow.datetime = real_datetime
