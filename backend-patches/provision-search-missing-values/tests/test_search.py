import copy
import unittest
from types import SimpleNamespace
from provision_description_settlement import group_options
from workflow import WorkflowEngine


def group(item_id=23, blocked=True):
    return {'Id': item_id, 'FORNECEDOR': 'CEMIG',
            'DATA PREVISTO PGTO': '2026-11-11',
            'CHILDREN': [{'Id': 337, 'IMOVEL': 'ESCRITÓRIO VILA DA SERRA',
                          'DESCRITIVOPROVISAO': str(item_id), 'STATUS': 'PAGAMENTO PREVISTO',
                          'FORNECEDOR': 'CEMIG', 'QTD': '1', 'FRETE': '0',
                          'VALOR TOTAL': None if blocked else '64.19'}],
            'settlementBlocked': blocked,
            'amountError': 'Total indisponível: valor ausente em VALOR TOTAL.',
            'totalDisplay': '—' if blocked else 'R$ 64,19',
            'VALOR TOTAL DESCRITIVO': None if blocked else '64.19'}


class SearchTests(unittest.TestCase):
    def setUp(self):
        self.engine = WorkflowEngine.__new__(WorkflowEngine)
        self.rows = [group()]
        self.messages, self.presented = [], []
        self.engine.sharepoint = SimpleNamespace(
            get_pending_provision_descriptions=lambda: copy.deepcopy(self.rows),
            get_provision_description=lambda item_id: copy.deepcopy(self.rows[0]))
        self.engine._selection_options = lambda state, step: group_options(
            self.engine.sharepoint.get_pending_provision_descriptions())
        self.engine._save = lambda state, etag: 'saved'
        self.engine._send_text = lambda state, message: self.messages.append(message)
        self.engine._send_filtered_options = lambda state, step, options: self.presented.extend(options)
        self.engine._include_terminal_option = lambda step, options: options
        self.engine._optional_text_target_field = lambda state, step: None
        self.engine._apply_selected_option = lambda *args: self.fail('Must not apply an invalid amount')
        self.state = {'flow': 'payment_settlement', 'batch_id': 'fictional',
                      'step_index': 0, 'fields': {}, 'answers': {}, 'selections': {},
                      'display_values': {}, 'attachments': [{'name': 'keep.pdf'}],
                      'options': [{'id': 'provision_description:99', 'value': '99', 'title': 'OUTRO'}]}
        self.step = {'key': 'provisao_para_baixa', 'target_field': 'ID PROVISÃO'}

    def test_missing_amount_stays_searchable_with_parent_and_child_identity(self):
        option = group_options([group()])[0]
        self.assertEqual(option['id'], 'provision_description:23')
        self.assertIn('CEMIG', option['title'])
        self.assertIn('337', option['title'])
        self.assertIn('VALOR PENDENTE', option['title'])
        self.assertNotIn('R$ 0', option['title'])
        self.assertTrue(option['source_values']['settlementBlocked'])

    def test_open_session_search_refreshes_previously_hidden_options(self):
        for reply in ({'kind': 'text', 'text': 'Cemig'},
                      {'kind': 'text', 'reply_id': 'filter_query', 'text': 'cemig'}):
            with self.subTest(reply=reply):
                self.presented.clear()
                result = self.engine._handle_selection_reply(reply, self.state, None, self.step)
                self.assertEqual(result['status'], 'filtered_options')
                self.assertEqual([o['value'] for o in self.presented], ['23'])
                self.assertEqual(self.state['fields'], {})
                self.assertEqual(self.state['step_index'], 0)

    def test_selecting_missing_amount_explains_correction_without_mutating_payment(self):
        original = copy.deepcopy(self.state)
        result = self.engine._handle_selection_reply(
            {'kind': 'text', 'reply_id': 'provision_description:23'}, self.state, None, self.step)
        self.assertEqual(result['status'], 'provision_amount_required')
        for key in ('fields', 'answers', 'selections', 'step_index', 'attachments'):
            self.assertEqual(self.state[key], original[key])
        self.assertNotIn('provision_description', self.state)
        self.assertIn('337', self.messages[-1])
        self.assertIn('GALERIA', self.messages[-1])

    def test_corrected_amount_is_read_fresh_for_selection(self):
        self.rows = [group(blocked=False)]
        option = group_options(self.rows)[0]
        source = self.engine._description_selection_source(self.state, option)
        self.assertEqual(source['VALOR TOTAL DESCRITIVO'], '64.19')
        self.assertEqual(self.messages, [])

    def test_amount_becoming_invalid_between_list_and_selection_cannot_advance(self):
        def invalid(item_id):
            raise ValueError('Invalid provision number: VALOR TOTAL')
        self.rows = [group(blocked=False)]
        self.engine.sharepoint.get_provision_description = invalid
        result = self.engine._handle_selection_reply(
            {'kind': 'text', 'reply_id': 'provision_description:23'}, self.state, None, self.step)
        self.assertEqual(result['status'], 'provision_amount_required')
        self.assertEqual(self.state['fields'], {})

    def test_valid_amount_still_opens_child_review_without_writing_payment(self):
        self.rows = [group(blocked=False)]
        del self.engine._apply_selected_option
        self.engine._prompt_next_or_summary = lambda state, etag: {'status': 'review_child'}
        result = self.engine._handle_selection_reply(
            {'kind': 'text', 'reply_id': 'provision_description:23'}, self.state, None, self.step)
        self.assertEqual(result['status'], 'review_child')
        self.assertEqual(self.state['fields']['ID PROVISÃO'], '337')
        self.assertEqual(self.state['fields']['VALOR TOTAL'], '64.19')
        self.assertEqual(self.state['step_index'], 1)
        self.assertFalse(self.state['provision_description']['prepared'])

    def test_transport_failure_is_not_reported_as_missing_amount(self):
        def unavailable(item_id):
            raise ConnectionError('Synthetic service unavailable')
        self.engine.sharepoint.get_provision_description = unavailable
        with self.assertRaises(ConnectionError):
            self.engine._description_selection_source(self.state, group_options([group(blocked=False)])[0])
        self.assertEqual(self.messages, [])

    def test_schema_failure_is_not_misreported_as_amount_correction(self):
        def invalid(item_id):
            raise ValueError('SharePoint provision item omitted selected fields')
        self.engine.sharepoint.get_provision_description = invalid
        with self.assertRaisesRegex(ValueError, 'omitted selected fields'):
            self.engine._description_selection_source(self.state, group_options([group(blocked=False)])[0])
        self.assertEqual(self.messages, [])

    def test_paid_item_removed_since_prompt_is_not_selectable(self):
        self.rows = []
        self.state['options'] = group_options([group(blocked=False)])
        result = self.engine._handle_selection_reply(
            {'kind': 'text', 'reply_id': 'provision_description:23'}, self.state, None, self.step)
        self.assertEqual(result['status'], 'invalid_option')
        self.assertEqual(self.state['fields'], {})


if __name__ == '__main__':
    unittest.main()
