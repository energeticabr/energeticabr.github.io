"""Exercise recovery in an isolated Bash harness; never touches live services."""
from pathlib import Path
import subprocess
import unittest


SOURCE = Path(__file__).with_name('deploy.sh').read_text()


class RecoveryTests(unittest.TestCase):
    def run_recovery(self, failure=''):
        recovery = SOURCE.split('deployed=0\n', 1)[1].split('\ncheck_baseline\n', 1)[0]
        harness = '''
set -Eeuo pipefail
app=/fake/app; build=/fake/build; stage=/fake/stage; baseline=original
failure="FAILURE"
sudo() { echo "sudo $*"; case "$*" in *"$failure"*) test -z "$failure" ;; *) return 0 ;; esac; }
check_hash() { echo "hash $1 $2"; }
check_workflow() { echo "workflow $1"; }
check_services_health() { echo "health"; }
'''.replace('FAILURE', failure)
        return subprocess.run(['bash', '-c', harness + recovery + '\ndeployed=1\nrollback\n'], capture_output=True, text=True)

    def test_termination_invokes_failure_recovery(self):
        self.assertIn("trap 'on_failure 130' INT", SOURCE)
        self.assertIn("trap 'on_failure 143' TERM", SOURCE)

    def test_success_requires_hash_workflow_and_health_checks(self):
        result = self.run_recovery()
        self.assertEqual(result.returncode, 0, result.stderr)
        for root in ('/fake/app', '/fake/build'):
            self.assertIn(f'hash {root} original', result.stdout)
            self.assertIn(f'workflow {root}', result.stdout)
        self.assertIn('health', result.stdout)
        self.assertIn('ROLLED_BACK_VERIFIED', result.stderr)

    def test_restore_failure_still_attempts_both_copies_and_reports_failure(self):
        result = self.run_recovery('/fake/app/worker/workflow_config.json')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('/fake/build/worker/workflow_config.json', result.stdout)
        self.assertIn('systemctl restart', result.stdout)
        self.assertNotIn('ROLLED_BACK_VERIFIED', result.stderr)
        self.assertIn('ROLLBACK_FAILED', result.stderr)


if __name__ == '__main__':
    unittest.main()
