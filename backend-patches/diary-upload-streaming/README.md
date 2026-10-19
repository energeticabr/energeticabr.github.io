# Stream local media staging

Prepared for MAIN to integrate and deploy. This sidecar did not commit, push, upload to the VM, deploy, restart, or run tenant QA.

`LocalMediaRepository.stage` now routes only `local_path` input through a bounded 64 KiB copy and incremental SHA-256. It preserves the existing filename, deterministic object path, size/MIME/original-name fields, configured byte limit, and existing-target behavior. Existing targets remain untouched; returned size/hash still describe the supplied input, matching the old contract. Remote downloads, workflow aggregate limits, financial logic, shared locking, proxy configuration, and client code are unchanged.

A same-directory temporary file retains the old `0666 & umask` creation permissions. The completed, closed file is published with an exclusive hard link, then its temporary name is removed. An existing target, including a target that appeared during copying, is preserved. Short reads, growth beyond the configured limit, changed input length, read/write errors, and publication errors do not publish a partial attachment. No whole input buffer is retained. The already-complete bridge upload file remains owned/cleaned by the existing caller.

## Exact deployment scope and pins

Only these two live paths may be replaced:

- `/opt/energetica-whatsapp/local_app.py`
- `/home/opc/energetica-build/local_app.py`

Both baseline hashes: `4d6c996ad378a887b9e325d2d17a87e300c1b71c6eacde274f7b24b6fd188e12`.

Both candidate hashes: `26fce982cd4d48fc83d9f8e3aac078d0bd7cdc89a6c6ba8afc2b1ee1e651216a`.

Manifest SHA-256: `a242e635bb14b84a86ced5028d1ed3a677074a0ff77a10745f31785d948eb14c`.

Installer SHA-256: `d13a34e5105a55714de7f76ccd660ace4dafcf9faca89c677e1c21e7acbb0da6`.

The public diff contains only the new helper, its dispatch, and two standard-library imports. Complete baseline/candidate sources and `source-files.tar` remain private outside this repository. `deploy-manifest.json` pins both roots independently, the diff, and the private archive. `package.py` rejects a private archive destination inside the public repository.

## Local tests and packaging

Use Python 3.12 and pytest on the PC, with private source paths:

```powershell
$env:PYTHONPATH='<existing-pytest-dependencies>'
$env:ENERGETICA_BACKEND_TEST_ROOT='<private-root>/candidate'
$env:ENERGETICA_LOGIC_SOURCE='<private-root>/reference/logic.py'
python -m pytest backend-patches/diary-upload-streaming/tests -q --tb=short -p no:cacheprovider
python backend-patches/diary-upload-streaming/package.py --baseline '<private-root>/base' --candidate '<private-root>/candidate' --output backend-patches/diary-upload-streaming --mirror-hashes backend-patches/diary-upload-streaming/mirror-hashes.json --archive-output '<private-root>/source-files.tar'
```

The tests execute the actual repository class and actual production filename functions from private source using AST loading. This isolates unrelated worker imports and avoids service/tenant initialization. Files are real temporary files; inputs are synthetic. Faults are injected only at file/network/service boundaries. The current package has 29 passing tests, including actual private archive assembly, drift refusal, and fake-service rollback. Do not run the broad backend suite or upload benchmarks on the small VM.

## MAIN deployment recipe (not executed)

1. Refresh both source hashes immediately before staging/deployment. Abort on drift; integrate a new baseline instead of overwriting another task's source.
2. Create private stage `/home/opc/diary-upload-streaming-20261019` with directory mode 0700. Stage only `deploy.py`, `source.patch`, `deploy-manifest.json`, and the private `source-files.tar`. Copy the existing canonical helper from `/home/opc/provision-settlement-amount-20261017/shared-deploy.py` to this stage as `shared-deploy.py`; require SHA-256 `01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2`. Do not substitute a repository helper. Keep full source/archive outside public hosting and repositories.
3. Check the staged installer hash and manifest hash above. Then MAIN may run:

```sh
cd /home/opc/diary-upload-streaming-20261019
sudo -n python3 deploy.py --check a242e635bb14b84a86ced5028d1ed3a677074a0ff77a10745f31785d948eb14c
sudo -n python3 deploy.py --deploy a242e635bb14b84a86ced5028d1ed3a677074a0ff77a10745f31785d948eb14c
sudo -n sha256sum /opt/energetica-whatsapp/local_app.py /home/opc/energetica-build/local_app.py
```

