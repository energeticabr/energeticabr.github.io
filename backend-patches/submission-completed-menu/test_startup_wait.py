"""The rollout must allow a slow, otherwise healthy service startup."""
import os
from pathlib import Path
import re
import sys
import types
import unittest
from unittest.mock import patch


class StartupWaitTests(unittest.TestCase):
    def runner(self):
        path = Path(os.environ.get('STARTUP_RUNNER', 'shared-deploy.py'))
        if 'STARTUP_RUNNER' in os.environ:
            source = path.read_bytes()
        else:
            sys.path.insert(0, str(Path(__file__).parent))
            from package import shared_runner
            source = shared_runner()
        runner = types.ModuleType('synthetic_startup_runner')
        runner.__file__ = str(path)
        exec(compile(source, str(path), 'exec'), runner.__dict__)
        return runner

    def test_service_ready_after_twenty_attempts_is_accepted(self):
        runner = self.runner()
        outcomes = [RuntimeError('still starting')] * 20 + [{'status': 'ok'}]
        with patch.object(runner, 'health', side_effect=outcomes) as health:
            with patch.object(runner.time, 'sleep'):
                try:
                    result = runner.wait_health()
                except RuntimeError:
                    result = {'status': 'startup timed out'}
        self.assertEqual(result, {'status': 'ok'})
        self.assertEqual(health.call_count, 21)

    def test_unhealthy_service_still_stops_after_bounded_wait(self):
        runner = self.runner()
        with patch.object(runner, 'health', side_effect=RuntimeError('unhealthy')) as health:
            with patch.object(runner.time, 'sleep'):
                with self.assertRaisesRegex(RuntimeError, 'unhealthy'):
                    runner.wait_health()
        self.assertEqual(health.call_count, 60)

    def test_ingress_watchdog_covers_health_checks_and_rollback(self):
        gate = Path(__file__).with_name('deployment_gate.sh').read_text()
        seconds = int(re.search(r'--on-active=(\d+)s', gate).group(1))
        # Two 60-attempt health windows with 5s HTTP timeouts and 59 sleeps,
        # plus the 30s drain and a 60s restart allowance.
        budget = 2 * (60 * 5 + 59) + 30 + 60
        self.assertGreater(seconds, budget)


if __name__ == '__main__':
    unittest.main()
