"""Real workflow with synthetic catalogs/media only; no business records are posted."""
import copy
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT)]
from workflow import WorkflowEngine
from logic import conversation_key


class Store:
    def __init__(self):
        self.rows = {}
        self.versions = {}

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


class Summary:
    def build(self, *args, **kwargs):
        return {'path': 'synthetic.png', 'filename': 'synthetic.png', 'width': 100, 'height': 100}


class Media:
    def read(self, item):
        return b'QA attachment bytes'


class Catalog:
    def __init__(self):
        self.rows = {}
        self.creates = []
        self.attachments = {}
        self.fail_attachment = False
        self.fail_verify = False
        self.unknown_create = False
        self.hide_rows = False
        self.ensure_calls = 0

    def get_options(self, step, context):
        source = step.get('source', {})
        if source.get('type') == 'static':
            return copy.deepcopy(source['options'])
        target = step.get('target_field')
        values = {'FILIAL': ['004 - OBRA QA', '003 - OUTRA QA'],
                  'TIPODOCUMENTO': ['TIPO A QA', 'TIPO B QA'],
                  'PESSOARELACIONADA': ['PESSOA A QA', 'PESSOA B QA'],
                  'IMOVEL': ['TODOS'], 'ETAPA': ['ETAPA A QA'],
                  'NUMCONTRATO': ['CONTRATO QA']}.get(target, [])
        return [{'id': n, 'title': value, 'value': value}
                for n, value in enumerate(values, 1)]

    def ensure_item(self, token, fields, *, target_list, **kwargs):
        if target_list != 'DOCUMENTOS':
            raise AssertionError('Unexpected real business target')
        self.ensure_calls += 1
        if token in self.rows and not self.hide_rows:
            return self.rows[token]['Id']
        item_id = 100 + len(self.rows)
        self.rows[token] = {'Id': item_id, 'fields': copy.deepcopy(fields)}
        self.creates.append(token)
        if self.unknown_create:
            self.unknown_create = False
            raise TimeoutError('Unknown POST outcome')
        return item_id

    def _find_item(self, token, target_list, idempotency_field):
        return None if self.hide_rows else copy.deepcopy(self.rows.get(token))

    def ensure_attachment(self, item_id, name, content, mime_type, *, target_list):
        if self.fail_attachment:
            raise RuntimeError('Synthetic attachment failure')
        self.attachments.setdefault(item_id, {})[name] = bytes(content)

    def verify_item(self, item_id, fields, names, *, target_list):
        if self.fail_verify:
            raise RuntimeError('Synthetic verification failure')
        row = next(row for row in self.rows.values() if row['Id'] == item_id)
        if row['fields'] != fields or set(self.attachments.get(item_id, {})) != set(names):
            raise AssertionError('Fields or attachment isolation broken')
        return {'fields': True, 'attachments': True}


class DocumentBatchTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / 'worker/workflow_config.json').read_text(encoding='utf-8'))
        self.config['limits']['post_completion_menu_enabled'] = False
        self.store, self.catalog, self.messenger = Store(), Catalog(), Messenger()
        self.engine = WorkflowEngine(self.config, self.store, Media(), self.messenger,
                                     self.catalog, summary_builder=Summary())
        self.event_counter = 0
        self.state = self.engine._new_state({'message_id': 'qa-start', 'sender': 'qa',
            'conversation_id': 'qa', 'phone_number_id': 'portal-admin'}, 'qa')

    def etag(self):
        return self.store.load(self.state['key'])[1]

    def begin(self):
        return self.engine._begin_action(self.state, self.etag(),
            {'flow': 'document', 'title': 'ADICIONAR UM NOVO DOCUMENTO'})

    def reply(self, reply_id='', text=''):
        self.event_counter += 1
        event = {'kind': 'text', 'message_id': f'qa-{self.event_counter}', 'reply_id': reply_id, 'text': text}
        if self.state['stage'] == 'submission_failed':
            return self.engine._handle_submission_failed_reply(event, self.state, self.etag())
        return self.engine._handle_text(event, self.state, self.etag())

    def ready(self):
        self.begin()
        self.reply('document_mode_multiple')
        self.state['fields'].update(FILIAL='004 - OBRA QA',
            TIPOHOMOLOGACAO='HOMOLOGAÇÃO MÃO DE OBRA', TIPODOCUMENTO='TIPO A QA',
            PESSOARELACIONADA='PESSOA A QA', DATA='2026-10-21', IMOVEL='TODOS', ETAPA='ETAPA A QA')
        self.state['display_values'].update(self.state['fields'])
        self.state['answers'] = {'filial': '004 - OBRA QA',
            'tipo_homologacao': 'HOMOLOGAÇÃO MÃO DE OBRA', 'tipo_documento': 'TIPO A QA',
            'pessoa_relacionada': 'PESSOA A QA', 'data_emissao': '2026-10-21',
            'tem_data_validade': 'NÃO', 'imovel': 'TODOS', 'tem_observacao': 'NÃO',
            'etapa_obra': 'ETAPA A QA'}
        self.attach('first-qa.pdf')
        self.state['step_index'] = len(self.config['sharepoint']['steps'])
        self.state['attachments_phase_completed'] = True
        self.state['attachments_decision'] = 'yes'
        self.engine._summarize_and_confirm(self.state, self.etag())

    def attach(self, name):
        self.state['attachments'] = [{'object_name': 'qa/' + name, 'sharepoint_name': name,
            'message_id': name, 'mime_type': 'application/pdf', 'size': 19}]

    def action_ids(self):
        return [action['id'] for action in self.messenger.sent[-1].get('actions', [])]

    def test_entry_offers_single_or_multiple_before_first_field(self):
        self.begin()
        self.assertEqual(self.state['stage'], 'choosing_document_mode')
        self.assertIn('document_mode_single', self.action_ids())
        self.assertIn('document_mode_multiple', self.action_ids())
        self.assertFalse(self.catalog.creates)

    def test_single_mode_returns_to_existing_first_field(self):
        self.begin()
        result = self.reply('document_mode_single')
        self.assertEqual(result.get('field'), 'filial')
        self.assertEqual(self.state['stage'], 'selecting_fields')
        self.engine._send_confirmation_actions(self.state)
        self.assertIn('confirm_yes', self.action_ids())
        self.assertNotIn('document_add_another', self.action_ids())

    def test_multiple_confirmation_offers_add_and_finish_without_posting(self):
        self.ready()
        self.assertIn('document_add_another', self.action_ids())
        self.assertIn('document_submit_final', self.action_ids())
        self.assertIn('confirm_edit', self.action_ids())
        self.assertFalse(self.catalog.creates)

    def test_add_posts_current_document_and_opens_editable_context(self):
        self.ready()
        previous = copy.deepcopy(self.state['fields'])
        result = self.reply('document_add_another')
        self.assertEqual(len(self.catalog.creates), 1)
        self.assertEqual(self.catalog.rows[self.catalog.creates[0]]['fields'], previous)
        self.assertEqual(self.catalog.attachments[100], {'first-qa.pdf': b'QA attachment bytes'})
        self.assertEqual(result['status'], 'awaiting_document_defaults')
        self.assertEqual(self.state['fields']['PESSOARELACIONADA'], 'PESSOA A QA')
        self.assertEqual(self.state['fields']['DATA'], '2026-10-21')
        self.assertNotIn('TIPODOCUMENTO', self.state['fields'])
        self.assertEqual(self.state['attachments'], [])
        self.assertEqual(self.state['navigation_history'], [])
        self.assertEqual(self.state['sharepoint'], {})

    def test_proceed_asks_only_type_then_fresh_required_attachment(self):
        self.ready()
        self.reply('document_add_another')
        result = self.reply('document_defaults_proceed')
        self.assertEqual(result.get('field'), 'tipo_documento')
        result = self.reply('2')
        self.assertEqual(self.state['fields']['TIPODOCUMENTO'], 'TIPO B QA')
        self.assertEqual(self.state['stage'], 'collecting_attachments')
        self.assertEqual(result['status'], 'waiting_for_attachments')
        self.assertEqual(len(self.catalog.creates), 1)

    def test_defaults_offer_person_branch_dates_stage_and_observation(self):
        self.ready()
        self.reply('document_add_another')
        values = [option['value'] for option in self.state['options']]
        steps = self.config['sharepoint']['steps']
        keys = [steps[value]['key'] for value in values if isinstance(value, int)]
        for key in ['filial', 'pessoa_relacionada', 'data_emissao',
                    'tem_data_validade', 'etapa_obra', 'tem_observacao']:
            self.assertIn(key, keys)
        self.assertNotIn('tipo_documento', keys)

    def test_edit_issue_date_returns_to_defaults_without_changing_previous_row(self):
        self.ready()
        self.reply('document_add_another')
        option = next(x for x in self.state['options'] if x.get('value') == 4)
        self.reply(str(option['id']))
        result = self.reply(text='22/10/2026')
        self.assertEqual(result['status'], 'awaiting_document_defaults')
        self.assertEqual(self.state['fields']['DATA'], '2026-10-22')
        self.assertEqual(self.catalog.rows[self.catalog.creates[0]]['fields']['DATA'], '2026-10-21')

    def test_final_submits_new_type_and_attachment_as_separate_document(self):
        self.ready()
        self.reply('document_add_another')
        self.reply('document_defaults_proceed')
        self.reply('2')
        self.attach('second-qa.pdf')
        self.state['attachments_phase_completed'] = True
        self.engine._summarize_and_confirm(self.state, self.etag())
        result = self.reply('document_submit_final')
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(self.state['stage'], 'completed')
        self.assertEqual(len(self.catalog.creates), 2)
        self.assertEqual(self.catalog.rows[self.catalog.creates[1]]['fields']['TIPODOCUMENTO'], 'TIPO B QA')
        self.assertEqual(set(self.catalog.attachments[101]), {'second-qa.pdf'})
        self.assertEqual(set(self.catalog.attachments[100]), {'first-qa.pdf'})

    def test_mode_and_defaults_are_resendable_without_writes(self):
        self.begin()
        self.engine._resend_current_prompt(self.state, self.etag())
        self.assertIn('document_mode_multiple', self.action_ids())
        self.ready()
        self.reply('document_add_another')
        self.engine._resend_current_prompt(self.state, self.etag())
        self.assertEqual(self.state['stage'], 'document_batch_defaults')
        self.assertEqual(len(self.catalog.creates), 1)

    def test_unknown_creation_not_visible_never_reposts_on_retry(self):
        self.ready()
        self.catalog.unknown_create = self.catalog.hide_rows = True
        self.assertEqual(self.reply('document_add_another')['status'], 'submission_failed')
        self.assertEqual(self.reply('retry_submission')['status'], 'submission_failed')
        self.assertEqual(len(self.catalog.creates), 1)
        self.assertEqual(self.catalog.ensure_calls, 1)
        self.catalog.hide_rows = False
        self.assertEqual(self.reply('retry_submission')['status'], 'awaiting_document_defaults')
        self.assertEqual(self.catalog.ensure_calls, 1)
        self.assertEqual(set(self.catalog.attachments[100]), {'first-qa.pdf'})

    def test_attachment_failure_retries_known_row_without_create_call(self):
        self.ready()
        self.catalog.fail_attachment = True
        self.assertEqual(self.reply('document_add_another')['status'], 'submission_failed')
        self.catalog.fail_attachment = False
        self.assertEqual(self.reply('retry_submission')['status'], 'awaiting_document_defaults')
        self.assertEqual(self.catalog.ensure_calls, 1)
        self.assertEqual(len(self.catalog.creates), 1)

    def test_frozen_fields_and_attachments_survive_stale_state_and_retry(self):
        self.ready()
        before = copy.deepcopy(self.state['fields'])
        self.catalog.fail_verify = True
        self.reply('document_add_another')
        self.catalog.fail_verify = False
        self.state['fields']['PESSOARELACIONADA'] = 'UNRELATED STALE PERSON'
        self.attach('wrong-stale-attachment.pdf')
        result = self.reply('retry_submission')
        self.assertEqual(result['status'], 'awaiting_document_defaults')
        self.assertEqual(self.state['fields']['PESSOARELACIONADA'], before['PESSOARELACIONADA'])
        self.assertEqual(set(self.catalog.attachments[100]), {'first-qa.pdf'})
        self.assertEqual(self.catalog.ensure_calls, 1)

    def test_checkpoint_is_independent_of_restored_precommit_draft(self):
        self.ready()
        stale = copy.deepcopy(self.state)
        self.reply('document_add_another')
        self.state = stale
        self.state['fields']['PESSOARELACIONADA'] = 'UNRELATED STALE PERSON'
        result = self.reply('document_add_another')
        self.assertEqual(result['status'], 'awaiting_document_defaults')
        self.assertEqual(self.catalog.ensure_calls, 1)
        self.assertEqual(self.state['fields']['PESSOARELACIONADA'], 'PESSOA A QA')
        self.assertEqual(self.state['document_batch']['submitted'], [100])

    def test_checkpoint_storage_failure_precedes_any_sharepoint_write(self):
        self.ready()
        original_save = self.store.save

        def fail_checkpoint(key, value, etag):
            if key != self.state['key']:
                raise RuntimeError('Synthetic durable storage failure')
            return original_save(key, value, etag)

        with patch.object(self.store, 'save', side_effect=fail_checkpoint):
            result = self.reply('document_add_another')
        self.assertEqual(result['status'], 'submission_failed')
        self.assertFalse(self.catalog.creates)

    def test_pending_row_cannot_be_edited_from_old_confirmation(self):
        self.ready()
        self.catalog.fail_attachment = True
        self.reply('document_add_another')
        self.state['stage'] = 'awaiting_confirmation'
        result = self.reply('confirm_edit')
        self.assertEqual(result['status'], 'document_submission_locked')
        self.assertNotEqual(self.state['stage'], 'editing_field_choice')
        self.assertEqual(self.catalog.ensure_calls, 1)

    def test_changing_homologation_does_not_ask_type_until_proceed(self):
        self.ready()
        self.reply('document_add_another')
        self.reply('2')  # homologation, index 1
        result = self.reply('2')  # HOMOLOGAÇÃO FILIAL
        self.assertNotEqual(result.get('field'), 'tipo_documento')
        self.assertEqual(self.state['fields']['TIPOHOMOLOGACAO'], 'HOMOLOGAÇÃO FILIAL')

    def test_validity_can_be_added_and_removed_for_next_document(self):
        self.ready()
        self.reply('document_add_another')
        self.reply('6')  # tem_data_validade
        result = self.reply('1')
        self.assertEqual(result.get('field'), 'data_validade')
        self.reply(text='21/10/2027')
        self.assertEqual(self.state['fields']['DATAVALIDADE'], '2027-10-21')
        self.reply('6')
        result = self.reply('2')
        self.assertEqual(result['status'], 'awaiting_document_defaults')
        self.assertNotIn('DATAVALIDADE', self.state['fields'])

    def test_final_without_new_attachment_cannot_post_previous_file_again(self):
        self.ready()
        self.reply('document_add_another')
        self.reply('document_defaults_proceed')
        self.reply('2')
        self.state['stage'] = 'awaiting_confirmation'
        self.reply('document_submit_final')
        self.assertEqual(len(self.catalog.creates), 1)
        self.assertNotEqual(self.state['stage'], 'completed')

    def test_three_documents_receive_distinct_identities_and_do_not_reuse_files(self):
        self.ready()
        self.reply('document_add_another')
        for name in ('second-qa.pdf', 'third-qa.pdf'):
            self.reply('document_defaults_proceed')
            self.reply('2')
            self.attach(name)
            self.state['attachments_phase_completed'] = True
            self.engine._summarize_and_confirm(self.state, self.etag())
            self.reply('document_add_another' if name == 'second-qa.pdf' else 'document_submit_final')
        self.assertEqual(len(set(self.catalog.creates)), 3)
        self.assertEqual(set(self.catalog.attachments[100]), {'first-qa.pdf'})
        self.assertEqual(set(self.catalog.attachments[101]), {'second-qa.pdf'})
        self.assertEqual(set(self.catalog.attachments[102]), {'third-qa.pdf'})
        self.assertEqual(self.state['stage'], 'completed')

    def test_cancel_next_keeps_already_submitted_document(self):
        self.ready()
        self.reply('document_add_another')
        self.reply('document_defaults_proceed')
        self.reply('2')
        self.attach('second-qa.pdf')
        self.engine._summarize_and_confirm(self.state, self.etag())
        self.reply('confirm_cancel')
        self.assertEqual(self.state['stage'], 'cancelled_confirmation')
        self.assertEqual(len(self.catalog.creates), 1)
        self.assertEqual(set(self.catalog.attachments[100]), {'first-qa.pdf'})

    def test_embedded_type_registration_preserves_batch_and_returns_to_attachment(self):
        self.ready()
        self.reply('document_add_another')
        self.reply('document_defaults_proceed')
        expected = copy.deepcopy(self.state['document_batch'])
        self.reply('register_new_document_type')
        self.assertEqual(self.state['flow'], 'document_type_registration')
        self.state['fields']['TIPODOCUMENTO'] = 'TIPO NOVO QA'
        result = self.engine._resume_document_with_registered_document_type(self.state, self.etag(), 900)
        self.assertEqual(self.state['flow'], 'document')
        self.assertEqual(self.state['document_batch'], expected)
        self.assertEqual(self.state['fields']['TIPODOCUMENTO'], 'TIPO NOVO QA')
        self.assertEqual(result['status'], 'waiting_for_attachments')
        self.assertEqual(len(self.catalog.creates), 1)

    def test_single_document_submission_still_uses_original_token_and_completion(self):
        self.ready()
        self.state['document_batch']['mode'] = 'single'
        result = self.reply('confirm_yes')
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(self.catalog.creates, ['WA-document-' + self.state['batch_id']])

    def test_begin_another_flow_does_not_inherit_document_mode(self):
        self.begin()
        self.reply('document_mode_multiple')
        self.engine._begin_action(self.state, self.etag(), {'flow': 'task', 'title': 'TAREFA'})
        self.assertNotIn('document_batch', self.state)

    def test_edit_noncommercial_person_keeps_unrelated_property_and_date(self):
        self.ready()
        self.reply('document_add_another')
        self.reply('4')  # pessoa_relacionada
        result = self.reply('2')
        self.assertEqual(result['status'], 'awaiting_document_defaults')
        self.assertEqual(self.state['fields']['PESSOARELACIONADA'], 'PESSOA B QA')
        self.assertEqual(self.state['fields']['IMOVEL'], 'TODOS')
        self.assertEqual(self.state['fields']['DATA'], '2026-10-21')

    def test_defaults_issue_date_is_identifiable_without_confusing_validity_date(self):
        self.ready()
        self.reply('document_add_another')
        option = next((x for x in self.state['options'] if x.get('title') == 'DATA DE EMISSÃO'), None)
        self.assertIsNotNone(option)
        result = self.reply(str(option['id']))
        self.assertEqual(result.get('field'), 'data_emissao')

    def test_finalizing_new_attachment_after_type_does_not_repeat_other_fields(self):
        self.ready()
        self.reply('document_add_another')
        self.reply('document_defaults_proceed')
        self.reply('2')
        self.attach('second-qa.pdf')
        result = self.reply('finish_attachments')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertEqual(self.state['stage'], 'awaiting_confirmation')
        self.assertIn('document_submit_final', self.action_ids())
        result = self.reply('document_submit_final')
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(len(self.catalog.creates), 2)

    def test_full_initial_form_requires_attachment_and_finishes_in_multiple_menu(self):
        self.begin()
        self.reply('document_mode_multiple')
        for reply_id, text in [('1', ''), ('1', ''), ('1', ''), ('1', ''),
                               ('', '21/10/2026'), ('2', ''), ('1', ''), ('2', ''), ('1', '')]:
            self.reply(reply_id, text)
        self.assertEqual(self.state['stage'], 'collecting_attachments')
        self.assertEqual(self.state['fields']['ETAPA'], 'ETAPA A QA')
        self.attach('initial-flow-qa.pdf')
        result = self.reply('finish_attachments')
        self.assertEqual(result['status'], 'awaiting_confirmation')
        self.assertIn('document_add_another', self.action_ids())
        self.assertFalse(self.catalog.creates)

    def test_public_handle_deduplicates_repeated_add_event(self):
        self.ready()
        event = {'kind': 'text', 'message_id': 'public-qa-add', 'reply_id': 'document_add_another',
                 'text': '', 'sender': 'qa', 'conversation_id': 'qa', 'phone_number_id': 'portal-admin',
                 'trusted_portal': True}
        self.config['whatsapp']['accept_private_chats'] = True
        self.state['key'] = conversation_key(event)
        self.store.save(self.state['key'], self.state, None)
        result = self.engine.handle(event)
        self.assertEqual(result['status'], 'awaiting_document_defaults')
        self.engine.handle(event)
        self.assertEqual(len(self.catalog.creates), 1)
        saved, _ = self.store.load(self.state['key'])
        self.assertEqual(saved['document_batch']['index'], 1)
        self.assertEqual(saved['attachments'], [])

    def test_new_document_after_cancelled_sequence_uses_new_batch_identity(self):
        self.ready()
        self.reply('document_add_another')
        old_batch = self.state['batch_id']
        self.begin()
        self.reply('document_mode_multiple')
        self.assertNotEqual(self.state['batch_id'], old_batch)

    def test_public_attachment_event_cannot_modify_pending_frozen_row(self):
        self.ready()
        self.catalog.fail_attachment = True
        self.reply('document_add_another')
        event = {'kind': 'attachment', 'message_id': 'unsafe-attachment', 'sender': 'qa',
                 'conversation_id': 'qa', 'phone_number_id': 'portal-admin', 'trusted_portal': True}
        self.config['whatsapp']['accept_private_chats'] = True
        self.state['key'] = conversation_key(event)
        self.store.save(self.state['key'], self.state, None)
        # Move the checkpoint key consistently for this public-conversation fixture.
        self.state['stage'] = 'awaiting_confirmation'
        self.engine._commit(self.state, self.etag())
        result = self.engine.handle(event)
        self.assertEqual(result['status'], 'document_submission_locked')
        self.assertEqual(len(self.catalog.creates), 1)

    def public_event(self, reply_id, text=''):
        self.event_counter += 1
        event = {'kind': 'text', 'message_id': f'public-{self.event_counter}', 'reply_id': reply_id,
                 'text': text, 'sender': 'qa', 'conversation_id': 'qa', 'phone_number_id': 'portal-admin',
                 'trusted_portal': True}
        self.config['whatsapp']['accept_private_chats'] = True
        self.state['key'] = conversation_key(event)
        current = self.store.load(self.state['key'])[1]
        self.store.save(self.state['key'], self.state, current)
        result = self.engine.handle(event)
        self.state, _ = self.store.load(self.state['key'])
        return result

    def test_completed_sequence_allows_public_main_menu_and_next_operation(self):
        self.ready()
        result = self.public_event('document_submit_final')
        self.assertEqual(result['status'], 'completed')
        result = self.public_event('navigation_main_menu')
        self.assertNotEqual(result['status'], 'completed')
        self.assertEqual(self.state['stage'], 'choosing_group')
        self.assertEqual(len(self.catalog.creates), 1)
        self.begin()
        self.reply('document_mode_multiple')
        self.assertEqual(self.state['stage'], 'selecting_fields')

    def test_prefixed_whatsapp_proceed_reaches_type_through_public_handle(self):
        self.ready()
        self.public_event('document_add_another')
        result = self.public_event('choice:edit_field:document_defaults_proceed')
        self.assertEqual(result.get('field'), 'tipo_documento')
        self.assertEqual(self.state['stage'], 'selecting_fields')
        self.assertEqual(len(self.catalog.creates), 1)

    def test_return_from_cancelled_embedded_type_keeps_multi_document_identity(self):
        self.ready()
        self.reply('document_add_another')
        self.reply('document_defaults_proceed')
        expected = copy.deepcopy(self.state['document_batch'])
        self.reply('register_new_document_type')
        self.assertEqual(self.state['flow'], 'document_type_registration')
        self.engine._navigate_back(self.state, self.etag())
        self.assertEqual(self.state['flow'], 'document')
        self.assertEqual(self.state.get('document_batch'), expected)
        self.assertEqual(len(self.catalog.creates), 1)


if __name__ == '__main__':
    unittest.main()
