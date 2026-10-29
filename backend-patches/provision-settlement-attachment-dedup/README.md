# Provision settlement attachment duplication

Settlement copied a provision's files under `PROV-child-SHA256-original` names.
The original-name copy path could then deliver the same bytes again under the
source names. A real affected payment had eight files representing four distinct
SHA-256 contents in both the launch and its linked order.

New settlement copies keep the source filename when available. Identical content
still reuses an existing destination file, including legacy generated names.
Different contents sharing a filename retain the child/hash fallback. A corrupt
reserved deterministic filename still stops the operation without overwriting.
Upload filenames are percent-encoded after OData apostrophe escaping, matching
the attachment reader and preserving valid `#`, `%`, `?` and Unicode names.

This is a shared backend correction for Android, iOS and Windows/web. Client
packages and signature gestures do not change.

## Validation

- Before the fix, the new regressions reproduced three files becoming six and
  four becoming eight. After the fix both counts remain unchanged.
- 55 focused tests passed on the deployed Python 3.9 runtime: row propagation,
  grouped settlement, retries/lost responses, filename/content conflicts,
  original-name copier compatibility, parent fanout and concurrent timer copies.
- 49 SharePoint client tests passed locally.
- 18 package/regression/repair-plan tests plus two subtests passed locally.
- Independent review found no blocking issue. The protected gesture guard
  confirmed all 14 blocks intact.

The historical general backend test snapshot is **not green**. Its bounded
Windows run reported the following two failures, reproduced unchanged against
the original production source snapshot:

- `test_audit_log.py::AuditLogTests::test_log_uses_all_configured_databases_and_shows_item_detail`
- `test_backend_pending_integration.py::AttendancePendingIntegrationTests::test_initial_status_prompt_has_no_summary_but_completed_edit_does`

Collection also failed for `test_channel_bridge.py`,
`test_watchdog_recovery_notice.py` and `test_watchdog_state_check.py` because the
Windows/private snapshot lacks Linux/runtime imports. An earlier unbounded run
was interrupted; it is not claimed as successful. The relevant live-runtime and
client suites above completed successfully. No real payment was created for QA.

## Deployment and repair

The manifest pins exactly `worker/clients.py` and
`worker/payroll_row_attachments.py` in production and its source mirror. Complete
source archives stay in the private workspace. The installer validates the
archive, hashes and service health, retains backups, and rolls back on failure.
The shared installer must match SHA-256
`01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2`.

Stage `deploy.py`, `source.patch`, `deploy-manifest.json`, the private
`source-files.tar` and `shared-deploy.py` in
`/home/opc/provision-settlement-attachment-dedup-20261028`. Run
`deploy.py --check <manifest-sha256>` before `--deploy` with the same hash.

Deployment completed at `20261029T004339810483Z`; both roots matched their
candidate hashes and `/health` returned `status: ok`.

`repair_duplicates.py` defaults to a read-only plan for one explicit linked paid
launch/order/provision/description. Applying requires the exact live plan hash
and a new private backup directory. It backs up every target file, preserves the
source provision and financial fields, and removes only generated copies with
the correct child ID/full SHA-256 and matching retained target/source bytes.
Every delete rechecks ownership, source and target inventories. Both final
target inventories are independently verified.

The reported payment and its order were repaired from eight to four files each.
All four distinct document contents were retained, with verified private backups.
The app's browser could not be inspected because local browser control is disabled
in Work settings; verification uses the live SharePoint/galeria read path.