`--check` assembles/compiles only the staged candidate and reads health; it does not replace live source or restart. It still writes staging files, so this sidecar did not run it remotely. Actual rollout holds `/tmp/energetica-whatsapp-deploy.lock`, validates both baselines, backs up both files and their attributes, atomically copies the candidate preserving each target's owner/mode, restarts only `energetica-channel-bridge`, waits for bridge/Whatsmeow health, and checks installed hashes. The helper's `health` checks Whatsmeow but does not restart it. No document/financial record is touched by the installer.

Backups/receipts: `/var/backups/energetica-whatsapp/diary-upload-streaming/diary-upload-streaming-<UTC>`. The installer automatically attempts per-root restore and a bridge restart on rollout failure. Inspect `receipt.json`; `rollback_incomplete` requires MAIN attention. A successful deployment still requires MAIN's normal UI verification, with no real financial transaction used as a test. The shared backend serves Android, iOS, and web/Windows without a client build for this patch alone.

## Manual rollback after a completed deployment (MAIN only, not executed)

Select the exact backup directory printed in that deployment receipt. The following Linux command validates the staged manifest, backup scope/content, and current source versions before restoring. It takes the same global deployment lock, preserves current target owner/mode, and refuses unrelated drift. Replace the one explicit backup path; do not use a glob or “latest” lookup.

```sh
sudo -n flock -n /tmp/energetica-whatsapp-deploy.lock python3 - /var/backups/energetica-whatsapp/diary-upload-streaming/diary-upload-streaming-EXACT-UTC <<'PY'
import importlib.util
import hashlib
import json
from pathlib import Path
import sys

stage = Path('/home/opc/diary-upload-streaming-20261019')
if hashlib.sha256((stage / 'deploy.py').read_bytes()).hexdigest() != 'd13a34e5105a55714de7f76ccd660ace4dafcf9faca89c677e1c21e7acbb0da6':
    raise RuntimeError('Installer drift')
spec = importlib.util.spec_from_file_location('diary_rollback', stage / 'deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
if deploy.digest(stage / 'deploy-manifest.json') != 'a242e635bb14b84a86ced5028d1ed3a677074a0ff77a10745f31785d948eb14c':
    raise RuntimeError('Manifest drift')
if deploy.digest(stage / 'shared-deploy.py') != deploy.SHARED_RUNNER_SHA:
    raise RuntimeError('Shared helper drift')
manifest = json.loads((stage / 'deploy-manifest.json').read_text())
backup = Path(sys.argv[1])
if backup.resolve() != backup or not backup.is_relative_to(deploy.BACKUPS) or backup == deploy.BACKUPS:
    raise RuntimeError('Unexpected backup directory')
if json.loads((backup / 'manifest.json').read_text()) != manifest:
    raise RuntimeError('Backup manifest mismatch')
targets = []
for index, root in enumerate(deploy.ROOTS):
    target = root / 'local_app.py'
    saved = backup / (str(index) + '-local_app.py')
    before = manifest['files']['local_app.py']['before' if index == 0 else 'mirrorBefore']
    after = manifest['files']['local_app.py']['after']
    if root.resolve() != root or target.resolve() != target or saved.is_symlink():
        raise RuntimeError('Unexpected source alias')
    if deploy.digest(saved) != before or deploy.digest(target) not in {before, after}:
        raise RuntimeError('Source/backup drift; nothing restored')
    targets.append((target, saved, before, after, target.stat()))
helper = importlib.util.spec_from_file_location('diary_rollback_helper', stage / 'shared-deploy.py')
runner = importlib.util.module_from_spec(helper)
helper.loader.exec_module(runner)
for target, saved, before, after, attributes in targets:
    current = deploy.digest(target)
    if current not in {before, after}:
        raise RuntimeError('Concurrent drift; preserve source and inspect')
    if current == after:
        runner.atomic_copy(saved, target, attributes)
    if deploy.digest(target) != before:
        raise RuntimeError('Restore verification failed')
runner.restart()
health = runner.wait_health()
if any(deploy.digest(target) != before for target, saved, before, after, attributes in targets):
    raise RuntimeError('Post-restart source drift')
print(json.dumps({'status': 'restored', 'health': health, 'backup': str(backup)}))
PY
```

If restore is interrupted between roots, inspect both hashes; the same guarded recipe accepts either pinned baseline or candidate and can finish the restore. Any other hash must be preserved and reconciled explicitly. Backups remain available; no cleanup or data deletion is part of this package.
