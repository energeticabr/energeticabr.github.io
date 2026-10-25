# Provision description link editor — verification

## User-visible behavior

Edit provision now includes **Descritivo da provisão**, a searchable closed
selector of existing description IDs with supplier and observation labels.
The loaded link is visible. Submitting a new selection preserves the provision
ID, supplier, branch, payroll identity, payment dates and attachments unless the
user separately edits another editable field.

The previous and new description totals are recalculated from complete child
sets using the existing exact-decimal quantity/value/freight calculation. An
empty previous description is retained with zero total, not deleted.

## Validation evidence

- Signature gesture guard: all 14 protected blocks intact.
- 97 initial focused gallery tests and 105 related portal tests passed.
- 26 final provision integration cases passed after the independent review fixes.
- The initial full app run completed: 7,286 tests, 7,283 passed, 3 skipped, no
  failures. Final post-fix full-suite/CI status is authoritative in the PR.
- Both final Vite and PWA builds passed; preexisting chunk-size/dynamic-import
  warnings remain unchanged and are not treated as validation failures.
- A real browser exercised the production selector and save flow with fictitious
  repository data at 320px and 390px. Selection, wrapping, conditional writes,
  both parent totals and the visible before/after receipt were checked.
- No real financial record was relinked to test this feature.

## Review and recovery

One independent whole-branch reviewer identified two concurrency issues. RED
tests reproduced destination deletion during/after the child write and an
intervening move in another session before retry. The fixes revalidate at the
write boundary, conditionally restore this edit when its destination disappears,
and retain outstanding parent-total repair independently of a subsequent move.
A retry repairs actual parent child-sets without stealing a later user's link.

SharePoint operations are not a cross-record transaction. Failed synchronization
keeps the editor available for retry; server-wide repair of preexisting orphan
links is not introduced. No new supplier/branch/payment-status eligibility policy
was added by this request.

## Publication

[PR 593](https://github.com/energeticabr/energeticabr.github.io/pull/593) records
the authoritative reviewed revision, CI and merge status. The existing release
workflows target web/Windows, iOS TestFlight and Google Play internal testing.
Successful distribution is reported only after its actual workflow steps and
published editor are verified. No production Play or App Store review is requested.
