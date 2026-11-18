import ast
from pathlib import Path
from types import SimpleNamespace
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import threading
import unittest


class FakeSession:
    closed = []
    def __init__(self):
        self.retry_policy = {'GET': [429, 500, 502, 503, 504]}
    def __enter__(self):
        return self
    def __exit__(self, *_):
        self.closed.append(self)


def load_menu():
    path = Path(__file__).with_name('menu_method.py')
    tree = ast.parse(path.read_text(encoding='utf-8'))
    context = {'datetime': datetime, 'ZoneInfo': ZoneInfo, 'PENDING_GROUP_ID': 'pending'}
    exec(compile(tree, str(path), 'exec'), context)
    return context['_start_group_menu_options']


class MenuTests(unittest.TestCase):
    def test_workers_isolate_sessions_and_caches_and_preserve_retry_policy(self):
        base, _ = self.engine()
        client = SimpleNamespace(session=FakeSession(), _field_cache={'list': {'field': 'value'}},
                                 _field_type_cache={'list': {'field': 'Text'}})
        seen = []
        names = ['_pending_attendance_days_count', '_pending_pathologies_count', '_pending_notes_count',
                 '_pending_documents_count', '_pending_provisions', '_today_pending_attendance_action']
        def wrapper(name):
            original = getattr(base, name)
            def run(reader, *args):
                self.assertIsNot(reader.sharepoint, client)
                self.assertIsNot(reader.sharepoint.session, client.session)
                self.assertEqual(reader.sharepoint.session.retry_policy, client.session.retry_policy)
                reader.sharepoint._field_cache['list']['field'] = 'worker'
                reader.sharepoint._field_type_cache['list']['field'] = 'worker'
                seen.append(reader.sharepoint.session)
                return original(*args)
            return run
        reader_type = type('Reader', (SimpleNamespace,), {name: wrapper(name) for name in names})
        reader = reader_type(**{name: value for name, value in vars(base).items() if name not in names}, sharepoint=client)
        load_menu()(reader, {})
        self.assertEqual(len(seen), 6)
        self.assertEqual(len({id(value) for value in seen}), 6)
        self.assertTrue(all(value in FakeSession.closed for value in seen))
        self.assertNotIn(client.session, FakeSession.closed)
        self.assertEqual(client._field_cache['list']['field'], 'value')
        self.assertEqual(client._field_type_cache['list']['field'], 'Text')

    def engine(self, barrier=None):
        calls = []
        today = datetime.now(ZoneInfo('America/Sao_Paulo')).date()
        def read(name, result):
            def run(*args):
                calls.append(name)
                if barrier and name in {'attendance', 'pathology', 'notes'}:
                    barrier.wait(timeout=2)
                return result
            return run
        engine = SimpleNamespace(
            _nb_portal_session=lambda state: state.get('nb', False),
            _start_groups=lambda: [{'id': 'first'}, {'id': 'pending'}, {'id': 'group_nb_participacoes'}, {'id': 'group_personal_expenses'}],
            _pending_construction_diary_options=read('diary', (None, [{'id': 'd1'}], {'id': 'latent'})),
            _pending_attendance_days_count=read('attendance', 2),
            _pending_pathologies_count=read('pathology', 3),
            _pending_notes_count=read('notes', 4),
            _pending_documents_count=read('documents', 5),
            _pending_provisions=read('provisions', [{'due': today}, {'due': today + timedelta(days=1)}]),
            _pending_provision_due_date=lambda row: row['due'],
            _today_pending_attendance_action=read('today-attendance', {'id': 'attendance', 'tone': 'danger'}),
            _startable_construction_diary_action=lambda rows: {'id': 'start-diary', 'count': len(rows)} if rows else None,
        )
        # Existing implementation paths, so the baseline test exercises real duplication.
        engine._pending_total_count = lambda state: 2 + sum(getattr(engine, name)() for name in (
            '_pending_attendance_days_count', '_pending_pathologies_count', '_pending_notes_count')) + engine._pending_documents_count(state) + len(engine._pending_provisions())
        engine._pending_provisions_due_count = lambda: sum(row['due'] <= today for row in engine._pending_provisions())
        def diaries(state):
            _, rows, latent = engine._pending_construction_diary_options(state)
            return [latent, engine._startable_construction_diary_action(rows)]
        engine._main_menu_diary_actions = diaries
        return engine, calls

    def test_independent_reads_overlap_and_preserve_menu(self):
        engine, calls = self.engine(threading.Barrier(3))
        options = load_menu()(engine, {})
        self.assertEqual(options[1:4], [{'id': 'attendance', 'tone': 'danger'}, {'id': 'latent'}, {'id': 'start-diary', 'count': 1}])
        self.assertEqual(options[4], {'id': 'pending', 'title': '⏳ PENDÊNCIAS (18)', 'tone': 'danger'})
        self.assertEqual(calls.count('diary'), 1)
        self.assertEqual(calls.count('provisions'), 1)

    def test_nb_does_not_query_energetico(self):
        engine, calls = self.engine()
        self.assertEqual(load_menu()(engine, {'nb': True}), [{'id': 'group_nb_participacoes'}, {'id': 'group_personal_expenses'}])
        self.assertEqual(calls, [])

    def test_failures_keep_menu_and_fresh_reads(self):
        engine, calls = self.engine()
        engine._pending_construction_diary_options = lambda state: (_ for _ in ()).throw(OSError('offline'))
        engine._pending_provisions = lambda: []
        first = load_menu()(engine, {})
        self.assertEqual(next(x for x in first if x['id'] == 'pending')['title'], '⏳ PENDÊNCIAS (14)')
        engine._pending_notes_count = lambda: 10
        second = load_menu()(engine, {})
        self.assertEqual(next(x for x in second if x['id'] == 'pending')['title'], '⏳ PENDÊNCIAS (20)')
        self.assertNotIn('tone', next(x for x in second if x['id'] == 'pending'))


if __name__ == '__main__':
    unittest.main()
