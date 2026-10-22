# Manual attachment compression — backend only

Only `worker/workflow.py` changes. This directory contains a bounded patcher,
synthetic regression tests and a staged rollout wrapper, not the private backend
source. No frontend, portal endpoint, signature implementation, configuration,
credential, conversation or stored user file is included or deployed.

Uploads always keep originals and continue through the existing menu/form path.
No threshold/configuration can re-enable the retired automatic offer. Aggregate
checks before summary and commit return an editable size-block notice without
asking for compression. A stale affirmative reply cannot approve compression or
post a recovered conversation.

The four retired compression stages recover originals and their queue on a
normal message, new attachment or `_resend_current_prompt`. Initial uploads
return to the original menu. Form data and current question are preserved;
`input_continue` is consumed rather than replayed. Pending/queued references
remain durable until recovery completes, so an interruption after a successful
save can resume without duplicating or losing the remaining originals. Temporary
previews are removed only after references have been saved; draft references
remain protected by the existing deletion helper.

The manual icon API (`portal_attachment_compress` / compression choice), its
level/preview/version selection, and every signature method are unchanged.
The diary photo-to-final-PDF pipeline is preserved, including its existing
automatic reduction of an oversized **final diary batch** after evidence
consolidation. That existing diary behavior asks no compression question.

The deployed `_attachment_size_limit()` is deliberately **unchanged**: the
retired 10 MB aggregate limit is already absent; its current sentinel is the
configured input cap plus one byte. The configured input cap defaults to 60 MB.
The existing attachment count limit, input byte cap and precommit check against
actual retained bytes remain in place. A legacy/mutated oversized batch cannot
post by supplying small metadata.

## Pins

| Source | SHA-256 |
| --- | --- |
| workflow, production and mirror, before | `e4b5af06230e8b761f13d98a19cec4e3e97237ea1674fc80c3a186dfe63d55ef` |
| workflow candidate | `aac994185f7b6b540f32497ba79a87bb692509eb087db7c7e4598413d2a3aefd` |
| production bridge, read only | `41cff91d025485cbe13cf73fbc8228598ce74e9b8510593f1b776e13802642aa` |
| mirror bridge, read only | `a5a8244d6525f34f53de781caa399570073df1f55ef8148ed4c1c5f9cdfa5e19` |
| production compressor, read only | `138515fe0004e304f990f1eb90d4623214538c14c26de27767819264b78af517` |
| mirror compressor, read only | `e3fef6adf8f0dc147f39c6268de46eb830ae55171713c4cd01af9f8dd1280b40` |
| existing shared runner | `01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2` |
| reviewed deployment manifest | `c485f002d63efc28735c0f75c6ecaaea0bc5b5f14b0d74b66f0bf5b9c710d51b` |

The mirror compressor predates the bridge's manual `level=` argument. It cannot
exercise the current manual API successfully. QA therefore ran real HTTP,
compression, preview and version-choice tests using private copies of the
**production** bridge and compressor with the candidate workflow. The package
does not synchronize or alter those independently pinned files.

## Reproduce private QA

The private source-only snapshot and synthetic test tools are under
`/home/opc/manual-compression-qa-20261022`. No environment file, real state or
attachment was copied. `candidate` uses the production bridge/compressor copies
for manual API coverage. Run on the VM:

```bash
cd /home/opc/manual-compression-qa-20261022/candidate
sudo -n env PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tests:worker:. \
  MANUAL_WORKFLOW_BASELINE=/home/opc/manual-compression-qa-20261022/baseline/worker/workflow.py \
  /opt/energetica-whatsapp/.venv/bin/python -m unittest discover \
  -s /home/opc/manual-compression-qa-20261022 -p 'test_*.py' -v
```

The new runtime suite covers small/threshold/large uploads, batches, initial
menus, fields, summaries, duplicate messages, four legacy stages, resend,
new-upload recovery, durable interruption recovery, actual-byte blocking,
editing, count/input limits, and diary preservation. Separate HTTP tests use
the real manual compressor, including keep-original/use-compressed and account
isolation. The integrity test checks the complete AST: exactly six existing
methods change and one recovery method is added; all other methods, module
code, signature code and size-limit code remain identical.

Old tests asserting automatic offers are intentionally incompatible and were
not modified. The broad legacy harness also has configuration/menu drift that
fails before reaching attachments. Detailed test results and failing names are
in the private backend evidence directory, not hidden by skip/config overrides.

Final focused result: **25 passed** (14 workflow, 3 real HTTP manual API,
6 rollout, 2 source-integrity checks). The relevant legacy comparison ran
23 tests on each version: baseline 16 failures + 1 error; candidate 19 failures
+ 1 error. The three additional failures intentionally assert retired offers:
`test_declining_optional_compression_keeps_the_original_file`,
`test_pdf_over_150kb_asks_for_the_same_compression`, and
`test_single_attachment_does_not_offer_compress_all`. All other failing names
and their baseline/candidate tracebacks are retained privately. Two exploratory
whole-`test_workflow.py` runs were interrupted after about 17 minutes; they did
not finish and are not a passing-suite claim.

## Parent deployment commands

The package is staged at
`/home/opc/manual-compression-qa-20261022/release`. Its `shared-deploy.py` is a
verified copy of the existing runner from
`/home/opc/multiple-document-entry-20261021/shared-deploy.py`. If restaging,
upload exactly `deploy.py`, `deploy.sh`, `deployment_gate.sh`,
`patch_workflow.py`, `deploy-manifest.json`, and that existing shared runner.
Preserve LF endings; the local `.gitattributes` enforces them.

Read-only production verification and private candidate assembly (already run):

```bash
cd /home/opc/manual-compression-qa-20261022/release
bash -n deploy.sh deployment_gate.sh
sudo -n /opt/energetica-whatsapp/.venv/bin/python deploy.py --check \
  c485f002d63efc28735c0f75c6ecaaea0bc5b5f14b0d74b66f0bf5b9c710d51b
```

After independent review, the parent runs the deployment, not this worker:

```bash
sudo -n bash /home/opc/manual-compression-qa-20261022/release/deploy.sh \
  c485f002d63efc28735c0f75c6ecaaea0bc5b5f14b0d74b66f0bf5b9c710d51b
```

The wrapper uses the existing ingress gate/drain and 120-second watchdog,
the existing shared deployment lock, exact source/package pins, recoverable
per-root backups and the runner's atomic copy/restart/health functions.
Rollback restores each touched workflow independently; CAS preserves a
concurrent writer and records `rollback_incomplete` instead of overwriting it.
Receipts and original files stay under
`/var/backups/energetica-whatsapp/manual-attachment-compression-*`.
Any source/package drift aborts instead of rebasing or modifying another file.

Verify both workflow hashes and service health after parent deployment:

```bash
sudo -n sha256sum /opt/energetica-whatsapp/worker/workflow.py \
  /home/opc/energetica-build/worker/workflow.py
sudo -n systemctl is-active energetica-channel-bridge.service
sudo -n curl --fail --silent http://127.0.0.1:8765/health
```

No production deployment, service restart, ingress gate or user-data mutation
was performed during implementation/QA.
