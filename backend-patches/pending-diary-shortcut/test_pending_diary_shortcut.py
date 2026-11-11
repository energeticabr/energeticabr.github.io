import os
from datetime import datetime
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(os.environ['ENERGETICA_WORKFLOW_SOURCE_DIR'])))
from workflow import WorkflowEngine


def diary(item_id, day, *, status='PENDENTE', activities=None):
    return {
        'id': item_id,
        'title': f'{item_id} - Obra de teste',
        'value': str(item_id),
        'source_values': {
            'DATA': f'{day}T03:00:00Z' if day else None,
            'STATUS': status,
            'ATIVIDADES EXECUTADAS': activities,
        },
    }


class PendingDiaryShortcutTest(unittest.TestCase):
    def setUp(self):
        self.engine = WorkflowEngine.__new__(WorkflowEngine)
        self.items = []
        self.latent = None
        self.state = {'key': 'test-conversation'}
        self.engine.config = {'sharepoint': {'construction_diary_fill_flow': {
            'main_menu_start': {'not_started_fields': ['ATIVIDADES EXECUTADAS']},
            'steps': [{'key': 'diario_obra_pendente'}],
        }}}
        self.engine.sharepoint = SimpleNamespace(get_options=lambda step, fields: self.items)
        self.engine._load_latent_diary_record = lambda state: (self.latent, 'etag')
        self.engine._today_diary_photo_append_action = lambda: None
        clock = patch('workflow.datetime', wraps=datetime)
        clock.start().now.return_value = datetime(2026, 11, 11, tzinfo=ZoneInfo('America/Sao_Paulo'))
        self.addCleanup(clock.stop)

    def test_only_old_partially_filled_diary_opens_from_the_menu(self):
        self.items = [diary(17, '2026-11-07', activities='Fundação')]
        action, = self.engine._main_menu_diary_actions(self.state)
        self.assertEqual(action['title'], '📔 COMEÇAR DIÁRIO DE OBRAS (07/11/2026)')

        with patch.object(self.engine, '_begin_action') as begin:
            self.engine._handle_group_choice({
                'reply_id': action['reply'], 'message_id': 'test-reply',
            }, self.state, 'etag')
        selected = begin.call_args.args[2]
        self.assertEqual(selected['flow'], 'construction_diary_fill')
        self.assertEqual([item['value'] for item in selected['diary_start_options']], ['17'])

    def test_pending_diaries_across_dates_are_listed_without_a_single_date_label(self):
        self.items = [
            diary(21, '2026-11-11'), diary(17, '2026-11-07'), diary(16, None),
            diary(15, '2026-11-10', status='CONCLUÍDO'),
        ]
        action, = self.engine._main_menu_diary_actions(self.state)
        self.assertEqual(action['title'], '📔 COMEÇAR DIÁRIO DE OBRAS')
        self.assertEqual([item['value'] for item in action['options']], ['21', '17', '16'])

    def test_old_paused_diary_is_offered_even_before_the_first_answer(self):
        self.items = [diary(17, '2026-11-07')]
        self.latent = {'diary_date': '07/11/2026', 'diary_state': {'fields': {'ID DIÁRIO': 17}}}
        action, = self.engine._main_menu_diary_actions(self.state)
        self.assertEqual(action['reply'], 'resume_latent_construction_diary')
        self.assertIn('07/11/2026', action['title'])

        with patch.object(self.engine, '_resume_latent_diary') as resume:
            self.engine._handle_group_choice({
                'reply_id': action['reply'], 'message_id': 'test-reply',
            }, self.state, 'etag')
        self.assertIs(resume.call_args.args[3], self.latent)

    def test_no_shortcut_when_only_completed_diaries_remain(self):
        self.items = [diary(17, '2026-11-07', status='CONCLUÍDO')]
        self.assertEqual(self.engine._main_menu_diary_actions(self.state), [])


if __name__ == '__main__':
    unittest.main()
