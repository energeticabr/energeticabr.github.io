# Absence justification implementation plan

**Goal:** Default absence MOTIVACAO to the saved IRREGULARIDADES for the same attendance record and date, avoiding a repeated question.

**Architecture:** Read the current justification at the motivation boundary in the shared Python workflow. Preserve explicit holiday and manual edits, review/confirmation, absence payment rules and optimistic concurrency. Batch reasons belong to individual records; ask only for missing reasons.

**Tech Stack:** Python workflow, in-memory integration fixtures, pinned backend deployment.

- [ ] Reproduce individual and batch behavior with the real engine and synthetic data.
- [ ] Add fresh exact-record reads and defaults, including mixed batches and changed notes before submission.
- [ ] Run focused attendance regressions and deployment integrity/rollback tests.
- [ ] Package the reviewed diff with current source hashes; publish the shared backend and verify installed behavior/health for Android, iOS and Windows.

User explicitly requested execution without approval questions. No client UI or protected signature blocks change. Source snapshot is private; only diff/tests/deployment metadata enter Git.
