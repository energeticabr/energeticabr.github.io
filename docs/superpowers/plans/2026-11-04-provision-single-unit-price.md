# Single provision missing unit price

**Goal:** Ask for the unit price immediately after selecting a description with exactly one linked provision whose unit price is pending, zero or empty; return to the initial review after a valid answer.

**Architecture:** Reuse the grouped settlement's existing single-field edit route in `worker/provision_description_settlement.py`. Preserve draft entries, attachments and final financial confirmation. Deploy the shared backend for Android, iOS and Windows; client binaries are unchanged.

**Constraints:** Count all linked children, including paid children. A single selected/pending row within a larger description does not qualify. Positive prices and multi-row descriptions retain the existing review. No financial writes before confirmation.

- [x] Add real-engine regressions for missing/zero/pending prices, invalid responses, positive prices, multiple children, attachments and continuation.
- [x] Observe the missing-price regression fail on current production source.
- [x] Reuse the existing numeric input/edit completion route, then run grouped settlement regression suites (35 passed against installed source).
- [x] Package the minimal source diff with pinned baseline/candidate hashes, backup and rollback; deploy and verify shared service health and installed hash.
- [x] Commit and publish the reviewable patch and verification evidence (PR #743).
