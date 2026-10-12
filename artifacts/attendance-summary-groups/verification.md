# Attendance confirmation group fills and per-item dates

Base: `64b8fafb8c3f422c1c172770479987aadeb1c809`.

- Same numeric IDDESCRITIVOETAPA and the same ATIVIDADEEXECUTADA share one row fill, including interleaved suppliers. Changing either field selects another fill. Supplier, presence status and date do not participate in the key.
- IDDESCRITIVO and IDDESCRITIVOETAPA labels are supported. Renamed/multiline captions do not change the numeric ID. Missing/malformed grouping fields never merge unrelated records.
- Six distinct pastel fills precede a bijective RGB palette of 32,768 additional fills. Independent review checked all 32,774 colors for uniqueness. Batch label contrast is at least 5.176:1.
- Batch detection uses field semantics rather than the former four-cell count, preserving stacked phone layout after DATA becomes the first of five fields.
- Each backend row reads its own source DATA and formats dd/mm/yyyy; absent dates show `-`. The confirmation gate, source records and other fields remain unchanged.

## Verification

- Initial frontend RED: three missing-behavior failures. Review-case RED also reproduced duplicate rounded-HSL colors (166/200 unique), multiline IDs, malformed objects and low label contrast. Final focused checks: 8/8. Complete chat-view suite: 302/302.
- First full frontend run: 5,409 passed. Final full run after review corrections: 5,410 passed, zero failures, exit code 0 (643,503.9276 ms).
- Native and PWA builds passed after final corrections. Existing chunk/dynamic-import warnings remain. Signature guard: 14 intact blocks. Secret scan: 739 tracked files checked.
- Backend RED: 6/6 expected failures on original source; GREEN: 6/6 on updated copy, also 6/6 with production Python 3.9 on the VM. No HTTP allowed in fixture tests.
- Legacy positional assertions were adapted to cell labels/five-cell order. Relevant current backend comparison: 42 tests, 40 pass, two pre-existing `returned_to_main_menu` expectation errors (`test_attendance_batch_conflict_offers_exit_without_trapping_menu`, `test_attendance_batch_missing_id_can_exit_instead_of_retrying_forever`). No new failure remains in that comparison.
- Full artifact-mirror backend discovery was not green on baseline: 2,150 tests, 511 failures, 124 errors, 3 skips (including missing modules/deployment scripts and historical fixture expectations). Its pre-adaptation candidate run had 2,156 tests, 521 failures, 127 errors, 3 skips; the additional identities were the five positional assertions, repeated by discovery. This is not presented as a green complete backend suite. Full inventory is retained in the local `attendance-date-verification.md` receipt.
- Browser preview at desktop and 390×844 phone: green/blue/green/peach fills match the intended pairs; DATA precedes supplier; no row horizontal overflow. Controlled fixture only; no real attendance submitted.

## Backend receipt

On 2026-10-12 at 13:37 UTC, installed only the one-line DATA change with hash guards, atomic replacement, preserved ownership and backup:

- Before: `95cae83845805ee1d03a8bbafa3e4bde9fb435506d698328734d3c5e64146c30`.
- After: `be477c9c6d587baa80a4aa7e2b17ba9f8282cc67e0e983e5d539ae19ee7bf56e` in production and source mirror.
- Backup: `/var/backups/energetica-whatsapp/attendance-summary-date-20261012T133725716528Z`.
- Restarted both `energetica-whatsapp` and `energetica-channel-bridge`; both active, 8080 and 8765 health checks passed.

Apply the zero-context worker patch with `git apply --unidiff-zero` against the reviewed baseline. Run the date regressions with current `worker` and `tests` on PYTHONPATH and `ATTENDANCE_WORKFLOW` set to the selected actual workflow file; this prevents fixture imports silently substituting an older workflow.

Power Automate work remains paused. No financial or HR row was posted for QA. Native publication and final live checks are recorded only after their receipts exist.
