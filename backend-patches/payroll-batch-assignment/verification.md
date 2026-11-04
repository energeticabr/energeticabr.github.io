# Verification record

## Scope and focused validation

- Shared runtime change in `worker/workflow.py` only; no mobile source or native projects changed.
- Fresh production baseline: `7c77bb2b4a4cf201120b8ca5f7d4efa4d56e3873343ecfa555dbb95386dfdc8d`.
- Reviewed candidate: `2b538443ab1a8165fb636cb194e41cb2971cad34f88c7e95df32c700aa40b785`.
- Independently transformed mirror: `45bf670e109838db6277debc6fa11ff4c2a7d03865d31b0e2ef73470cda58a91`.
- 24 real ChannelBridge/WorkflowEngine/LocalStateStore feature tests pass. They cover both modes and mixed combinations; supplier-specific month resolution; prior/next month and year rollover; displayed-month rollover; missing/ambiguous sheets; query failure; drafts with prior answers; verified rows; stale and duplicate controls; retry after partial verification; and process termination before the first write with the collective type durably saved.
- 54 archived launch/settlement regressions pass through a test-only adapter that chooses the new individual mode before exercising each old per-line scenario.
- Seven installer tests pass on Linux: source/input drift rejection, independent roots, backups, rollback after restart failure, concurrent drift preservation and service health.
- Actual app conversation store and renderer: 12 synthetic views at 320, 390 and 1200px, four new questions each, with no horizontal overflow or browser exceptions. The 320px mode and 390px month screenshots were visually inspected.
- Signature guard before/after reports 14 protected blocks intact.
- Independent source review found one Important issue (collective type durability), reproduced and fixed. Follow-up found no Critical/Important issues. Scoped individual buttons and exact-month lookup were added for its additional observations.

## Broader regression and publication

The complete private backend command (`python -B -m unittest discover -s tests -v`, through the snapshot runner) was compared on Windows with the same configuration and external fixtures. The runner releases failed TestCase objects after retaining their names and complete tracebacks, avoiding catalog retention on the small VM.

| Revision | Tests | Failures | Errors | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 2210 | 1266 | 141 | 3 |
| Candidate | 2210 | 1266 | 140 | 3 |

New failing/error names: **zero**. The full legacy suite is **not green**. Existing failures include legacy workflow navigation expectations and the missing `test_watchdog_recovery_notice` import. The baseline-only `SignatureServiceTests.test_rejects_unauthorized_request` error was a local `ConnectionAbortedError: WinError 10053`; it did not recur on the candidate, and is not claimed as a production fix. Complete logs and exact failure-name JSON remain in the private task evidence.

Implementation [PR #747](https://github.com/energeticabr/energeticabr.github.io/pull/747) merged as `f4a3627a8ecb5eb5829d78d69a9ecf3ca88cf23f`. Hosted PR checks passed: installer tests (8 seconds) and both signature checks (10 seconds each).

The pinned package was deployed on 2026-11-04 at **16:23:06 UTC**. Manifest SHA-256: `cc58ccabf210b83c6dc74656eefab508a14cf3325552a7f9599d36540351af48`. The installer returned `deployed` / health `ok`; backup and receipt are under `/var/backups/energetica-whatsapp/payroll-batch-assignment-20261104T162306404803Z`.

An independent post-install read confirmed both exact candidate hashes above. Production and mirror configuration hashes remained respectively `e72f874a925a2155906009dddb549131ceeb91d26071d3977a44330b22a6b4a3` and `a951c15f30d78409101b7829bdf9bad3cf118ac7541c3dcaa705663e962bf069`. Both services were active, HTTP health returned `{"status":"ok","channel":"generic"}`, and no temporary ingress gate remained.

All **24 feature tests passed again using the installed production runtime**, with synthetic external records and temporary state. No real financial records, attachments or conversation files were changed by installation or validation.

Android, iOS and Windows/web use the same published runtime; new client binaries are unnecessary for this patch.

## Deferred minor

Typed legacy payment-type controls remain supported. Scoped controls are generated only by the explicit individual mode; normal forward flow does not switch to collective mode. An externally reconstructed draft switching modes while preserving old controls is not a supported transition.
