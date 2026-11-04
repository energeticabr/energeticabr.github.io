# Verification

- Seven real-channel table tests and 24 prior payroll-assignment tests pass (31 total), with synthetic records and temporary state.
- Four shared-app renderer tests pass: individual/collective rows, escaped data, invalid/foreign metadata fallback and retained filtering instructions.
- Ten installer tests pass on Linux, including independent four-file pins, drift, rollback, concurrent changes and LF/CRLF preservation.
- Eighteen actual renderer views at 320, 390 and 1200px pass: all three columns visible, no page overflow, correct affected-row counts and original reply commands. Long fictitious suppliers wrap; 320px collective and 390px individual screenshots were inspected.
- Native/web builds pass. Signature guard reports 14 intact blocks before and after changes.
- Independent review found a pagination lifecycle gap and an instruction-removal issue; reproducing tests were added and both fixes passed follow-up review, with no remaining Critical/Important finding.

Full app-suite completion and target-specific publication evidence are pending. The first full run reported a browser binary-upload test failure; the same two-test browser file subsequently passed unchanged in isolation. The first failure is retained in the private full log.

The existing background-target browser diagnostic timed out at 20,001ms in CI. Its outer 20-second deadline was shorter than the helper's allowed 30-second startup budget. Independent review approved raising only that outer deadline to 60 seconds, retaining the 1-second measurement deadline, background-target injection and all assertions. No helper or application behavior changed; the updated diagnostic must pass in CI. The mismatch is confirmed, but cold startup is not claimed as the proven cause of that particular cancellation.

The release must verify web/Windows, Play internal and TestFlight separately, and the pinned backend receipt and installed hashes. No financial records are used for validation.
