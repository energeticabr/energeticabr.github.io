# DDA report payment confirmation implementation plan

**Goal:** Add a check to each DDA report row. Confirm an existing payment in a popup above the open report, then update the affected row and totals.

**Architecture:** Reuse the gallery payment confirmation component and authenticated `confirmDdaPayment` endpoint. Normalize the identity and manual-confirmation metadata into report rows. Apply only a validated receipt to the current report; preserve filters, page and scroll. The open-only filter naturally removes a newly paid row, while All shows it as paid.

**Constraints:** No bank payment is executed. No real bill is marked paid during testing. Preserve signature locks. Publish web/Windows, Play internal and TestFlight. User has authorized implementation and publication without additional approval.

- [x] Add failing report tests for confirmation, cancel, failure/invalid receipt, paid rows, filters/totals and closed-session responses; controller test for authenticated callback.
- [x] Implement row checks, nested popup integration and receipt-driven report refresh; scope layout to rotated report viewport.
- [x] Validate focused tests, 320/390/desktop browser previews, signature guard and PWA build; obtain independent review.
- [ ] Commit, PR, merge, verify full CI and all publication targets.

Review focus: nested Escape/focus must not close underlying report; invalid/missing keys cannot be submitted; a closed report must ignore late responses; confirmation must not reset filters or reinstate bank-open over manual-paid; popup and checks must fit the rotated mobile report.

Validation: 45 focused tests and 3 browser suites passed, including 320/390/1365 px confirmation previews and global sync overlay interaction. PWA build and 14-block signature guard passed. Independent review found no P1/P2 blockers. No real DDA was marked paid.

