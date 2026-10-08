"""Real bridge + production local optimistic store; no external writes."""
import copy
from pathlib import Path
import tempfile
import threading
import unittest

import test_workflow as fixtures
from channel_bridge import ChannelBridge, ChannelMessenger, normalize_channel_events, portal_channel_payload
from local_app import LocalStateStore


class MultiLaunchStateVersionTests(unittest.TestCase):
    def setUp(self):
        fixtures.WorkflowTests.setUp(self)
        self.config['limits']['inactivity_expiration_enabled'] = False
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = LocalStateStore(Path(self.directory.name))
        self.engine.state_store = self.state
        self.messenger = ChannelMessenger()
        self.engine.messenger = self.messenger
        self.bridge = ChannelBridge.__new__(ChannelBridge)
        self.bridge.engine = self.engine
        self.bridge.messenger = self.messenger
        self.bridge.lock = threading.Lock()
        self.identity = {'oid': 'synthetic-multi-launch', 'name': 'Teste isolado'}
        self.number = 0
        incoming = normalize_channel_events(self.payload('SIM', 'seed'))[0]
        self.key = fixtures.conversation_key(incoming)
        self.current = self.engine._new_state(incoming, self.key)
        self.current.update(flow='launch', stage='selecting_fields',
                            fields={'FORNECEDOR': 'FORNECEDOR TESTE', 'FILIAL': 'FILIAL TESTE',
                                    'ETAPA': 'ETAPA TESTE', 'CONTA': 'PIX', 'PRODUTO': 'CIMENTO',
                                    'UN': 'SC', 'QUANTIDADE': '2', 'VALOR UNITÁRIO': '10',
                                    'FRETE': '5', 'DESCRIÇÃO': 'Preservar esta observação',
                                    'DATA PGTO PREVISTO': '2026-10-08', 'DATA PGTO EFETUADO': '2026-10-08'},
                            answers={'pedido_lancamento': 'NOVO PEDIDO', 'tipo_lancamento': 'LANÇAMENTO MÚLTIPLO'},
                            launch_lines=[], current_launch_line_saved=False,
                            draft_user_input_seen=True)
        self.current['display_values'] = copy.deepcopy(self.current['fields'])
        self.attachment = self.media.stage(fixtures.event('file', 'attachment',
            original_filename='comprovante.pdf', mime_type='application/pdf', content=b'synthetic-evidence'),
            self.current['batch_id'], self.key)
        self.current['attachments'] = [self.attachment]
        self.prepare_more_line(self.current)
        self.state.save(self.key, self.current, None)

    def payload(self, reply, message=None):
        self.number += 1
        return portal_channel_payload({'messageId': message or f'multi-{self.number}', 'replyId': reply}, self.identity)

    def send(self, reply, message=None):
        return self.bridge.handle(self.payload(reply, message))

    def load(self):
        return self.state.load(self.key)

    def prepare_more_line(self, state):
        steps = self.engine._flow_config(state)['steps']
        state['step_index'] = next(i for i, step in enumerate(steps) if step['key'] == 'acrescentar_linha_lancamento')
        state['stage'] = 'selecting_fields'
        state['options'] = copy.deepcopy(steps[state['step_index']]['source']['options'])

    def assert_valid(self, result, status='awaiting_launch_line_variation'):
        self.assertEqual(result['status'], 'processed', result)
        self.assertEqual(result['results'][0]['status'], status, result)
        self.assertFalse(any('OCORREU UM ERRO' in m.get('text', '') for m in result['messages']))
        self.assertEqual(result['results'][0]['etag'], self.load()[1])
        self.assertEqual(self.sharepoint.items, {}, 'No SharePoint write while adding a draft line')

    def test_add_next_line_does_not_emit_error_and_preserves_line_freight_attachment(self):
        self.assert_valid(self.send('1'))
        state, _ = self.load()
        self.assertEqual(state['stage'], 'choosing_launch_line_variation')
        self.assertEqual(len(state['launch_lines']), 1)
        self.assertEqual(state['launch_lines'][0]['fields']['PRODUTO'], 'CIMENTO')
        self.assertEqual(state['launch_lines'][0]['fields']['FRETE'], '5')
        self.assertEqual(state['fields']['FRETE'], '0')
        self.assertEqual(state['multi_launch_freight'], '5')
        self.assertTrue(state['draft_user_input_seen'])
        self.assertEqual(state['attachments'], [self.attachment])
        self.assertEqual(self.media.read(state['attachments'][0]), b'synthetic-evidence')

    def test_third_line_and_repeated_message_do_not_duplicate_the_previous_line(self):
        self.assert_valid(self.send('1'))
        state, etag = self.load()
        state['fields'].update(PRODUTO='AREIA', QUANTIDADE='3')
        self.prepare_more_line(state)
        self.state.save(self.key, state, etag)
        payload = self.payload('1', 'third-line')
        self.assert_valid(self.bridge.handle(payload))
        repeated = self.bridge.handle(payload)
        self.assertEqual(repeated['results'][0]['status'], 'duplicate')
        state, _ = self.load()
        self.assertEqual([row['fields']['PRODUTO'] for row in state['launch_lines']], ['CIMENTO', 'AREIA'])
        self.assertEqual([row['fields']['FRETE'] for row in state['launch_lines']], ['0', '5'])
        self.assertEqual(state['attachments'], [self.attachment])

    def test_completed_supplier_edit_returns_to_variations_without_error(self):
        # Seed the actual last edit step; the handler clears the edit cursor,
        # records the changed supplier and reopens the inherited-data menu.
        state, etag = self.load()
        self.engine._capture_current_launch_line(state)
        steps = self.engine._flow_config(state)['steps']
        state['step_index'] = next(i for i, step in enumerate(steps) if step['key'] == 'fornecedor_lancamento')
        state['options'] = [{'id': 171, 'title': 'OUTRO FORNECEDOR', 'value': 'OUTRO FORNECEDOR'}]
        state['edit_step_indices'] = [state['step_index']]
        state['launch_line_variation_editing'] = True
        state['launch_line_variation_pending_key'] = 'fornecedor_lancamento'
        self.state.save(self.key, state, etag)
        self.assert_valid(self.send('171'))
        state, _ = self.load()
        self.assertEqual(state['fields']['FORNECEDOR'], 'OUTRO FORNECEDOR')
        self.assertEqual(state['launch_line_variation_edits']['fornecedor_lancamento'], 'OUTRO FORNECEDOR')
        self.assertEqual(state['launch_lines'][0]['fields']['FORNECEDOR'], 'FORNECEDOR TESTE')

    def test_filter_and_invalid_choice_return_current_version_and_allow_continue(self):
        # Direct menu opening does not run the draft marker, allowing this
        # test to inspect both branch contracts even on the unfixed baseline.
        state, etag = self.load()
        self.engine._capture_current_launch_line(state)
        self.engine._begin_additional_launch_line(state, etag)
        self.assert_valid(self.send('FORNECEDOR'), 'filtered_launch_line_variations')
        self.assert_valid(self.send('zz-no-match'), 'invalid_launch_line_variation')
        proceed = self.send('1')
        self.assertEqual(proceed['status'], 'processed', proceed)
        self.assertEqual(proceed['results'][0]['field'], 'produto_lancamento')
        self.assertEqual(self.load()[0]['attachments'], [self.attachment])

    def test_single_to_multiple_keeps_first_line_and_attachment(self):
        state, etag = self.load()
        state['answers']['tipo_lancamento'] = 'LANÇAMENTO ÚNICO'
        state['stage'] = 'awaiting_confirmation'
        self.state.save(self.key, state, etag)
        self.assert_valid(self.send('confirm_convert_single_launch_to_multiple'))
        state, _ = self.load()
        self.assertEqual(state['answers']['tipo_lancamento'], 'LANÇAMENTO MÚLTIPLO')
        self.assertEqual(len(state['launch_lines']), 1)
        self.assertEqual(state['attachments'], [self.attachment])

    def test_real_concurrent_state_change_still_reports_error_without_overwriting(self):
        original_save = self.state.save
        raced = False

        def concurrent_save(key, state, etag):
            nonlocal raced
            if key == self.key and not raced:
                raced = True
                other, other_etag = self.load()
                other['concurrent_marker'] = 'preserve-other-writer'
                original_save(key, other, other_etag)
            return original_save(key, state, etag)

        self.state.save = concurrent_save
        result = self.send('1')
        self.assertEqual(result['status'], 'processed_with_recovery')
        self.assertEqual(result['results'][0]['status'], 'flow_paused_after_error')
        self.assertTrue(any('OCORREU UM ERRO' in m.get('text', '') for m in result['messages']))
        self.assertEqual(self.load()[0]['concurrent_marker'], 'preserve-other-writer')
        self.assertEqual(self.load()[0]['attachments'], [self.attachment])
        self.assertEqual(self.sharepoint.items, {})


if __name__ == '__main__':
    unittest.main()
