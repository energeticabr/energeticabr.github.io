"""Real grouped conversation, with synthetic SharePoint and no financial IO."""
import copy
import os
import re
import tempfile
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.parse import unquote, urlsplit

if not os.getenv('ENERGETICA_BACKEND_TEST_ROOT'):
    raise unittest.SkipTest('Requires a private fresh backend source snapshot')
ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path[:0] = [str(ROOT), str(ROOT/'worker'), str(ROOT/'tests')]
import test_workflow as backend_fixtures


def add_rest_boundary(client):
    """Serve only the real attachment coordinator's REST reads from memory."""
    client.site_url = 'https://synthetic.invalid/sites/fixture'
    client._internal_field = lambda kind, field: field
    client._list_endpoint = lambda kind: "web/lists/getbytitle('" + kind + "')"
    class Response:
        def __init__(self, content): self.content = content
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def iter_content(self, size): yield self.content
    def request(method, endpoint, params=None, **kwargs):
        if method != 'GET':
            raise AssertionError('Unexpected remote mutation in fixture')
        path = unquote(urlsplit(endpoint).path)
        match = re.search(r"getbytitle\('([^']+)'\)/items(?:\((\d+)\))?(.*)$", path)
        if not match:
            raise AssertionError('Unexpected fixture endpoint: ' + path)
        kind, ident, suffix = match.groups()
        if ident:
            record = client.items[int(ident)]
            assert record['target_list'] == kind
            attachments = record['attachments']
            if suffix == '/AttachmentFiles':
                return {'value': [{'FileName': name} for name in sorted(attachments)]}
            filename = re.fullmatch(r"/AttachmentFiles/getByFileName\('(.+)'\)/\$value", suffix)
            if filename:
                return Response(attachments[filename.group(1).replace("''", "'")])
        elif suffix == '':
            condition = (params or {}).get('$filter', '')
            wanted = re.fullmatch(r"DESCRITIVOPROVISAO eq '(\d+)'", condition)
            assert wanted, condition
            return {'value': [{'Id': item_id, 'Attachments': bool(record['attachments']),
                'DESCRITIVOPROVISAO': record['fields'].get('DESCRITIVOPROVISAO')}
                for item_id, record in client.items.items() if record['target_list'] == kind
                and str(record['fields'].get('DESCRITIVOPROVISAO')) == wanted.group(1)]}
        raise AssertionError('Unexpected fixture endpoint: ' + path)
    client._request = request
    client._ensure_attachment_local = lambda ident, name, content, target_list=None: \
        client.ensure_attachment(ident, name, content, None, target_list=target_list)
    # Match the real client's decimal/date comparisons; the archived memory
    # fixture used raw string equality (e.g. '10.5' != '10,5' on journal retry).
    from clients import SharePointClient
    def verify(ident, fields, names, target_list=None):
        item = client.items[int(ident)]
        assert item['target_list'] == target_list
        assert all(SharePointClient._same_sharepoint_value(item['fields'].get(key), value,
            field_type='Note' if key == 'OBS' else None) for key, value in fields.items())
        assert set(names) <= set(item['attachments'])
        return {'fields': True, 'attachments': True}
    client.verify_item = verify


def source():
    rows = []
    for item_id, quantity, unit, freight in ((11, '2', '10.5', '3'),
            (12, '1', '20', '0'), (13, '3', '5', '1'), (14, '2', '2.5', '0')):
        rows.append({'Id': item_id, 'DESCRITIVOPROVISAO': '7',
            'STATUS': 'PAGAMENTO PREVISTO', 'PGTOAGENDADO': None,
            'DATA PGTO EFETUADO': None, 'FORMAPGTO': None, 'QTD': quantity,
            'VALOR TOTAL': unit, 'FRETE': freight, 'PRODUTO': f'Produto fictício {item_id}',
            'FORNECEDOR': 'Fornecedor fictício', 'FILIAL': '004 - FILIAL FICTÍCIA',
            'IMOVEL': 'TODOS', 'DATA PREVISTO PGTO': '2026-10-28',
            'IDPEDIDO': None, 'IDLANCAMENTOS': None, 'OBS': None})
    rows[-1].update({'STATUS': 'PAGAMENTO EFETUADO', 'PGTOAGENDADO': 'PAGO',
                    'DATA PGTO EFETUADO': '2026-10-20'})
    return {'Id': 7, 'CHILDREN': rows, 'PENDING CHILD IDS': ['11', '12', '13'],
        'FORNECEDOR': 'Fornecedor fictício', 'FILIAL': '004 - FILIAL FICTÍCIA',
        'DATA PREVISTO PGTO': '2026-10-28', 'DATA PGTO EFETUADO': None,
        'PGTOAGENDADO': None, 'VALORTOTAL': '65', 'FORMAPGTO': None, 'OBS': None,
        'VALOR TOTAL DESCRITIVO': '65', 'totalDisplay': 'R$ 65,00'}


