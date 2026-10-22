# Best-effort attachment compression: deployment package

This package applies the bounded `patch_backend.py` to exactly three
production source files under `/opt/energetica-whatsapp`:
`worker/compression.py`, `channel_bridge.py`, and `worker/workflow.py`.
It contains no private backend snapshot, credential, state or attachment.

The explicit compression level aims for the smaller of its absolute size cap
and the original's actual-byte percentage remainder. Reaching that goal ends
the search without needless quality loss. If no candidate reaches it, the
smallest result within the existing useful-resolution/quality floors is still
offered for preview. The comparison shows actual sizes, reduction and whether
the goal was reached. Only explicit acceptance selects the compressed object.
An incompressible file keeps its original bytes and returns an informational
receipt, not an error or stranded level question. Hard total limits, timeouts,
signed-PDF protection, PDF text/links and ownership checks remain enforced.
Automatic compression offers remain disabled; only the tray icon starts it.

The `/home/opc/energetica-build` mirror is checked against separate immutable
pins before rollout and after restart. It is never a write or rollback target.
Its compressor lacks the production `level=` API; synchronizing it would hide
known drift and is deliberately excluded.

## Source pins

The candidate pins below were derived in memory using
`patch_backend.patch(relative, data)` against private, hash-pinned baselines.
No complete backend source is added to this repository.

| Relative production source | Before SHA-256 | Candidate SHA-256 |
| --- | --- | --- |
| `worker/compression.py` | `138515fe0004e304f990f1eb90d4623214538c14c26de27767819264b78af517` | `7de490f75c60cc8eacebf9d413ad8831b2fe899861c9867cf5dafcdfb7dee48f` |
| `channel_bridge.py` | `41cff91d025485cbe13cf73fbc8228598ce74e9b8510593f1b776e13802642aa` | `85f963428e6f82ab5207d1c75c177aeba20d42ba47136257652bc53e6c52f164` |
| `worker/workflow.py` | `aac994185f7b6b540f32497ba79a87bb692509eb087db7c7e4598413d2a3aefd` | `9053523f509f23118d306ba826b2b8f310ecf2ef0773677a9b87d7606e17b832` |

| Read-only mirror source | Unchanged SHA-256 |
| --- | --- |
| `worker/compression.py` | `e3fef6adf8f0dc147f39c6268de46eb830ae55171713c4cd01af9f8dd1280b40` |
| `channel_bridge.py` | `a5a8244d6525f34f53de781caa399570073df1f55ef8148ed4c1c5f9cdfa5e19` |
| `worker/workflow.py` | `aac994185f7b6b540f32497ba79a87bb692509eb087db7c7e4598413d2a3aefd` |

The required staged `shared-deploy.py` SHA-256 is
`01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2`.
Supply this independently verified LF runner at staging; it is not included
here. Windows CRLF checkout bytes have a different hash: normalize line endings
or use the separately verified LF copy, and verify the required pin unchanged.

## Safety contract

The fixed remote release directory is
`/home/opc/compression-best-effort-20261022/release`. The CLI requires the
reviewed manifest SHA-256 as a separate argument. The manifest allows exactly
the three live files, three mirror guards and five runtime package inputs.
Unexpected paths, baseline hashes, package hashes, symlinks, parent aliases or
hard-linked files fail closed. Patcher and runner bytes are pinned immediately
before their in-memory compilation and execution.

`--check` verifies package pins, live baselines, mirror pins, derived candidate
hashes, compilation, any existing candidate files and runner health. It does
not create candidates, backups, receipts, bytecode or a missing deployment
lock, and does not write live sources or restart services. The existing shared
lock must already exist; an absent lock causes a read-only failure.

Rollout holds the existing `/tmp/energetica-whatsapp-deploy.lock` using
nonblocking exclusive `flock`, compatible with the pinned runner's deployment
family. The shell captures the unchanged `deployment_gate.sh`, verifies that
exact captured text against the reviewed hash, and sources only that capture,
never reopening the staged gate between verification and execution.
It gates new non-root bridge connections, drains requests
and arranges the existing 120-second watchdog. The Python deploy entry point
requires root and the shell parent PID marker. The gate is released on exit.

All three candidate byte strings are hashed and compiled before materializing
`release/candidate` or changing live sources. Every existing candidate must
already match; it is never silently replaced. Three exact backups, original
attributes and the manifest are saved beneath
`/var/backups/energetica-whatsapp/best-effort-attachment-compression-*` before
the first live write. Each write rechecks the candidate and exact live baseline
immediately before calling the existing runner's atomic replacement API.

After restart, health, all three installed hashes and the mirror hashes must
pass. On failure, every attempted live write is restored independently from
its verified backup only while the current target still matches its before or
after pin. A concurrent writer's different contents are preserved. A failed
restore does not prevent other restores. Recovery restarts and rechecks health
and restored hashes; receipts record `rolled_back` or `rollback_incomplete`
with errors. SIGINT, SIGTERM and SIGHUP enter the same recovery path.

## Synthetic QA and TDD evidence

Run only the deployment tests in any private QA directory containing
`deploy.py`, `deploy.sh`, `deployment_gate.sh` and `test_deploy.py`:

```bash
python3 -B -m unittest discover -s . -p test_deploy.py -v
```

These tests use temporary synthetic live, mirror, release and backup trees.
The runner double isolates service restart/health/atomic-copy boundaries;
gate doubles isolate privileged firewall/systemd commands. There are no real
service calls, network calls, user-data reads or deployments. Linux tests use
real descriptors, symlinks, hard links and `flock` in temporary directories.

Observed TDD: initial missing-wrapper failures, then added regressions exposed
candidate drift, patcher drift and recovery-restart hash verification gaps.
Final Linux QA: **41/41 deployment tests passed**, including real temporary
symlink/hard-link/flock tests and eight Bash gate tests. Two regression cases
mutate the staged gate after check and after capture, proving that unreviewed
bytes never execute. No live firewall, state,
service or user data is touched by this synthetic suite.

Functional private-runtime QA: **35/35 codec, HTTP, manual-only recovery and
source-integrity regressions passed**, plus **8/8 legacy codec tests**.
Cases include reachable/unreachable goals, real large-file absolute caps,
mixed-file hard-limit rejection before writes, signed PDFs, retained searchable
text/links, explicit preview acceptance and preserving the original.
The frontend suite separately covers empty E1 correction and compression
preview/keep/accept/no-reduction return on phone and PC.

## Staging and execution

Stage exactly the five runtime inputs named in `deploy-manifest.json` plus
that manifest, preserving LF bytes. Independently verify the shared runner
against the fixed pin above. After any parent or reviewer changes, refresh
input pins and independently record the final manifest SHA-256; do not reuse
an earlier manifest hash.

```bash
cd /home/opc/compression-best-effort-20261022/release
bash -n deploy.sh
bash -n deployment_gate.sh
# REVIEWED_MANIFEST_SHA must be the separately reviewed final manifest digest.
sudo -n /opt/energetica-whatsapp/.venv/bin/python -B deploy.py --check "$REVIEWED_MANIFEST_SHA"
# Rollout only after final review and complete QA:
sudo -n bash deploy.sh "$REVIEWED_MANIFEST_SHA"
```

Deploying again against already patched live sources intentionally fails the
original baseline guard. Retain backups and receipts for review rather than
changing baselines to force a rerun.
