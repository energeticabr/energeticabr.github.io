"""Real workflow, channel and durable state; synthetic financial records only."""
import copy
import os
from pathlib import Path
import sys
import unittest

PATCHES = Path(__file__).resolve().parent.parent
SOURCE = Path(os.environ['PER_PAYMENT_SOURCE']).resolve()
sys.path[:0] = [str(SOURCE / 'worker'), str(SOURCE), str(SOURCE / 'tests')]
sys.path[:0] = [str(PATCHES / folder) for folder in (
    'launch-payroll-attachments/tests', 'payroll-batch-assignment/tests',
    'provision-contractor-payroll/tests', 'launch-payroll-per-payment')]
import test_channel as fixture


class DirectLinkTests(fixture.Integration):
    def setUp(self):
        super().setUp()
        self.sharepoint.options_by_key['launch_payroll_types'] = [
            {'id': 1, 'title': 'SALÁRIO', 'value': 'SALÁRIO'},
            {'id': 2, 'title': 'AJUDA DE CUSTO', 'value': 'AJUDA DE CUSTO'},
            {'id': 3, 'title': 'VALE REFEIÇÃO', 'value': 'VALE REFEIÇÃO'},
            {'id': 4, 'title': 'VALE TRANSPORTE', 'value': 'VALE TRANSPORTE'}]
        request = self.sharepoint._request
        def financial_request(method, endpoint, **kwargs):
            if endpoint == 'lists/FOLHAPGTO/fields':
                from payroll_pending import PAYROLL_FIELDS
                return {'value': [{'InternalName': 'Id' if f == 'ID' else f,
                    'Title': f, 'TypeAsString': 'Text', 'Indexed': True}
                    for f in ('ID', *PAYROLL_FIELDS)]}
            if endpoint == 'lists/FOLHAPGTO/items':
                import re
                query = (kwargs.get('params') or {}).get('$filter', '')
                origin = re.search(r"IDLANCAMENTO eq '([0-9]+)'", query)
                rows = []
                for identifier, row in self.sharepoint.items.items():
                    if row['target_list'] != 'FOLHAPGTO':
                        continue
                    if origin and str(row['fields'].get('IDLANCAMENTO')) != origin[1]:
                        continue
                    token = next(k.split(':', 1)[1] for k, v in self.sharepoint.tokens.items()
                                 if v == identifier and k.startswith('FOLHAPGTO:'))
                    rows.append({'Id': identifier, 'Title': token, **row['fields']})
                return {'value': rows}
            return request(method, endpoint, **kwargs)
        self.sharepoint._request = financial_request

    def begin(self, settlement=True, ids=None):
        if settlement:
            self.settlement(multi=True)
            ids = ids or (11, 12, 13)
        else:
            self.engine._maybe_prompt_launch_payroll(self.current, None, self.entries)
            ids = ids or (901, 902, 903)
        return self.send('launch_payroll_selected:' + ','.join(map(str, ids)))

    def open_single(self):
        result = self.engine._maybe_prompt_launch_payroll(self.current, None, self.entries[:1])
        messages = self.messenger.drain()
        self.payloads.append({'messages': copy.deepcopy(messages)})
        return result, messages

    def choices(self, messages):
        return [o for m in messages if m.get('type') == 'poll' for o in m.get('options', [])]

    def test_saved_launch_opens_sheet_directly_and_decline_is_after_months(self):
        result, messages = self.open_single()
        self.assertEqual(result['status'], 'awaiting_launch_payroll_sheet')
        choices = self.choices(messages)
        decline = next(o for o in choices if o['reply'] == 'launch_payroll_no')
        self.assertEqual(decline['label'], '❌ NÃO ADICIONAR A FOLHA DE PAGAMENTO')
        self.assertLess(next(i for i, o in enumerate(choices) if o['reply'].endswith(':31')),
                        choices.index(decline))
        self.assertFalse(any(o['reply'] == 'launch_payroll_yes' for o in choices))
        self.assertFalse(self.rows())
        self.assertEqual(self.external.uploads, [])

    def test_decline_finishes_without_payroll_or_attachment_writes(self):
        self.open_single()
        self.assertEqual(self.send('launch_payroll_no')['status'], 'completed')
        self.assertFalse(self.rows())
        self.assertEqual(self.external.uploads, [])
        self.assertEqual(set(self.external.items), {('LANCAMENTOS', 901), ('LANCAMENTOS', 902), ('LANCAMENTOS', 903)})

    def test_month_then_type_creates_only_corresponding_row_and_original_files(self):
        self.open_single()
        self.assertEqual(self.choose(31)['status'], 'awaiting_launch_payroll_type')
        self.assertFalse(self.rows())
        self.assertEqual(self.send('launch_payroll_type_salary')['status'], 'completed')
        self.assertEqual([(r['IDLANCAMENTO'], r['IDFOLHA']) for r in self.rows()], [(901, 31)])
        payroll_id = next(key for key, row in self.sharepoint.items.items() if row['target_list'] == 'FOLHAPGTO')
        self.assertEqual(self.external.files['FOLHAPGTO', payroll_id],
                         {'901-a.pdf': b'first-901', '901-b.jpg': b'second-901'})

    def test_decline_survives_resume_and_duplicate_does_not_create_rows(self):
        self.open_single()
        state, etag = self.load()
        self.engine._resend_current_prompt(state, etag)
        choices = self.choices(self.messenger.drain())
        self.assertTrue(any(o['reply'] == 'launch_payroll_no' for o in choices))
        packet = self.payload('launch_payroll_no', 'decline-once')
        self.assertEqual(self.bridge.handle(packet)['results'][0]['status'], 'completed')
        self.assertEqual(self.bridge.handle(packet)['results'][0]['status'], 'duplicate')
        self.assertFalse(self.rows())

    def test_legacy_decision_resume_goes_directly_to_linking(self):
        self.open_single()
        state, etag = self.load()
        state['stage'] = 'asking_launch_payroll'
        state['pending_launch_payroll'].pop('selected_entries', None)
        etag = self.state.save(self.key, state, etag)
        self.messenger.drain()
        result = self.engine._resend_current_prompt(state, etag)
        self.assertEqual(result['status'], 'awaiting_launch_payroll_sheet')
        self.assertFalse(any(o['reply'] == 'launch_payroll_yes'
                             for o in self.choices(self.messenger.drain())))

    def test_multiple_launches_open_existing_selection_without_yes_no(self):
        result = self.engine._maybe_prompt_launch_payroll(self.current, None, self.entries)
        self.assertEqual(result['status'], 'awaiting_launch_payroll_selection')
        self.assertEqual(self.send('launch_payroll_selected:901,903')['status'], 'awaiting_launch_payroll_sheet_mode')
        self.sheet_mode('shared')
        choices = self.choices(self.payloads[-1]['messages'])
        self.assertTrue(any(o['reply'] == 'launch_payroll_no' for o in choices))
        self.assertEqual(self.send('launch_payroll_no')['status'], 'completed')
        self.assertFalse(self.rows())

    def test_stale_yes_cannot_select_a_sheet(self):
        self.open_single()
        self.assertEqual(self.send('launch_payroll_yes')['status'], 'invalid_launch_payroll_sheet')
        self.assertFalse(self.rows())
        self.assertIsNone(self.pending()['selected_entries'][0].get('IDFOLHA'))

    def test_previous_month_button_precedes_decline_and_links_its_sheet(self):
        from datetime import datetime
        from zoneinfo import ZoneInfo
        today = datetime.now(ZoneInfo('America/Sao_Paulo'))
        month = today.month - 1 or 12
        year = today.year - (today.month == 1)
        self.sharepoint.options_by_key['launch_payroll_sheets'] = [self.sheets[0],
            self.sheet(30, 'FORNECEDOR TESTE A', f'{month:02d}/{year}')]
        result, messages = self.open_single()
        choices = self.choices(messages)
        previous = next(i for i, o in enumerate(choices) if o['reply'].endswith(':30'))
        decline = next(i for i, o in enumerate(choices) if o['reply'] == 'launch_payroll_no')
        self.assertEqual(decline, previous + 1)
        self.choose(30)
        self.send('launch_payroll_type_salary')
        self.assertEqual([(r['IDLANCAMENTO'], r['IDFOLHA']) for r in self.rows()], [(901, 30)])

    def test_settlement_enters_linking_and_can_decline_without_reposting(self):
        result = self.settlement()
        self.assertEqual(result['status'], 'awaiting_launch_payroll_sheet')
        self.assertEqual(self.send('launch_payroll_no')['status'], 'completed')
        self.assertFalse(self.rows())

    def test_noncontractor_keeps_existing_no_payroll_behavior(self):
        self.entries[0]['supplier_source_values']['EMPREITEIRO'] = 'NÃO'
        self.assertIsNone(self.engine._maybe_prompt_launch_payroll(self.current, None, self.entries[:1]))
        self.assertFalse(self.rows())

    def test_old_no_still_declines_from_persisted_decision_stage(self):
        self.open_single()
        state, etag = self.load()
        state['stage'] = 'asking_launch_payroll'
        self.state.save(self.key, state, etag)
        self.assertEqual(self.send('launch_payroll_no')['status'], 'completed')
        self.assertFalse(self.rows())

    def test_single_payment_skips_both_mode_questions(self):
        self.assertEqual(self.settlement()['status'], 'awaiting_launch_payroll_sheet')
        self.assertEqual(self.choose(31)['status'], 'awaiting_launch_payroll_type')
        self.assertEqual(self.send('launch_payroll_type_salary')['status'], 'completed')
        self.assertEqual(len(self.rows()), 1)


if __name__ == '__main__':
    names = [name for name in DirectLinkTests.__dict__ if name.startswith('test_')]
    if '--regressions' in sys.argv:
        names += [name for cls in (fixture.Integration, fixture.test_batch_assignment.BatchAssignmentTests)
                  for name in cls.__dict__ if name.startswith('test_')
                  # This archived case predates the current fail-closed legacy-origin
                  # reservation. It expects an uncertain write to retry automatically.
                  and name != 'test_shared_type_is_durable_before_first_external_write']
    names = list(dict.fromkeys(names))
    suite = unittest.TestSuite(DirectLinkTests(name) for name in names)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(not result.wasSuccessful())
