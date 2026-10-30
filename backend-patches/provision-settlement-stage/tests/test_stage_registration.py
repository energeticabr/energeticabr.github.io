"""Real workflow engine with in-memory catalogs/storage; no tenant requests."""
import copy
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path[:0] = [str(ROOT / 'tests'), str(ROOT / 'worker'), str(ROOT)]
import test_workflow as fixtures

CREATE = 'NOVA_ETAPA_BAIXA_PROVISAO'
BRANCH = '004 - OBRA QA'
OTHER = '000 - CENTRAL QA'
BRANCHES = [
    {'id': 900, 'title': OTHER, 'value': OTHER},
    {'id': 420, 'title': BRANCH, 'value': BRANCH},
]


class SettlementStageTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.WorkflowTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.engine, self.sp = self.case.engine, self.case.sharepoint
        self.engine.config['limits']['inactivity_expiration_enabled'] = False
        self.engine.config['limits']['attachment_restart_on_inactivity_enabled'] = False
        self.sp.options_by_key['provisao_para_baixa'][0]['source_values']['FILIAL'] = BRANCH
        for key in ['filial_cadastro_etapa_obra', 'preencher_filial_baixa']:
            self.sp.options_by_key[key] = copy.deepcopy(BRANCHES)

    def current(self):
        return next(iter(self.case.state.values.values()))

    def reply(self, text=None, reply_id=None):
        # Current production treats typed numbers as search, not a button tap.
        # Exercise the canonical choice IDs emitted by the real clients.
        if text and text.isdigit() and reply_id is None:
            state, _ = self.current()
            step = self.engine._current_step(state)
            if step and step.get('kind') == 'selection':
                reply_id = f"choice:{step['key']}:{text}"
        return self.case.reply(text, reply_id=reply_id)

    def stage_question(self):
        self.reply('OPA')
        self.case.open_supply_provision_action('BAIXAR PAGAMENTO AGENDADO')
        self.reply('370')
        self.reply(reply_id='validar_qtd_baixa_keep')
        self.reply(reply_id='validar_valor_total_baixa_keep')
        self.reply(reply_id='date_today')
        self.reply('371')
        result = self.reply('1')
        self.assertEqual(result['field'], 'etapa_baixa')
        return self.current()

    def options(self):
        return [item for item in self.case.messenger.sent[-1]['options']
                if not item.get('navigation_back') and not item.get('navigation_main_menu')]

    def child_summary(self, branch=420):
        self.reply(reply_id=CREATE)
        self.reply(str(branch))
        self.reply('ETAPA NOVA QA')
        self.reply('1')
        self.reply(reply_id='construction_stage_start_blank')
        self.reply(reply_id='construction_stage_deadline_blank')
        self.reply(reply_id='construction_stage_end_blank')
        self.reply('0')
        summary = self.reply('NÃO')
        self.assertEqual(summary['status'], 'awaiting_confirmation')

    def test_stage_registration_is_first_and_keeps_catalog_ids(self):
        state, _ = self.stage_question()
        self.assertEqual(self.options()[0]['id'], CREATE)
        self.assertEqual(self.options()[0]['title'], '➕ CADASTRAR ETAPA')
        self.assertTrue(any(item['id'] == 372 for item in state['options']))
        self.assertEqual(self.sp.items, {})

    def test_filter_clear_refresh_and_pagination_keep_registration_first(self):
        self.stage_question()
        for command in ['filter_query', 'filter_clear', 'refresh_options']:
            with self.subTest(command=command):
                self.reply('FUNDAÇÃO' if command == 'filter_query' else '', reply_id=command)
                self.assertEqual(self.options()[0]['id'], CREATE)
        state, etag = self.current()
        self.sp.options_by_key['etapa_baixa'] = [
            {'id': index, 'title': f'ETAPA QA {index}', 'value': f'ETAPA QA {index}'}
            for index in range(1, 25)]
        self.engine._prompt_next_or_summary(state, etag)
        self.reply(reply_id='option_next')
        self.assertEqual(self.options()[0]['id'], CREATE)

    def test_opens_the_existing_full_stage_wizard_with_default_branch_first(self):
        original, _ = self.stage_question()
        result = self.reply(reply_id=CREATE)
        state, _ = self.current()
        self.assertEqual(result['field'], 'filial_cadastro_etapa_obra')
        self.assertEqual(state['flow'], 'construction_stage_registration')
        self.assertEqual(state['embedded_return']['type'], 'payment_settlement_stage_registration')
        self.assertEqual(state['embedded_return']['state']['fields'], original['fields'])
        self.assertEqual(self.options()[0]['id'], 420)
        self.assertTrue(self.options()[0]['title'].startswith('⭐ '))
        self.assertEqual(self.options()[0]['value'], BRANCH)
        self.assertEqual(self.sp.items, {})

    def test_parent_branch_question_uses_original_payment_not_a_visual_title(self):
        state, _ = self.stage_question()
        state['fields']['FILIAL'] = OTHER
        step = next(step for step in self.engine._flow_config(state)['steps'] if step['key'] == 'preencher_filial_baixa')
        options = self.engine._selection_options(state, step)
        self.assertEqual(options[0]['id'], 420)
        self.assertTrue(options[0]['title'].startswith('⭐ '))
        self.assertEqual(options[0]['value'], BRANCH)
        deceptive = {'id': 777, 'title': BRANCH, 'value': OTHER}
        self.sp.options_by_key[step['key']] = [deceptive]
        options = self.engine._selection_options(state, step)
        self.assertFalse(any(item['title'].startswith('⭐') for item in options))

    def test_missing_or_ambiguous_default_never_invents_a_choice(self):
        state, _ = self.stage_question()
        step = next(step for step in self.engine._flow_config(state)['steps'] if step['key'] == 'preencher_filial_baixa')
        for choices in [BRANCHES[:1], [BRANCHES[1], {**BRANCHES[1], 'id': 421}]]:
            self.sp.options_by_key[step['key']] = copy.deepcopy(choices)
            options = self.engine._selection_options(state, step)
            self.assertEqual(len(options), len(choices))
            self.assertFalse(any(item['title'].startswith('⭐') for item in options))

    def test_back_restores_payment_and_attachments_without_writes(self):
        state, etag = self.stage_question()
        state['attachments'] = [{'id': 'qa-proof', 'name': 'comprovante.pdf', 'size': 5}]
        self.case.state.save(state['key'], state, etag)
        self.reply(reply_id=CREATE)
        self.assertEqual(self.current()[0]['flow'], 'construction_stage_registration')
        result = self.reply(reply_id='navigation_back')
        restored, _ = self.current()
        self.assertEqual(result['field'], 'etapa_baixa')
        self.assertEqual(restored['flow'], 'payment_settlement')
        self.assertEqual(restored['fields'], state['fields'])
        self.assertEqual(restored['attachments'], state['attachments'])
        self.assertEqual(self.sp.items, {})

    def test_verified_registration_selects_stage_and_only_creates_stage_record(self):
        self.stage_question()
        self.child_summary()
        result = self.reply('SIM')
        state, _ = self.current()
        self.assertTrue(result['embedded_settlement_stage_registered'])
        self.assertEqual(state['flow'], 'payment_settlement')
        self.assertEqual(state['fields']['ETAPA'], 'ETAPA NOVA QA')
        self.assertEqual(state['fields']['ID PROVISÃO'], '370')
        self.assertEqual([item['target_list'] for item in self.sp.items.values()], ['LANCAMENTOOBRA'])
        self.assertEqual(self.sp.update_calls, [])

    def test_group_context_is_isolated_from_child_and_restored_on_back(self):
        state, etag = self.stage_question()
        group = {'parent_id': 88, 'parent': {'FILIAL': BRANCH},
                 'selected_ids': ['11'], 'prepared': True,
                 'journal': {'checkpoints': {}}}
        state['provision_description'] = copy.deepcopy(group)
        state['idempotency_token'] = 'QA-PARENT-IDENTITY'
        self.engine._start_embedded_launch_registration(state, etag,
            flow='construction_stage_registration',
            return_type='payment_settlement_stage_registration', heading='QA ETAPA')
        child, _ = self.current()
        self.assertNotIn('provision_description', child)
        self.assertEqual(child['embedded_return']['state']['provision_description'], group)
        self.reply(reply_id='navigation_back')
        restored, _ = self.current()
        self.assertEqual(restored['provision_description'], group)
        self.assertEqual(restored['idempotency_token'], 'QA-PARENT-IDENTITY')
        self.assertEqual(self.sp.items, {})

    def test_other_branch_registration_returns_to_stage_without_cross_branch_link(self):
        self.stage_question()
        self.child_summary(branch=900)
        result = self.reply('SIM')
        state, _ = self.current()
        self.assertEqual(result['field'], 'etapa_baixa')
        self.assertEqual(state['fields']['FILIAL'], BRANCH)
        self.assertNotEqual(state['fields'].get('ETAPA'), 'ETAPA NOVA QA')
        self.assertEqual([item['target_list'] for item in self.sp.items.values()], ['LANCAMENTOOBRA'])

    def test_unrelated_stage_registration_and_shared_configuration_are_unchanged(self):
        state, _ = self.stage_question()
        before = copy.deepcopy(self.engine.config)
        self.engine._flow_config(state)
        self.assertEqual(self.engine.config, before)
        standalone = {**state, 'flow': 'construction_stage_registration', 'embedded_return': {}}
        step = self.engine._flow_config(standalone)['steps'][0]
        options = self.engine._selection_options(standalone, step)
        self.assertFalse(any(option['title'].startswith('⭐') for option in options))


if __name__ == '__main__':
    unittest.main()