class BatchReviewTests(unittest.TestCase):
    def setUp(self):
        self.h = backend_fixtures.WorkflowTests('runTest')
        self.h.setUp()
        self.h.sharepoint.next_id = 1000
        add_rest_boundary(self.h.sharepoint)
        import provision_attachment_sync
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        attachment_path = patch.object(provision_attachment_sync, 'STATE_DIR', Path(temporary.name)/'sync')
        attachment_path.start()
        self.addCleanup(attachment_path.stop)
        group = source()
        self.child_ids = [11, 12, 13, 14]
        self.h.sharepoint.items[7] = {'fields': {k: copy.deepcopy(v)
            for k, v in group.items() if k != 'CHILDREN'},
            'attachments': {}, 'target_list': 'DESCRITIVOPROVISAO'}
        for row in group['CHILDREN']:
            self.h.sharepoint.items[row['Id']] = {'fields': copy.deepcopy(row),
                'attachments': {}, 'target_list': 'PROVISÃO PGTOS'}
        def fresh(item_id=7):
            parent = copy.deepcopy(self.h.sharepoint.items[int(item_id)]['fields'])
            parent['CHILDREN'] = [copy.deepcopy(self.h.sharepoint.items[i]['fields'])
                                  for i in self.child_ids]
            return parent
        self.h.sharepoint.get_provision_description_for_settlement = fresh
        self.h.sharepoint.get_provision_description = fresh
        self.h.sharepoint.get_pending_provision_descriptions = lambda: [fresh()]
        # Keep the real engine, replacing only the external delivery boundary.
        # Match ChannelMessenger's one-shot metadata consumption in this fixture.
        for method in ('send_options', 'send_filtered_options'):
            original = getattr(self.h.messenger, method)
            def recording(state, step, options, maximum, original=original):
                original(state, step, options, maximum)
                self.h.messenger.sent[-1]['detail_table'] = copy.deepcopy(
                    state.pop('_outbound_detail_table', None))
            setattr(self.h.messenger, method, recording)

    def state(self):
        return next(state for state, etag in self.h.state.values.values()
                    if state.get('flow') == 'payment_settlement')

    def open(self):
        self.h.reply('OPA')
        self.h.open_supply_provision_action('BAIXAR PAGAMENTO AGENDADO')
        return self.h.reply(reply_id='provision_description:7')

    def table(self):
        tables = [message.get('detail_table') for message in self.h.messenger.sent
                  if (message.get('detail_table') or {}).get('kind') == 'provision_settlement_review']
        self.assertTrue(tables, 'The user must receive the structured review table')
        return tables[-1]

    def choose_value(self, value):
        option = next(item for item in self.state()['options'] if item.get('value') == value)
        return self.h.reply(reply_id=str(option['id']))

    def edit(self, item_id, target, value):
        result = self.h.reply(reply_id='description_review_edit')
        self.assertEqual(result['status'], 'awaiting_description_edit_choice')
        result = self.h.reply(reply_id=f'description_edit_child:{item_id}')
        self.assertEqual(result['status'], 'awaiting_edit_field')
        steps = self.h.engine._flow_config(self.state())['steps']
        index = next(i for i, step in enumerate(steps) if step.get('target_field') == target
                     and (step.get('edit_only') or step.get('kind') == 'confirm_or_replace_number'))
        result = self.choose_value(index)
        self.assertEqual(result.get('field'), steps[index]['key'])
        return self.choose_value(value) if target == 'PRODUTO' else self.h.reply(value)

    def no_writes(self):
        self.assertEqual(self.h.sharepoint.update_calls, [])
        self.assertEqual(len(self.h.sharepoint.items), 5)

    def prepare(self, launch=False):
        result = self.h.reply(reply_id='description_review_submit')
        self.assertEqual(result.get('field'), 'data_pgto_efetuado_baixa')
        self.h.reply(reply_id='date_today')
        result = self.choose_value('ENERGÉTICA - CAIXA')
        self.assertEqual(result.get('field'), 'observacao_grupo_baixa')
        result = self.h.reply(reply_id='description_observation_blank')
        self.assertEqual(result.get('field'), 'submeter_lancamentos')
        result = self.choose_value('SIM' if launch else 'NÃO')
        if launch:
            self.assertEqual(result.get('field'), 'etapa_baixa')
            result = self.choose_value('FUNDAÇÃO')
        if result.get('status') == 'awaiting_attachment_decision':
            result = self.h.reply('NÃO')
        self.assertEqual(result.get('status'), 'awaiting_confirmation', result)
        return result

    def test_selection_shows_every_provision_with_grand_and_pending_totals(self):
        result = self.open()
        self.assertEqual(result.get('field'), 'description_review')
        table = self.table()
        self.assertEqual(table['descriptionId'], '7')
        self.assertEqual([row['id'] for row in table['rows']], ['11', '12', '13', '14'])
        self.assertEqual([row['totalDisplay'] for row in table['rows']],
                         ['R$ 24,00', 'R$ 20,00', 'R$ 16,00', 'R$ 5,00'])
        self.assertEqual(table['rows'][0]['quantityDisplay'], '2')
        self.assertEqual(table['rows'][0]['unitPriceDisplay'], 'R$ 10,50')
        self.assertTrue(table['rows'][-1]['paid'])
        self.assertEqual(table['totalDisplay'], 'R$ 65,00')
        self.assertEqual(table['pendingTotalDisplay'], 'R$ 60,00')
        self.assertEqual({item['id'] for item in self.state()['options']},
                         {'description_review_submit', 'description_review_edit'})
        self.no_writes()

    def test_submit_skips_all_quantity_and_unit_price_confirmations(self):
        self.open()
        marker = len(self.h.messenger.sent)
        result = self.h.reply(reply_id='description_review_submit')
        self.assertEqual(result.get('field'), 'data_pgto_efetuado_baixa')
        self.assertFalse(any(message.get('field') in {'validar_qtd_baixa',
            'validar_valor_total_baixa'} for message in self.h.messenger.sent[marker:]))
        self.no_writes()

    def test_missing_optional_field_still_uses_blank_review_after_batch_submit(self):
        self.h.sharepoint.items[12]['fields']['IMOVEL'] = None
        self.open()
        self.h.reply(reply_id='description_review_submit')
        self.h.reply(reply_id='date_today')
        self.choose_value('ENERGÉTICA - CAIXA')
        result = self.h.reply(reply_id='description_observation_blank')
        self.assertEqual(self.state()['stage'], 'reviewing_payment_settlement_blank_fields', result)
        self.assertIn('IMOVEL', [item['field'] for item in self.state()['payment_settlement_blank_fields']])
        result = self.h.reply(reply_id='payment_settlement_continue_summary')
        self.assertEqual(result.get('field'), 'submeter_lancamentos')
        self.assertEqual(len(self.state()['provision_description']['entries']), 3)
        self.no_writes()

    def test_edit_quantity_changes_only_chosen_line_and_returns_updated_table(self):
        self.open()
        original = copy.deepcopy(self.h.sharepoint.items)
        snapshot = copy.deepcopy(self.state()['provision_description']['original_children'])
        children = copy.deepcopy(self.state()['provision_description']['children'])
        result = self.edit(12, 'QTD', '4')
        self.assertEqual(result.get('field'), 'description_review')
        table = self.table()
        self.assertEqual([row['quantityDisplay'] for row in table['rows']], ['2', '4', '3', '2'])
        self.assertEqual(table['rows'][1]['totalDisplay'], 'R$ 80,00')
        self.assertEqual(table['totalDisplay'], 'R$ 125,00')
        self.assertEqual(table['pendingTotalDisplay'], 'R$ 120,00')
        self.assertEqual(self.h.sharepoint.items, original)
        self.assertEqual(self.state()['provision_description']['original_children'], snapshot)
        self.assertEqual(self.state()['provision_description']['children'], children)
        self.no_writes()

    def test_edit_fractional_unit_value_preserves_precision_and_recalculates_total(self):
        self.open()
        result = self.edit(11, 'VALOR TOTAL', '10,1234')
        self.assertEqual(result.get('field'), 'description_review')
        table = self.table()
        self.assertEqual(table['rows'][0]['unitPriceDisplay'], 'R$ 10,1234')
        self.assertEqual(table['rows'][0]['totalDisplay'], 'R$ 23,25')
        self.assertEqual(table['totalDisplay'], 'R$ 64,25')
        self.no_writes()

    def test_edit_freight_returns_table_with_updated_line_and_grand_total(self):
        self.open()
        self.edit(13, 'FRETE', '0')
        self.assertEqual(self.table()['rows'][2]['totalDisplay'], 'R$ 15,00')
        self.assertEqual(self.table()['totalDisplay'], 'R$ 64,00')
        self.no_writes()

    def test_line_choice_never_offers_paid_provision_or_common_fields(self):
        self.open()
        self.h.reply(reply_id='description_review_edit')
        ids = {item['id'] for item in self.state()['options']}
        self.assertNotIn('description_edit_child:14', ids)
        self.assertNotIn('description_edit_common', ids)
        self.assertIn('description_edit_child:12', ids)
        self.h.reply(reply_id='description_edit_child:14')
        self.assertEqual(self.state()['provision_description']['review_phase'], 'overview')
        self.no_writes()

    def test_unknown_quantity_is_visible_and_forged_submit_cannot_advance(self):
        self.h.sharepoint.items[12]['fields']['QTD'] = None
        self.open()
        table = self.table()
        self.assertEqual(table['rows'][1]['quantityDisplay'], 'PENDENTE')
        self.assertEqual(table['rows'][1]['totalDisplay'], 'PENDENTE')
        self.assertEqual(table['totalDisplay'], 'VALOR PENDENTE')
        self.assertFalse(table['canSubmit'])
        self.h.reply(reply_id='description_review_submit')
        self.assertEqual(self.state()['provision_description']['review_phase'], 'overview')
        self.no_writes()

    def test_back_from_line_picker_keeps_edited_values_and_review(self):
        self.open()
        self.edit(12, 'QTD', '4')
        self.h.reply(reply_id='description_review_edit')
        result = self.choose_value('__back_to_summary__')
        self.assertEqual(result.get('field'), 'description_review')
        self.assertEqual(self.table()['totalDisplay'], 'R$ 125,00')
        self.no_writes()

    def test_back_from_field_picker_returns_review_without_confirming_payment(self):
        self.open()
        self.h.reply(reply_id='description_review_edit')
        self.h.reply(reply_id='description_edit_child:12')
        result = self.choose_value('__back_to_summary__')
        self.assertEqual(result.get('field'), 'description_review')
        self.assertEqual(self.table()['totalDisplay'], 'R$ 65,00')
        self.no_writes()

    def test_common_questions_once_then_final_confirmation_preserves_each_draft(self):
        self.open()
        self.edit(12, 'QTD', '4')
        self.prepare()
        group = self.state()['provision_description']
        self.assertEqual([entry['fields']['QTD'] for entry in group['entries']], ['2', '4', '3'])
        prompts = [message.get('field') for message in self.h.messenger.sent]
        self.assertEqual(prompts.count('forma_pgto_baixa'), 1)
        self.assertNotIn('validar_valor_total_baixa', prompts)
        self.no_writes()

    def test_numeric_fields_remain_editable_from_final_summary_after_batch_submit(self):
        self.open()
        self.prepare()
        self.h.reply('EDITAR')
        self.h.reply(reply_id='description_edit_child:12')
        steps = self.h.engine._flow_config(self.state())['steps']
        offered = {steps[option['value']].get('target_field')
                   for option in self.state()['options'] if isinstance(option.get('value'), int)}
        self.assertTrue({'QTD', 'VALOR TOTAL'} <= offered, offered)
        self.no_writes()

    def test_final_confirmation_updates_pending_only_and_recalculates_parent(self):
        self.open()
        self.edit(12, 'QTD', '4')
        self.prepare()
        original_paid = copy.deepcopy(self.h.sharepoint.items[14])
        result = self.h.reply('SIM')
        self.assertEqual(result.get('status'), 'completed', result)
        self.assertEqual(self.h.sharepoint.items[7]['fields']['VALORTOTAL'], '125')
        self.assertEqual(self.h.sharepoint.items[12]['fields']['QTD'], '4')
        self.assertTrue(all(self.h.sharepoint.items[item]['fields']['PGTOAGENDADO'] == 'PAGO'
                            for item in (11, 12, 13)))
        self.assertEqual(self.h.sharepoint.items[14], original_paid)

    def test_submit_invalid_zero_and_negative_values_is_refused(self):
        for field, invalid in (('QTD', '0'), ('QTD', '-2'), ('VALOR TOTAL', '0'),
                ('VALOR TOTAL', 'NaN'), ('VALOR TOTAL', True), ('FRETE', '-1')):
            with self.subTest(field=field, invalid=invalid):
                case = BatchReviewTests('runTest')
                case.setUp()
                try:
                    case.h.sharepoint.items[12]['fields'][field] = invalid
                    case.open()
                    self.assertFalse(case.table()['canSubmit'])
                    case.h.reply(reply_id='description_review_submit')
                    self.assertEqual(case.state()['provision_description']['review_phase'], 'overview')
                    case.no_writes()
                finally:
                    case.doCleanups()

    def test_single_child_still_shows_table_and_skips_numeric_confirmations(self):
        self.child_ids = [11]
        result = self.open()
        self.assertEqual(result.get('field'), 'description_review')
        self.assertEqual(len(self.table()['rows']), 1)
        self.assertEqual(self.table()['totalDisplay'], 'R$ 24,00')
        result = self.h.reply(reply_id='description_review_submit')
        self.assertEqual(result.get('field'), 'data_pgto_efetuado_baixa')
        self.no_writes()

    def test_unknown_value_can_be_completed_through_line_edit(self):
        self.h.sharepoint.items[12]['fields']['VALOR TOTAL'] = None
        self.open()
        self.assertFalse(self.table()['canSubmit'])
        self.edit(12, 'VALOR TOTAL', '20')
        self.assertTrue(self.table()['canSubmit'])
        self.assertEqual(self.table()['totalDisplay'], 'R$ 65,00')
        self.prepare()
        self.no_writes()

    def test_large_complete_group_is_iterative_after_common_questions(self):
        template = copy.deepcopy(self.h.sharepoint.items[11])
        self.h.sharepoint.items = {7: self.h.sharepoint.items[7]}
        self.child_ids = list(range(10000, 11200))
        for ident in self.child_ids:
            record = copy.deepcopy(template)
            record['fields']['Id'] = ident
            self.h.sharepoint.items[ident] = record
        self.open()
        self.assertEqual(len(self.table()['rows']), 1200)
        self.h.reply(reply_id='description_review_submit')
        self.h.reply(reply_id='date_today')
        self.choose_value('ENERGÉTICA - CAIXA')
        result = self.h.reply(reply_id='description_observation_blank')
        self.assertEqual(result.get('field'), 'submeter_lancamentos')
        self.assertEqual(len(self.state()['provision_description']['entries']), 1200)
        self.assertEqual(self.h.sharepoint.update_calls, [])

    def test_product_edit_is_persisted_to_only_selected_provision_on_final_confirmation(self):
        self.h.sharepoint.options_by_key['preencher_produto_baixa'] = [
            {'id': 'revised-product', 'title': 'Produto revisado', 'value': 'Produto revisado'}]
        self.open()
        result = self.edit(12, 'PRODUTO', 'Produto revisado')
        self.assertEqual(result.get('field'), 'description_review')
        self.assertEqual(self.table()['rows'][1]['product'], 'Produto revisado')
        self.prepare()
        self.no_writes()
        result = self.h.reply('SIM')
        self.assertEqual(result.get('status'), 'completed', result)
        self.assertEqual(self.h.sharepoint.items[12]['fields']['PRODUTO'], 'Produto revisado')
        self.assertEqual(self.h.sharepoint.items[11]['fields']['PRODUTO'], 'Produto fictício 11')

    def test_paid_zero_unit_value_is_readonly_but_does_not_block_valid_pending_lines(self):
        self.h.sharepoint.items[14]['fields']['VALOR TOTAL'] = '0'
        self.open()
        table = self.table()
        self.assertTrue(table['canSubmit'])
        self.assertEqual(table['rows'][-1]['unitPriceDisplay'], 'R$ 0,00')
        self.assertEqual(table['totalDisplay'], 'R$ 60,00')
        self.no_writes()

    def test_old_unmarked_in_progress_draft_keeps_individual_numeric_review(self):
        self.open()
        state = copy.deepcopy(self.state())
        group = state['provision_description']
        group.pop('review_version')
        group.pop('review_phase')
        group.update(entries=[], common=None)
        self.h.engine._description_load_child(state, 0, announce=False)
        self.assertEqual(self.h.engine._current_step(state)['key'], 'validar_qtd_baixa')
        self.no_writes()

    def test_foreign_line_reply_never_selects_another_provision(self):
        self.open()
        self.h.reply(reply_id='description_review_edit')
        self.h.reply(reply_id='description_edit_child:9999')
        self.assertEqual(self.state()['provision_description']['editing_phase'], 'choose')
        self.assertEqual(self.table()['totalDisplay'], 'R$ 65,00')
        self.no_writes()

    def test_concurrent_source_edit_blocks_final_confirmation_before_any_write(self):
        self.open()
        self.prepare()
        self.h.sharepoint.items[12]['fields']['QTD'] = '9'
        result = self.h.reply('SIM')
        self.assertEqual(result.get('status'), 'submission_failed', result)
        self.assertEqual(self.h.sharepoint.items[12]['fields']['QTD'], '9')
        self.no_writes()

    def test_lost_paid_write_response_resumes_without_duplicate_writes(self):
        self.open()
        self.edit(12, 'QTD', '4')
        self.prepare()
        update = self.h.sharepoint.update_item_with_etag
        lost = []
        def update_then_lose(ident, fields, etag, target_list=None):
            result = update(ident, fields, etag, target_list=target_list)
            if target_list == 'PROVISÃO PGTOS' and int(ident) == 12 and not lost:
                lost.append(True)
                raise RuntimeError('synthetic lost paid response')
            return result
        self.h.sharepoint.update_item_with_etag = update_then_lose
        failed = []
        failure = self.h.engine._submission_failed
        def record_failure(state, etag, error):
            failed.append(repr(error))
            return failure(state, etag, error)
        self.h.engine._submission_failed = record_failure
        self.assertEqual(self.h.reply('SIM')['status'], 'submission_failed')
        result = self.h.reply(reply_id='error_retry')
        self.assertEqual(result.get('status'), 'completed', (result, failed))
        self.assertEqual(len(self.h.sharepoint.update_calls), 4)
        self.assertEqual(len(self.h.sharepoint.items), 5)

    def scientific_values(self):
        self.h.sharepoint.items[11]['fields'].update(QTD=200000.0, FRETE=0.00001)
        self.h.sharepoint.items[11]['fields']['VALOR TOTAL'] = 0.00001
        self.h.sharepoint.items[12]['fields']['QTD'] = 0.00001
        self.h.sharepoint.items[12]['fields']['VALOR TOTAL'] = 200000.0

    def test_json_scientific_numbers_are_accepted_as_canonical_draft_values_and_commit(self):
        self.scientific_values()
        self.open()
        original = copy.deepcopy(self.state()['provision_description']['original_children'])
        self.assertTrue(self.table()['canSubmit'])
        self.assertEqual(self.table()['rows'][0]['totalDisplay'], 'R$ 2,00')
        self.prepare()
        self.assertEqual(self.state()['provision_description']['original_children'], original)
        self.no_writes()
        result = self.h.reply('SIM')
        self.assertEqual(result.get('status'), 'completed', result)
        from payment_provision_group import _number
        fields = self.h.sharepoint.items[11]['fields']
        self.assertEqual(str(_number(fields['VALOR TOTAL'], 'unit')), '0.00001')
        self.assertEqual(str(_number(fields['FRETE'], 'freight')), '0.00001')
        self.assertEqual(str(_number(self.h.sharepoint.items[12]['fields']['QTD'], 'quantity')), '0.00001')

    def test_scientific_values_survive_lost_paid_response_retry_without_repeated_write(self):
        self.scientific_values()
        self.open()
        self.prepare()
        update = self.h.sharepoint.update_item_with_etag
        lost = []
        def update_then_lose(ident, fields, etag, target_list=None):
            result = update(ident, fields, etag, target_list=target_list)
            if target_list == 'PROVISÃO PGTOS' and int(ident) == 12 and not lost:
                lost.append(True)
                raise RuntimeError('synthetic lost scientific response')
            return result
        self.h.sharepoint.update_item_with_etag = update_then_lose
        self.assertEqual(self.h.reply('SIM')['status'], 'submission_failed')
        self.assertTrue(lost, 'All accepted numeric values must reach the child writer')
        result = self.h.reply(reply_id='error_retry')
        self.assertEqual(result.get('status'), 'completed', result)
        self.assertEqual(len(self.h.sharepoint.update_calls), 4)
        self.assertEqual(len(self.h.sharepoint.items), 5)

    def test_persisted_line_picker_resumes_with_the_same_pending_provision_options(self):
        self.open()
        self.h.reply(reply_id='description_review_edit')
        original = copy.deepcopy(self.state()['provision_description']['entries'])
        restored, etag = self.h.state.load(self.state()['key'])
        result = self.h.engine._resume_draft_prompt(copy.deepcopy(restored), etag)
        self.assertEqual(result.get('status'), 'draft_resumed', result)
        self.assertEqual(self.state()['provision_description']['entries'], original)
        self.assertEqual([option['id'] for option in self.state()['options']],
            ['description_edit_back', 'description_edit_child:11',
             'description_edit_child:12', 'description_edit_child:13'])
        result = self.h.reply(reply_id='description_edit_child:12')
        self.assertEqual(result.get('status'), 'awaiting_edit_field')
        self.no_writes()

    def test_cancelling_flow_exit_preserves_line_picker_options(self):
        self.open()
        self.h.reply(reply_id='description_review_edit')
        self.assertEqual(self.h.reply(reply_id='navigation_main_menu')['status'], 'awaiting_portal_draft_exit')
        self.h.reply(reply_id='portal_draft_exit_cancel')
        self.assertEqual([option['id'] for option in self.state()['options']],
            ['description_edit_back', 'description_edit_child:11',
             'description_edit_child:12', 'description_edit_child:13'])
        self.no_writes()

    def test_group_launch_keeps_one_order_and_one_launch_per_pending_provision(self):
        self.open()
        self.prepare(launch=True)
        self.no_writes()
        result = self.h.reply('SIM')
        self.assertEqual(result.get('status'), 'completed', result)
        orders = [row for row in self.h.sharepoint.items.values() if row['target_list'] == 'NOTASPENDENTES']
        launches = [row for row in self.h.sharepoint.items.values() if row['target_list'] == 'LANCAMENTOS']
        self.assertEqual(len(orders), 1)
        self.assertEqual(len(launches), 3)
        self.assertEqual({row['fields']['IDPGTOAGENDADO'] for row in launches}, {'11', '12', '13'})
        self.assertEqual(len({row['fields']['AGRUPAR'] for row in launches}), 1)


