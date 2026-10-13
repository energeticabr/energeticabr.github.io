"""Replay the real shared deployer's safety tests through this pinned wrapper."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import deploy

suite_path = Path(__file__).resolve().parent.parent / "launch-payroll-per-payment" / "test_deploy.py"
spec = importlib.util.spec_from_file_location("demonstrative_activity_deploy_safety", suite_path)
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
original.deploy = deploy.load_runner(deploy.LOCAL_RUNNER)


class WrapperTests(unittest.TestCase):
    def test_unreviewed_runner_is_rejected_without_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "runner.py"
            source.write_text("raise RuntimeError('UNTRUSTED RUNNER EXECUTED')\n")
            with self.assertRaisesRegex(RuntimeError, "hash mismatch"):
                deploy.load_runner(source)


def load_tests(loader, tests, pattern):
    tests.addTests(loader.loadTestsFromTestCase(original.DeployTests))
    return tests


if __name__ == "__main__":
    unittest.main()
