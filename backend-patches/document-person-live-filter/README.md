# Document related-person live filtering

The document flow's `pessoa_relacionada` step selects SharePoint sources through
a conditional source, including a union for contract/labor homologation. The
bridge previously emitted `databaseFilter` only for a top-level
`sharepoint_list`, preventing the client from requesting live filtering here.

`patch_bridge.patch_bridge(source)` changes only the `logic.condition_matches`
import and `ChannelMessenger._send_option_poll`. Classification is explicitly
limited to flow `document`, key `pessoa_relacionada`. It uses the existing
condition evaluator, first matching branch, default fallback, and the engine's
context order (`answers` overrides `fields`). A union qualifies only when it is
nonempty and every selected child is a SharePoint list. Static/unsupported
sources and direct-text steps do not qualify. Existing top-level SharePoint
filter behavior, scoped choice IDs and presentation metadata are preserved.

The function returns identical output when reapplied to the complete patch.
Missing/duplicate exact anchors, partial application and Python syntax errors
fail closed. It preserves every unrelated byte of each input, so independently
pinned production and mirror sources remain distinct. Parent rollout must pin
each full input hash separately; exact anchors alone do not detect unrelated
source drift. No workflow configuration or business data is written.

Generate separate candidates with the CLI (output must not exist):

```powershell
& $documentPython -B "$documentPatch/patch_bridge.py" "$documentPrivate/channel_bridge.before.py" "$documentPrivate/backend/candidate/production/channel_bridge.py"
& $documentPython -B "$documentPatch/patch_bridge.py" "$documentPrivate/channel_bridge.mirror.before.py" "$documentPrivate/backend/candidate/mirror/channel_bridge.py"
```

## Regression tests

The harness executes the actual pinned messenger class, including its real
constructor, poll builder and option wrappers, via AST. It imports the existing
pure `logic.py` helpers; only unrelated external RHID enrichment is doubled.
The private workflow snapshot is also hash-pinned and supplies the real step.
Full private bridge/config sources are intentionally excluded from this package.

```powershell
$env:DOCUMENT_PERSON_PRIVATE_ROOT = $documentPrivate
$env:DOCUMENT_PERSON_LOGIC_PATH = $documentLogic
# RED: both unmodified snapshots; expected missing-filter assertions.
$env:DOCUMENT_PERSON_BASELINE = '1'
& $documentPython -B -m unittest discover -s "$documentPatch/tests" -p test_bridge_filter.py -v
# GREEN: entire standalone backend patch suite.
Remove-Item Env:DOCUMENT_PERSON_BASELINE
& $documentPython -B -m unittest discover -s "$documentPatch/tests" -v
```

Set `$documentPrivate` to the private task root, `$documentPatch` to this folder,
`$documentPython` to a working Python interpreter and `$documentLogic` to the
existing worker `logic.py`. Test temporary outputs stay under the private
`backend/tests` folder and are cleaned automatically. No network is contacted.

Observed RED: 11 tests, 26 assertion failures, zero errors, exit 1.
Observed GREEN: all 17 tests passed, exit 0, exercising both distinct baselines.
Coverage includes all real homologation branches, active static branch versus
unselected database branches, context precedence, union guards, direct/freeform
text, unrelated flows/steps, empty/one-option behavior, original choice IDs,
presentation, idempotence, drift, compilation and CLI overwrite refusal.

`send_options([])` still produces the existing explanatory text without filter
metadata; `send_filtered_options([])` still emits no new message. A direct
empty `_send_option_poll` retains filter metadata. This bounded patch does not
change those existing empty-result presentation behaviors.

## Prepared production-only installer

`deploy.py`, `deploy.sh` and the byte-identical `deployment_gate.sh` adapt the
existing best-effort-compression release pattern. `FILES` contains only
`channel_bridge.py`. The exact production pin is `85f963428e6f82ab5207d1c75c177aeba20d42ba47136257652bc53e6c52f164`
before and `15ad4a8e23a8ee475719463199fe0a6d34e792fff4c3ed21676849596ad46bea`
after. The mirror is read-only at
`a5a8244d6525f34f53de781caa399570073df1f55ef8148ed4c1c5f9cdfa5e19`.
The earlier mirror patch candidate is only a behavioral test artifact; it must
not be included in the release or installed.

Release directory: `/home/opc/document-related-person-live-filter-20261022/release`.
Stage exactly `patch_bridge.py`, `deploy.py`, `deploy.sh`,
`deployment_gate.sh`, the independently verified existing `shared-deploy.py`,
and `deploy-manifest.json`. Preserve LF bytes. The shared runner must match
`01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2`;
it is deliberately not duplicated in this public package. The unchanged gate
must match `ae5ed44ab6d6ab1edfecbc14dd3bbd59505e9f991962d1410f488e4a029eefb6`.

The installer retains the established nonblocking shared lock, healthy-service
preflight, verified backup, attribute-preserving atomic copy, per-write source
and candidate checks, bridge restart and health checks. The shared runner
checks both `energetica-channel-bridge.service` and
`energetica-whatsmeow.service` and HTTP `127.0.0.1:8765/health`.
The mirror is never a write/rollback target. All supported writers of the owned
`channel_bridge.py` MUST hold the same
`/tmp/energetica-whatsapp-deploy.lock` exclusive flock throughout their writes
and any rollback. This is the accepted cooperative deployment contract.
Hash checks provide extra best-effort drift detection. A hash read followed by
`os.replace` is not atomic compare-and-swap and cannot protect against privileged
writers that bypass the flock. Under the cooperative contract, failed health or
hash checks restore verified before/after bytes. Foreign bytes observed during
recovery are preserved and reported as incomplete rollback; a writer bypassing
the lock can still race that check and the later replacement.
The parent independently verified root-owned group-readable `0644` code and a
runtime service account restricted by `ProtectSystem=strict` with writable
paths limited to its `/var/lib` data. This package changes no permissions,
ACLs, filesystem locks or service hardening. Recovery restarts and rechecks
health and restored hashes. The gate is released on exit; the existing
120-second watchdog remains unchanged.

