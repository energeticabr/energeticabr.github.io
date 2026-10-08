# Multiple-launch state version repair

The variation prompt saved the next-line state, but did not return the resulting optimistic-store ETag. The draft-input marker then attempted to save with the previous ETag. A valid prompt was already queued before the resulting RuntimeError triggered the bridge's generic error recovery.

The nine-line workflow patch returns the latest saved version from the variation prompt, filter and invalid-answer branches. It does not suppress exceptions, overwrite concurrent state, retry financial writes, or alter data clients, cash receipts, provision flows, fields or navigation menus.

Six sandbox regressions use the actual ChannelBridge and production LocalStateStore, with synthetic financial fixtures only. They cover adding a second/third line, repeated message IDs, supplier edits, filtered/invalid answers, single-to-multiple conversion, preserving attachments and a real injected conflicting writer. The last case must still display recovery. Compatible backend test_workflow fixtures and runtime modules must be on PYTHONPATH; production records are never needed.

Run in the backend sandbox:

```sh
PYTHONPATH=tests python -B -m unittest test_multi_launch_state_version -v
python -B -m unittest test_deploy_multi -v
```

The deployment helper only writes worker/workflow.py at the two explicit runtime/source roots. It validates a hash-pinned manifest, rejects source drift under a shared deployment lock, backs up exact files, preserves attributes, copies atomically and rolls back all changed roots if installation/restart/health verification fails. It intentionally rejects a second application to the already patched runtime.

The archived diff has zero context to avoid whitespace-only patch context lines. Validate/apply it with `git apply --unidiff-zero` only against the exact hash-pinned baseline; the deployment helper installs the reviewed full candidate, not an unchecked patch.

See verification.md for the actual deployed hashes, service health and inherited full-suite limitations. This shared backend repair is active for Android, iOS and Windows/PWA without requiring a binary update.
