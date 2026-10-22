"""Exercise the real payment workflow with in-memory storage/SharePoint only."""
import copy
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT)]
from workflow import WorkflowEngine
from payment_provision_group import provision_preview


class Store:
    def __init__(self):
        self.rows, self.versions = {}, {}

    def load(self, key):
        return copy.deepcopy(self.rows.get(key)), self.versions.get(key)

    def save(self, key, state, etag):
        if etag != self.versions.get(key):
            raise RuntimeError('etag conflict')
        self.rows[key] = copy.deepcopy(state)
        self.versions[key] = str(int(self.versions.get(key, '0')) + 1)
        return self.versions[key]


class Messenger:
    def __init__(self):
        self.sent = []

    def send_text(self, state, body):
        self.sent.append({'type': 'text', 'body': body})

    def send_options(self, state, step, options, maximum):
        self.sent.append({'type': 'poll', 'step': copy.deepcopy(step),
                          'options': copy.deepcopy(options[:maximum])})

    send_filtered_options = send_options

    def send_actions(self, state, body, actions):
        self.sent.append({'type': 'actions', 'body': body, 'actions': copy.deepcopy(actions)})

    def send_image(self, *args, **kwargs):
        pass


class Catalog:
    def __init__(self):
        self.rows, self.tokens, self.creates = {}, {}, []
        self.fail_child_verification = False

    def get_options(self, step, context):
        source = step.get('source', {})
        if source.get('type') == 'static':
            return copy.deepcopy(source['options'])
        values = {'PRODUTO': ['PRODUTO A QA', 'PRODUTO B QA'],
                  'FORNECEDOR': ['FORNECEDOR QA'], 'FILIAL': ['004 - OBRA QA'],
                  'IMOVEL': ['TODOS'], 'FORMAPGTO': ['PIX']}.get(step.get('target_field'), [])
        return [{'id': i, 'title': value, 'value': value} for i, value in enumerate(values, 1)]

    def _find_item(self, token, target_list, idempotency_field):
        item_id = self.tokens.get((target_list, token))
        return {'Id': item_id} if item_id else None

    def ensure_item(self, token, fields, *, target_list, **kwargs):
        if target_list not in {'DESCRITIVOPROVISAO', 'PROVISÃO PGTOS'}:
            raise AssertionError('Unexpected financial destination')
        if (target_list, token) in self.tokens:
            raise AssertionError('Repeated creation instead of checkpoint recovery')
        item_id = 100 + len(self.rows)
        self.rows[target_list, item_id] = {'fields': copy.deepcopy(fields), 'version': 1}
        self.tokens[target_list, token] = item_id
        self.creates.append((target_list, item_id))
        return item_id

    def verify_item(self, item_id, fields, names, *, target_list):
        if names:
            raise AssertionError('This test does not submit attachments')
        actual = self.rows[target_list, item_id]['fields']
        if any(actual.get(key) != value for key, value in fields.items()):
            raise AssertionError('Posted fields differ from the verified payload')
        if target_list == 'PROVISÃO PGTOS' and self.fail_child_verification:
            self.fail_child_verification = False
            raise RuntimeError('Synthetic lost child verification response')
        return {'fields': True, 'attachments': True}

    def get_item_fields_with_etag(self, item_id, fields, *, target_list):
        row = self.rows[target_list, int(item_id)]
        return {key: row['fields'].get(key) for key in fields}, str(row['version'])

    def update_item_with_etag(self, item_id, fields, etag, *, target_list):
        row = self.rows[target_list, int(item_id)]
        if str(row['version']) != etag:
            raise RuntimeError('Stale SharePoint ETag')
        row['fields'].update(copy.deepcopy(fields))
        row['version'] += 1

    def get_provision_description(self, parent):
        return {'Id': int(parent), 'CHILDREN': [
            {'Id': item_id, **copy.deepcopy(row['fields'])}
            for (target, item_id), row in self.rows.items()
            if target == 'PROVISÃO PGTOS' and row['fields'].get('DESCRITIVOPROVISAO') == str(parent)]}


class Summary:
    def __init__(self):
        self.rows = []

    def build(self, *, rows, attachments, batch_id):
        self.rows.append(copy.deepcopy(rows))
        return {'path': 'synthetic-qa.png', 'filename': 'synthetic-qa.png', 'width': 390, 'height': 700}


