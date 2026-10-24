"""Build code-only synthetic roots and run with this explicit Python executable."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--private-output', type=Path, required=True)
    parser.add_argument('--baseline', action='store_true')
    parser.add_argument('--label')
    parser.add_argument('--reused-77', action='store_true')
    parser.add_argument('pytest_args', nargs='*')
    args = parser.parse_args()
    private = args.private_output.resolve()
    tests = Path(__file__).resolve().parent
    results = []
    for scope, filename in [('app', 'workflow-app.py'), ('build', 'workflow.py')]:
        root = private / 'task2-test-runtime' / (('baseline-' if args.baseline else '') + scope)
        root.mkdir(parents=True, exist_ok=True)
        support = private / 'support'
        for source in support.rglob('*'):
            if not source.is_file() or source.suffix not in {'.py', '.json'} or '__pycache__' in source.parts:
                continue
            target = root / source.relative_to(support)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        if args.baseline:
            shutil.copyfile(private / 'live' / filename, root / 'worker/workflow.py')
            shutil.copyfile(private / 'live/workflow_config.json', root / 'worker/workflow_config.json')
        else:
            for source in (private / 'task2-candidates' / scope / 'worker').iterdir():
                shutil.copyfile(source, root / 'worker' / source.name)
        if scope == 'build':
            shutil.copyfile(support / 'mirror-channel_bridge.py', root / 'channel_bridge.py')
        label = args.label or ('red' if args.baseline else 'green')
        temporary = private / 'task2-test-tmp'
        temporary.mkdir(exist_ok=True)
        if os.name == 'nt':
            temporary = Path('\\\\?\\' + str(temporary))
        env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'TMP': str(temporary), 'TEMP': str(temporary),
            'ENERGETICA_BACKEND_TEST_ROOT': str(root), 'ENERGETICA_PRIVATE_OUTPUT': str(private),
            'PYTHONPATH': os.pathsep.join(map(str, [private / 'python-test-deps', root, root / 'worker', tests]))}
        test_args = args.pytest_args or [str(tests)]
        if args.reused_77:
            test_args = [str(tests / ('test_' + name + '.py')) for name in
                ('workflow', 'sync', 'source_identity', 'reupload', 'schema', 'deploy')]
            test_args.extend('--deselect=backend-patches/contractor-employment-register/tests/test_deploy.py::' + name for name in (
                'test_existing_helper_is_never_replaced', 'test_concurrent_helper_publisher_wins_without_overwrite',
                'test_rollback_preserves_concurrent_workflow_and_recovery', 'test_symlink_target_and_candidate_are_rejected',
                'test_stage_inside_live_root_is_rejected_before_writes', 'test_absent_helper_state_must_be_explicit_in_manifest'))
        command = [sys.executable, '-m', 'pytest', '-q', '--tb=short', '--rootdir=' + str(tests.parents[2]),
            '--basetemp=' + str(temporary / (label + '-' + scope + '-' + uuid4().hex[:8])), *test_args]
        result = subprocess.run(command, cwd=tests.parents[2], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        log = private / f'task2-{label}-{scope}.log'
        log.write_text(result.stdout, encoding='utf-8')
        print(f'{scope}: exit={result.returncode}; log={log}', flush=True)
        print(result.stdout[-6000:], flush=True)
        results.append(result.returncode)
    return max(results)


if __name__ == '__main__':
    raise SystemExit(main())
