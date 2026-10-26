# Direct supplier status choices

The supplier status question incorrectly used a recommended-value confirmation menu. Its actual choices are now ATIVO and INATIVO, retaining configured IDs 1 and 2 and the exact SharePoint values. This uses the same supplier wizard in standalone and embedded flows; the return-to-parent control is unchanged.

The reply handler refreshes this question's cached options, just as it already does for the supplier homologation and WhatsApp questions. A stale change-value button refreshes the choices without selecting a status; a stale keep button still means ATIVO.

Tests exercise the real prompt and selection logic with synthetic resumed drafts and in-memory external boundaries. No supplier, HR record or financial item is submitted. Use a private fresh backend snapshot as `ENERGETICA_BACKEND_TEST_ROOT`, with the archived `test_workflow` fixture installed under `tests/`. Isolate attachment-control storage before fixture discovery.

The deployment package allows only `worker/workflow.py` and `worker/workflow_config.json`. It pins live and mirror hashes, validates Python and JSON syntax, creates backups, checks health and restores both files on failure. Full source archives remain private; only reviewed diffs and hash manifests are committed. Run `deploy.py --check <manifest-sha256>` before `--deploy`.

The shared service updates Android, iOS and Windows behavior without rebuilding native clients. Signature gestures and client code are unchanged.
