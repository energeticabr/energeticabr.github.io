"""Real Bash gate execution with all firewall/systemd boundaries replaced."""
import base64
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from bridge_fixture import PATCH_ROOT, PRIVATE_ROOT


class GateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bash = os.getenv('DOCUMENT_PERSON_BASH') or shutil.which('bash')
        if not cls.bash and Path('C:/Program Files/Git/bin/bash.exe').is_file():
            cls.bash = 'C:/Program Files/Git/bin/bash.exe'
        if not cls.bash:
            raise unittest.SkipTest('bash unavailable')
        cls.shell_env = dict(os.environ, PATH=str(Path(cls.bash).resolve().parent) + os.pathsep + os.environ['PATH'])
        if os.name == 'nt' and Path(cls.bash).name == 'sh.exe':
            # Git bundles GNU Bash as sh.exe, which otherwise enters POSIX mode.
            cls.bash_temp = tempfile.TemporaryDirectory(dir=PRIVATE_ROOT / 'backend/tests')
            cls.addClassCleanup(cls.bash_temp.cleanup)
            renamed = Path(cls.bash_temp.name) / 'bash.exe'
            shutil.copy2(cls.bash, renamed)
            cls.bash = str(renamed)

    def gate(self, scenario):
        path = (PATCH_ROOT / 'deployment_gate.sh')
        self.assertTrue(path.is_file(), 'Existing ingress gate must be packaged')
        script = r'''
set -euo pipefail
source "$1"
id() { [[ "$*" == '-u caddy' ]]; echo 1001; }
iptables() {
  local operation="$1"; shift
  if [[ "$operation" == '-I' ]]; then
    [[ "$1 $2" == 'OUTPUT 1' ]]; shift 2
  else
    [[ "$operation $1" == '-D OUTPUT' ]]; shift
  fi
  [[ "$*" == "-o lo -d 127.0.0.1 -p tcp --dport 8765 --syn -m owner ! --uid-owner 0 -m comment --comment diary-progress-$$ -j REJECT --reject-with tcp-reset" ]] || return 9
  echo "firewall $operation"
}
systemd-run() {
  [[ "$*" == "--quiet --unit=energetica-diary-progress-release-$$ --on-active=120s /usr/sbin/iptables -D OUTPUT -o lo -d 127.0.0.1 -p tcp --dport 8765 --syn -m owner ! --uid-owner 0 -m comment --comment diary-progress-$$ -j REJECT --reject-with tcp-reset" ]] || return 9
  echo watchdog
}
systemctl() { echo timer-stop; }
ss() { return 0; }
sleep() { :; }
trap diary_release_ingress EXIT
'''
        return subprocess.run([self.bash, '+o', 'posix', '-c', script + scenario, 'test', path.as_posix()],
                              env=self.shell_env, text=True, capture_output=True, timeout=10)

    def test_gate_releases_after_successful_drain(self):
        result = self.gate('diary_block_ingress\ndiary_drain_requests\necho rollout\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(),
                         ['firewall -I', 'watchdog', 'rollout', 'firewall -D'])

    def test_watchdog_schedule_failure_releases_ingress(self):
        result = self.gate('systemd-run() { return 1; }\ndiary_block_ingress\necho rollout\n')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout.splitlines(), ['firewall -I', 'firewall -D'])

    def test_drain_timeout_cancels_rollout_and_releases_ingress(self):
        result = self.gate('ss() { echo active; }\ndiary_block_ingress\ndiary_drain_requests\necho rollout\n')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('rollout', result.stdout.splitlines())
        self.assertEqual(result.stdout.splitlines()[-1], 'firewall -D')

    def test_drain_query_failure_cancels_rollout(self):
        result = self.gate('ss() { return 1; }\ndiary_block_ingress\ndiary_drain_requests\necho rollout\n')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('rollout', result.stdout.splitlines())
        self.assertEqual(result.stdout.splitlines()[-1], 'firewall -D')

    def test_root_proxy_is_refused_before_firewall_mutation(self):
        result = self.gate('id() { echo 0; }\ndiary_block_ingress\necho rollout\n')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')

    def test_shells_parse_without_executing_deployment(self):
        base = PATCH_ROOT
        result = subprocess.run([self.bash, '-n', str(base / 'deploy.sh')],
                                env=self.shell_env, text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run([self.bash, '-n', str(base / 'deployment_gate.sh')],
                                env=self.shell_env, text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def captured_shell(self, mutation, *, via_stdin=False):
        # Exercise the real shell entry point; isolate only paths, Python runner
        # and privileged external commands inside a disposable synthetic package.
        with tempfile.TemporaryDirectory(dir=PRIVATE_ROOT / 'backend/tests') as temporary:
            base = Path(temporary)
            gate = base / 'deployment_gate.sh'
            gate.write_bytes((PATCH_ROOT / 'deployment_gate.sh').read_bytes())
            shell = (PATCH_ROOT / 'deploy.sh').read_text()
            package_path = base.as_posix()
            if os.name == 'nt':
                package_path = subprocess.check_output([self.bash, '+o', 'posix', '-c', 'cd -- "$1" && pwd', 'test', package_path], env=self.shell_env, text=True).strip()
            shell = shell.replace('/home/opc/document-related-person-live-filter-20261022/release', package_path)
            shell = shell.replace('/opt/energetica-whatsapp/.venv/bin/python', Path(sys.executable).as_posix())
            trusted_installer = (
                'import os, pathlib, sys\n'
                'base = pathlib.Path(__file__).parent\n'
                'if sys.argv[1] == "--check" and os.environ["MUTATION"] == "check":\n'
                '    with (base / "deployment_gate.sh").open("a") as f:\n'
                '        f.write("\\necho UNREVIEWED_GATE_EXECUTED >&2\\nexit 93\\n")\n'
                'if sys.argv[1] == "--check" and os.environ["MUTATION"] == "installer-check":\n'
                '    (base / "deploy.py").write_text("print(\\\"UNREVIEWED_INSTALLER_EXECUTED\\\")\\nraise SystemExit(93)\\n")\n'
                'if sys.argv[1] == "--deploy":\n'
                '    assert os.environ.get("DOCUMENT_PERSON_FILTER_GATE", "").isdigit()\n'
                'print(sys.argv[1])\n').encode()
            real_installer_sha = hashlib.sha256((PATCH_ROOT / 'deploy.py').read_bytes()).hexdigest()
            shell = shell.replace('DEPLOY_PY_SHA=' + real_installer_sha,
                                  'DEPLOY_PY_SHA=' + hashlib.sha256(trusted_installer).hexdigest())
            (base / 'deploy.sh').write_bytes(shell.encode())
            (base / 'deploy.py').write_bytes(trusted_installer)
            if mutation == 'installer-before':
                (base / 'deploy.py').write_bytes(b'print("UNREVIEWED_INSTALLER_EXECUTED")\nraise SystemExit(93)\n')
            program = r'''
set -euo pipefail
id() { if [[ "$*" == '-u' ]]; then echo 0; else echo 1001; fi; }
iptables() { echo "firewall $1"; }
systemd-run() { :; }
systemctl() { :; }
ss() { :; }
sha256sum() {
  command sha256sum "$@"
  if [[ "$MUTATION" == 'hash' ]]; then
    printf '\necho UNREVIEWED_GATE_EXECUTED >&2\nexit 93\n' >> "$SCENARIO_GATE"
  fi
}
export -f id iptables systemd-run systemctl ss sha256sum
"$BASH" +o posix "$1" reviewed-manifest
'''
            if not shutil.which('sha256sum', path=self.shell_env['PATH']):
                program = program.replace('command sha256sum "$@"',
                    '\"$QA_PYTHON\" -c \'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())\'')
            environment = {**self.shell_env, 'MUTATION': mutation, 'SCENARIO_GATE': str(gate), 'QA_PYTHON': Path(sys.executable).as_posix()}
            environment.pop('DOCUMENT_PERSON_VERIFIED_PACKAGE', None)
            if via_stdin:
                launcher = base / 'trusted_launch.py'
                launcher.write_bytes((
                    'import base64, hashlib, os, pathlib, subprocess, sys\n'
                    'data = pathlib.Path(sys.argv[1]).read_bytes()\n'
                    'assert hashlib.sha256(data).hexdigest() == os.environ["QA_SHELL_SHA"]\n'
                    'package = base64.b64decode(os.environ["QA_VERIFIED_PACKAGE_B64"]).decode()\n'
                    'env = dict(os.environ, DOCUMENT_PERSON_VERIFIED_PACKAGE=package, BASH_ENV=os.environ["QA_MOCK_FUNCTIONS"])\n'
                    'subprocess.run([os.environ["QA_BASH"], "+o", "posix", "-s", "--", sys.argv[2]], input=data, env=env, check=True)\n'
                ).encode())
                program = program.replace('"$BASH" +o posix "$1" reviewed-manifest',
                    'declare -f id iptables systemd-run systemctl ss sha256sum > "$QA_MOCK_FUNCTIONS"\n'
                    '"$QA_PYTHON" -B "$QA_LAUNCHER" "$1" reviewed-manifest')
                environment.update(QA_LAUNCHER=launcher.as_posix(), QA_SHELL_SHA=hashlib.sha256(shell.encode()).hexdigest(),
                                   QA_VERIFIED_PACKAGE_B64=base64.b64encode(package_path.encode()).decode(), QA_BASH=self.bash,
                                   QA_MOCK_FUNCTIONS=(base / 'mock-functions.sh').as_posix())
            result = subprocess.run([self.bash, '+o', 'posix', '-c', program, 'test', str(base / 'deploy.sh')],
                                    env=environment,
                                    text=True, capture_output=True, timeout=10)
            return result, gate.read_text()

    def test_gate_mutated_after_check_is_not_executed(self):
        result, gate = self.captured_shell('check')
        self.assertIn('UNREVIEWED_GATE_EXECUTED', gate)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('UNREVIEWED_GATE_EXECUTED', result.stderr)
        self.assertNotIn('--deploy', result.stdout)
        self.assertNotIn('firewall', result.stdout)

    def test_gate_mutated_after_capture_still_executes_only_verified_capture(self):
        result, gate = self.captured_shell('hash')
        self.assertIn('UNREVIEWED_GATE_EXECUTED', gate)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('UNREVIEWED_GATE_EXECUTED', result.stderr)
        self.assertIn('--deploy', result.stdout)
        self.assertIn('firewall -D', result.stdout)

    def test_installer_mutated_before_first_check_never_executes(self):
        result, _ = self.captured_shell('installer-before')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('UNREVIEWED_INSTALLER_EXECUTED', result.stdout + result.stderr)
        self.assertNotIn('--check', result.stdout)
        self.assertNotIn('firewall', result.stdout)

    def test_installer_mutated_after_check_uses_same_verified_capture(self):
        result, _ = self.captured_shell('installer-check')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('UNREVIEWED_INSTALLER_EXECUTED', result.stdout + result.stderr)
        self.assertIn('--check', result.stdout)
        self.assertIn('--deploy', result.stdout)
        self.assertIn('firewall -D', result.stdout)

    def test_trusted_outer_capture_stdin_supplies_verified_package(self):
        result, _ = self.captured_shell('installer-check', via_stdin=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('UNREVIEWED_INSTALLER_EXECUTED', result.stdout + result.stderr)
        self.assertIn('--check', result.stdout)
        self.assertIn('--deploy', result.stdout)
        self.assertIn('firewall -D', result.stdout)
