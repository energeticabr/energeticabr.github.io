"""Real workflow; synthetic storage, catalog, media and financial writes only."""
import copy
import os
from pathlib import Path
import sys
import unittest
import json
import threading
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT = Path(os.environ['ORDER_SUPPLIER_SOURCE']).resolve()
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT), str(ROOT / 'tests')]
import test_workflow as fixtures
from channel_bridge import ChannelBridge, ChannelMessenger, normalize_channel_events, portal_channel_payload


class OrderSupplierTests(unittest.TestCase):
    def setUp(self):
        fixtures.WorkflowTests.setUp(self)
        self.config['limits']['inactivity_expiration_enabled'] = False
        self.steps = self.engine._flow_config({'flow': 'launch'})['steps']
        self.supplier_index = next(i for i, s in enumerate(self.steps) if s['key'] == 'fornecedor_lancamento')
        self.pending_index = next(i for i, s in enumerate(self.steps) if s['kind'] == 'supplier_pending_provision_check')
        self.a = {'id': 170, 'title': 'FORNECEDOR A', 'value': 'FORNECEDOR A',
                  'source_values': {'Id': 170, 'EMPREITEIRO': 'SIM', 'FILIAL': 'FILIAL A'}}
        self.b = {'id': 280, 'title': 'FORNECEDOR B', 'value': 'FORNECEDOR B',
                  'source_values': {'Id': 280, 'EMPREITEIRO': 'NÃO', 'FILIAL': 'FILIAL B'}}
        self.sharepoint.options_by_key['fornecedor_lancamento'] = [self.a, self.b]
        self.sharepoint.options_by_key['fornecedor_pedido_lancamento_unico'] = [self.a, self.b]
        self.sharepoint.options_by_key['confirmar_pendencias_fornecedor_lancamento'] = [
            {'id': 901, 'title': '901', 'value': '901', 'source_values': {
                'Id': 901, 'FORNECEDOR': 'FORNECEDOR A', 'STATUS': 'PAGAMENTO PREVISTO'}},
            {'id': 902, 'title': '902', 'value': '902', 'source_values': {
                'Id': 902, 'FORNECEDOR': 'FORNECEDOR B', 'STATUS': 'PAGAMENTO PREVISTO'}}]
        identity = {'message_id': 'seed', 'sender': 'qa', 'conversation_id': 'qa', 'phone_number_id': 'portal-admin'}
        self.current = self.engine._new_state(identity, fixtures.conversation_key(identity))
        self.current.update(flow='launch', stage='selecting_fields', step_index=self.supplier_index,
            answers={'tipo_lancamento': 'LANÇAMENTO ÚNICO', 'pedido_lancamento': 'NOVO PEDIDO'},
            fields={'DATA': '2026-11-03', 'QUANTIDADE': '2', 'VALOR UNITÁRIO': '10', 'FRETE': '0'},
            attachments=[{'object_name': 'qa/test', 'sharepoint_name': 'receipt.pdf'}])
        self.current['options'] = [copy.deepcopy(self.a), copy.deepcopy(self.b)]
        self.counter = 0

    def reply(self, reply, text=''):
        self.counter += 1
        event = {'kind': 'text', 'message_id': f'reply-{self.counter}', 'reply_id': reply, 'text': text}
        _, etag = self.state.load(self.current['key'])
        step = self.engine._current_step(self.current)
        return self.engine._handle_step_reply(event, self.current, etag)

    def choose_launch(self):
        return self.reply('170')

    def action(self, word):
        message = self.messenger.sent[-1]
        return next(a['id'] for a in message['actions'] if word in a['title'].upper())

    def choose_different(self):
        self.choose_launch()
        self.reply(self.action('NÃO'))
        option = next(o for o in self.current['options'] if o['value'] == 'FORNECEDOR B')
        return self.reply(str(option['id']))

    def test_selecting_launch_supplier_first_asks_same_supplier_for_order(self):
        self.choose_launch()
        question = self.messenger.sent[-1]
        self.assertIn('PEDIDO', question['body'])
        self.assertEqual(len([a for a in question['actions'] if a['id'].startswith('single_order_supplier_')]), 2)
        self.assertTrue(any('SIM' in a['title'] for a in question['actions']))
        self.assertTrue(any('NÃO' in a['title'] for a in question['actions']))
        self.assertEqual(self.current['step_index'], self.pending_index)

    def test_yes_continues_pending_check_for_launch_supplier(self):
        self.choose_launch()
        self.reply(self.action('SIM'))
        self.assertIn('901', self.messenger.sent[-1]['body'])
        self.assertNotIn('902', self.messenger.sent[-1]['body'])
        self.assertEqual(self.current['fields']['FORNECEDOR'], 'FORNECEDOR A')

    def test_no_selects_order_supplier_without_changing_launch_or_attachments(self):
        before = copy.deepcopy(self.current['attachments'])
        self.choose_different()
        self.assertEqual(self.current['fields']['FORNECEDOR'], 'FORNECEDOR A')
        self.assertEqual(self.current['selections']['fornecedor_lancamento']['source_values']['EMPREITEIRO'], 'SIM')
        self.assertEqual(self.current['attachments'], before)
        self.assertIn('901', self.messenger.sent[-1]['body'])
        self.assertNotIn('902', self.messenger.sent[-1]['body'])
        rows = self.engine._summary_rows(self.current)
        self.assertIn({'label': 'FORNECEDOR DO PEDIDO', 'value': 'FORNECEDOR B'}, rows)
        self.assertIn({'label': 'FORNECEDOR', 'value': 'FORNECEDOR A'}, rows)

    def test_new_order_payload_uses_alternate_and_leaves_original_state_untouched(self):
        self.choose_different()
        before = copy.deepcopy(self.current['fields'])
        flow = self.engine._flow_config(self.current)
        result = self.engine._ensure_related_item(self.current, flow)
        order = self.sharepoint.items[result['item_id']]['fields']
        self.assertEqual(order['FORNECEDOR'], 'FORNECEDOR B')
        self.assertEqual(self.current['fields']['FORNECEDOR'], 'FORNECEDOR A')
        self.assertEqual({k: v for k, v in self.current['fields'].items() if k != 'AGRUPAR'}, before)

    def test_yes_uses_original_supplier_in_new_order(self):
        self.choose_launch()
        self.reply(self.action('SIM'))
        result = self.engine._ensure_related_item(self.current, self.engine._flow_config(self.current))
        self.assertEqual(self.sharepoint.items[result['item_id']]['fields']['FORNECEDOR'], 'FORNECEDOR A')

    def test_submission_creates_order_and_launch_with_separate_suppliers_then_asks_payroll(self):
        self.choose_different()
        self.current['attachments'] = []
        self.current['fields'].update(PRODUTO='SERVIÇO TESTE', UN='UN', CONTA='PIX',
                                      FILIAL='FILIAL A', ETAPA='ETAPA A')
        self.current['selections']['produto_lancamento'] = {'id': 123, 'value': 'SERVIÇO TESTE'}
        self.sharepoint.options_by_key['unidade_padrao_produto_lancamento'] = [
            {'id': 123, 'value': 'UN', 'title': 'UN'}]
        self.current['stage'] = 'committing'
        _, etag = self.state.load(self.current['key'])
        result = self.engine._commit(self.current, etag)
        self.assertEqual(result['status'], 'awaiting_launch_payroll_decision', result)
        orders = [row['fields'] for row in self.sharepoint.items.values() if row['target_list'] == 'NOTASPENDENTES']
        launches = [row['fields'] for row in self.sharepoint.items.values() if row['target_list'] == 'LANCAMENTOS']
        self.assertEqual(len(orders), 1)
        self.assertEqual(len(launches), 1)
        self.assertEqual(orders[0]['FORNECEDOR'], 'FORNECEDOR B')
        self.assertEqual(launches[0]['FORNECEDOR'], 'FORNECEDOR A')
        self.assertEqual(self.current['pending_launch_payroll']['entries'][0]['supplier'], 'FORNECEDOR A')

    def test_non_contractor_launch_does_not_gain_payroll_from_order_supplier(self):
        self.a['source_values']['EMPREITEIRO'] = 'NÃO'
        self.b['source_values']['EMPREITEIRO'] = 'SIM'
        self.current['options'] = [copy.deepcopy(self.a), copy.deepcopy(self.b)]
        self.choose_different()
        _, etag = self.state.load(self.current['key'])
        result = self.engine._maybe_prompt_launch_payroll(self.current, etag, [{
            'item_id': 551, 'fields': copy.deepcopy(self.current['fields']),
            'supplier_source_values': self.current['selections']['fornecedor_lancamento']['source_values']}])
        self.assertIsNone(result)
        self.assertNotIn('pending_launch_payroll', self.current)

    def test_numeric_filter_does_not_select_and_clear_reopens_catalog(self):
        self.choose_launch()
        self.reply(self.action('NÃO'))
        self.reply('filter_query', '280')
        self.assertEqual(self.current['step_index'], self.pending_index)
        self.assertTrue(any('FORNECEDOR B' in o['title'] for o in self.messenger.sent[-1]['options']))
        self.reply('filter_clear')
        self.assertTrue(any('FORNECEDOR A' in o['title'] for o in self.messenger.sent[-1]['options']))
        self.assertTrue(any('FORNECEDOR B' in o['title'] for o in self.messenger.sent[-1]['options']))
        self.reply('filter_query', 'SEM RESULTADO')
        self.assertEqual(self.current['step_index'], self.pending_index)
        self.assertFalse([o for o in self.messenger.sent[-1]['options'] if 'FORNECEDOR A' in o['title'] or 'FORNECEDOR B' in o['title']])
        self.reply('filter_query', 'FORNECEDOR B')
        self.assertTrue(any('FORNECEDOR B' in o['title'] for o in self.messenger.sent[-1]['options']))

    def test_search_finds_registered_supplier_outside_visible_page(self):
        catalog = [{'id': i, 'title': f'CADASTRO TESTE {i}', 'value': f'CADASTRO TESTE {i}'}
                   for i in range(1, 81)]
        catalog[0] = {'id': 1, 'title': 'FORNECEDOR REMOTO', 'value': 'FORNECEDOR REMOTO'}
        self.sharepoint.options_by_key['fornecedor_pedido_lancamento_unico'] = catalog
        self.choose_launch()
        self.reply(self.action('NÃO'))
        self.assertFalse(any('FORNECEDOR REMOTO' in o['title'] for o in self.messenger.sent[-1]['options']))
        self.reply('filter_query', 'FORNECEDOR REMOTO')
        self.assertTrue(any('FORNECEDOR REMOTO' in o['title'] for o in self.messenger.sent[-1]['options']))
        option = next(o for o in self.current['options'] if o.get('value') == 'FORNECEDOR REMOTO')
        self.reply('choice:fornecedor_pedido_lancamento_unico:' + option['id'])
        result = self.engine._ensure_related_item(self.current, self.engine._flow_config(self.current))
        self.assertEqual(self.sharepoint.items[result['item_id']]['fields']['FORNECEDOR'], 'FORNECEDOR REMOTO')

    def test_multiple_and_existing_order_skip_new_question(self):
        for answer in ({'tipo_lancamento': 'LANÇAMENTO MÚLTIPLO'}, {'pedido_lancamento': 'PEDIDO EXISTENTE'}):
            with self.subTest(answer=answer):
                self.setUp()
                self.current['answers'].update(answer)
                self.choose_launch()
                self.assertIn('901', self.messenger.sent[-1]['body'])
                self.assertNotIn('MESMO FORNECEDOR', self.messenger.sent[-1]['body'])

    def test_changing_launch_supplier_discards_old_order_choice(self):
        self.choose_different()
        self.current['step_index'] = self.supplier_index
        self.current['options'] = [self.a, self.b]
        self.reply('280')
        self.assertIn('PEDIDO', self.messenger.sent[-1]['body'])
        self.reply(self.action('SIM'))
        result = self.engine._ensure_related_item(self.current, self.engine._flow_config(self.current))
        self.assertEqual(self.sharepoint.items[result['item_id']]['fields']['FORNECEDOR'], 'FORNECEDOR B')

    def test_reopen_question_keeps_alternate_supplier_selection(self):
        self.choose_launch()
        self.reply(self.action('NÃO'))
        _, etag = self.state.load(self.current['key'])
        self.engine._resend_current_prompt(self.current, etag)
        self.assertTrue(any('FORNECEDOR A' in o['title'] for o in self.messenger.sent[-1]['options']))
        self.assertTrue(any('FORNECEDOR B' in o['title'] for o in self.messenger.sent[-1]['options']))

    def test_old_confirmation_and_supplier_controls_do_not_answer_new_supplier_question(self):
        self.choose_launch()
        old_yes = self.action('SIM')
        self.reply(self.action('NÃO'))
        old_selection = str(next(o['id'] for o in self.current['options'] if o['value'] == 'FORNECEDOR B'))
        self.current['step_index'] = self.supplier_index
        self.current['options'] = [self.a, self.b]
        self.reply('280')
        self.reply(old_yes)
        self.assertIn('MESMO FORNECEDOR', self.messenger.sent[-1]['body'])
        self.reply(self.action('NÃO'))
        self.reply('choice:fornecedor_pedido_lancamento_unico:' + old_selection)
        self.assertEqual(self.current['step_index'], self.pending_index)
        self.assertNotEqual(self.current['single_launch_order_supplier']['phase'], 'done')

    def test_actual_portal_replies_back_and_payroll_stay_with_launch_supplier(self):
        identity = {'oid': 'synthetic-order-supplier', 'name': 'Teste'}
        number = 0
        packets = []
        def payload(reply='', text=''):
            nonlocal number
            number += 1
            return portal_channel_payload({'messageId': f'order-{number}', 'replyId': reply, 'text': text}, identity)
        incoming = normalize_channel_events(payload('seed'))[0]
        self.current = self.engine._new_state(incoming, fixtures.conversation_key(incoming)) | {
            key: copy.deepcopy(self.current[key]) for key in ['flow', 'stage', 'step_index', 'answers', 'fields', 'options']}
        self.engine.messenger = ChannelMessenger()
        bridge = ChannelBridge.__new__(ChannelBridge)
        bridge.engine, bridge.messenger, bridge.lock = self.engine, self.engine.messenger, threading.Lock()
        self.engine._save(self.current, None)
        def send(reply, text=''):
            result = bridge.handle(payload(reply, text))
            self.assertEqual(result['status'], 'processed', result)
            self.assertFalse(any('OCORREU UM ERRO' in m.get('text', '') for m in result['messages']), result)
            packets.append(copy.deepcopy(result))
            self.current, _ = self.state.load(self.current['key'])
            return result
        def option(fragment):
            for message in reversed(packets[-1]['messages']):
                for item in message.get('options', []):
                    if fragment in item.get('reply', ''):
                        return item['reply']
            self.fail(f'Missing option {fragment}: {packets[-1]}')
        send('choice:fornecedor_lancamento:170')
        send(option('single_order_supplier_no:'))
        selection = option(':280')
        send('navigation_back')
        self.assertTrue(any('MESMO FORNECEDOR' in m.get('question', '') + m.get('text', '') for m in packets[-1]['messages']))
        send(option('single_order_supplier_no:'))
        send('filter_query', '280')
        self.assertEqual(self.current['step_index'], self.pending_index)
        self.assertTrue(any('FORNECEDOR B' in o.get('label', '') for m in packets[-1]['messages'] for o in m.get('options', [])))
        send('filter_clear')
        send(selection)
        self.assertEqual(self.current['fields']['FORNECEDOR'], 'FORNECEDOR A')
        self.assertIn('901', str(packets[-1]['messages']))
        self.assertNotIn('902', str(packets[-1]['messages']))
        _, etag = self.state.load(self.current['key'])
        item = {'item_id': 550, 'fields': copy.deepcopy(self.current['fields']),
                'supplier_source_values': self.current['selections']['fornecedor_lancamento']['source_values']}
        self.engine._maybe_prompt_launch_payroll(self.current, etag, [item])
        self.assertEqual(self.current['pending_launch_payroll']['entries'][0]['supplier'], 'FORNECEDOR A')
        self.assertTrue(self.current['pending_launch_payroll']['entries'][0]['eligible'])
        # Confirmed payroll follows original supplier even when order supplier is not a contractor.
        month = datetime.now(ZoneInfo('America/Sao_Paulo')).strftime('%m/%Y')
        self.sharepoint.options_by_key['launch_payroll_sheets'] = [
            {'id': 71, 'title': month, 'value': month,
             'source_values': {'Id': 71, 'FORNECEDOR': 'FORNECEDOR A', 'MESREFERENCIA': month}}]
        send('launch_payroll_yes')
        send('launch_payroll_selected:550')
        self.assertEqual(self.current['pending_launch_payroll']['current_sheet_supplier'], 'FORNECEDOR A')
        if os.environ.get('ORDER_SUPPLIER_FIXTURE'):
            Path(os.environ['ORDER_SUPPLIER_FIXTURE']).write_text(json.dumps(packets, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    unittest.main()