def line(product='PRODUTO A QA', quantity='2', unit='10', freight='7.5'):
    return {'fields': {'PRODUTO': product, 'QTD': quantity, 'VALOR TOTAL': unit,
            'FRETE': freight, 'FORNECEDOR': 'FORNECEDOR QA', 'FILIAL': '004 - OBRA QA',
            'IMOVEL': 'TODOS', 'FORMA PGTO': 'PIX', 'DATA PREVISTO PGTO': '2026-11-20', 'OBS': ''},
            'answers': {'tipo_provisao_pagamento': 'MULTIPLOS', 'tem_frete_pagamento': 'SIM',
                        'frete_pagamento': freight, 'tem_observacao_pagamento': 'NÃO'},
            'display_values': {'FRETE': 'R$ 7,50'},
            'selections': {'tem_frete_pagamento': {'id': 1, 'value': 'SIM', 'title': 'SIM'}}}


class FirstFreightTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / 'worker/workflow_config.json').read_text(encoding='utf-8'))
        self.config['limits']['post_completion_menu_enabled'] = False
        self.store, self.catalog, self.messenger = Store(), Catalog(), Messenger()
        self.summary = Summary()
        self.engine = WorkflowEngine(self.config, self.store, None, self.messenger, self.catalog,
                                     summary_builder=self.summary)
        self.state = self.engine._new_state({'message_id': 'qa-start', 'sender': 'qa',
            'conversation_id': 'qa', 'phone_number_id': 'portal-admin'}, 'qa')
        self.state.update(flow='payment', stage='selecting_fields', provision_lines=[])
        self.state.update(copy.deepcopy(line()))
        self.state['answers'].pop('tem_frete_pagamento')
        self.state['answers'].pop('frete_pagamento')
        self.state['selections'] = {}
        self.state['fields'].pop('FRETE')
        self.state['step_index'] = self.index('tem_frete_pagamento')
        self.counter = 0

    def index(self, key):
        return next(i for i, step in enumerate(self.config['sharepoint']['payment_flow']['steps'])
                    if step['key'] == key)

    def etag(self):
        return self.store.load(self.state['key'])[1]

    def reply(self, text):
        self.counter += 1
        return self.engine._handle_text({'kind': 'text', 'message_id': f'qa-{self.counter}',
                                        'reply_id': text, 'text': text}, self.state, self.etag())

    def first_saved(self, freight='7.5'):
        self.state.update(copy.deepcopy(line(freight=freight)))
        self.state['provision_lines'] = [copy.deepcopy(line(freight=freight))]
        self.state['provision_current_saved'] = True
        self.engine._prompt_provision_question(self.state, self.etag(), 'asking_provision_more')

    def additional(self):
        self.first_saved()
        self.reply('1')
        return self.reply('1')

    def test_first_multiple_item_asks_if_there_is_freight_then_its_value(self):
        result = self.engine._prompt_next_or_summary(self.state, self.etag())
        self.assertEqual(result.get('field'), 'tem_frete_pagamento')
        self.assertEqual(self.reply('1').get('field'), 'frete_pagamento')
        self.assertEqual(self.reply('7,50').get('field'), 'tem_observacao_pagamento')
        self.assertEqual(self.state['fields']['FRETE'], '7,5')

    def test_no_freight_on_first_item_keeps_zero(self):
        self.engine._prompt_next_or_summary(self.state, self.etag())
        self.assertEqual(self.reply('2').get('field'), 'tem_observacao_pagamento')
        self.assertEqual(self.state['fields']['FRETE'], '0')

    def test_new_item_does_not_inherit_freight_or_its_selection(self):
        self.first_saved()
        original = copy.deepcopy(self.state['provision_lines'][0])
        self.reply('1')
        self.assertEqual(self.state['fields']['FRETE'], '0')
        self.assertEqual(self.state['answers']['tem_frete_pagamento'], 'NÃO')
        self.assertNotIn('frete_pagamento', self.state['answers'])
        self.assertNotIn('tem_frete_pagamento', self.state['selections'])
        self.assertEqual(self.state['provision_lines'][0], original)

    def test_second_and_third_item_ask_only_product_quantity_and_unit_price(self):
        self.assertEqual(self.additional().get('field'), 'produto_pagamento')
        self.assertEqual(self.reply('2').get('field'), 'quantidade_pagamento')
        self.assertEqual(self.reply('3').get('field'), 'valor_unitario_pagamento')
        self.assertEqual(self.reply('20').get('status'), 'awaiting_provision_choice')
        self.assertEqual(self.state['stage'], 'asking_provision_more')
        self.assertEqual([row['fields']['FRETE'] for row in self.state['provision_lines']], ['7.5', '0'])
        self.reply('1')
        self.assertEqual(self.reply('1').get('field'), 'produto_pagamento')
        self.reply('1')
        self.reply('1')
        self.reply('5')
        preview = provision_preview(self.state)
        self.assertEqual([row['freight'] for row in preview['lines']], ['7.5', '0', '0'])
        self.assertEqual(preview['total'], '92.5')
        freight_questions = [message for message in self.messenger.sent
            if message.get('step', {}).get('key') in {'tem_frete_pagamento', 'frete_pagamento'}]
        self.assertEqual(freight_questions, [])

    def test_resumed_later_item_skips_old_freight_steps_and_clears_stale_values(self):
        for key in ['tem_frete_pagamento', 'frete_pagamento']:
            with self.subTest(key=key):
                self.state['provision_lines'] = [line()]
                self.state.update(copy.deepcopy(line(freight='99')))
                self.state['provision_current_saved'] = False
                self.state['step_index'] = self.index(key)
                result = self.engine._prompt_next_or_summary(self.state, self.etag())
                self.assertEqual(result.get('field'), 'tem_observacao_pagamento')
                self.assertEqual(self.state['fields']['FRETE'], '0')
                self.assertEqual(self.state['provision_lines'][0]['fields']['FRETE'], '7.5')

    def test_freight_edit_options_remain_on_first_item_but_not_later_items(self):
        self.first_saved()
        keys = self.config['sharepoint']['payment_flow']['steps']
        def offered():
            return {keys[option['value']]['key'] for option in self.engine._editable_options(self.state)
                    if isinstance(option.get('value'), int)}
        self.assertTrue({'tem_frete_pagamento', 'frete_pagamento'}.issubset(offered()))
        self.reply('1')
        self.assertTrue({'tem_frete_pagamento', 'frete_pagamento'}.isdisjoint(offered()))

    def test_ordinary_first_item_freight_edit_is_preserved(self):
        self.first_saved()
        self.state['stage'] = 'selecting_fields'
        self.state['step_index'] = self.index('frete_pagamento')
        self.state['edit_step_indices'] = [self.index('frete_pagamento')]
        self.assertEqual(self.engine._prompt_next_or_summary(self.state, self.etag()).get('field'), 'frete_pagamento')
        self.reply('12,50')
        self.assertEqual(self.state['provision_lines'][0]['fields']['FRETE'], '12,5')

    def ready_to_commit(self):
        self.state['provision_lines'] = [line(), line('PRODUTO B QA', '3', '20', '99'),
                                         line('PRODUTO A QA', '1', '5', '99')]
        self.state['provision_current_saved'] = True
        self.state['provision_reference_supplier'] = 'FORNECEDOR QA'
        self.state['provision_parent_mode'] = 'NEW'
        self.state.update(copy.deepcopy(self.state['provision_lines'][-1]))
        self.state['stage'] = 'committing'

    def test_commit_posts_freight_on_first_child_only_and_exact_parent_total(self):
        self.ready_to_commit()
        self.engine._summarize_and_confirm(self.state, self.etag())
        self.engine._persist_provision_group(self.state, self.etag(), self.engine._flow_config(self.state))
        children = [row['fields'] for (target, _), row in self.catalog.rows.items() if target == 'PROVISÃO PGTOS']
        self.assertEqual([row['FRETE'] for row in children], ['7.5', '0', '0'])
        parent = next(row['fields'] for (target, _), row in self.catalog.rows.items() if target == 'DESCRITIVOPROVISAO')
        self.assertEqual(parent['VALORTOTAL'], '92.5')
        self.assertEqual(len({row['DESCRITIVOPROVISAO'] for row in children}), 1)

    def test_retry_after_child_write_preserves_frozen_payload_and_does_not_duplicate(self):
        self.ready_to_commit()
        self.engine._summarize_and_confirm(self.state, self.etag())
        self.catalog.fail_child_verification = True
        with self.assertRaisesRegex(RuntimeError, 'Synthetic lost'):
            self.engine._persist_provision_group(self.state, self.etag(), self.engine._flow_config(self.state))
        frozen = copy.deepcopy(self.state['provision_commit']['children'])
        self.engine._persist_provision_group(self.state, self.etag(), self.engine._flow_config(self.state))
        self.assertEqual([child['fields']['FRETE'] for child in frozen], ['7.5', '0', '0'])
        for after, before in zip(self.state['provision_commit']['children'], frozen):
            self.assertEqual({key: after['fields'][key] for key in before['fields']}, before['fields'])
        self.assertEqual(len(self.catalog.creates), 4)

    def test_started_legacy_submission_is_not_rewritten(self):
        self.ready_to_commit()
        self.state['provision_commit'] = {'parent_id': 100, 'attachments': [], 'attachment_digests': []}
        before = copy.deepcopy(self.state['provision_lines'])
        self.state['step_index'] = self.index('frete_pagamento')
        self.engine._current_step(self.state)
        self.assertEqual(self.state['provision_lines'], before)
        self.assertEqual(self.state['fields']['FRETE'], '99')

    def test_single_mode_and_legacy_single_drafts_still_ask_freight(self):
        for mode in ['UNICO', None]:
            with self.subTest(mode=mode):
                self.state['answers'] = {} if mode is None else {'tipo_provisao_pagamento': mode}
                self.state['provision_lines'] = []
                self.state['step_index'] = self.index('tem_frete_pagamento')
                result = self.engine._prompt_next_or_summary(self.state, self.etag())
                self.assertEqual(result.get('field'), 'tem_frete_pagamento')

    def old_freight_prompt(self):
        self.state['provision_lines'] = [line()]
        self.state.update(copy.deepcopy(line(freight='99')))
        self.state['provision_current_saved'] = False
        self.state['step_index'] = self.index('tem_frete_pagamento')
        step = self.config['sharepoint']['payment_flow']['steps'][self.state['step_index']]
        self.state['options'] = copy.deepcopy(step['source']['options'])

    def test_draft_resume_displays_the_next_real_question_not_the_retired_freight_question(self):
        self.old_freight_prompt()
        result = self.engine._resume_draft_prompt(self.state, self.etag())
        self.assertEqual(result.get('field'), 'tem_observacao_pagamento')
        self.assertEqual(self.messenger.sent[-1]['step']['key'], 'tem_observacao_pagamento')
        self.assertEqual(self.state['fields']['FRETE'], '0')
        self.assertEqual(self.catalog.creates, [])

    def test_a_stale_freight_reply_does_not_answer_the_observation_question(self):
        self.old_freight_prompt()
        self.assertEqual(self.reply('1').get('field'), 'tem_observacao_pagamento')
        self.assertEqual(self.state['answers']['tem_observacao_pagamento'], 'NÃO')
        self.assertEqual(self.state['answers']['tem_frete_pagamento'], 'NÃO')
        self.assertEqual(self.state['fields']['FRETE'], '0')

    def displayed_total(self):
        return next(row['value'] for row in self.summary.rows[-1] if row['label'] == 'TOTAL DA PROVISÃO')

    def test_resumed_confirmation_shows_the_corrected_total_before_accepting_confirmation(self):
        self.ready_to_commit()
        self.state['stage'] = 'awaiting_confirmation'
        self.engine._resume_draft_prompt(self.state, self.etag())
        self.assertTrue(self.summary.rows, 'A corrected review must be rendered before confirming')
        self.assertEqual(self.displayed_total(), 'R$ 92,50')
        self.assertEqual(self.catalog.creates, [])
        self.reply('confirm_yes')
        parent = next(row['fields'] for (target, _), row in self.catalog.rows.items() if target == 'DESCRITIVOPROVISAO')
        self.assertEqual(parent['VALORTOTAL'], '92.5')

    def test_stale_confirmation_is_replaced_by_a_corrected_review_without_posting(self):
        self.ready_to_commit()
        self.state['stage'] = 'awaiting_confirmation'
        self.assertEqual(self.reply('confirm_yes').get('status'), 'awaiting_confirmation')
        self.assertEqual(self.catalog.creates, [])
        self.assertEqual(self.displayed_total(), 'R$ 92,50')
        self.reply('confirm_yes')
        self.assertEqual(len(self.catalog.creates), 4)

    def test_reading_an_updated_preview_does_not_approve_the_changed_total(self):
        self.ready_to_commit()
        self.state['stage'] = 'awaiting_confirmation'
        rows = self.engine._summary_rows(self.state)
        self.assertEqual(next(row['value'] for row in rows if row['label'] == 'TOTAL DA PROVISÃO'), 'R$ 92,50')
        self.reply('confirm_yes')
        self.assertEqual(self.catalog.creates, [])
        self.assertEqual(self.displayed_total(), 'R$ 92,50')


if __name__ == '__main__':
    unittest.main()
