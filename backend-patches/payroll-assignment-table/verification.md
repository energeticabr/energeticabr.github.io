# Verification

- Seven real-channel table tests and 24 prior payroll-assignment tests pass (31 total), with synthetic records and temporary state.
- Four shared-app renderer tests pass: individual/collective rows, escaped data, invalid/foreign metadata fallback and retained filtering instructions.
- Ten installer tests pass on Linux, including independent four-file pins, drift, rollback, concurrent changes and LF/CRLF preservation.
- Eighteen actual renderer views at 320, 390 and 1200px pass: all three columns visible, no page overflow, correct affected-row counts and original reply commands. Long fictitious suppliers wrap; 320px collective and 390px individual screenshots were inspected.
- Native/web builds pass. Signature guard reports 14 intact blocks before and after changes.
- Independent review found a pagination lifecycle gap and an instruction-removal issue; reproducing tests were added and both fixes passed follow-up review, with no remaining Critical/Important finding.

The local full app run reported 8,552 tests: 8,546 passed, three failed and three skipped. The failures were browser measurement-readiness timeouts in attachment-upload-progress, diary-attachment-progress and home-diary-label; all passed unchanged in isolated reruns. The fresh hosted full app run on cumulative main `1bf4f59949a48dfdb665a5254a809049d43fe6ea` passed 8,551 tests with zero failures and one skip (8,552 total), including those cases. [iOS web-test job](https://github.com/energeticabr/energeticabr.github.io/actions/runs/41873665097/job/126728123089).

The first Pages validation reported 9,915 tests: 9,904 passed, one failed and ten skipped. The asset-report keyboard/history case timed out; its two-test file passed unchanged locally, and the fresh hosted app suite passed the same case. A new Pages execution is being tracked; this failed run is retained rather than described as green.

The existing background-target browser diagnostic timed out at 20,001ms in CI. Its outer 20-second deadline was shorter than the helper's allowed 30-second startup budget. Independent review approved raising only that outer deadline to 60 seconds, retaining the 1-second measurement deadline, background-target injection and all assertions. No helper or application behavior changed; the updated diagnostic passed the published Android run. The mismatch is confirmed, but cold startup is not claimed as the proven cause of that particular cancellation.

The release must verify web/Windows, Play internal and TestFlight separately, and the pinned backend receipt and installed hashes. No financial records are used for validation.

## Publication receipts

Feature [PR #750](https://github.com/energeticabr/energeticabr.github.io/pull/750) merged as `902bbac9dcc3ed740f88f39cdc95813d45fcd215`. Cumulative main `1bf4f59949a48dfdb665a5254a809049d43fe6ea` contains it and was rechecked with four renderer tests and 18 visual states.

- Backend installed at 2026-11-04 16:58:14 UTC. Manifest SHA-256 `40bf582e11359f1675208149a4710fed8d96c766c8005d7cc13952baeff20af6`; backup receipt `/var/backups/energetica-whatsapp/payroll-assignment-table-20261104T165814804080Z`. Independently matched all installed hashes, healthy services, zero temporary ingress rules, and all 31 tests passed again against the installed production runtime using synthetic data.
- Android internal: [run 1822](https://github.com/energeticabr/energeticabr.github.io/actions/runs/41873666119), cumulative main above. Play committed edit `11793686345257430076` at 17:38:32 UTC. The downloaded signed AAB contains the table JavaScript and CSS; SHA-256 `d2a3c4ee19e90ff7d2af704f4ff72f867e5db57f7cfa5b66dab49353df7d5efc`.
- Web/Windows: awaiting verified Pages publication and public entry-asset check.
- iOS: [run 2150](https://github.com/energeticabr/energeticabr.github.io/actions/runs/41873665097) uploaded successfully at 17:50:46 UTC. Apple build `7e61c64f-22c5-496b-946c-2ed56b5159e3` was `VALID`, `READY_FOR_BETA_TESTING`, then `ATTACHED` to `ENERGETICO Validacao` at 17:53:50 UTC. The downloaded simulator artifact independently contains the table JavaScript and CSS.
