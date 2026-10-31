# Parent provision due date follows the earliest unpaid child

User request: the description's planned payment date defaults to the most restrictive linked unpaid provision due date. After a payment, advance to the earliest remaining unpaid date until completion.

Rule: compare calendar dates chronologically, including overdue children. A future scheduling date is not proof of payment. Exclude only children with confirmed payment according to the existing domain contract; retain existing full-settlement paid-date rules. When no unpaid child remains, preserve the historical planned date rather than inventing or erasing a deadline. Unknown/invalid child dates or incomplete pagination must not silently produce a later deadline.

Root causes: Python parent creation copies the first child date; the append updater only recalculates totals; grouped settlement does not select the next outstanding due date. The gallery payment editor synchronizes date fields only for a single linked child. Portal creation/append also derives its initial date from the active child.

Implementation:
1. Backend worker adds failing synthetic tests, a shared date selector, and creation/append/grouped/single-settlement integration. Preserve frozen payloads, idempotency, parent ETags and complete fresh child reads.
2. Frontend worker adds failing synthetic tests and integrates the same rule into portal creation/append, child edits and relinks. Derived parent updates must not propagate the earliest date into the children's individual dates. Preserve explicit parent editor behavior.
3. Main prepares a source-only private, pinned backend rollout, checks the existing description 52 read-only, and reviews both contracts with the independent reviewer. No broad historical migration or payment/amount modifications.
4. Verify focused regressions, signature protection, build, Linux runtime and browser end states. Merge green CI, publish backend, web/Windows, Android internal testing and iOS TestFlight for the same revision; verify each actual delivery.

All financial test destinations are synthetic. Full backend sources, credentials and deployment archives remain private. Any bounded correction to the pictured description is limited to its planned due date and uses live child reconciliation and an ETag.
