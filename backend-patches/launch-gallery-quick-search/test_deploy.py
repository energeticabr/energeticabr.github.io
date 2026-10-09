"""Run the real shared rollout against temporary local targets, never the VM."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


DEPLOY_PATH = Path(__file__).with_name("deploy.py")
if DEPLOY_PATH.exists():
    spec = importlib.util.spec_from_file_location("gallery_quick_search_deploy", DEPLOY_PATH)
    deploy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)
else:
    deploy = None


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(deploy, "The gallery deploy wrapper has not been implemented")
        self.runner = deploy.runner
        temp = tempfile.TemporaryDirectory(prefix="gallery-quick-search-tests-")
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.roots = (self.root / "production", self.root / "mirror")
        self.stage = self.root / "candidate"
        self.relative = "worker/launch_gallery.py"
        self.candidate = b"VALUE = 'search candidate'\n"
        self.originals = (b"VALUE = 'production baseline'\n", b"VALUE = 'mirror baseline'\n")
        self.pins = {}
        for root, original in zip(self.roots, self.originals):
            (root / "worker").mkdir(parents=True)
            (root / self.relative).write_bytes(original)
            self.pins[str(root)] = hashlib.sha256(original).hexdigest()
            (root / "worker/workflow.py").write_bytes(b"OTHER_MODULE = 1\n")
        (self.stage / "worker").mkdir(parents=True)
        (self.stage / self.relative).write_bytes(self.candidate)
        self.manifest = {self.relative: {"before": self.pins,
                                       "after": hashlib.sha256(self.candidate).hexdigest()}}
        for name, value in (("ROOTS", self.roots), ("STAGE", self.stage),
                            ("BACKUPS", self.root / "backups")):
            patcher = patch.object(self.runner, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(self.runner, "set_owner", lambda *args: None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.health = patch.object(self.runner, "health", return_value={"status": "ok"}).start()
        self.addCleanup(patch.stopall)

    def assert_originals(self):
        for root, original in zip(self.roots, self.originals):
            self.assertEqual((root / self.relative).read_bytes(), original)
            self.assertEqual((root / "worker/workflow.py").read_bytes(), b"OTHER_MODULE = 1\n")

    def receipt(self):
        receipts = list((self.root / "backups").glob("*/receipt.json"))
        self.assertEqual(len(receipts), 1)
        return json.loads(receipts[0].read_text())

    def test_check_accepts_distinct_baselines_without_live_writes_or_backup(self):
        with patch.object(self.runner, "restart") as restart:
            result = deploy.execute(self.manifest, check_only=True)
        self.assertEqual(result["status"], "checked")
        self.assertEqual(result["before"], {str(root / self.relative): self.pins[str(root)] for root in self.roots})
        self.assert_originals()
        self.assertFalse((self.root / "backups").exists())
        restart.assert_not_called()

    def test_success_installs_only_gallery_and_backs_up_each_actual_baseline(self):
        with patch.object(self.runner, "restart"):
            result = deploy.execute(self.manifest)
        self.assertEqual(result["status"], "deployed")
        backup = Path(result["backup"])
        for index, (root, original) in enumerate(zip(self.roots, self.originals)):
            self.assertEqual((root / self.relative).read_bytes(), self.candidate)
            self.assertEqual((root / "worker/workflow.py").read_bytes(), b"OTHER_MODULE = 1\n")
            self.assertEqual((backup / f"{index}-launch_gallery.py").read_bytes(), original)

    def test_drift_on_either_target_blocks_before_backup(self):
        for index, root in enumerate(self.roots):
            with self.subTest(target=index):
                target = root / self.relative
                target.write_bytes(b"USER_CHANGE = 1\n")
                with patch.object(self.runner, "restart") as restart, self.assertRaisesRegex(RuntimeError, "drift"):
                    deploy.execute(self.manifest)
                self.assertEqual(target.read_bytes(), b"USER_CHANGE = 1\n")
                self.assertFalse((self.root / "backups").exists())
                restart.assert_not_called()
                target.write_bytes(self.originals[index])

    def test_swapped_baselines_are_not_accepted_just_because_hashes_are_known(self):
        for root, original in zip(self.roots, reversed(self.originals)):
            (root / self.relative).write_bytes(original)
        with self.assertRaisesRegex(RuntimeError, "drift"):
            deploy.execute(self.manifest)
        self.assertFalse((self.root / "backups").exists())

    def test_wrong_candidate_hash_blocks_before_mutation(self):
        (self.stage / self.relative).write_bytes(b"UNREVIEWED = 1\n")
        with self.assertRaisesRegex(RuntimeError, "Candidate hash"):
            deploy.execute(self.manifest)
        self.assert_originals()
        self.assertFalse((self.root / "backups").exists())

    def test_extra_module_in_manifest_is_rejected_before_mutation(self):
        self.manifest["worker/workflow.py"] = self.manifest[self.relative]
        with self.assertRaisesRegex(RuntimeError, "Unexpected file"):
            deploy.execute(self.manifest)
        self.assert_originals()
        self.assertFalse((self.root / "backups").exists())

    def test_missing_or_extra_target_baseline_is_rejected(self):
        for pins in ({str(self.roots[0]): self.pins[str(self.roots[0])]}, self.pins | {"/wrong/root": "0" * 64}):
            with self.subTest(pins=pins), self.assertRaisesRegex(RuntimeError, "baseline"):
                deploy.execute({self.relative: {"before": pins, "after": self.manifest[self.relative]["after"]}})
        self.assert_originals()
        self.assertFalse((self.root / "backups").exists())

    def test_manifest_rejects_missing_invalid_or_extra_hash_metadata(self):
        for entry in ({"after": "a" * 64}, {"before": self.pins, "after": "bad"},
                      {"before": self.pins | {str(self.roots[0]): None}, "after": "a" * 64},
                      self.manifest[self.relative] | {"unapproved": True}):
            with self.subTest(entry=entry), self.assertRaises(RuntimeError):
                deploy.execute({self.relative: entry})
        self.assert_originals()
        self.assertFalse((self.root / "backups").exists())

    def test_failed_restart_restores_each_distinct_original_and_records_rollback(self):
        with patch.object(self.runner, "restart", side_effect=[RuntimeError("restart failed"), None]), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "restart failed"):
                deploy.execute(self.manifest)
        self.assert_originals()
        self.assertEqual(self.receipt()["status"], "rolled_back")

    def test_failed_second_install_restores_first_target_and_second_baseline(self):
        real_copy = self.runner.atomic_copy
        def copy(source, target, attributes=None):
            if source == self.stage / self.relative and target == self.roots[1] / self.relative:
                raise OSError("mirror install failed")
            return real_copy(source, target, attributes)
        with patch.object(self.runner, "atomic_copy", side_effect=copy), patch.object(self.runner, "restart"), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(OSError, "mirror install failed"):
                deploy.execute(self.manifest)
        self.assert_originals()
        self.assertEqual(self.receipt()["status"], "rolled_back")

    def test_restore_failure_still_restores_production_and_records_incomplete_rollback(self):
        real_copy = self.runner.atomic_copy
        def copy(source, target, attributes=None):
            if "backups" in source.parts and target == self.roots[1] / self.relative:
                raise OSError("mirror restore failed")
            return real_copy(source, target, attributes)
        with patch.object(self.runner, "atomic_copy", side_effect=copy), patch.object(self.runner, "restart", side_effect=[RuntimeError("initial failure"), None]), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "initial failure"):
                deploy.execute(self.manifest)
        self.assertEqual((self.roots[0] / self.relative).read_bytes(), self.originals[0])
        self.assertEqual((self.roots[1] / self.relative).read_bytes(), self.candidate)
        self.assertEqual(self.receipt()["status"], "rollback_incomplete")
        self.assertIn("mirror restore failed", " ".join(self.receipt()["errors"]))

    def test_target_drift_between_wrapper_and_shared_runner_is_rejected(self):
        real_digest = self.runner.digest
        target = self.roots[0] / self.relative
        calls = 0
        def digest(path):
            nonlocal calls
            if path == target:
                calls += 1
                if calls == 2:
                    target.write_bytes(self.originals[1])
            return real_digest(path)
        with patch.object(self.runner, "digest", side_effect=digest), self.assertRaisesRegex(RuntimeError, "drift"):
            deploy.execute(self.manifest)
        self.assertFalse((self.root / "backups").exists())

    def test_late_drift_is_preserved_while_installed_production_is_rolled_back(self):
        real_copy = self.runner.atomic_copy
        def copy(source, target, attributes=None):
            result = real_copy(source, target, attributes)
            if source == self.stage / self.relative and target == self.roots[0] / self.relative:
                (self.roots[1] / self.relative).write_bytes(b"USER_LATE_CHANGE = 1\n")
            return result
        with patch.object(self.runner, "atomic_copy", side_effect=copy), patch.object(self.runner, "restart"), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "drift"):
                deploy.execute(self.manifest)
        self.assertEqual((self.roots[0] / self.relative).read_bytes(), self.originals[0])
        self.assertEqual((self.roots[1] / self.relative).read_bytes(), b"USER_LATE_CHANGE = 1\n")
        self.assertEqual(self.receipt()["status"], "rolled_back")

    def test_drift_after_preinstall_digest_preserves_uninstalled_mirror(self):
        real_digest = self.runner.digest
        production = self.roots[0] / self.relative
        mirror = self.roots[1] / self.relative
        injected = False

        def digest(path):
            nonlocal injected
            actual = real_digest(path)
            if path == mirror and not injected and production.read_bytes() == self.candidate:
                # Return the baseline already read by the runner, but change the
                # file before changed.append and the wrapper's copy-time guard.
                mirror.write_bytes(b"USER_LATE_CHANGE = 1\n")
                injected = True
            return actual

        with patch.object(self.runner, "digest", side_effect=digest), patch.object(self.runner, "restart"), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "drift"):
                deploy.execute(self.manifest)
        self.assertTrue(injected)
        self.assertEqual(mirror.read_bytes(), b"USER_LATE_CHANGE = 1\n")
        self.assertEqual(production.read_bytes(), self.originals[0])
        receipt = self.receipt()
        self.assertEqual(receipt["status"], "rollback_incomplete")
        self.assertTrue(any("Concurrent source change preserved" in error and str(mirror) in error
                            for error in receipt["errors"]), receipt["errors"])
        for root in self.roots:
            self.assertEqual((root / "worker/workflow.py").read_bytes(), b"OTHER_MODULE = 1\n")

    def test_drift_after_preinstall_digest_preserves_uninstalled_production(self):
        real_digest = self.runner.digest
        production = self.roots[0] / self.relative
        preflight_complete = False
        injected = False

        def health():
            nonlocal preflight_complete
            preflight_complete = True
            return {"status": "ok"}

        def digest(path):
            nonlocal injected
            actual = real_digest(path)
            if path == production and preflight_complete and not injected:
                # The first target digest after preflight/backup is the runner's
                # immediate-before-install check, not the wrapper's copy guard.
                production.write_bytes(b"USER_LATE_CHANGE = 1\n")
                injected = True
            return actual

        with patch.object(self.runner, "digest", side_effect=digest), patch.object(self.runner, "health", side_effect=health), patch.object(self.runner, "restart"), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "drift"):
                deploy.execute(self.manifest)
        self.assertTrue(injected)
        self.assertEqual(production.read_bytes(), b"USER_LATE_CHANGE = 1\n")
        self.assertEqual((self.roots[1] / self.relative).read_bytes(), self.originals[1])
        receipt = self.receipt()
        self.assertEqual(receipt["status"], "rollback_incomplete")
        self.assertTrue(any("Concurrent source change preserved" in error and str(production) in error
                            for error in receipt["errors"]), receipt["errors"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
