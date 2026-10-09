# Verified publication — 2026-10-08

## Required outcome

Every selected payment has its own IDFOLHA question, including payments for the same supplier. Synthetic launches 901 and 902 for the same supplier selected sheets 31 and 32 respectively; saved rows retained those separate mappings. Each question identifies the payment position, launch ID, supplier and total.

## Fresh evidence

- Original live backend: the final 16-test original regression set reproduced 15 failures on both Windows and the VM before installation.
- Four additional legacy-reconciliation tests failed before the review repair; all 20 focused tests then passed locally, in VM staging and using the installed /opt runtime.
- Seven exact-file deployment tests passed, including check-only, drift/hash/manifest rejection and rollback/partial-restore handling.
- Six existing multiple-launch/ETag regressions passed unchanged.
- All 4,926 application tests passed; the signature guard confirmed 14 intact blocks.
- Independent review found and then verified the repair for uncertain legacy writes. Final review had no scoped P0–P3 findings. Reconciliation uses existing lookup/read/verification APIs only, preserves existing sheets and never creates/merges financial rows.
- Actual backend messages were rendered through the unchanged app conversation store/UI in Chrome at 1536px and 390px. Both sheet buttons were enabled and visible; there was no horizontal overflow.
- A fresh synthetic message/row export using installed source matched the visually verified fixture exactly. No real financial records or user drafts were used for QA.

## Full backend suite limitation

Baseline: 2,128 tests, 481 failures, 116 errors, 3 skips.
Final candidate: 2,148 tests, 481 failures, 117 errors, 3 skips.

All 597 inherited failing/error case identities remained. The extra error was a Windows HTTP connection abort (WinError 10053) in the existing authentication/origin test, not a payroll assertion. That exact test passed all three reruns on both baseline and candidate. The full backend suite is NOT green; see regression-comparison.md for the complete case list.

## Installed source and recovery

Only worker/workflow.py was installed at both /opt/energetica-whatsapp and /home/opc/energetica-build.

- Before SHA256: 2834445e70f4a4016fe1d2cd33053a3b88fc2942d59ef8903679b9fc0f6ee0a1
- Reviewed/installed SHA256: c080270856b1f592adf497ef986e2ae8177ddc516e9dc3ea5bce929f5b180534
- Manifest SHA256: 73e52b578fbe959a881cc6917d968ba79c4d17225ac505431e9b1c7acc6f9cf6
- Verified backup: /var/backups/energetica-whatsapp/launch-payroll-per-payment-20261009T023241435815Z
- Installation: 2026-10-09 02:32:41 UTC (2026-10-08 23:32:41 São Paulo).
- Both services active after restart; internal bridge health returned status=ok, channel=generic. Public health returned HTTP 200, body=ok.
- Archived patch replay with core.autocrlf=false produced the exact reviewed candidate hash.

This shared backend publication is active for existing Android, iOS and Windows/web clients. No frontend/native code, schema, signature gestures, credentials or financial/conversation-state data were altered. No new native binaries are needed.
