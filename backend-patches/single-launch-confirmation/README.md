# Single-launch confirmation table

The shared service only projected multiple launches. Consequently the already released client had no `activeFlow.launches` data for its inline, four-cell confirmation table in single mode.

`single-confirmation.patch` exposes the current fields only for a single launch in `awaiting_confirmation`, without multiple-line edit/delete commands. The server-side `can_act` gate explicitly authorizes multiple mode only. Stale captured multiple lines, other stages, invalid amounts and inactive flows remain excluded. Unit price keeps its precision; the final payable total uses the same cent rounding as the confirmation summary. Multiple-launch behavior is unchanged.

This is a shared-service fix for Android, iOS and Windows/PWA; no new native binary is required. No real SharePoint launch was created for verification.

## Checks

- Reproduction: missing `launches` failed the new authenticated-portal regression before the patch.
- Candidate: 16 checks passed (5 single regressions and 11 existing multiple/security checks), including rejection of forged edit/delete commands with a valid revision before mutation.
- Existing client: all 325 chat/store/launch-panel checks passed; 10 focused confirmation/rendering checks also passed.
- Chrome: real sandbox portal output normalized by the existing conversation store and renderer; at 320, 390 and 1365 px the table is above confirmation buttons and has no horizontal overflow.
- Signature guard: 14 locked blocks intact; client source is unchanged.
- Production client assets already contain the table and its styles (`index-IvX9AJES.js`); verified by `verify_live_client.mjs`.
- Both VM staged copies passed all 16 checks; reviewed SHA-256 pins were verified before and after testing.
- Full deployment rollback was exercised with mocked privileged commands: a forced post-install hash mismatch restores both original modules and restarts the mocked services. No production operations occur in this rollback test.
- Full backend discovery: baseline and candidate each ran 2292 checks with the identical 441 failures, 132 errors and 3 skips. This legacy suite is **not green**; no new failing/error cases were introduced. See `verification.md` for names.

`deploy.sh` guards both installed/source copies by their verified baseline hashes, pins both reviewed candidate hashes before/after testing and installation, validates staged copies using the VM Python runtime, preserves backups and rolls back on deployment/health failure. Use `validate` before `apply`; the baseline guard intentionally prevents applying it twice.

The remote stage also needs `test-fixtures/test_portal_launch_preview.py` and `test-fixtures/test_portal_attachments.py` from the backend test checkout. These are sandbox/authentication test utilities only, not deployed application code. `SINGLE_LAUNCH_TESTS` points the regression runner at them when the installed service does not ship its complete test suite.

Verification commands (PowerShell):

```powershell
$env:SINGLE_LAUNCH_SOURCE='<sandbox backend root>'
$env:SINGLE_LAUNCH_FIXTURE='<output.json>'
python -B backend-patches/single-launch-confirmation/test_single_launch.py
node backend-patches/single-launch-confirmation/verify_ui.mjs '<output.json>' '<screenshot.png>'
```
