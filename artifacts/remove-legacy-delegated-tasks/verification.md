# Retirement of the obsolete inline delegated tasks gallery

## Scope

Remove `TAREFAS DELEGADAS PENDENTES` from Pendências, including its contribution
to the HOME/pending count. Remove only the obsolete inline chat gallery (search,
drag ordering, instant check completion) shown in the user's second screenshot.
Preserve modern G9 `delegatedTasks` in Demandas and all SharePoint task records,
task creation, current full-form editing, and the modern gallery's service routes.

The app no longer requests old snapshots at startup/login/foreground, exposes
their completion client, stores their ordering, or renders restored old polls.
Saved plain/scoped/case-normalized completion IDs are hidden. Backend legacy
sessions migrate to Pendências. A stale reply during another active form keeps
that form's exact stage, fields, options, attachments and timestamps. The two
old dedicated portal APIs return empty `retired` results with the original owner
authorization; no task read/write and no false completion receipt.

## Verified on 2026-10-12

- RED/GREEN: six initial frontend regressions; additional seven-format JSDOM
  reproduction failed before the selector fix and passed afterwards.
- Final changed-module suite: **780/780 PASS** (controller, client, chat view, G9).
- Final full mobile suite: `pnpm test`: **5414/5414 PASS**, zero skipped.
- `pnpm build` and `pnpm build:pwa`: PASS (existing chunk-size/import warnings).
- `pnpm guard:signature-gestures`: **14 protected blocks intact**.
- `pnpm secrets:verify` and `git diff --check`: PASS.
- Backend: **37 real WorkflowEngine tests + 9 real ChannelBridge tests PASS**
  locally and on production Python **3.9.25** in an isolated QA directory.
  Only external boundaries use memory fixtures; HTTP/socket access forbidden.
- Independent read-only review reproduced two P2s; both were corrected and
  re-reviewed with no remaining finding in scope. Full current draft continuation,
  retained PDF, replay, task creation and owner rejection checks are covered.
- Browser QA opened Pendências without the legacy category and opened the
  preserved modern G9 gallery with fictitious records. No real task was completed
  or deleted for QA. Screenshots retained in the task's local artifacts directory.

The first broad run exposed an obsolete diary test that expected the now-retired
source read; its required behavior is now zero legacy reads with the diary still
loaded. An unrelated payment-ledger browser readiness timeout passed isolated;
the final complete run passed unchanged. No payments code/fixture was changed.

## Backend installation

`worker.patch` applies to workflow baseline SHA256
`e2f9a39837f19fba31fd8f00b94e100134f2ac69f386807f0f5e150c8a7b581d`.
`channel-bridge.patch` applies to bridge baseline SHA256
`fc632e4303a0ce79a37b9cdd8811684c63f7f2dc37b1bfc65671ebf43397e804`.
Final source hashes, exact four installed paths, backup and healthy services are
recorded in `deployment-receipt.json`. The installer checks current hashes before
any overwrite, preserves owners/modes, uses atomic file replacement, restarts
both services, checks both health endpoints and rolls back on failure.

Tests retained here document the real-engine cases. They use the existing offline
mirror under `artifacts/pending-attendance-checkboxes-20261012/candidate`, the full
candidate sources in the task artifacts, and the previous supplier-sync test.
Main's isolated VM runners override those fixture/candidate paths; no production
credentials or user state are loaded by these QA cases. Source snapshots are not
committed; the bounded zero-context patches and hashes make the deployed delta
auditable. To reconstruct against the exact hashed baseline, use
`git apply --unidiff-zero` (the installer consumes reviewed full candidates).

No SharePoint list, record, attachment or user draft was deleted. Publication uses
the repository's normal Pages, Google Play internal and TestFlight workflows for
the merged revision, without dispatching duplicate releases or public store review.