The parent-owned trusted inline Python launcher must verify the separately
reviewed manifest digest, read and hash the final `deploy.sh` bytes, and pass
that exact capture to `subprocess.run(['/bin/bash', '-s', '--', manifest_sha],
input=verified_shell_bytes, env={..., 'DOCUMENT_PERSON_VERIFIED_PACKAGE':
exact_release_directory})`. It must not reopen a staged shell path for Bash.
The shell's package fallback is lazy: `BASH_SOURCE` is evaluated only when the
verified-package environment variable is absent. Exact release-path and alias
guards still apply.

Before the first installer execution, trusted bootstrap code inside the
verified shell captures `deploy.py` bytes once and validates the hardcoded
`DEPLOY_PY_SHA`. Both `--check` and `--deploy` decode, revalidate and execute
that same immutable base64 capture with the correct `__file__` and arguments.
The root/gate parent-PID marker is preserved. A changed staged installer may
still be rejected by the manifest-input checks, but its changed code is never
compiled or executed. There is no trust derived from executing or rereading
writable staged installer code.

`--check` does not materialize candidates or create backups, receipts, bytecode,
or a missing lock. It performs no live write/restart. Existing aliases,
hardlinks and differing candidate bytes are rejected. The main API remains
`checked_manifest`, `assemble`, `rollout`, and `deployment_lock`.

Generate a fresh manifest locally into a new output file after any runtime
input changes, using the pinned production source and existing shared runner:

```powershell
& $documentPython -B "$documentPatch/build_manifest.py" `
  --source "$documentPrivate/channel_bridge.before.py" `
  --shared-runner $documentSharedRunner `
  --output "$documentPrivate/backend/deploy-manifest.reviewed.json"
```

The generator validates the source, shared-runner and gate pins, derives and
checks the exact candidate, and prints the manifest SHA-256. It performs no
staging, installation or network access. Compare the generated bytes with the
public manifest. Parent stages only after independent review and records the
reviewed final digest separately. The installer API remains
`--check REVIEWED_SHA` / `--deploy REVIEWED_SHA`; production execution goes
through the trusted outer capture launcher and the verified shell bootstrap
described above. No remote command was executed during preparation.

## Complete local QA

Additional environment variables for the full suite:

```powershell
$env:DOCUMENT_PERSON_WORKFLOW_PATH = $documentWorkflow
$env:DOCUMENT_PERSON_SHARED_RUNNER_PATH = $documentSharedRunner
$env:DOCUMENT_PERSON_BASH = $documentBash
& $documentPython -B -m unittest discover -s "$documentPatch/tests" -v
```

The interpreter used was
`C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/work/provision-parent-multiple-20261008/.venv/Scripts/python.exe`.
Pure logic source:
`C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/work/supplier-create-global-search-20261020/candidate/worker/logic.py`,
SHA-256 `ddd1e411c811e5635bb9df04811c823da11b0e1a0b2b0de6c6513de74e1e0611`.
The parent independently confirmed equality with live worker logic.
Selection-handler reference:
`C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/work/compression-best-effort-20261022/baseline/workflow.py`,
SHA-256 `aac994185f7b6b540f32497ba79a87bb692509eb087db7c7e4598413d2a3aefd`.
Only the real handler and terminal-option helpers are extracted from that older
workflow reference; compression changes elsewhere are outside this integration
probe. The pagination adapter and persistence boundary are isolated, while real
query matching and messenger output run together against both bridge snapshots.

Local Bash was the bundled GNU Bash 5.2.37 at
`C:/Users/Bernardonotini/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/usr/bin/sh.exe`.
The test harness copies that executable to a temporary `bash.exe` name to avoid
its `sh` POSIX mode; missing `sha256sum` is supplied by actual Python SHA-256
over the captured stdin bytes. All firewall, systemd, proxy identity and socket
commands are doubles. No real firewall rules, services, network, application
state or documents are touched. Linux-only `flock`/ownership tests are included
and skipped on Windows; the parent must run those on Linux independently.

Remote rollout and Android/iOS/Windows frontend releases remain parent-owned.

The original deployment RED recorded 21 expected missing-installer assertion
failures. The reviewed bootstrap RED separately reproduced both malicious
installer execution gaps before the fix. The additional regressions exercise
malicious installer bytes before the first check, replacement after check,
and trusted outer capture through Bash stdin with a verified package directory.
The final manifest digest and updated complete-suite result are recorded in the
private receipt after regeneration; do not reuse the earlier manifest digest.

Final reviewed-bootstrap suite: 58 discovered, 55 passed, 3 Linux-only lock
tests skipped, zero failures/errors, exit 0. Current reviewed manifest SHA-256:
`a862a136f0068204c059b0d5e6f5f79cf77965ac27605f0cd3713401100a30af`.
Current captured shell SHA-256:
`b6cae6e9d966a21529651684b6dc2ea9d88ce0a3ed482c44484444d6b5e10232`.
Current installer SHA-256 embedded in that shell:
`50996a3aa9ed238ce96bb5b3664dc7e390aa7386071be94b87749949a5790abd`.
