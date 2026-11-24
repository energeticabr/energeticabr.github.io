# Faster app reopen

## Intent

Reduce the wait shown when Energético reopens by removing an unnecessary sequential VM request on the common main-menu path.

## Goals and constraints

- Keep the authoritative `input_continue` request on every session recovery.
- Check for unfinished diary PDF work before resuming when the saved state indicates an active diary, uncertain recovery, or pending upload.
- Preserve cancellation, draft recovery, attachment state, and the rule that only the empty current-question request may be retried.
- Do not change signature gesture code or the visual loading design.

## Approaches

- **Conditional preflight (selected):** skip the diary-evidence status request only when local and saved state provide no indication of diary work or an uncertain write. This removes one sequential request from ordinary menu reopen while retaining recovery for diary evidence.
- **Remove the preflight:** fastest, but can make a resumed diary request wait behind photo/PDF work without showing its progress.
- **Keep the current path:** safest but sends the extra request on every reopen, including the main menu shown in the report.

## Implementation calls

Keep `resumeConversation` conservative by default. Let the app controller explicitly disable the preflight only for known ordinary conversation state. Release web, Android internal, and TestFlight through the existing workflows after the required checks.

## Review focus

- A normal main-menu reopen makes one resume request and no diary preflight.
- An active or uncertain diary recovery still waits for diary evidence before sending `input_continue`.
- Retries, cancellation, saved drafts, and pending files retain their existing behavior.
