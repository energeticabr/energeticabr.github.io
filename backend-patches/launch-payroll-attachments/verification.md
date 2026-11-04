# Validation evidence

## Scope and tests

Only the shared backend's `worker/workflow.py` and `worker/payroll_row_attachments.py` change. `FOLHAPGTO` creation retains its existing token, fields and retry flow; the new attachment checkpoint precedes the existing durable success marker. Publication serves Android, iOS and Windows/web without a client update.

- Twelve real-handler cases plus two complete channel/state cases and 24 existing payroll assignment cases pass: **38 tests, zero failures**. External SharePoint/media records are synthetic and state uses temporary directories.
- The initial production baseline failed eight of the eleven original attachment tests: the financial rows were confirmed with zero copied files.
- Independent review found an injectivity defect when a source name matched another source's reserved collision name. A new regression failed first, then passed after reserving the full source namespace and tracking assigned target filenames. All 38 focused tests passed again.
- Ten installer cases pass on Linux, including independent roots, altered input/source rejection, uniform LF/CRLF handling, backups, restart rollback, concurrent source preservation and service health.
- Signature guard: fourteen protected blocks intact. No mobile source changed.

## Full backend comparison

The production workflow configuration snapshot matches SHA-256 `e72f874a925a2155906009dddb549131ceeb91d26071d3977a44330b22a6b4a3`. The identical configuration/external fixtures were used for baseline and candidate.

| Revision | Tests | Failures | Errors | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 2210 | 1267 | 140 | 3 |
| Candidate | 2210 | 1267 | 140 | 3 |

The full inherited suite is **not green**. Comparison of complete failing/error case identities found **zero new failures or errors**. Examples of existing failures include `test_supplier_default_branch_failure_preserves_launch` and the missing `test_watchdog_recovery_notice` import. Complete tracebacks and identity JSON remain in private task evidence.

## Preservation boundary

Unrelated destination files are preserved. If an external editor changes/removes source attachments after a partial upload, the current attempt cannot confirm success. A later retry copies the new inventory and preserves already uploaded files; it does not remove old content versions. This is submission-time copying, not continuous destructive synchronization or historical payroll remediation.

The installer and synthetic validation do not create or alter real financial records, source attachments, conversation state, or workflow configuration. Target publication requires separate pinned installation, health/hash verification and installed-source test evidence.
