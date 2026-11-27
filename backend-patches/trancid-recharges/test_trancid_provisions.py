import unittest
from unittest.mock import Mock

import test_trancid_recharges
from trancid_portal_adapter import PortalError, parse_boleto_terms
from trancid_provisions import prepare, register
from trancid_recharges import GatewayError


class BoletoTermsTests(unittest.TestCase):
    def test_reads_the_official_due_date_and_total_from_right_column(self):
        report = (
            '                         V encimento\n'
            'Data do Documento        11/12/2026\n'
            '                     (=) Valor do Documento\n'
            '26/11/2026                         222,20\n'
            '        VENCIMENTO\n'
        )
        self.assertEqual(parse_boleto_terms(report), ('2026-12-11', 22220))
        with self.assertRaises(PortalError):
            parse_boleto_terms(report.replace('11/12/2026', '31/11/2026'))
        with self.assertRaises(PortalError):
            parse_boleto_terms(report + report.replace('11/12/2026', '12/12/2026'))


class ProvisionTests(unittest.TestCase):
    def setUp(self):
        base = test_trancid_recharges.ServiceTests()
        self.addCleanup(base.doCleanups)
        base.setUp()
        self.service, self.portal = base.service, base.portal
        both = base.body['items'] + [{'id': self.service.directory()[1]['id'], 'amountCents': 5500}]
        preview = self.service.preview('owner', {**base.body, 'items': both})
        self.identifier = preview['id']
        self.service.confirm('owner', self.identifier)
        self.portal.order = Mock(return_value={
            'status': 'Enviado', 'paymentMethod': 'BOLETO', 'creditCents': 11000, 'requestDate': '2026-11-26',
        })
        self.portal.order_boleto_terms = Mock(return_value=('2026-12-11', 11110))
        self.portal.order_details = Mock(return_value=[
            {'id': 'portal-1234', 'name': 'Colaborador', 'cardLast4': '1234', 'amountCents': 5500},
            {'id': 'portal-5678', 'name': 'Colaborador do cartão', 'cardLast4': '5678', 'amountCents': 5500},
        ])
        self.store = Mock()
        self.store.suppliers.return_value = [
            {'Id': 71, 'Title': 'Colaborador', 'FILIAL': 'A', 'PROFISSAO': 'SERVENTE'},
            {'Id': 72, 'Title': 'Outra Pessoa', 'FILIAL': 'B', 'PROFISSAO': 'PEDREIRO'},
        ]
        self.records = {}
        self.fail_child_once = False

        def ensure(target, fields):
            if self.fail_child_once and target == 'PROVISÃO PGTOS':
                self.fail_child_once = False
                raise OSError('lost connection after the parent write')
            key = fields['FOLHAOPERACAO']
            if key not in self.records:
                self.records[key] = (target, fields, len(self.records) + 1)
            self.assertEqual(self.records[key][:2], (target, fields))
            return self.records[key][2]

        self.store.ensure.side_effect = ensure

    def test_prepare_defaults_to_boleto_and_requires_an_explicit_mapping_for_unmatched_names(self):
        with self.assertRaises(GatewayError):
            prepare(self.service, 'someone-else', self.identifier, self.store)
        self.portal.order_boleto_terms.assert_not_called()
        prepared = prepare(self.service, 'owner', self.identifier, self.store)
        self.assertEqual(prepared['dueDate'], '2026-12-11')
        self.assertEqual(prepared['totalCents'], 11110)
        self.assertEqual([card['supplierId'] for card in prepared['cards']], [71, None])
        self.store.ensure.assert_not_called()
        with self.assertRaises(GatewayError):
            register(self.service, 'owner', self.identifier, '2026-12-15', {}, self.store)
        self.store.ensure.assert_not_called()

    def test_an_incomplete_homonym_still_requires_an_explicit_supplier_choice(self):
        self.store.suppliers.return_value.append(
            {'Id': 73, 'Title': 'Colaborador', 'FILIAL': '', 'PROFISSAO': 'SERVENTE'},
        )
        prepared = prepare(self.service, 'owner', self.identifier, self.store)
        self.assertIsNone(prepared['cards'][0]['supplierId'])
        self.assertIn(71, prepared['cards'][0]['suggestedIds'])
        self.assertNotIn(73, {entry['id'] for entry in prepared['suppliers']})

    def test_partial_write_resumes_with_the_edited_due_date_and_groups_cards_by_supplier(self):
        prepared = prepare(self.service, 'owner', self.identifier, self.store)
        choices = {prepared['cards'][1]['id']: 71}
        self.fail_child_once = True
        with self.assertRaises(OSError):
            register(self.service, 'owner', self.identifier, '2026-12-15', choices, self.store)
        locked = prepare(self.service, 'owner', self.identifier, self.store)
        self.assertTrue(locked['locked'])
        self.assertEqual(locked['dueDate'], '2026-12-15')
        with self.assertRaises(GatewayError):
            register(self.service, 'owner', self.identifier, '2026-12-16', {}, self.store)
        result = register(self.service, 'owner', self.identifier, '2026-12-15', {}, self.store)
        self.assertEqual(result['parentId'], 1)
        self.assertEqual(result['lineCount'], 1)
        self.assertEqual(set(self.records), {'trancid:789805', 'trancid:789805:71'})
        parent = self.records['trancid:789805'][1]
        child = self.records['trancid:789805:71'][1]
        self.assertEqual(parent['DATAPREVISTOPGTO'], '2026-12-15T03:00:00Z')
        self.assertEqual(child['DATAPREVISTOPGTO'], parent['DATAPREVISTOPGTO'])
        self.assertEqual((parent['VALORTOTAL'], child['VALORTOTAL']), ('111,10', '111,10'))
        self.assertEqual((parent['FORNECEDOR'], child['FORNECEDOR'], child['DESCRITIVOPROVISAO']), ('TRANCID', 'Colaborador', '1'))
        self.assertEqual(register(self.service, 'owner', self.identifier, '2026-12-15', {}, self.store), result)
        self.assertEqual(len(self.portal.submissions), 1)

    def test_separate_suppliers_reconcile_to_the_boleto_total(self):
        prepared = prepare(self.service, 'owner', self.identifier, self.store)
        result = register(self.service, 'owner', self.identifier, prepared['dueDate'],
                          {prepared['cards'][1]['id']: 72}, self.store)
        self.assertEqual(result['lineCount'], 2)
        self.assertEqual([self.records[f'trancid:789805:{ident}'][1]['VALORTOTAL'] for ident in (71, 72)],
                         ['55,55', '55,55'])

    def test_report_that_disagrees_with_the_confirmed_cards_cannot_be_provisioned(self):
        cards = self.portal.order_details.return_value
        cards[1]['id'] = 'another-card'
        with self.assertRaises(GatewayError):
            prepare(self.service, 'owner', self.identifier, self.store)
        self.store.ensure.assert_not_called()

    def test_only_the_person_who_placed_the_order_can_resume_it_from_the_gallery(self):
        self.portal.history_orders = [{
            'orderCode': '789805', 'requestDate': '2026-11-26', 'paymentMethod': 'BOLETO',
            'status': 'Enviado', 'creditCents': 11000,
        }]
        owner_order, = self.service.history(1, owner='owner')['orders']
        other_order, = self.service.history(1, owner='other')['orders']
        self.assertEqual(owner_order['provisionRequestId'], self.identifier)
        self.assertNotIn('provisionRequestId', other_order)
