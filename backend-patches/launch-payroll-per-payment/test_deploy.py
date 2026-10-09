"""Deployment tests confined to a unique local temporary directory."""
import importlib.util
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("per_payment_deploy", Path(__file__).with_name("deploy.py"))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.roots = [self.root / "production", self.root / "mirror"]
        self.stage = self.root / "stage"
        self.files = deploy.FILES
        self.manifest = {}
        for relative in self.files:
            source = self.stage / relative
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_bytes(b"VALUE = 2\n")
            before = None if relative in deploy.NEW_HELPERS else hashlib.sha256(b"VALUE = 1\n").hexdigest()
            self.manifest[relative] = {"before": before, "after": deploy.digest(source)}
            for root in self.roots:
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                if before: target.write_bytes(b"VALUE = 1\n")
        for name, value in (("ROOTS",self.roots),("STAGE",self.stage),("BACKUPS",self.root / "backups")):
            patcher = patch.object(deploy,name,value); patcher.start(); self.addCleanup(patcher.stop)
        patcher = patch.object(deploy,"health",return_value={"status":"ok","channel":"generic"})
        patcher.start(); self.addCleanup(patcher.stop)
        patcher = patch.object(deploy,"set_owner",lambda *args: None)
        patcher.start(); self.addCleanup(patcher.stop)

    def test_drift_blocks_before_backup_or_restart(self):
        (self.roots[1] / self.files[-1]).write_bytes(b"USER_CHANGE=1\n")
        with patch.object(deploy,"restart") as restart, self.assertRaisesRegex(RuntimeError,"drift"):
            deploy.execute(self.manifest)
        restart.assert_not_called()
        self.assertFalse((self.root / "backups").exists())

    def test_unexpected_manifest_file_is_rejected_before_mutation(self):
        self.manifest["worker/clients.py"] = {"before": None, "after": "not-authorized"}
        with patch.object(deploy,"restart") as restart, self.assertRaisesRegex(RuntimeError,"Unexpected file"):
            deploy.execute(self.manifest)
        restart.assert_not_called()
        self.assertFalse((self.root / "backups").exists())

    def test_wrong_candidate_hash_is_rejected_before_mutation(self):
        (self.stage / self.files[0]).write_bytes(b"UNREVIEWED_CHANGE = 1\n")
        with patch.object(deploy,"restart") as restart, self.assertRaisesRegex(RuntimeError,"Candidate hash"):
            deploy.execute(self.manifest)
        restart.assert_not_called()
        for root in self.roots:
            self.assertEqual((root / self.files[0]).read_bytes(),b"VALUE = 1\n")
        self.assertFalse((self.root / "backups").exists())

    def test_check_only_preserves_live_files_and_creates_no_backup(self):
        with patch.object(deploy,"restart") as restart:
            result = deploy.execute(self.manifest,check_only=True)
        self.assertEqual(result["status"],"checked")
        restart.assert_not_called()
        for root in self.roots:
            self.assertEqual((root / self.files[0]).read_bytes(),b"VALUE = 1\n")
        self.assertFalse((self.root / "backups").exists())

    def test_success_has_verified_backup_and_only_exact_files_installed(self):
        with patch.object(deploy,"restart") as restart:
            result = deploy.execute(self.manifest)
        self.assertEqual(result["status"],"deployed")
        restart.assert_called_once()
        for root in self.roots:
            for relative in self.files:
                self.assertEqual((root / relative).read_bytes(),b"VALUE = 2\n")
        self.assertTrue(Path(result["backup"]).is_dir())

    def test_failed_restart_restores_all_and_removes_only_new_helper(self):
        with patch.object(deploy,"restart",side_effect=[RuntimeError("restart failed"),None]) as restart:
            with self.assertRaisesRegex(RuntimeError,"restart failed"):
                deploy.execute(self.manifest)
        self.assertEqual(restart.call_count,2)
        for root in self.roots:
            for relative in self.files:
                if relative in deploy.NEW_HELPERS: self.assertFalse((root / relative).exists())
                else: self.assertEqual((root / relative).read_bytes(),b"VALUE = 1\n")

    def test_restore_failure_does_not_skip_other_restores_or_restart(self):
        real_copy = deploy.atomic_copy
        failing_target = self.roots[1] / self.files[-1]
        def copy(source,target,*args):
            if "backups" in source.parts and target == failing_target:
                raise OSError("mirror restore failed")
            real_copy(source,target,*args)
        with patch.object(deploy,"atomic_copy",side_effect=copy), patch.object(deploy,"restart",side_effect=[RuntimeError("initial"),None]) as restart:
            with self.assertRaisesRegex(RuntimeError,"initial"):
                deploy.execute(self.manifest)
        self.assertEqual(restart.call_count,2)
        for relative in self.files:
            if relative not in deploy.NEW_HELPERS:
                self.assertEqual((self.roots[0] / relative).read_bytes(),b"VALUE = 1\n")

if __name__ == "__main__": unittest.main()
