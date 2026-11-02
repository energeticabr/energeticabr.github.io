import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest

from demand_watch import Inotify, Notifications, next_wake


def fiscal(status='queued', due=None, lease=0):
    source = {'status': status}
    if due:
        source['nextAllowedAt'] = due
    return {'jobs': {'request': {'status': status, 'leaseUntil': lease,
                               'sources': {'NFE': source, 'CTE': {'status': 'succeeded'},
                                           'NFSE': {'status': 'succeeded'}}}}}


class DemandTests(unittest.TestCase):
    def test_empty_and_terminal_queues_do_not_wake(self):
        self.assertIsNone(next_wake({'jobs': {}}, 'dda', 100))
        self.assertIsNone(next_wake({'jobs': {'x': {'status': 'succeeded'}}}, 'dda', 100))
        self.assertIsNone(next_wake(fiscal('succeeded'), 'fiscal', 100))

    def test_dda_queued_wakes_but_running_does_not(self):
        self.assertEqual(next_wake({'jobs': {'x': {'status': 'queued'}}}, 'dda', 100), 100)
        self.assertIsNone(next_wake({'jobs': {'x': {'status': 'running'}}}, 'dda', 100))

    def test_fiscal_ready_and_expired_lease(self):
        self.assertEqual(next_wake(fiscal(), 'fiscal', 100), 100)
        self.assertEqual(next_wake(fiscal('running', lease=90), 'fiscal', 100), 100)

    def test_future_retry_waits_until_due_without_a_file_change(self):
        state = fiscal('waiting', '1970-01-01T00:03:20.0000000Z')
        self.assertEqual(next_wake(state, 'fiscal', 100), 200)
        notifications = Notifications()
        self.assertEqual(notifications.update({'fiscal': state}, 100), ([], 200))
        self.assertEqual(notifications.update({'fiscal': state}, 200)[0], ['fiscal'])

    def test_global_lease_blocks_another_ready_request(self):
        state = fiscal('running', lease=300)
        state['jobs']['other'] = fiscal()['jobs']['request']
        self.assertEqual(next_wake(state, 'fiscal', 100), 300)

    def test_one_ready_source_does_not_wait_for_other_source(self):
        state = fiscal('waiting', '1970-01-01T00:03:20Z')
        state['jobs']['request']['sources']['CTE'] = {'status': 'queued'}
        self.assertEqual(next_wake(state, 'fiscal', 100), 100)

    def test_reconnect_rediscovers_existing_work(self):
        self.assertEqual(Notifications().update({'fiscal': fiscal()}, 100)[0], ['fiscal'])
        self.assertEqual(Notifications().update({'fiscal': fiscal()}, 101)[0], ['fiscal'])

    def test_pending_work_is_reannounced_but_idle_heartbeats_are_not(self):
        notifier = Notifications()
        state = {'dda': {'jobs': {'x': {'status': 'queued'}}}}
        self.assertEqual(notifier.update(state, 100)[0], ['dda'])
        self.assertEqual(notifier.update(state, 101), ([], 115))
        self.assertEqual(notifier.update(state, 115)[0], ['dda'])
        self.assertEqual(notifier.update({'dda': {'jobs': {}, 'heartbeat': 120}}, 120)[0], [])
        self.assertEqual(notifier.update(state, 121)[0], ['dda'])

    def test_invalid_queue_or_cooldown_fails_closed(self):
        with self.assertRaises(ValueError):
            next_wake(fiscal(), 'other', 100)
        with self.assertRaises(ValueError):
            next_wake(fiscal('waiting', 'invalid'), 'fiscal', 100)

    @unittest.skipIf(os.name == 'nt', 'Linux notification integration')
    def test_atomic_replacement_wakes_inotify(self):
        with tempfile.TemporaryDirectory() as directory, Inotify([directory]) as watcher:
            def replace():
                time.sleep(0.1)
                temporary = Path(directory) / 'state.tmp'
                temporary.write_text(json.dumps({'jobs': {}}))
                os.replace(temporary, Path(directory) / 'state.json')
            worker = threading.Thread(target=replace)
            worker.start()
            self.assertTrue(watcher.wait(2))
            worker.join()


if __name__ == '__main__':
    unittest.main()
