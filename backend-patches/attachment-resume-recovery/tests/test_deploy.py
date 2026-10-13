"""Only temporary local targets; systemctl and health dependencies are doubled."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from bridge_fixture import PATCH_ROOT, load_module, pinned_source


class FixtureRunner:
    def __init__(self, *, restart_failure=False, health_results=(), on_restart=None):
        self.events = []
        self.restart_failure = restart_failure
        self.health_results = list(health_results)
        self.on_restart = on_restart

    def restart(self):
        self.events.append("restart")
        if len(self.events) == 1 and self.on_restart:
            self.on_restart()
        if len(self.events) == 1 and self.restart_failure:
            raise RuntimeError("fixture restart failed")

    def wait_health(self):
        self.events.append("health")
        return self.health_results.pop(0) if self.health_results else True


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        patcher = load_module("attachment_recovery_patch_deploy", PATCH_ROOT / "patch_bridge.py")
        with patch.dict("sys.modules", {"patch_bridge": patcher}):
            self.deploy = load_module("attachment_recovery_deploy", PATCH_ROOT / "deploy.py")
        temporary_root = PATCH_ROOT / "tests/.tmp"
        temporary_root.mkdir(exist_ok=True)
        if os.name == "nt":
            # Keep fixtures in the allowed scope while supporting MAX_PATH hosts.
            temporary_root = Path("\\\\?\\" + str(temporary_root.resolve()))
        self.temp = tempfile.TemporaryDirectory(prefix="deploy-", dir=temporary_root)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.live, self.mirror = self.root / "live", self.root / "mirror"
        self.stage = self.root / "stage"
        self.originals = {}
        baseline = pinned_source().encode("utf-8")
        for index, directory in enumerate((self.live, self.mirror)):
            directory.mkdir()
            source = directory / "channel_bridge.py"
            source.write_bytes(baseline + (b"\n# distinct mirror baseline\n" if index else b""))
            self.originals[source] = source.read_bytes()
            worker = directory / "worker"
            worker.mkdir()
            (worker / "workflow_config.json").write_bytes(b'{"keep":"workflow"}\n')
            (directory / ".env").write_bytes(b"synthetic-private-config-do-not-read\n")
        (self.mirror / "workflow_config.json").write_bytes(b'{"keep":"mirror-config"}\n')
        self.expected = [hashlib.sha256(content).hexdigest() for content in self.originals.values()]
        self.runner = FixtureRunner()

    def invoke(self, *, apply=False, **overrides):
        kwargs = {"expected_live_hash": self.expected[0], "expected_mirror_hash": self.expected[1],
                  "live": self.live, "mirror": self.mirror, "stage": self.stage,
                  "apply": apply, "runner": self.runner, **overrides}
        return self.deploy.deploy_patch(**kwargs)

    def snapshot(self, directory=None):
        directory = directory or self.root
        return {path.relative_to(directory).as_posix(): path.read_bytes()
                for path in directory.rglob("*") if path.is_file()}

    def assert_original_sources(self):
        for target, original in self.originals.items():
            self.assertEqual(target.read_bytes(), original)

    def test_dry_run_verifies_distinct_live_mirror_hashes_and_writes_nothing(self):
        before = self.snapshot()
        result = self.invoke()
        self.assertTrue(result["dryRun"])
        self.assertTrue(result["sourceCasVerified"])
        self.assertTrue(result["workflowConfigPreserved"])
        self.assertEqual(len(result["codeHashes"]), 2)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.stage.exists())
        self.assertEqual(self.runner.events, [])

    def test_cli_defaults_to_dry_run_without_network_or_service_changes(self):
        before = self.snapshot()
        process = subprocess.run([sys.executable, "-B", str(PATCH_ROOT / "deploy.py"),
            "--expected-live-hash", self.expected[0], "--expected-mirror-hash", self.expected[1],
            "--live", str(self.live), "--mirror", str(self.mirror), "--stage", str(self.stage)],
            capture_output=True, text=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertTrue(json.loads(process.stdout)["dryRun"])
        self.assertEqual(self.snapshot(), before)
        self.assertNotIn("synthetic-private", process.stdout + process.stderr)

    def test_drift_in_either_source_is_refused_before_backups_or_actions(self):
        for target in self.originals:
            with self.subTest(target=target.parent.name):
                target.write_bytes(self.originals[target] + b"\n# external source change\n")
                before = self.snapshot()
                with self.assertRaisesRegex(RuntimeError, "Bridge changed"):
                    self.invoke(apply=True)
                self.assertEqual(self.snapshot(), before)
                self.assertEqual(self.runner.events, [])
                self.assertFalse(self.stage.exists())
                target.write_bytes(self.originals[target])

    def test_compile_failure_precedes_backup_and_installation(self):
        before = self.snapshot()
        with patch.object(self.deploy, "patch_bridge", return_value="def broken(:"):
            with self.assertRaises(SyntaxError):
                self.invoke(apply=True)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.stage.exists())
        self.assertEqual(self.runner.events, [])

    def test_local_install_backs_up_both_baselines_and_preserves_other_files(self):
        before = {str(root): self.snapshot(root) for root in (self.live, self.mirror)}
        attributes = {path: path.stat() for path in self.originals}
        result = self.invoke(apply=True)
        self.assertFalse(result["dryRun"])
        self.assertTrue(result["serviceHealth"])
        self.assertEqual(self.runner.events, ["restart", "health"])
        backups = Path(result["backup"])
        for name, target in zip(("live", "mirror"), self.originals):
            self.assertEqual((backups / f"{name}-channel_bridge.py").read_bytes(), self.originals[target])
            self.assertEqual(target.read_bytes(), self.deploy.patch_bridge(self.originals[target].decode("utf-8")).encode("utf-8"))
            compile(target.read_bytes(), str(target), "exec")
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), stat.S_IMODE(attributes[target].st_mode))
            self.assertEqual((target.stat().st_uid, target.stat().st_gid), (attributes[target].st_uid, attributes[target].st_gid))
            after = self.snapshot(target.parent)
            self.assertEqual({key: value for key, value in after.items() if key != "channel_bridge.py"},
                             {key: value for key, value in before[str(target.parent)].items() if key != "channel_bridge.py"})
        self.assertEqual(json.loads((backups / "receipt.json").read_text())["status"], "deployed")

    def test_failed_restart_rolls_back_both_sources_and_restarts_restored_service(self):
        self.runner = FixtureRunner(restart_failure=True)
        with self.assertRaisesRegex(RuntimeError, "fixture restart failed"):
            self.invoke(apply=True)
        self.assert_original_sources()
        self.assertEqual(self.runner.events, ["restart", "restart", "health"])
        self.assertEqual(len(list(self.stage.glob("backups/*/receipt.json"))), 1)

    def test_failed_health_rolls_back_both_sources_and_checks_restored_health(self):
        self.runner = FixtureRunner(health_results=[False, True])
        with self.assertRaisesRegex(RuntimeError, "Service health failed"):
            self.invoke(apply=True)
        self.assert_original_sources()
        self.assertEqual(self.runner.events, ["restart", "health", "restart", "health"])
        receipt = next(self.stage.glob("backups/*/receipt.json"))
        self.assertEqual(json.loads(receipt.read_text())["status"], "rolled_back")

    def test_failed_rollback_health_is_reported_as_incomplete(self):
        self.runner = FixtureRunner(health_results=[False, False])
        with self.assertRaisesRegex(RuntimeError, "Rollback incomplete"):
            self.invoke(apply=True)
        self.assert_original_sources()
        receipt = next(self.stage.glob("backups/*/receipt.json"))
        self.assertEqual(json.loads(receipt.read_text())["status"], "rollback_incomplete")

    def test_partial_install_failure_restores_already_installed_target(self):
        install = self.deploy.atomic_install
        def fail_mirror(content, target, **kwargs):
            if target.parent == self.mirror and content != self.originals[target]:
                raise OSError("fixture mirror install failed")
            return install(content, target, **kwargs)
        with patch.object(self.deploy, "atomic_install", side_effect=fail_mirror):
            with self.assertRaisesRegex(OSError, "fixture mirror install failed"):
                self.invoke(apply=True)
        self.assert_original_sources()
        self.assertEqual(self.runner.events, ["restart", "health"])

    def test_drift_after_backup_is_refused_before_any_install(self):
        copier = self.deploy.shutil.copy2
        def mutate_after_copy(source, destination):
            result = copier(source, destination)
            if Path(source).parent == self.mirror:
                Path(source).write_bytes(self.originals[Path(source)] + b"\n# concurrent mirror edit\n")
            return result
        with patch.object(self.deploy.shutil, "copy2", side_effect=mutate_after_copy):
            with self.assertRaisesRegex(RuntimeError, "Bridge changed"):
                self.invoke(apply=True)
        self.assertEqual((self.live / "channel_bridge.py").read_bytes(), self.originals[self.live / "channel_bridge.py"])
        self.assertTrue((self.mirror / "channel_bridge.py").read_bytes().endswith(b"# concurrent mirror edit\n"))
        self.assertEqual(self.runner.events, [])

    def test_per_target_cas_preserves_mirror_edit_and_rolls_back_live(self):
        install = self.deploy.atomic_install
        mirror = self.mirror / "channel_bridge.py"
        def mutate_after_live(content, target, **kwargs):
            result = install(content, target, **kwargs)
            if target.parent == self.live and content != self.originals[target]:
                mirror.write_bytes(self.originals[mirror] + b"\n# concurrent mirror edit\n")
            return result
        with patch.object(self.deploy, "atomic_install", side_effect=mutate_after_live):
            with self.assertRaisesRegex(RuntimeError, "Bridge changed"):
                self.invoke(apply=True)
        self.assertEqual((self.live / "channel_bridge.py").read_bytes(), self.originals[self.live / "channel_bridge.py"])
        self.assertTrue(mirror.read_bytes().endswith(b"# concurrent mirror edit\n"))

    def test_rollback_preserves_foreign_edit_and_keeps_recoverable_backup(self):
        live = self.live / "channel_bridge.py"
        self.runner = FixtureRunner(health_results=[False, True],
                                    on_restart=lambda: live.write_bytes(b"# foreign post-install change\n"))
        with self.assertRaisesRegex(RuntimeError, "Rollback incomplete"):
            self.invoke(apply=True)
        self.assertEqual(live.read_bytes(), b"# foreign post-install change\n")
        self.assertEqual((self.mirror / "channel_bridge.py").read_bytes(), self.originals[self.mirror / "channel_bridge.py"])
        backup = next(self.stage.glob("backups/*/live-channel_bridge.py"))
        self.assertEqual(backup.read_bytes(), self.originals[live])

    def test_workflow_config_drift_aborts_and_does_not_overwrite_foreign_config(self):
        config = self.mirror / "worker/workflow_config.json"
        self.runner = FixtureRunner(on_restart=lambda: config.write_bytes(b'{"external":"change"}\n'))
        with self.assertRaisesRegex(RuntimeError, "Workflow configuration changed"):
            self.invoke(apply=True)
        self.assert_original_sources()
        self.assertEqual(config.read_bytes(), b'{"external":"change"}\n')

    def test_atomic_install_preserves_passed_owner_mode_and_cas(self):
        target = self.live / "channel_bridge.py"
        original_chmod = self.deploy.os.chmod
        with (patch.object(self.deploy.os, "chown", create=True) as chown,
              patch.object(self.deploy.os, "chmod", wraps=original_chmod) as chmod):
            self.deploy.atomic_install(b"VALUE = 1\n", target, mode=0o600, uid=123, gid=456,
                                       expected_hash=self.expected[0])
        self.assertEqual(target.read_bytes(), b"VALUE = 1\n")
        self.assertEqual(chown.call_args.args[1:], (123, 456))
        self.assertEqual(chmod.call_args.args[1:], (0o600,))
        with self.assertRaisesRegex(RuntimeError, "Bridge changed"):
            self.deploy.atomic_install(b"VALUE = 2\n", target, mode=0o600, uid=123, gid=456,
                                       expected_hash=self.expected[0])
        self.assertEqual(target.read_bytes(), b"VALUE = 1\n")
        self.assertFalse(list(target.parent.glob(".attachment-recovery-*")))

    def test_health_requires_http200_and_restart_uses_existing_systemd_service(self):
        bad, good = Mock(), Mock()
        bad.__enter__ = Mock(return_value=Mock(status=202))
        bad.__exit__ = Mock(return_value=False)
        good.__enter__ = Mock(return_value=Mock(status=200))
        good.__exit__ = Mock(return_value=False)
        with patch.object(self.deploy, "urlopen", side_effect=[bad, good]), patch.object(self.deploy.time, "sleep"):
            self.assertTrue(self.deploy.health(attempts=2, delay=0))
        with patch.object(self.deploy, "urlopen", return_value=bad):
            self.assertFalse(self.deploy.health(attempts=1, delay=0))
        with patch.object(self.deploy.subprocess, "run") as run:
            self.deploy.SystemRunner().restart()
        run.assert_called_once_with(["systemctl", "restart", "energetica-whatsapp"], check=True)


if __name__ == "__main__":
    unittest.main()