class ReviewBridgeTests(unittest.TestCase):
    def test_real_channel_forwards_scoped_review_table_and_consumes_it_once(self):
        from channel_bridge import ChannelMessenger
        from provision_description_review import review_table
        group = source()
        draft = {'parent_id': '7', 'children': group['CHILDREN'][:3],
                 'original_children': group['CHILDREN'], 'entries': []}
        table = review_table(draft)
        state = {'flow': 'payment_settlement', 'provision_description': {
            'parent_id': '7', 'review_version': 1, 'review_phase': 'overview'},
            '_outbound_detail_table': table}
        messenger = ChannelMessenger()
        messenger.send_actions(state, 'DESCRITIVO 7 — CONFIRA AS PROVISÕES.', [
            {'id': 'description_review_submit', 'title': 'SUBMETER'}])
        self.assertEqual(messenger.messages[0]['detail_table'], table)
        self.assertEqual(messenger.messages[0]['options'][0]['reply'], 'description_review_submit')
        messenger.send_actions(state, 'OUTRA PERGUNTA', [{'id': 'back', 'title': 'VOLTAR'}])
        self.assertNotIn('detail_table', messenger.messages[1])
        original = copy.deepcopy(state)
        for wrong in ({'flow': 'launch'}, {'provision_description': {'parent_id': '8',
                'review_version': 1, 'review_phase': 'overview'}},
                {'provision_description': {'parent_id': '7', 'review_version': 1, 'review_phase': 'submitted'}}):
            scoped = {**copy.deepcopy(original), **wrong, '_outbound_detail_table': table}
            messenger.send_actions(scoped, 'DESCRITIVO 7 — CONFIRA AS PROVISÕES.', [{'id': 'back', 'title': 'VOLTAR'}])
            self.assertNotIn('detail_table', messenger.messages[-1])


if __name__ == '__main__':
    unittest.main()
