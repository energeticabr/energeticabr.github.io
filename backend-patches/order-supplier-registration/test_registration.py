"""Order supplier catalog and embedded registration with synthetic state only."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import unittest
import tempfile
import threading

spec = importlib.util.spec_from_file_location('order_supplier_base',
    Path(__file__).resolve().parents[1] / 'single-launch-order-supplier/test_order_supplier.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


class RegistrationTests(base.OrderSupplierTests):
    def setUp(self):
        super().setUp()
        temporary = tempfile.TemporaryDirectory(prefix='order-supplier-test-')
        self.addCleanup(temporary.cleanup)
        self.state.directory = temporary.name
        self.sharepoint.site_url = 'https://synthetic.example.test/site'

    def open_catalog(self):
        self.choose_launch()
        self.reply(self.action('NÃO'))

    def registration_action(self):
        actions = [o for o in self.current['options']
                   if o.get('action') == 'start_embedded_supplier_registration']
        self.assertEqual(len(actions), 1, 'Catalog must offer supplier registration')
        return actions[0]

    def test_catalog_displays_id_and_supplier(self):
        self.open_catalog()
        labels = [o['title'] for o in self.current['options']]
        self.assertIn('170 - FORNECEDOR A', labels)
        self.assertIn('280 - FORNECEDOR B', labels)
        self.assertIn('CADASTRAR NOVO FORNECEDOR', labels[0])

    def test_existing_open_catalog_is_upgraded_without_losing_selection(self):
        self.open_catalog()
        choice = self.current['single_launch_order_supplier']
        choice['options'] = [{**copy.deepcopy(self.b), 'catalog_id': 280,
                            'id': f"single_order_supplier:{choice['token']}:280"}]
        _, etag = self.state.load(self.current['key'])
        self.engine._prompt_single_launch_order_supplier(self.current, etag)
        self.assertIn('280 - FORNECEDOR B', [o['title'] for o in self.current['options']])
        self.assertIn('CADASTRAR NOVO FORNECEDOR', self.registration_action()['title'])

    def test_registration_remains_available_when_search_has_no_results(self):
        self.open_catalog()
        self.reply('filter_query', 'FORNECEDOR INEXISTENTE')
        visible = self.messenger.sent[-1]['options']
        self.assertTrue(any('CADASTRAR NOVO FORNECEDOR' in o['title'] for o in visible))
        self.assertFalse(any(o.get('catalog_id') for o in visible))
        self.assertNotEqual(self.current['single_launch_order_supplier']['phase'], 'done')

    def test_registration_restores_parent_and_selects_only_order_supplier(self):
        self.open_catalog()
        before = copy.deepcopy(self.current)
        self.reply(str(self.registration_action()['id']))
        self.assertEqual(self.current['flow'], 'supply_supplier_registration')
        self.assertEqual(self.current['embedded_return']['type'], 'single_launch_order_supplier_registration')
        self.assertEqual(self.current['embedded_return']['state']['attachments'], before['attachments'])
        self.assertEqual(self.current['embedded_return']['state']['single_launch_order_supplier'],
                         before['single_launch_order_supplier'])
        self.current['fields']['CADASTRO'] = 'FORNECEDOR NOVO'
        _, etag = self.state.load(self.current['key'])
        self.current['sharepoint'] = {'item_id': 987}
        result = self.engine._notify_completed(self.current, etag)
        self.assertTrue(result['embedded_supplier_registered'])
        self.assertEqual(self.current['flow'], 'launch')
        self.assertEqual(self.current['fields'], before['fields'])
        self.assertEqual(self.current['attachments'], before['attachments'])
        self.assertEqual(self.current['selections'], before['selections'])
        self.assertEqual(self.current['single_launch_order_supplier']['supplier'], 'FORNECEDOR NOVO')
        self.assertEqual(self.current['single_launch_order_supplier']['phase'], 'done')
        self.assertEqual(self.engine._single_launch_order_supplier_value(self.current), 'FORNECEDOR NOVO')
        self.assertEqual(self.sharepoint.items, {})

    def test_stale_catalog_control_does_not_answer_supplier_wizard(self):
        self.open_catalog()
        stale = next(o['id'] for o in self.current['options'] if o.get('catalog_id') == 280)
        self.reply(str(self.registration_action()['id']))
        before = copy.deepcopy(self.current['fields'])
        result = self.engine.handle({'kind': 'text', 'message_id': 'stale-parent',
            'sender': 'qa', 'conversation_id': 'qa', 'phone_number_id': 'portal-admin',
            'reply_id': f'choice:fornecedor_pedido_lancamento_unico:{stale}', 'text': ''})
        self.assertEqual(self.current['fields'], before)
        saved, _ = self.state.load(self.current['key'])
        self.assertEqual(saved['fields'], before)
        self.assertEqual(saved['flow'], 'supply_supplier_registration')

    def test_return_to_launch_from_unfinished_wizard_preserves_order_selection(self):
        self.open_catalog()
        before = copy.deepcopy(self.current)
        self.reply(str(self.registration_action()['id']))
        _, etag = self.state.load(self.current['key'])
        result = self.engine._restore_embedded_supply_ancestor(self.current, etag, 1)
        self.assertTrue(result['embedded_flow_returned'])
        self.assertEqual(self.current['fields'], before['fields'])
        self.assertEqual(self.current['attachments'], before['attachments'])
        self.assertEqual(self.current['single_launch_order_supplier']['phase'], 'select')
        self.assertIn('CADASTRAR NOVO FORNECEDOR', self.registration_action()['title'])
        self.assertEqual(self.sharepoint.items, {})

    def test_search_in_pre_release_catalog_updates_labels(self):
        self.open_catalog()
        for o in self.current['single_launch_order_supplier']['options']:
            o['title'] = o['value']
        self.reply('filter_query', '280')
        self.assertTrue(any(o['title'] == '280 - FORNECEDOR B'
                            for o in self.messenger.sent[-1]['options']))

    def test_portal_catalog_and_registration_packets(self):
        long = {'id': 390, 'title': 'FORNECEDOR FICTÍCIO DE MATERIAIS ELÉTRICOS E SERVIÇOS PARA CONSTRUÇÃO LTDA',
                'value': 'FORNECEDOR FICTÍCIO DE MATERIAIS ELÉTRICOS E SERVIÇOS PARA CONSTRUÇÃO LTDA'}
        self.sharepoint.options_by_key['fornecedor_pedido_lancamento_unico'].append(long)
        self.engine.messenger = base.ChannelMessenger()
        bridge = base.ChannelBridge.__new__(base.ChannelBridge)
        bridge.engine, bridge.messenger, bridge.lock = self.engine, self.engine.messenger, threading.Lock()
        identity = {'oid': 'synthetic-registration', 'name': 'Teste'}
        event = base.normalize_channel_events(base.portal_channel_payload({'messageId': 'seed', 'replyId': 'seed'}, identity))[0]
        seeded = self.engine._new_state(event, base.fixtures.conversation_key(event))
        seeded.update({key: copy.deepcopy(self.current[key]) for key in
                       ['flow', 'stage', 'step_index', 'answers', 'fields', 'options', 'attachments']})
        self.engine._save(seeded, None)
        packets = []
        def send(reply, text=''):
            packet = bridge.handle(base.portal_channel_payload(
                {'messageId': f'fixture-{len(packets)}', 'replyId': reply, 'text': text}, identity))
            self.assertEqual(packet['status'], 'processed')
            self.assertFalse(any('OCORREU UM ERRO' in m.get('text', '') for m in packet['messages']))
            packets.append(packet)
            return packet
        send('choice:fornecedor_lancamento:170')
        no = next(o['reply'] for m in packets[-1]['messages'] for o in m.get('options', [])
                  if 'single_order_supplier_no:' in o.get('reply', ''))
        send(no)
        labels = [o['label'] for m in packets[-1]['messages'] for o in m.get('options', [])]
        self.assertIn('280 - FORNECEDOR B', labels)
        self.assertTrue(any('CADASTRAR NOVO FORNECEDOR' in label for label in labels))
        send('filter_query', '390')
        send('filter_query', 'INEXISTENTE')
        new = next(o['reply'] for m in packets[-1]['messages'] for o in m.get('options', [])
                   if 'NOVO_FORNECEDOR_PEDIDO' in o.get('reply', ''))
        send(new)
        saved, _ = self.state.load(seeded['key'])
        self.assertEqual(saved['flow'], 'supply_supplier_registration')
        if os.environ.get('REGISTRATION_FIXTURE'):
            Path(os.environ['REGISTRATION_FIXTURE']).write_text(json.dumps(packets, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    unittest.main()
