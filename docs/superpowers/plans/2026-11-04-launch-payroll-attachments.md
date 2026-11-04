# Launch attachments in payroll

Goal: each newly submitted launch's FOLHAPGTO item receives one attachment per source attachment, with original bytes and names where available. Distinct source filenames remain distinct even when bytes match. Every row uses its own IDLANCAMENTO; retries reuse the existing financial row and completed uploads.

Implementation: extend the existing private worker/payroll_row_attachments.py and call its new copy_launch_to_payroll function from WorkflowEngine._record_launch_payroll_type after field verification and before the durable success checkpoint. Use SharePointStore's paginated inventory and SHA-256 readback. Validate source ownership, source stability and target linkage. Never overwrite conflicting files. A deterministic launch/name/content namespace handles a genuine filename collision. An attachment error retains the existing retry flow. Settlement without a launch has no launch attachments to copy.

1. Write real handler regressions using synthetic SharePoint boundaries: separate launches, 3/4 files, same content/different names, partial retry, lost POST response, conflict, empty source, source/link changes, settlement launch ID. Run baseline and observe missing copies.
2. Implement the helper and hook; run focused cases and existing launch/settlement integration cases.
3. Package only the two source transformations in an isolated current repository checkout. Reuse the pinned two-root deployment installer/gate; test drift/backup/rollback. Compare full backend suite baseline/candidate names.
4. Review, merge with successful CI, deploy both backend roots, independently verify hashes and health, and rerun synthetic tests against installed code. This shared server publication serves Android, iOS and Windows without client binaries.

No financial data, conversation files, source attachments, or historical payroll rows are changed by validation or deployment.
