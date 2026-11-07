# DDA provision shortcut

**Goal:** Place PROVISÃO below the green payment check. Clicking transfers the exact DDA attachments into the chat tray and starts the existing payment provision wizard.

**Architecture:** Reuse the DDA launch transfer with a configurable flow action (`action_payment`, `payment_provision`). Keep payment confirmation independent. Keep draft, unrelated attachments, cancellation and retry guarantees.

**Constraints:** No financial record is submitted by the shortcut. No protected signature blocks change. Publish Windows/web, Android internal and iOS TestFlight.

## Tasks
- [ ] Add failing integration tests for provision transfer, retry, cancellation and independent card action.
- [ ] Generalize the existing transfer handler and wire the gallery button with busy/error/cancellation handling.
- [ ] Check mobile layout at 320/390px and desktop; run focused tests, full suite, signature guard and builds.
- [ ] Review, merge and verify publication separately for all three targets.

## Review focus
- Failed downloads must leave the current flow/tray untouched.
- Retry must send only unconfirmed files and preserve pending files.
- Closing/logout must cancel late transitions and uploads.
- Provision must not confirm a payment or invoke a launch flow.
- Long names and the new label must fit narrow cards.

## Progress
Native worktree creation did not return; cancelled the stalled call and created an isolated linked worktree via git. Execute directly as instructed by the user.
