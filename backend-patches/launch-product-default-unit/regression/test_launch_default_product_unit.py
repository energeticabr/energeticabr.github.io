"""Production launch flows take the product's unit without an interactive poll."""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_workflow as legacy
from config import load_workflow_config


class LaunchDefaultProductUnitTests(unittest.TestCase):
    def setUp(self):
        self.h = legacy.WorkflowTests(methodName='runTest')
        self.h.setUp()
        original_reply = self.h.reply
        # Current clients send a button ID; bare numeric text is a search query.
        def client_reply(text=None, reply_id=None):
            stored = next(iter(self.h.state.values.values()), (None, None))[0]
            if reply_id is None and stored and any(str(option.get('id')) == str(text) for option in stored.get('options', [])):
                return original_reply(reply_id=str(text))
            return original_reply(text, reply_id)
        self.h.reply = client_reply
        self.restore_production_unit_step()
        self.product_units = {210: 'UN', 211: 'm³'}
        self.unit_reads = []
        original_options = self.h.sharepoint.get_options

        def catalog_options(step, context=None):
            source = step.get('source', {})
            if source.get('list') == 'CADASTROPRODUTO' and source.get('value_field') == 'UNIDADE':
                self.assertEqual(source.get('label_field'), 'UNIDADE')
                filters = source.get('filters', [])
                self.assertEqual(len(filters), 1)
                self.assertEqual(filters[0]['field'], 'Id')
                product_id = filters[0]['equals']
                self.assertIs(type(product_id), int)
                self.assertGreater(product_id, 0)
                self.assertNotIn('recommended', source)
                self.unit_reads.append(product_id)
                units = self.product_units.get(product_id, [])
                units = units if isinstance(units, list) else [units]
                return [
                    {'id': product_id, 'title': str(unit), 'value': unit,
                     'source_values': {'Id': product_id, 'UNIDADE': unit}}
                    for unit in units
                ]
            return original_options(step, context)

        self.h.sharepoint.get_options = catalog_options

    def restore_production_unit_step(self):
        production = load_workflow_config()['sharepoint']['launch_flow']['steps']
        steps = self.h.config['sharepoint']['launch_flow']['steps']
        for index, step in enumerate(steps):
            if step['key'] == 'unidade_lancamento':
                steps[index] = copy.deepcopy(next(item for item in production if item['key'] == step['key']))
                return steps[index]

    def state(self):
        return next(iter(self.h.state.values.values()))[0]

    def unit_options(self, unit='UN', alternative='CASA'):
        self.product_units[210] = unit
        self.h.sharepoint.options_by_key['unidade_lancamento'] = [
            {'id': 5, 'title': alternative, 'value': alternative},
            {'id': 3, 'title': f'⭐ {unit} (PADRÃO DO PRODUTO)', 'value': unit, 'recommended': True},
        ]

    def test_single_launch_uses_product_unit_and_asks_quantity_next(self):
        self.unit_options()
        self.h._start_launch_to_product('1')
        before = len(self.h.messenger.sent)
        result = self.h.reply('210')
        self.assertEqual(result['field'], 'quantidade_lancamento')
        self.assertEqual(self.state()['fields']['UN'], 'UN')
        self.assertEqual(self.state()['answers']['unidade_lancamento'], 'UN')
        self.assertEqual(self.state()['display_values']['UN'], 'UN')
        self.assertFalse(any(message.get('field') == 'unidade_lancamento' for message in self.h.messenger.sent[before:]))
        self.assertEqual(self.h.sharepoint.items, {})

    def test_multiple_launch_first_line_also_uses_its_product_default(self):
        self.unit_options('SACO', 'UN')
        self.h._start_launch_to_product('2')
        result = self.h.reply('210')
        self.assertEqual(result['field'], 'quantidade_lancamento')
        self.assertEqual(self.state()['fields']['UN'], 'SACO')

    def test_each_additional_line_recomputes_the_default_without_changing_the_first(self):
        self.unit_options()
        self.h._start_launch_to_product('2')
        self.assertEqual(self.h.reply('210')['field'], 'quantidade_lancamento')
        self.h.reply('2')
        self.h.reply('10')
        self.h.reply('2')  # no freight
        self.h.sharepoint.options_by_key['produto_lancamento'].append({'id': 211, 'title': 'AREIA', 'value': 'AREIA'})
        self.product_units[211] = 'm³'
        self.h.reply('1')  # add another line and capture the first line
        self.assertEqual(self.state()['launch_lines'][0]['fields']['UN'], 'UN')
        self.h.reply('1')  # keep shared supplier/branch values
        result = self.h.reply('211')
        self.assertEqual(result['field'], 'quantidade_lancamento')
        self.assertEqual(self.state()['fields']['UN'], 'm³')
        self.assertEqual(self.state()['answers']['unidade_lancamento'], 'm³')
        self.assertEqual(self.state()['launch_lines'][0]['fields']['UN'], 'UN')

    def test_default_reinserted_by_the_catalog_is_used_even_without_a_numeric_unit_id(self):
        self.unit_options('t')
        self.h.sharepoint.options_by_key['unidade_lancamento'][1]['id'] = 'PADRÃO'
        self.h._start_launch_to_product()
        result = self.h.reply('210')
        self.assertEqual(result['field'], 'quantidade_lancamento')
        self.assertEqual(self.state()['fields']['UN'], 't')

    def test_missing_product_default_does_not_select_an_unrelated_unit_or_ask_for_one(self):
        self.product_units.pop(210)
        self.h.sharepoint.options_by_key['unidade_lancamento'] = [{'id': 5, 'title': 'CASA', 'value': 'CASA'}]
        self.h._start_launch_to_product()
        before = len(self.h.messenger.sent)
        result = self.h.reply('210')
        self.assertEqual(result['status'], 'missing_product_unit_default')
        self.assertNotIn('UN', self.state()['fields'])
        self.assertFalse(any(message.get('field') == 'unidade_lancamento' for message in self.h.messenger.sent[before:]))
        self.assertEqual(self.h.sharepoint.items, {})

    def test_ambiguous_product_defaults_do_not_silently_pick_the_first(self):
        self.unit_options()
        self.product_units[210] = ['UN', 'KG']
        self.h.sharepoint.options_by_key['unidade_lancamento'][0]['recommended'] = True
        self.h._start_launch_to_product()
        result = self.h.reply('210')
        self.assertEqual(result['status'], 'missing_product_unit_default')
        self.assertNotIn('UN', self.state()['fields'])
        self.assertEqual(self.h.sharepoint.items, {})

    def prepare_legacy_unit_question(self):
        self.unit_options()
        step = self.restore_production_unit_step()
        step['auto_select_recommended'] = False
        self.h._start_launch_to_product()
        result = self.h.reply('210')
        self.assertEqual(result['field'], 'unidade_lancamento')
        self.restore_production_unit_step()

    def test_old_unit_prompt_reply_is_migrated_to_the_product_default(self):
        self.prepare_legacy_unit_question()
        result = self.h.reply('5')  # a stale button for CASA must not override UN
        self.assertEqual(result['field'], 'quantidade_lancamento')
        self.assertEqual(self.state()['fields']['UN'], 'UN')

    def test_resuming_an_old_unit_question_advances_without_showing_the_poll(self):
        self.prepare_legacy_unit_question()
        state, etag = next(iter(self.h.state.values.values()))
        before = len(self.h.messenger.sent)
        result = self.h.engine._resend_current_prompt(copy.deepcopy(state), etag)
        self.assertEqual(result['field'], 'quantidade_lancamento')
        self.assertEqual(self.state()['fields']['UN'], 'UN')
        self.assertFalse(any(message.get('field') == 'unidade_lancamento' for message in self.h.messenger.sent[before:]))

    def test_the_unit_is_not_offered_as_a_manual_summary_edit(self):
        self.unit_options()
        self.h._start_launch_to_product()
        self.assertEqual(self.h.reply('210')['field'], 'quantidade_lancamento')
        steps = self.h.config['sharepoint']['launch_flow']['steps']
        index = next(i for i, step in enumerate(steps) if step['key'] == 'unidade_lancamento')
        options = self.h.engine._editable_options(self.state())
        self.assertNotIn(index, [option.get('value') for option in options])

    def pending_state(self, *, multiple=False):
        self.h._start_launch_to_product('2' if multiple else '1')
        self.h.reply('210')
        state, etag = next(iter(self.h.state.values.values()))
        state = copy.deepcopy(state)
        state['fields'].update({'UN': 'CASA', 'QUANTIDADE': '2', 'VALOR UNITÁRIO': '10', 'FRETE': '0'})
        state['display_values']['UN'] = 'CASA'
        state['answers']['unidade_lancamento'] = 'CASA'
        state['selections']['unidade_lancamento'] = {'id': 5, 'title': 'CASA', 'value': 'CASA'}
        state['attachments_decision'] = 'no'
        state['attachments_phase_completed'] = True
        return state, etag

    def test_homonymous_products_use_the_selected_id_instead_of_the_name(self):
        self.h.sharepoint.options_by_key['produto_lancamento'].append(
            {'id': 211, 'title': 'CIMENTO CP II', 'value': 'CIMENTO CP II'})
        self.h._start_launch_to_product()
        self.h.reply(reply_id='choice:produto_lancamento:211')
        self.assertEqual(self.state()['fields']['UN'], 'm³')
        self.assertEqual(self.unit_reads, [211])

    def test_automatic_unit_does_not_read_the_legacy_unit_catalog(self):
        self.h._start_launch_to_product()
        self.h.reply('210')
        self.assertEqual(self.unit_reads, [210])
        self.assertFalse(any(key == 'unidade_lancamento' for key, _ in self.h.sharepoint.option_calls))

    def test_old_quantity_stage_is_normalized_when_it_reaches_summary(self):
        state, etag = self.pending_state()
        self.assertEqual(self.h.engine._current_step(state)['key'], 'quantidade_lancamento')
        result = self.h.engine._summarize_and_confirm(state, etag)
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(state['fields']['UN'], 'UN')
        self.assertEqual(state['display_values']['UN'], 'UN')
        self.assertEqual(state['answers']['unidade_lancamento'], 'UN')
        self.assertEqual(self.h.sharepoint.items, {})

    def test_summary_normalizes_each_pending_batch_line_by_its_own_id(self):
        state, etag = self.pending_state(multiple=True)
        first = self.h.engine._current_launch_line_snapshot(state)
        second = copy.deepcopy(first)
        second['selections']['produto_lancamento']['id'] = 211
        state['launch_lines'] = [first, second]
        state['multi_launch_grouping_supplier'] = 'FORNECEDOR TESTE'
        state['selections']['produto_lancamento']['id'] = 211
        self.h.engine._summarize_and_confirm(state, etag)
        self.assertEqual([line['fields']['UN'] for line in state['launch_lines']], ['UN', 'm³'])
        self.assertEqual(state['fields']['UN'], 'm³')
        self.assertEqual(self.h.sharepoint.items, {})

    def test_precommit_normalizes_before_even_the_related_order_write(self):
        state, etag = self.pending_state()
        state['stage'] = 'committing'
        original = self.h.sharepoint.ensure_item
        writes = []
        def ensure(token, fields, **kwargs):
            self.assertEqual(state['fields']['UN'], 'UN')
            if kwargs.get('target_list') == 'LANCAMENTOS':
                self.assertEqual(fields['UN'], 'UN')
            writes.append(kwargs.get('target_list'))
            return original(token, fields, **kwargs)
        self.h.sharepoint.ensure_item = ensure
        self.h.engine._commit(state, etag)
        self.assertIn('LANCAMENTOS', writes)

    def test_missing_default_blocks_all_writes_without_partially_normalizing_batch(self):
        state, etag = self.pending_state(multiple=True)
        first = self.h.engine._current_launch_line_snapshot(state)
        second = copy.deepcopy(first)
        second['selections']['produto_lancamento']['id'] = 211
        state['launch_lines'] = [first, second]
        self.product_units.pop(211)
        before = copy.deepcopy(state['launch_lines'])
        result = self.h.engine._commit(state, etag)
        self.assertEqual(result['status'], 'missing_product_unit_default')
        self.assertEqual(state['launch_lines'], before)
        self.assertEqual(state['fields']['UN'], 'CASA')
        self.assertEqual(self.h.sharepoint.items, {})

    def test_product_id_can_fall_back_to_source_values_but_never_to_name(self):
        state, etag = self.pending_state()
        state['selections']['produto_lancamento'] = {'id': 'NOVO', 'source_values': {'Id': '211'}}
        self.h.engine._summarize_and_confirm(state, etag)
        self.assertEqual(state['fields']['UN'], 'm³')

    def test_missing_or_invalid_id_and_default_never_guess_a_unit(self):
        for product_id, unit in [(None, 'UN'), ('NOVO', 'UN'), (True, 'UN'), (0, 'UN'),
                                 (210, ''), (210, '   '), (210, None), (210, 12)]:
            with self.subTest(product_id=product_id, unit=unit):
                self.setUp()
                state, etag = self.pending_state()
                state['selections']['produto_lancamento'] = {'id': product_id}
                self.product_units[210] = unit
                result = self.h.engine._commit(state, etag)
                self.assertEqual(result['status'], 'missing_product_unit_default')
                self.assertEqual(self.h.sharepoint.items, {})
                self.product_units[210] = 'UN'

    def test_partial_attempt_or_posted_checkpoint_preserves_units_and_journals(self):
        for marker in ('launch_cash_writes', 'partial_submission_items', 'sharepoint', 'submission_failure'):
            with self.subTest(marker=marker):
                self.setUp()
                state, etag = self.pending_state(multiple=True)
                state['launch_lines'] = [self.h.engine._current_launch_line_snapshot(state)]
                state[marker] = ({'token': {'fields': {'UN': 'CASA'}, 'create_attempted': True}}
                                 if marker == 'launch_cash_writes' else
                                 [{'item_id': 99, 'target_list': 'LANCAMENTOS'}]
                                 if marker == 'partial_submission_items' else {'item_id': 99})
                before = copy.deepcopy(state)
                result = self.h.engine._commit(state, etag)
                self.assertEqual(result['status'], 'launch_product_unit_migration_blocked')
                for key in ('fields', 'display_values', 'answers', 'selections', 'launch_lines', marker):
                    self.assertEqual(state[key], before[key])
                self.assertEqual(self.h.sharepoint.items, {})

    def test_old_pagination_control_applies_default_without_emitting_unit_poll(self):
        self.prepare_legacy_unit_question()
        before = len(self.h.messenger.sent)
        result = self.h.reply(reply_id='option_next')
        self.assertEqual(result.get('field'), 'quantidade_lancamento')
        self.assertEqual(self.state()['fields']['UN'], 'UN')
        self.assertFalse(any(message.get('field') == 'unidade_lancamento'
                             for message in self.h.messenger.sent[before:]))

    def test_old_filter_controls_apply_default_without_emitting_unit_poll(self):
        for control in ('filter_query', 'filter_clear', 'refresh_options'):
            with self.subTest(control=control):
                self.setUp()
                self.prepare_legacy_unit_question()
                result = self.h.reply(text='CASA', reply_id=control)
                self.assertEqual(result.get('field'), 'quantidade_lancamento')
                self.assertEqual(self.state()['fields']['UN'], 'UN')

    def test_resuming_a_frozen_old_unit_step_never_changes_its_payload(self):
        self.prepare_legacy_unit_question()
        state, etag = next(iter(self.h.state.values.values()))
        state = copy.deepcopy(state)
        state['fields']['UN'] = 'CASA'
        state['launch_cash_writes'] = {'old-token': {'fields': copy.deepcopy(state['fields']), 'create_attempted': True}}
        before = copy.deepcopy(state)
        result = self.h.engine._resend_current_prompt(state, etag)
        self.assertEqual(result['status'], 'launch_product_unit_migration_blocked')
        self.assertEqual(state['fields'], before['fields'])
        self.assertEqual(state['launch_cash_writes'], before['launch_cash_writes'])
        self.assertEqual(self.h.sharepoint.items, {})

    def test_failed_non_cash_attempt_freezes_unit_before_retry_and_keeps_posted_record(self):
        state, etag = self.pending_state()
        state['fields']['CONTA'] = 'BANCO'
        original = self.h.sharepoint.ensure_item
        def timeout_after_write(token, fields, **kwargs):
            item_id = original(token, fields, **kwargs)
            if kwargs.get('target_list') == 'LANCAMENTOS':
                raise RuntimeError('response lost after create')
            return item_id
        self.h.sharepoint.ensure_item = timeout_after_write
        result = self.h.engine._commit(state, etag)
        self.assertEqual(result['status'], 'submission_failed')
        self.assertEqual(state.get('launch_unit_write_batch_id'), state['batch_id'])
        posted = copy.deepcopy(self.h.sharepoint.items)
        self.assertTrue(any(item['target_list'] == 'LANCAMENTOS' and item['fields']['UN'] == 'UN'
                            for item in posted.values()))
        self.product_units[210] = 'KG'
        frozen = copy.deepcopy(state['fields'])
        result = self.h.engine._commit(state, result['etag'] if 'etag' in result else self.h.state.load(state['key'])[1])
        self.assertEqual(result['status'], 'launch_product_unit_migration_blocked')
        self.assertEqual(state['fields'], frozen)
        self.assertEqual(self.h.sharepoint.items, posted)

    def test_transient_catalog_error_keeps_current_attempt_retryable_without_duplicate_creates(self):
        state, etag = self.pending_state()
        state['fields']['CONTA'] = 'BANCO'
        original_ensure = self.h.sharepoint.ensure_item
        created_targets = []
        lost_response = False

        def ensure(token, fields, **kwargs):
            nonlocal lost_response
            target = kwargs.get('target_list')
            existed = f'{target}:{token}' in self.h.sharepoint.tokens
            item_id = original_ensure(token, fields, **kwargs)
            if not existed:
                created_targets.append(target)
            if target == 'LANCAMENTOS' and not lost_response:
                lost_response = True
                raise RuntimeError('response lost after create')
            return item_id

        self.h.sharepoint.ensure_item = ensure
        result = self.h.engine._commit(state, etag)
        self.assertEqual(result['status'], 'submission_failed')
        self.assertEqual(state['launch_unit_write_batch_id'], state['batch_id'])
        posted = copy.deepcopy(self.h.sharepoint.items)
        preserved_keys = ('fields', 'display_values', 'answers', 'selections', 'launch_lines',
                          'launch_cash_writes', 'partial_submission_items', 'submission_failure',
                          'launch_unit_write_batch_id')
        frozen = {key: copy.deepcopy(state.get(key)) for key in preserved_keys}
        original_options = self.h.sharepoint.get_options

        def unavailable(step, context=None):
            if step.get('source', {}).get('value_field') == 'UNIDADE':
                raise RuntimeError('temporary catalog outage')
            return original_options(step, context)

        self.h.sharepoint.get_options = unavailable
        result = self.h.engine._retry_after_error(state, self.h.state.load(state['key'])[1])
        self.assertEqual(result['status'], 'launch_product_unit_migration_blocked')
        self.assertEqual(state['stage'], 'committing')
        self.assertEqual({key: state.get(key) for key in preserved_keys}, frozen)
        self.assertEqual(self.h.sharepoint.items, posted)
        self.assertEqual(created_targets.count('LANCAMENTOS'), 1)

        self.h.sharepoint.get_options = original_options
        result = self.h.engine._retry_after_error(state, result['etag'])
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(self.h.sharepoint.items, posted)
        self.assertEqual(created_targets.count('LANCAMENTOS'), 1)
        self.assertEqual(created_targets.count('NOTASPENDENTES'), 1)

    def test_valid_batch_units_are_normalized_before_any_write(self):
        state, etag = self.pending_state(multiple=True)
        first = self.h.engine._current_launch_line_snapshot(state)
        second = copy.deepcopy(first)
        second['selections']['produto_lancamento']['id'] = 211
        state['launch_lines'] = [first, second]
        state['selections']['produto_lancamento']['id'] = 211
        state['multi_launch_grouping_supplier'] = 'FORNECEDOR TESTE'
        original = self.h.sharepoint.ensure_item
        observed = []
        def ensure(token, fields, **kwargs):
            self.assertEqual([line['fields']['UN'] for line in state['launch_lines']], ['UN', 'm³'])
            if kwargs.get('target_list') == 'LANCAMENTOS':
                observed.append(fields['UN'])
            return original(token, fields, **kwargs)
        self.h.sharepoint.ensure_item = ensure
        self.h.engine._commit(state, etag)
        self.assertEqual(observed, ['UN', 'm³'])

    def test_product_change_recomputes_unit_and_blocks_when_new_default_is_missing(self):
        for unit in ('KG', None):
            with self.subTest(unit=unit):
                self.setUp()
                state, etag = self.pending_state()
                self.h.sharepoint.options_by_key['produto_lancamento'].append(
                    {'id': 211, 'title': 'OUTRO PRODUTO', 'value': 'OUTRO PRODUTO'})
                self.product_units[211] = unit
                steps = self.h.config['sharepoint']['launch_flow']['steps']
                index = next(i for i, step in enumerate(steps) if step['key'] == 'produto_lancamento')
                indices = self.h.engine._related_edit_step_indices(steps, index)
                for i in indices:
                    self.h.engine._clear_step_value(state, steps[i])
                state.update(step_index=index, edit_step_indices=indices, stage='selecting_fields', options=[])
                self.h.engine._prompt_next_or_summary(state, etag)
                result = self.h.reply(reply_id='choice:produto_lancamento:211')
                if unit is None:
                    self.assertEqual(result['status'], 'missing_product_unit_default')
                    self.assertNotIn('UN', self.state()['fields'])
                else:
                    self.assertEqual(self.state()['fields']['UN'], 'KG')
                self.assertEqual(self.h.sharepoint.items, {})

    def test_registered_product_resumes_with_its_id_and_unit_and_passes_summary_guard(self):
        parent, etag = self.pending_state()
        state = copy.deepcopy(parent)
        state.update(flow='supply_product_registration',
                     fields={'PRODUTO': 'NOVO PRODUTO', 'UNIDADE': 'KG', 'TIPODESPESA': 'MATERIAL'},
                     embedded_return={'type': 'launch_product_registration', 'state': parent})
        self.product_units[900] = 'KG'
        result = self.h.engine._resume_launch_with_registered_product(state, etag, 900)
        self.assertEqual(result['field'], 'quantidade_lancamento')
        self.assertEqual(state['selections']['produto_lancamento']['id'], 900)
        self.assertEqual(state['fields']['UN'], 'KG')
        result = self.h.engine._summarize_and_confirm(state, result['etag'])
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(state['fields']['UN'], 'KG')

    def test_non_unit_number_step_is_not_redirected_by_the_automatic_flag(self):
        self.h._start_launch_to_product()
        self.h.reply('210')
        step = next(step for step in self.h.config['sharepoint']['launch_flow']['steps']
                    if step['key'] == 'quantidade_lancamento')
        step['auto_select_recommended'] = True
        result = self.h.reply('2')
        self.assertEqual(result['field'], 'valor_unitario_lancamento')
        self.assertEqual(self.state()['fields']['QUANTIDADE'], '2')

    def test_resuming_a_draft_already_at_confirmation_rebuilds_summary_with_default(self):
        state, etag = self.pending_state()
        state['stage'] = 'awaiting_confirmation'
        self.h.engine._resend_current_prompt(state, etag)
        self.assertEqual(state['fields']['UN'], 'UN')
        self.assertIn('UN', [row['value'] for row in self.h.summary_builder.calls[-1]['rows']])
        self.assertEqual(self.h.sharepoint.items, {})

    def test_returning_from_cancelled_confirmation_revalidates_unit(self):
        state, etag = self.pending_state()
        state['stage'] = 'cancelled_confirmation'
        self.h.engine._handle_cancelled_confirmation_reply(
            legacy.event('return-old-summary', 'text', reply_id='cancel_return_submission'), state, etag)
        self.assertEqual(state['fields']['UN'], 'UN')
        self.assertEqual(self.h.sharepoint.items, {})

    def test_attempted_payload_cannot_reopen_summary_or_product_edit(self):
        for resume in (True, False):
            with self.subTest(resume=resume):
                self.setUp()
                state, etag = self.pending_state()
                state['fields']['UN'] = 'UN'
                state['launch_unit_write_batch_id'] = state['batch_id']
                state['stage'] = 'awaiting_confirmation'
                before = copy.deepcopy(state)
                result = (self.h.engine._resend_current_prompt(state, etag) if resume else
                          self.h.engine._handle_confirmation_reply(
                              legacy.event('edit-attempted', 'text', text='EDITAR'), state, etag))
                self.assertEqual(result['status'], 'launch_product_unit_migration_blocked')
                for key in ('fields', 'answers', 'selections', 'launch_unit_write_batch_id'):
                    self.assertEqual(state[key], before[key])
                self.assertEqual(self.h.sharepoint.items, {})


if __name__ == '__main__':
    unittest.main()
