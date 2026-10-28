# Durable manual DDA synchronization result

Goal: display each manual synchronization result at least once to its authenticated requester, outside the DDA gallery and after app restart/foreground. Only explicit Entendi acknowledges it. Preserve existing schedules and no payment operations.

Architecture: account-scoped app monitor owns the polling, independently of gallery lifetime. A durable, sanitized client intent stores its id before sending; private server retains unacknowledged jobs by authenticated owner. The client recovers pending jobs on login/start/foreground, polls the same request without restarting collection, and queues terminal receipts. Visible receipt acknowledgement is persisted and retried without re-showing in that session/device; server ACK removes it from pending. No credentials, PDF, barcode, supplier or amount in browser persistence. Optional details are loaded only in authenticated memory for display.

Private API contract: dda_refresh accepts optional 32hex requestId (idempotent). dda_refresh_status accepts existing requestId, or mode=pending returning status=pending,requests, or requestId,acknowledge=true returning status=acknowledged. Old clients remain compatible. No old legacy job backlog is shown. Failed/unavailable/busy manual outcomes are retained. User isolation and unacknowledged retention survive restart/pruning.

Global receipt uses existing DDA result layout above other screens, with background inert while open and explicit acknowledgement. Backgrounding/logging out/destroying a screen never acknowledges. A failed list read still identifies newly created IDs; no failed network read is presented as confirmed bank completion. One active manual operation is reused. Pending receipts restored even if gallery never opened.

Work follows writing-plans, test-driven-development, mobile-change-validation. Existing worktree reused on a new branch. Parallel backend agent owns only private code; primary owns frontend integration. User explicitly authorized execution/merge/publication without additional approvals.

- [x] Red-green tests: monitor lifecycle, persistence, account isolation, loss of start response, failed polling, ACK retry, no duplicate start, terminal success/failure and new IDs.
- [x] Global receipt and gallery integration; lifecycle hooks in app-controller; fixed authenticated client API.
- [x] Private backend tests, independent review, hash-pinned check/deploy and read-only live probe.
- [x] Focused app tests, signature guard, browser visual fixtures at 320/390, build, independent review.
- [ ] PR/merge; full CI and publication web/Windows, Android internal and iOS TestFlight; verify receipts.

Validation: 88 focused DDA tests, 14 signature blocks intact, PWA build passed. Real-browser fixture verified 320/390/1365px with fictional rows. Independent review identified an inert restoration race; regression reproduced, corrected with native top-layer dialog for global receipts (no background inert mutations), and re-reviewed without blockers. Actual report opened during the popup cannot disable it or leave the app inert after both close. Server package passed 16 tests on Windows/Linux, hash-pinned check/deploy and authenticated public pending probe (zero pending results). No real bank request or ACK was issued during verification.
