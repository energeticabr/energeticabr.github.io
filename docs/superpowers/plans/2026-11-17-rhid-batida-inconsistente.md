# RHID inconsistent punch correction plan

Goal: Allow selection of a uniquely identified out-of-range punch in attendance validation, require a typed justification, preserve its original RHID time and show the correction in orange.

Architecture: Reuse the existing slot classification and audited adjustment API. Keep missing-punch additions blue; existing-punch corrections use the report's established orange tone. Mark unresolved out-of-range days orange on the calendar.

Spec: User request and attached Edgar example; cover both 13:34 and 13:43.

Constraints: Preserve signature gesture blocks, identity/date checks, ambiguous-punch protection, pending selections and raw RHID data. Compare the original time again before saving. Publish to Windows web/PWA, Android internal and TestFlight.

- [x] Add failing integration tests for selection, original display, mandatory reason, correction and stale-data protection.
- [x] Extend shared eligibility and UI/controller validation, preserving missing-punch behavior.
- [x] Add orange calendar anomaly indicator and model/view coverage.
- [ ] Verify focused tests, browser layouts, signature guard, builds and full suite/CI.
- [ ] Review, merge and verify each publication.

Verification: focused suite 874/874 passed; subsequent calendar review regression 4/4 passed. Native and PWA builds passed; signature guard: 14 intact blocks. Browser correction flows passed at 320/390/1365; the existing interactive-fixture startup check timed out locally. Full suite and CI pending.

Review: independent reviewer found calendar omission for ambiguous/unassigned anomalous raw punches; fixed with a failing-then-passing regression. No other Important/Critical findings or deferred minors. Live persistence uses the existing audited backend API; no actual employee time changed as part of this implementation.
