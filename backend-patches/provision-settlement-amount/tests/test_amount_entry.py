"""Settlement can complete unknown prices without leaving the conversation."""
import copy
import unittest
from types import SimpleNamespace
from test_provision_description_settlement import Engine, group, prepared
from provision_description_settlement import group_options
from provision_description_query import ProvisionDescriptionQuery
from workflow import WorkflowEngine


class AmountEntryTests(unittest.TestCase):
    def test_settlement_read_retains_unknown_amount_but_default_read_stays_strict(self):
        from test_provision_description_query import SyntheticRest, child
        client = SyntheticRest(children=[child(**{'VALOR TOTAL': None})])
        with self.assertRaisesRegex(ValueError, 'VALOR TOTAL'):
            client.get_provision_description(42)
        source = client.get_provision_description_for_settlement(42)
        self.assertTrue(source['settlementBlocked'])
        self.assertIsNone(source['CHILDREN'][0]['VALOR TOTAL'])
        self.assertIsNone(source['VALOR TOTAL DESCRITIVO'])

    def source(self, count=1):
        source = group()
        source['CHILDREN'] = source['CHILDREN'][:count]
        source['CHILDREN'][0]['VALOR TOTAL'] = None
        return ProvisionDescriptionQuery._group(
            {key: value for key, value in source.items() if key != 'CHILDREN'},
            source['CHILDREN'], allow_invalid_totals=True)

    def state(self):
        return {'flow': 'payment_settlement', 'batch_id': 'fake', 'fields': {},
                'answers': {}, 'selections': {}, 'display_values': {},
                'attachments': [], 'step_index': 0, 'options': []}

    def test_single_unknown_price_opens_child_review_without_writes(self):
        engine, state = Engine(), self.state()
        engine._description_start(state, self.source())
        self.assertEqual(state['fields']['ID PROVISÃO'], '12')
        self.assertIsNone(state['fields']['VALOR TOTAL'])
        self.assertFalse(state['provision_description'].get('choose_amount_line'))
        self.assertEqual(engine.sharepoint.events, [])

    def test_multiple_lines_asks_choice_then_reviews_selected_line_first(self):
        engine, state = Engine(), self.state()
        engine.sharepoint.get_provision_description_for_settlement = lambda item_id: self.source(2)
        engine._description_start(state, self.source(2))
        flow = engine._description_flow_config(state, {'steps': [{'key': 'source'}]})
        step = flow['steps'][1]
        self.assertEqual(step['key'], 'description_amount_line')
        options = step['source']['options']
        self.assertEqual([o['value'] for o in options], ['11', '12'])
        engine._prompt_next_or_summary = lambda current, etag: {'status': 'review'}
        result = engine._description_choose_amount_line(state, None, options[1])
        self.assertEqual(result['status'], 'review')
        self.assertEqual(state['fields']['ID PROVISÃO'], '12')
        self.assertEqual([c['Id'] for c in state['provision_description']['children']], [12, 11])
        self.assertEqual(engine.sharepoint.events, [])

    def test_selection_reads_fresh_even_when_cached_amount_missing(self):
        engine, state = Engine(), self.state()
        source = self.source()
        fresh = copy.deepcopy(source)
        fresh['CHILDREN'][0]['VALOR TOTAL'] = '45'
        engine.sharepoint.get_provision_description_for_settlement = lambda item_id: fresh
        result = engine._description_selection_source(state, group_options([source])[0])
        self.assertEqual(result['CHILDREN'][0]['VALOR TOTAL'], '45')

    def test_invalid_paid_child_cannot_be_silently_omitted(self):
        source = self.source(2)
        next(row for row in source['CHILDREN'] if row['VALOR TOTAL'] is None)['PGTOAGENDADO'] = 'PAGO'
        with self.assertRaises(ValueError):
            Engine()._description_start(self.state(), source)

    def test_invalid_paid_child_returns_actionable_guidance_at_selection(self):
        engine, state = Engine(), self.state()
        source = self.source(2)
        next(row for row in source['CHILDREN'] if row['VALOR TOTAL'] is None)['PGTOAGENDADO'] = 'PAGO'
        engine.sharepoint.get_provision_description_for_settlement = lambda item_id: copy.deepcopy(source)
        messages = []
        engine._send_text = lambda state, text: messages.append(text)
        self.assertIsNone(engine._description_selection_source(state, group_options([source])[0]))
        self.assertIn('12', messages[-1])
        self.assertIn('GALERIA', messages[-1])
        self.assertEqual(engine.sharepoint.events, [])

    def test_paid_after_choice_prompt_is_refreshed_and_not_opened_for_review(self):
        engine, state = Engine(), self.state()
        source = self.source(2)
        engine._description_start(state, source)
        source['CHILDREN'][0]['PGTOAGENDADO'] = 'PAGO'
        reads = []
        def fresh(item_id):
            reads.append(item_id)
            return copy.deepcopy(source)
        engine.sharepoint.get_provision_description_for_settlement = fresh
        engine._prompt_next_or_summary = lambda *args: {'status': 'review'}
        engine._description_choose_amount_line(state, None, {'value': '11'})
        self.assertEqual(reads, ['7'])
        self.assertNotEqual(state['fields']['ID PROVISÃO'], '11')

    def workflow(self):
        engine = WorkflowEngine.__new__(WorkflowEngine)
        engine.sharepoint = SimpleNamespace(get_provision_description_for_settlement=lambda item_id: self.source(2))
        engine._send_text = lambda *args: None
        engine._save = lambda *args: 'saved'
        engine._prompt_next_or_summary = lambda *args: {'status': 'review'}
        engine._optional_text_target_field = lambda *args: None
        engine._include_terminal_option = lambda step, options: options
        engine._selection_options = lambda state, step: copy.deepcopy(step['source']['options'])
        return engine

    def test_choice_uses_real_selection_handler_and_filter_does_not_select(self):
        engine, state = self.workflow(), self.state()
        engine._description_start(state, self.source(2))
        step = engine._description_flow_config(state, {'steps': [{'key': 'source'}]})['steps'][1]
        shown = []
        engine._send_filtered_options = lambda state, step, options: shown.extend(options)
        result = engine._handle_selection_reply({'kind': 'text', 'text': 'Produto'}, state, None, step)
        self.assertEqual(result['status'], 'filtered_options')
        self.assertTrue(state['provision_description']['choose_amount_line'])
        self.assertEqual(len(shown), 2)
        result = engine._handle_selection_reply(
            {'kind': 'text', 'reply_id': 'description_amount_line:12'}, state, None, step)
        self.assertEqual(result['status'], 'review')
        self.assertEqual(state['fields']['ID PROVISÃO'], '12')

    def test_unknown_price_uses_existing_validated_money_entry(self):
        engine, state = self.workflow(), self.state()
        engine._description_start(state, self.source())
        prompts = []
        engine._send_input_question = lambda state, prompt: prompts.append(prompt)
        step = {'key': 'validar_valor_total_baixa', 'target_field': 'VALOR TOTAL',
                'number_style': 'currency', 'required_prompt': 'INFORME O VALOR UNITÁRIO'}
        for invalid in ('', 'abc', '-1', '0'):
            result = engine._handle_confirm_or_replace_number_reply(
                {'kind': 'text', 'text': invalid}, state, None, step)
            self.assertIn(result['status'], ('invalid_number', 'awaiting_replacement_number'))
            self.assertIsNone(state['fields']['VALOR TOTAL'])
        result = engine._handle_confirm_or_replace_number_reply(
            {'kind': 'text', 'text': '1.234,56'}, state, None, step)
        self.assertEqual(result['status'], 'review')
        self.assertEqual(state['fields']['VALOR TOTAL'], '1234,56')

    def test_concurrent_price_change_blocks_before_parent_write(self):
        engine = Engine()
        state = prepared(engine)
        state['provision_description']['original_children'][0]['VALOR TOTAL'] = None
        result = engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})
        self.assertEqual(result['status'], 'submission_failed')
        self.assertIn('outra pessoa', state['error'])
        self.assertEqual(engine.sharepoint.events, [])

    def test_confirmation_recalculates_parent_from_completed_drafts(self):
        for count, quantity, freight, expected in ((1, '1', '0', '15'), (1, '2', '3', '33'), (2, '2', '3', '57')):
            with self.subTest(count=count, quantity=quantity):
                engine = Engine()
                state = prepared(engine)
                description = state['provision_description']
                description['children'] = description['children'][:count]
                description['entries'] = description['entries'][:count]
                included = {str(entry['fields']['ID PROVISÃO']) for entry in description['entries']}
                description['original_children'] = [row for row in description['original_children'] if str(row['Id']) in included]
                target = str(description['entries'][0]['fields']['ID PROVISÃO'])
                for row in description['original_children']:
                    if str(row['Id']) == target:
                        row['VALOR TOTAL'] = None
                engine.sharepoint.group['CHILDREN'] = copy.deepcopy(description['original_children'])
                engine.sharepoint.get_provision_description = lambda item_id: (_ for _ in ()).throw(
                    ValueError('Invalid provision number: VALOR TOTAL'))
                engine.sharepoint.get_provision_description_for_settlement = lambda item_id: copy.deepcopy(engine.sharepoint.group)
                description['entries'][0]['fields']['VALOR TOTAL'] = '15'
                description['entries'][0]['fields'].update({'QTD': quantity, 'FRETE': freight})
                result = engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})
                self.assertEqual(result['status'], 'completed', state.get('error'))
                self.assertEqual(engine.sharepoint.group['VALORTOTAL'], expected)
                updated = next(row for row in engine.sharepoint.group['CHILDREN'] if str(row['Id']) == target)
                self.assertEqual(updated['VALOR TOTAL'], '15')

    def test_missing_original_amount_recovers_lost_child_response_without_duplicate(self):
        engine = Engine()
        state = prepared(engine)
        description = state['provision_description']
        for row in description['original_children']:
            if row['Id'] == 11:
                row['VALOR TOTAL'] = None
        engine.sharepoint.group['CHILDREN'] = copy.deepcopy(description['original_children'])
        engine.sharepoint.get_provision_description_for_settlement = lambda item_id: copy.deepcopy(engine.sharepoint.group)
        description['entries'][0]['fields']['VALOR TOTAL'] = '15'
        engine.child_response_lost = True
        self.assertEqual(engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})['status'], 'submission_failed')
        self.assertEqual(engine._description_commit(state, None, {'target_list': 'PROVISÃO PGTOS'})['status'], 'completed')
        self.assertEqual(engine.sharepoint.group['VALORTOTAL'], '57')
        self.assertEqual([event[1] for event in engine.sharepoint.events if event[0] == 'child'], [11, 12])


