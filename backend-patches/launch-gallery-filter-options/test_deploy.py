"""Exercise the new wrapper with the existing real rollout contract tests."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


deploy = load("filter_options_deploy_under_test", Path(__file__).with_name("deploy.py"))
fixtures = load("filter_options_deploy_fixtures", ROOT / "launch-gallery-quick-search/test_deploy.py")
fixtures.deploy = deploy.gallery


class DeployTests(fixtures.DeployTests):
    pass


class BundleTests(unittest.TestCase):
    def test_exact_stage_scope_and_candidate_pin(self):
        self.assertEqual(deploy.gallery.runner.STAGE.as_posix(), "/home/opc/gallery-filter-options-20261009/candidate")
        self.assertEqual(deploy.gallery.runner.FILES, ("worker/launch_gallery.py",))
        self.assertEqual(deploy.gallery.runner.NEW_HELPERS, ())
        manifest = json.loads(Path(__file__).with_name("deploy-manifest.json").read_text())
        self.assertEqual(set(manifest), {"worker/launch_gallery.py"})
        entry = manifest["worker/launch_gallery.py"]
        self.assertEqual(set(entry["before"]), {root.as_posix() for root in deploy.gallery.runner.ROOTS})
        candidate = ROOT / "launch-gallery-quick-search/candidate/worker/launch_gallery.py"
        self.assertEqual(hashlib.sha256(candidate.read_bytes()).hexdigest(), entry["after"])

    def test_cli_delegates_to_guarded_gallery_runner(self):
        from unittest.mock import patch
        with patch.object(deploy.gallery, "main") as main:
            deploy.main()
        main.assert_called_once_with()


if __name__ == "__main__":
    unittest.main(verbosity=2)
