# Verification — 2026-10-26

- Fresh live source was copied into an isolated private QA workspace; only code and fixture files were copied.
- Before the fix, all four new reproductions failed: uploads discarded the review actions, submit/edit could not advance, and final confirmation could not be reached through the expected sequence.
- After the fix: 35 real-conversation tests passed, including existing batch-review regressions and seven new attachment/recovery cases. No errors or skips.
- The new cases cover three uploads at the overview, a persisted collecting state, edit after upload, final attachment completion and financial confirmation, FINALIZAR without approval, and duplicate submit delivery. All keep synthetic SharePoint unchanged before final confirmation.
- Installer: 10 tests passed, including drift rejection, exact archive scope, hashes and rollback.
- Fresh-context code review found an attachment-count regression in the generic form-staging branch. An isolated two-file-limit reproduction failed before the scoped early guard and passed after it. The reviewer rechecked the final patch and closed the finding with no further issues.
- Signature guard: 14 protected blocks intact before and after the work. No mobile source changes.
- Manifest SHA-256: `3c95a9835b3944af8e4289b43ee95a6e194814c1e6a2c114119f13ec11f69a70`.
- Reviewed module SHA-256: `afe507b5bf32f2000a8797616bebbdcfd068a52d1146cfce916f47c8162ad8dc`.

## Published runtime and application verification

- Released at `2026-10-26T03:22:00Z`; installer returned `deployed`, health `ok`. Recoverable backup receipt: `provision-single-review-20261026T032200317893Z`.
- Independent SHA-256 reads confirmed both live and build-mirror modules match the reviewed `afe507...2ad8dc` artifact. Channel bridge and WhatsApp services are active.
- GitHub installer and both signature-guard checks passed for source revision `8cd16862`.
- The authenticated Windows browser app reloaded and restored the initial grouped review with three attachments. One click on SUBMETER removed the review actions and displayed the payment-date question with HOJE / OUTRA DATA. All three attachments remained visible, with no posting error.
- A private screenshot records this visible result. No payment date or final confirmation was entered, and no financial record was submitted for testing.
- This server update is effective for Android, iOS and Windows clients; there is no native binary change to distribute.
