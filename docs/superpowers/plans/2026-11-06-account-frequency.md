# Account frequency ordering

Goal: Order the account question in launches from most to least used in the last 100 LANCAMENTOS records by descending Id. Stable ties retain catalog order. Keep every catalog ID and value, filtering, pagination, drafts and attachments.

Architecture: Add a scoped ranker at the shared workflow selection boundary, following the existing stage frequency ranker. Read only Id and CONTA, top=100, without distinct or branch filters. Limit again locally; normalize names with the existing normalizer. On history failure retain catalog order. Backend publication serves existing Android, iOS and Windows/web clients.

User explicitly requested autonomous implementation and publication; execute inline without approval questions.

- [x] Add behavior tests against real workflow fixtures: frequency, last-100 boundary, ties, accents, empty/failure fallback, refresh, filtering/pagination/selection, isolation and draft preservation. Baseline: 7 expected failures, no errors. Candidate: 10 pass.
- [x] Add pinned patcher and minimal ranker for launch/conta_lancamento. Linux directed regressions, preserved stage/expense tests and installer tests: 64 pass. Signature guard: 14 protected blocks intact. Independent review: no material findings.
- [x] Review diff, package exact hashes with existing guarded installer, run preflight, publish with lock/gate/backup/rollback, independently verify installed behavior and service health. PR 785 merged; main CI passed. Installed regression: 10 pass; 100 live records/13 accounts independently matched; service and public HTTPS healthy; mirror unchanged. Full historical suite timed out at 90 seconds in both baseline and candidate.

Review focus: source values rather than display IDs; blank accounts count in the 100-record window; new launches refresh ranking; unchanged choice IDs; history outage keeps payment available.
