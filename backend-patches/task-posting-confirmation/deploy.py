"""Use the reviewed, hash-pinned exact-file installer, never touch user data."""
import hashlib
import importlib.util
from pathlib import Path

RUNNER_SHA256 = '01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2'
packaged = Path(__file__).with_name('shared_deploy_runner.py')
source = (packaged if packaged.exists() else
          Path(__file__).resolve().parents[1] / 'launch-payroll-per-payment/deploy.py')
if hashlib.sha256(source.read_bytes()).hexdigest() != RUNNER_SHA256:
    raise RuntimeError('Shared deployment runner hash mismatch')
spec = importlib.util.spec_from_file_location('task_posting_rollout', source)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
runner.STAGE = Path('/home/opc/task-posting-confirmation-20261009/candidate')

if __name__ == '__main__':
    runner.main()
