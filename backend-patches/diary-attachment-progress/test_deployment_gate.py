"""Run the actual shell gate against controlled OS command boundaries."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.name == "posix" and shutil.which("bash"), "requires the deployment Linux shell")
class GateTests(unittest.TestCase):
    def execute(self, mode):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stub = root / "command.py"
            stub.write_text("""#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
name = Path(sys.argv[0]).name
root = Path(os.environ['GATE_TEST'])
with (root / 'calls').open('a') as out: out.write(json.dumps([name, *sys.argv[1:]]) + '\\n')
mode = os.environ['GATE_MODE']
if name == 'id': print('50')
if name == 'ss':
    if mode == 'probe-failure': sys.exit(1)
    count = root / 'count'
    n = int(count.read_text()) if count.exists() else 0
    count.write_text(str(n + 1))
    if mode == 'busy' or n == 0: print('ESTAB synthetic active request')
if name == 'iptables' and mode == 'deny' and '-I' in sys.argv: sys.exit(1)
""", encoding="utf-8")
            stub.chmod(0o755)
            for name in ["iptables", "ss", "id", "sleep", "systemd-run", "systemctl"]:
                (root / name).symlink_to(stub)
            helper = Path(__file__).with_name("deployment_gate.sh")
            command = 'source "$1"; trap diary_release_ingress EXIT; diary_block_ingress; diary_drain_requests; printf "DRAINED\\n"'
            result = subprocess.run(["bash", "-euc", command, "gate-test", str(helper)],
                env={**os.environ, "PATH": str(root) + ":" + os.environ["PATH"], "GATE_TEST": str(root), "GATE_MODE": mode},
                text=True, capture_output=True)
            calls = [json.loads(line) for line in (root / "calls").read_text().splitlines()] if (root / "calls").exists() else []
            return result, calls

    def test_gate_blocks_new_ingress_before_draining_and_releases_afterwards(self):
        result, calls = self.execute("drain")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("DRAINED", result.stdout)
        inserted = next(i for i, row in enumerate(calls) if row[:2] == ["iptables", "-I"])
        reads = [i for i, row in enumerate(calls) if row[0] == "ss"]
        deleted = next(i for i, row in enumerate(calls) if row[:2] == ["iptables", "-D"])
        self.assertTrue(inserted < min(reads) < max(reads) < deleted)
        self.assertIn("8765", calls[inserted])
        self.assertIn("--syn", calls[inserted])
        self.assertIn("--uid-owner", calls[inserted])
        self.assertTrue(any(row[0] == "systemd-run" for row in calls), "crash watchdog must bound the gate lifetime")

    def test_busy_bridge_times_out_without_leaving_ingress_blocked(self):
        result, calls = self.execute("busy")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("DRAINED", result.stdout)
        self.assertTrue(any(row[:2] == ["iptables", "-D"] for row in calls))

    def test_firewall_failure_prevents_deployment_work(self):
        result, calls = self.execute("deny")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("DRAINED", result.stdout)
        self.assertFalse(any(row[0] == "ss" for row in calls))

    def test_failed_connection_probe_does_not_masquerade_as_idle(self):
        result, calls = self.execute("probe-failure")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("DRAINED", result.stdout)
        self.assertTrue(any(row[:2] == ["iptables", "-D"] for row in calls))


if __name__ == "__main__":
    unittest.main()
