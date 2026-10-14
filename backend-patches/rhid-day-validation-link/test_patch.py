import unittest
from contextlib import nullcontext
from datetime import date
from pathlib import Path
from types import SimpleNamespace
import sys

sys.path.insert(0, str(Path(__file__).parent))
from patch_bridge import patch_bridge


class BridgePatchTests(unittest.TestCase):
    def test_report_count_keeps_unmatched_pending_ids_and_deduplicates(self):
        source = '''class Bridge:
    def portal_rhid_attendance_report(
        self,
    ):
        pending_rows = self.engine.sharepoint.get_pending_attendance(on_date)
        return {
            "status": "processed",
            "messages": [],
            "attendanceReport": {"date": on_date.isoformat(), "rows": rows,
                **({"registration": badge_report["registration"]} if badge_report else {})},
        }

    def portal_rhid_pending_validation_start(
        self,
    ):
        pass

class Handler:
    def dispatch(self):
                if action == "something_else":
                    pass
                elif action == "rhid_pending_validation_start":
                    pass
'''
        with self.assertRaises(ValueError):
            patch_bridge(source + source)
        output = patch_bridge(source)
        namespace = {
            'date': date, 're': __import__('re'), 'on_date': date(2026, 10, 13),
            'rows': [], 'badge_report': None,
            'normalize_text': lambda value: value.lower().strip(),
        }
        exec(compile(output, 'candidate.py', 'exec'), namespace)
        pending = [
            {'Id': 21, 'DATA': '2026-10-13', 'PRESENCA': 'PENDENTE', 'FORNECEDOR': 'SEM RHID'},
            {'Id': 21, 'DATA': '2026-10-13', 'PRESENCA': 'PENDENTE', 'FORNECEDOR': 'SEM RHID'},
            {'Id': 22, 'DATA': '2026-10-13', 'PRESENCA': 'PENDENTE'},
            {'Id': 23, 'DATA': '2026-10-12', 'PRESENCA': 'PENDENTE'},
            {'Id': 24, 'DATA': '2026-10-13', 'PRESENCA': 'VALIDADO'},
        ]
        bridge = namespace['Bridge']()
        bridge.engine = SimpleNamespace(sharepoint=SimpleNamespace(get_pending_attendance=lambda _: pending))
        self.assertEqual(bridge.portal_rhid_attendance_report()['attendanceReport']['pendingValidationCount'], 2)

    def test_new_day_action_rejects_empty_day_without_starting_flow(self):
        from patch_bridge import DAY_METHOD
        namespace = {'date': date, 're': __import__('re')}
        exec('class Probe:\n' + DAY_METHOD, namespace)
        probe = namespace['Probe']()
        with self.assertRaisesRegex(ValueError, 'Data inválida'):
            probe.portal_rhid_day_validation_start({}, '2026-10-32', allowed_emails=set())

    def test_new_day_action_opens_whole_selected_day_without_choosing_one_id(self):
        from patch_bridge import DAY_METHOD
        namespace = {'date': date, 're': __import__('re')}
        exec('class Probe:\n' + DAY_METHOD, namespace)
        probe = namespace['Probe']()
        state = {'attachments': []}
        calls = []
        probe.lock = nullcontext()
        probe._portal_state = lambda identity: ('session', state)
        probe.portal_owners = SimpleNamespace(authorize=lambda *args, **kwargs: calls.append(('authorize', args[0])))
        probe.engine = SimpleNamespace(
            state_store=SimpleNamespace(load=lambda key: (state, 'etag')),
            _pending_attendance_record_options=lambda current, day: calls.append(('options', day)) or [{'value': '21'}, {'value': '22'}],
            _push_navigation_state=lambda current: calls.append(('push', None)),
            _begin_action=lambda current, etag, selected, **kwargs: calls.append(('begin', selected, kwargs)) or {'etag': 'new'},
        )
        probe.messenger = SimpleNamespace(reset=lambda: None, drain=lambda: [{'type': 'poll', 'question': 'QUAL PRESENÇA?'}])
        result = probe.portal_rhid_day_validation_start({}, '2026-10-13', allowed_emails=set())
        self.assertEqual(result['messages'][0]['question'], 'QUAL PRESENÇA?')
        self.assertEqual(calls[1], ('options', '2026-10-13'))
        self.assertEqual(calls[3][1]['attendance_home_shortcut'], True)
        self.assertEqual(calls[3][2]['preset_fields'], {'DATA FILTRO PRESENÇA': '2026-10-13'})
        self.assertEqual(calls[3][2]['start_step_key'], 'registro_presenca_pendente')

    def test_new_day_action_refuses_when_pending_list_was_emptied(self):
        from patch_bridge import DAY_METHOD
        namespace = {'date': date, 're': __import__('re')}
        exec('class Probe:\n' + DAY_METHOD, namespace)
        probe = namespace['Probe']()
        probe.lock = nullcontext()
        probe._portal_state = lambda identity: ('session', {'attachments': []})
        probe.portal_owners = SimpleNamespace(authorize=lambda *args, **kwargs: None)
        probe.engine = SimpleNamespace(
            state_store=SimpleNamespace(load=lambda key: ({'attachments': []}, 'etag')),
            _pending_attendance_record_options=lambda state, day: [],
        )
        with self.assertRaisesRegex(ValueError, 'Não há presenças pendentes'):
            probe.portal_rhid_day_validation_start({}, '2026-10-13', allowed_emails=set())


if __name__ == '__main__':
    unittest.main()