class AmountConversationTests(unittest.TestCase):
    def test_real_conversation_selects_missing_amount_and_reaches_confirmation(self):
        from test_workflow import WorkflowTests
        harness = WorkflowTests('runTest')
        harness.setUp()
        source = AmountEntryTests().source()
        harness.sharepoint.get_pending_provision_descriptions = lambda: [copy.deepcopy(source)]
        harness.sharepoint.get_provision_description_for_settlement = lambda item_id: copy.deepcopy(source)
        harness.reply('OPA')
        harness.open_supply_provision_action('BAIXAR PAGAMENTO AGENDADO')
        result = harness.reply(reply_id='provision_description:7')
        self.assertEqual(result.get('field'), 'validar_qtd_baixa')
        result = harness.reply(reply_id='validar_qtd_baixa_keep')
        self.assertEqual(result.get('field'), 'validar_valor_total_baixa')
        result = harness.reply('15,00')
        self.assertEqual(result.get('field'), 'data_pgto_efetuado_baixa')
        harness.reply(reply_id='date_today')
        result = harness.reply(reply_id='371')
        self.assertEqual(result.get('field'), 'observacao_grupo_baixa')
        harness.reply(reply_id='description_observation_blank')
        harness.reply(reply_id='2')
        result = harness.reply('NÃO')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        state = next(iter(harness.state.values.values()))[0]
        self.assertEqual(state['provision_description']['entries'][0]['fields']['VALOR TOTAL'], '15')
        self.assertIsNone(state['provision_description']['original_children'][0]['VALOR TOTAL'])
        rows = harness.engine._description_summary_rows(state)
        self.assertEqual(rows[-1]['value'], 'R$ 33,00')
        self.assertEqual(harness.sharepoint.update_calls, [])


if __name__ == '__main__':
    unittest.main()
