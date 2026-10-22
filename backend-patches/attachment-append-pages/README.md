# Tray attachment page replacement

The app composes a PDF locally and sends it to the existing authenticated upload
route with `operation=attachment_replace`, `attachment_id`, `expected_sha256`
and an idempotent UUID `request_id`. Ownership, staged target identity, source
hash, PDF validity/page limits and workflow locks are checked before one ETag
state commit. No event enters `workflow.handle`; no question is answered.

Only the selected unsubmitted tray entry is changed. Existing/read-only records
and pending signing/compression operations are not overwritten. Source media is
retained for recovery. A lost confirmation can retry the exact UUID and PDF;
the persisted receipt rejects different bytes or a later changed target.

## Verification

```text
python -B -m unittest discover -s backend-patches/attachment-append-pages -p 'test_*.py'
```

Set `ATTACHMENT_APPEND_BRIDGE_BASELINE` to a verified private `channel_bridge.py`
snapshot to exercise the actual handler. Otherwise the checked-in synthetic
upload fixture is used. Linux CI uses Python 3.9, matching the VM. Privileged
deployment commands in tests are isolated by disposable paths and command
stubs; tests never call a real tenant or modify real ingress.

## Pinned deployment

`package.py PRIVATE_WORKSPACE` validates the baseline pin, creates the private
candidate and generates `source.patch` plus `deploy-manifest.json`. Never commit
the full private bridge or its data. Stage the manifest inputs listed by the
manifest and the reviewed shared installer in
`/home/opc/attachment-append-pages-20261022/release`.

Run `deploy.py --check MANIFEST_SHA256` first. Only `deploy.sh MANIFEST_SHA256`
may perform the rollout: it validates inputs, temporarily gates/drains bridge
ingress, holds the shared deployment lock, backs up the exact runtime file,
performs an atomic compare-and-swap install, restarts and verifies health/hashes.
On failure it restores only its own exact versions. The divergent build mirror
is checked read-only and never synchronized.
