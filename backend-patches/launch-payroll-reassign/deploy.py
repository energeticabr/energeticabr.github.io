"""Use the existing gated deployment runner for just the gallery module."""
import hashlib
import importlib.util
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent
RUNNER_HASH = '92b17e8d28a5bfdfabdf99ca6245ac6a75c4b17e85b083e3a8bcb4656c1e8720'


def main():
    path = PACKAGE / 'deploy_runner.py'
    if hashlib.sha256(path.read_bytes()).hexdigest() != RUNNER_HASH:
        raise RuntimeError('Unexpected shared deployment runner')
    spec = importlib.util.spec_from_file_location('deploy_runner', path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    runner.RELATIVES = ('worker/launch_gallery.py',)
    runner.INPUTS = runner.INPUTS | {'deploy_runner.py'}
    runner.main()


if __name__ == '__main__':
    main()
