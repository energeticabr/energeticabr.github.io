import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import deploy


class DeployTests(unittest.TestCase):
    def test_manifest_rejects_missing_duplicate_outside_targets(self):
        manifest = json.loads((deploy.HERE / "deploy-manifest.json").read_text())
        with patch.object(deploy, "ROOTS", tuple(PurePosixPath(str(root).replace("\\", "/")) for root in deploy.ROOTS)):
            self.assertEqual(len(deploy.entries(manifest)), 6)
            for invalid in (manifest["files"][:-1], manifest["files"][:5] + manifest["files"][:1]):
                with self.assertRaises(ValueError): deploy.entries({"files": invalid})
            invalid = copy.deepcopy(manifest)
            invalid["files"][0]["candidate"] = "../other.py"
            with self.assertRaises(ValueError): deploy.entries(invalid)
        with self.assertRaises(ValueError): deploy.validate_stage("/opt/energetica-whatsapp")

    def exercise(self, fail_restart=False, concurrent=False):
        with tempfile.TemporaryDirectory(prefix="measured-progress-deploy-test-") as directory:
            root = Path(directory).resolve()
            package, stage = root / "package", root / "stage"
            package.mkdir(); stage.mkdir()
            roots = (root / "live", root / "mirror")
            files, originals = [], {}
            for code_root in roots:
                code_root.mkdir()
                for name in deploy.NAMES:
                    target = code_root / name
                    before = None if name == "operation_progress.py" else ("BEFORE = " + repr(name) + "\n").encode()
                    candidate = ("AFTER = " + repr(name) + "\n").encode()
                    if before is not None: target.write_bytes(before); originals[target] = before
                    (stage / name).write_bytes(candidate)
                    files.append(dict(destination=str(target), candidate=name,
                        before_sha256=hashlib.sha256(before).hexdigest() if before is not None else None,
                        after_sha256=hashlib.sha256(candidate).hexdigest()))
            manifest = json.dumps({"files": files}).encode()
            (package / "deploy-manifest.json").write_bytes(manifest)
            restarts = []
            def restart():
                restarts.append(True)
                if len(restarts) == 1 and concurrent:
                    (roots[0] / "channel_bridge.py").write_bytes(b"EXTERNAL = True\n")
                if len(restarts) == 1 and fail_restart: raise RuntimeError("health failed")
            with patch.object(deploy, "ROOTS", roots), patch.object(deploy, "HERE", package), \
                 patch.object(deploy, "validate_stage", lambda value: Path(value)), \
                 patch.object(deploy, "health", lambda: None), patch.object(deploy, "restart", restart), \
                 patch.object(os, "chown", lambda *_: None, create=True):
                if fail_restart:
                    with self.assertRaises(RuntimeError): deploy.deploy(stage, hashlib.sha256(manifest).hexdigest(), True)
                    for path, content in originals.items():
                        expected = b"EXTERNAL = True\n" if concurrent and path == roots[0] / "channel_bridge.py" else content
                        self.assertEqual(path.read_bytes(), expected)
                    self.assertTrue(all(not (code_root / "operation_progress.py").exists() for code_root in roots))
                    self.assertEqual(len(restarts), 2)
                else:
                    receipt = deploy.deploy(stage, hashlib.sha256(manifest).hexdigest(), True)
                    self.assertEqual(receipt["status"], "published")
                    self.assertTrue(Path(receipt["backup"], "receipt.json").is_file())
                    for entry in files:
                        self.assertEqual(hashlib.sha256(Path(entry["destination"]).read_bytes()).hexdigest(), entry["after_sha256"])

    def test_install_succeeds_with_checked_sources_and_retained_receipt(self): self.exercise()
    def test_failed_health_restores_originals_and_removes_only_owned_new_modules(self): self.exercise(fail_restart=True)
    def test_rollback_preserves_a_concurrent_writers_changed_source(self): self.exercise(fail_restart=True, concurrent=True)


if __name__ == "__main__": unittest.main()
