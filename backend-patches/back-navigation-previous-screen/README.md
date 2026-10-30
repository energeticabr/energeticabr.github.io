# Back returns to the previous screen

The first fixed-asset product question already has a real navigation snapshot of
the fixed-assets submenu. `_handle_draft_control` intercepted Back because that
snapshot has a different `flow`, opened an abandonment confirmation with the
default main-menu intent, and the client automatically confirmed it. The stack
was present; the wrong route ran before `_navigate_back`.

The patch removes that two-line interception. The ordinary Back handler marks
the message processed and restores the previous snapshot, including its exact
submenu. Same-flow Back, duplicate-message detection, completed-state handling,
cash checkpoint guards, explicit Home/transfer and fresh submission identities
remain in their existing paths. With genuinely absent history the existing safe
fallback returns to the selected area's action menu, without inventing a submenu.

A nested embedded registration regression also exposed a redundant
`state.pop("embedded_return", None)` after restoring the parent's complete state.
Removing that line preserves the parent's own return to its ancestor. The child
return is already removed by `state.clear()`. The final runtime diff therefore
contains three removed lines in one file, with no other behavior changes.

## Isolated verification

Use a private code-only backend mirror containing `worker/*.py`,
`worker/workflow_config.json`, required root Python modules and
`tests/test_workflow.py`. Do not use production state, credentials or live clients.

```sh
export BACK_NAVIGATION_SOURCE=/private/back-navigation-20261030/runtime
export BACK_NAVIGATION_WORKFLOW=/private/back-navigation-20261030/candidate/worker/workflow.py
python -B backend-patches/back-navigation-previous-screen/tests/test_previous_screen.py -v
python -B -m pytest -q -p no:cacheprovider backend-patches/back-navigation-previous-screen/tests/test_deploy.py
```

Unset `BACK_NAVIGATION_WORKFLOW` to exercise the unchanged baseline (expected
failures). The harness uses the actual WorkflowEngine and optimistic memory
store. Its SharePoint, messenger and media services are the existing fake engine
fixtures. It covers real menu entry, same-flow questions, nested menus, embedded
parent files, child-file cleanup, nested ancestors, duplicate Back, absent and
corrupt history, cash checkpoints, completed/new submission identities and Home.

**Coverage limitation:** the pinned source calls
`_provision_first_freight_only` and `_provision_reissue_skipped_freight` but their
definitions/hooks were not found in the copied source. The fixture supplies
test-only False/None results, explicitly rejecting payment/payment_settlement
flows. It never replaces navigation, history, abandonment, cash, persistence or
attachment cleanup. These are navigation regressions, not proof that the entire
deployed runtime or provision policy is sound. No loaded production object was
inspected and neither absent helper is changed by this package.

## Deployment package

Only `worker/workflow.py` is allowed in both runtime roots. The source patch,
manifest, installer and package builder are public; the full source tar and
downloaded code-only test runtime remain in private `work/back-navigation-20261030`.
The runtime roots were read-only verified against
`9d208eda2c53e05f6f5e098b911320d5fe9f98b0de85cc2831ef1a8a993403c1`.

Stage the private `source-files.tar` plus `deploy-manifest.json`, `source.patch`,
`deploy.py` and the exact shared runner as
`/home/opc/back-navigation-20261030/package`. The shared runner is the LF-normalized
`backend-patches/launch-payroll-per-payment/deploy.py`, pinned to SHA256
`01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2`.

Run `sudo python3 deploy.py --check MANIFEST_SHA256` before
`sudo python3 deploy.py --deploy MANIFEST_SHA256` with the same manifest hash.
No VM deployment, service restart, state/document mutation or shared-branch
commit was performed when preparing this package. The installer has exact-file
allowlists, separate production/mirror drift pins, archive/path/hash checks,
compilation, a deployment lock, verified backups, atomic copies, health checks
and rollback that preserves concurrent source changes. Android, iOS and Windows
consume the shared backend correction after deployment; this package adds no
client dependencies or native binaries.
