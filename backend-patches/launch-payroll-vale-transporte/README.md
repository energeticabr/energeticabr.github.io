# VALE TRANSPORTE in launch payroll types

The shared workflow omitted VALE TRANSPORTE from `LAUNCH_PAYROLL_TYPE_OPTIONS`.
The one-line patch adds `launch_payroll_type_transport`; both the existing
prompt and reply handler consume this table, so the option is displayed and
accepted by button ID or typed text and stored as `TIPOPGTO=VALE TRANSPORTE`.
The other six options and accounting/launch links are unchanged.

This fixes the shared service used by Android, iOS and Windows/PWA. No native
client change or new binary is required, and tests never write real SharePoint
payments.

## Verified checks

- New regressions: four failures before the fix, all five tests pass afterward.
- Prompt contains all seven choices; clicking or typing transport stores the
  correct linked FOLHAPGTO fields. Repeated message IDs do not duplicate payment.
- Actual client renderer in Chrome at 320, 390 and 1365 px: enabled transport
  button and all existing choices, no horizontal overflow.
- Full legacy suite: baseline and candidate each run 2292 checks with identical
  441 failures, 132 errors, 3 skips. This suite is not green; every case is listed
  in [verification.md](verification.md). No new failing/error cases.
- Both VM staged copies run the five regressions and match the reviewed hashes.
- Simulated post-install hash mismatch restores both original deployed copies
  and restarts simulated services, without touching production.
- Client source is untouched; signature guard confirms 14 intact locked blocks.

`deploy.sh` takes a unique `/home/opc/launch-payroll-transport-*` stage and mode
`validate` or `apply`. It refuses changed baselines, validates exact-context
patching and candidate hashes, keeps backups, uses a deployment lock and rolls
back installation/health failures. The stage needs these scripts plus the
sandbox `tests/test_workflow.py` fixture at `test-fixtures/test_workflow.py`.

Regression command: `TRANSPORT_SOURCE=<backend-root> python -B test_transport.py`.
Set `TRANSPORT_FIXTURE=<output.json>` to export the real prompt for `verify_ui.mjs`.
