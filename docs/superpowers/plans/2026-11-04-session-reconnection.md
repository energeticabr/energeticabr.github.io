# Session reconnection repair

**Goal:** Make Retomar conversa restore the authoritative VM question and unlock the app after transient disconnection, without replaying a business answer or dropping drafts/files.

**Diagnosis:** The controller waits indefinitely for the diary preflight on startup. Its manual timeout applies only after preflight, and does not cancel the HTTP resume request. `sendText` accepts a progress signal but does not pass it to token acquisition/fetch. A retry can therefore remain behind an old request, and a transient preflight failure prevents reaching `input_continue`. Old resume callbacks/finalizers are only scoped to the account, so they can affect a newer attempt.

**Implementation:** Add an abortable, bounded coordinator around only the preflight and `input_continue` control query. Retry transient connection failures with fresh controllers and bounded delays; reset the inactivity watchdog only for advancing PDF progress. Keep financial/text writes outside the retry loop. Forward cancellation for the exact empty `input_continue` control payload. Scope UI/progress ownership to the current resume attempt, hide stale errors while reconnecting, and release the busy state on timeout/cancel. Preserve local files and drafts without a destructive page reload.

Preserve the existing total 30-second inactivity bound across attempts and backoff, in addition to the 15-second per-attempt watchdog. Only advancing PDF evidence renews the shared budget. The unchanged attachment-resume-recovery stalled-VM regression exposed the missing shared bound in the first CI run; it and new lifetime/backoff regressions passed after adding the coordinator lifetime controller.

- [x] Reproduce the pictured failed-startup/manual-resume path with the real chat client and synthetic network failures.
- [x] Cover a hung preflight, ignored cancellation/late response, transient recovery, persistent failure followed by another tap, progress during PDF processing, and sign-out.
- [ ] Implement minimal coordinator/controller/client changes and run focused regressions, full suite, signature guard, builds, and 320/390px UI checks.
- [ ] Independent review, integrate and verify web/Windows, Play internal and processed/associated TestFlight for the same revision.

Focused verification: 726 tests passed, including real-client disconnection recovery, hung token/preflight/current-question reads, optional snapshot timeout, late-response suppression, HTTP status preservation, monotonic progress and one-shot post-resume mutations. The new regressions failed before the corresponding fixes. Real-browser click recovery passed at 320/390/1365px with preserved draft/file, restored options, enabled composer and no overflow. Native/PWA builds passed and 14 signature blocks remain intact. Independent review findings were reproduced and corrected; re-review found no remaining blockers. Full local suite is running at PR creation.
