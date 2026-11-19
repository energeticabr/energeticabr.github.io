"""Exercise rollback and staging isolation without service or production writes."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class DeployTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        module_path = Path(__file__).resolve().parents[1] / "deploy.py"
        spec = importlib.util.spec_from_file_location("tax_deploy", module_path)
        self.module = importlib.util.module_from_spec(spec)
        # fcntl is only used by the CLI lock, outside the tested function.
        try:
            import fcntl
        except ImportError:
            fcntl = SimpleNamespace()
        with patch.dict(sys.modules, {"fcntl": fcntl}):
            spec.loader.exec_module(self.module)
        self.stage = self.root / "stage"; self.stage.mkdir()
        self.backups = self.root / "backups"; self.backups.mkdir()
        self.module.BACKUP_ROOT = self.backups
        self.module.TARGETS = {}
        manifest = {}
        for name in ("live", "mirror"):
            directory = self.root / name; directory.mkdir()
            workflow = directory / "workflow.py"; workflow.write_text("old = True\n")
            self.module.TARGETS[name] = workflow
            helper = directory / "payroll_tax_settlement.py"
            self.module.TARGETS["tax-" + name] = helper
            candidate = self.stage / (name + "-candidate.py"); candidate.write_text("new = True\n")
            diff = self.stage / (name + ".patch"); diff.write_text("fixture patch")
            manifest[name] = {"before": sha(workflow), "after": sha(candidate),
                              "candidate": candidate.name, "patch": sha(diff)}
            tax = self.stage / "payroll_tax_settlement.py"; tax.write_text("helper = True\n")
            manifest["tax-" + name] = {"before": None, "after": sha(tax), "candidate": tax.name}
        self.manifest = self.stage / "deploy-manifest.json"
        self.manifest.write_text(json.dumps(manifest))
        self.log = self.root / "copies.jsonl"
        runner = self.root / "runner.py"
        runner.write_text("import json,shutil\nfrom pathlib import Path\n"
                          "def atomic_copy(source,target,attributes):\n"
                          f" with Path({str(self.log)!r}).open('a') as f: f.write(json.dumps([str(source),str(target),attributes.st_ino])+'\\n')\n"
                          " if source.name == 'mirror-candidate.py' or source.name == 'candidate-mirror.py': raise RuntimeError('injected copy failure')\n"
                          " shutil.copy2(source,target)\n")
        self.module.RUNNER = runner
        self.module.RUNNER_HASH = sha(runner)
        self.module.restart = lambda: None

    def test_rollback_preserves_original_target_attributes(self):
        workflow = self.module.TARGETS["live"]
        original_inode = workflow.stat().st_ino
        self.module.health = lambda runner: {"bridge": "ok", "worker": "ok"}
        with self.assertRaisesRegex(RuntimeError, "injected copy failure"):
            self.module.deploy(self.stage, sha(self.manifest), False)
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        restores = [c for c in calls if Path(c[0]).name == "live.py"]
        self.assertEqual(len(restores), 1)
        self.assertEqual(restores[0][2], original_inode)
        self.assertEqual(workflow.read_text(), "old = True\n")
        self.assertFalse(self.module.TARGETS["tax-live"].exists())

    def test_staged_bytes_changed_after_validation_never_reach_target(self):
        def health(runner):
            (self.stage / "live-candidate.py").write_text("unvalidated = True\n")
            return {"bridge": "ok", "worker": "ok"}
        self.module.health = health
        with self.assertRaises(RuntimeError):
            self.module.deploy(self.stage, sha(self.manifest), False)
        self.assertEqual(self.module.TARGETS["live"].read_text(), "old = True\n")
        receipt = next(self.backups.glob("*/receipt.json"))
        self.assertEqual(json.loads(receipt.read_text())["status"], "rolled_back")

    def test_check_does_not_install_files(self):
        self.module.health = lambda runner: {"bridge": "ok", "worker": "ok"}
        result = self.module.deploy(self.stage, sha(self.manifest), True)
        self.assertEqual(result["status"], "checked")
        self.assertFalse(self.log.exists())
        self.assertFalse(self.module.TARGETS["tax-live"].exists())

