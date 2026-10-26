# Verification

Executed against a fresh private snapshot of the live runtime, Python 3.9.
All business records, attachments and delivery boundaries in tests are synthetic.

- Reported five-supplier conversation reproduced on the unchanged baseline:
  final confirmation returned submission_failed before financial writes.
- Candidate: 19 conversation regressions passed (five suppliers, one DIVERSOS
  order, exact totals/links, per-launch suppliers, branch checks including paid rows,
  no-launch answer,
  frozen intent, lost order/child responses, real upload hook, file scope and
  the original failed draft's retry button before any write).
- Candidate: 13 scoped-fanout regressions passed, including later repair, saved
  context tampering, concurrent parent change, and dry-run without persistence.
- Existing fanout suite: 27 passed. Existing batch-review suite: 29 passed.
- Existing payroll-row attachment propagation suite: 23 passed.
- Installer suite: 10 passed, including drift, scope, archive, rollback and
  follow-up runtime pins while preserving the cumulative reviewed diff.
- Archived settlement/provision workflow tests: baseline and candidate both ran
  the same 23 tests with the identical 20 failures and no errors/new failing IDs.
  This is not a green historical full suite; old expectations/configuration do
  not match the current runtime. An unrelated broad historical run was stopped
  after confirming this fixture mismatch; no broader success is claimed.
- Signature guard: all 14 protected blocks intact; no mobile assets changed.
- Independent fresh-context review found upload-hook, later-repair and legacy
  identity gaps; all were corrected. Final review confirmed the frozen parent
  owner guard and reported no remaining concrete findings.
- Read-only probe of the preserved real draft reached the diagnostic write
  boundary on the candidate, instead of the original supplier-homogeneity error.
  All writes, state saves and messages were blocked during this probe.
- Exact-file deployment --check passed with both live roots matching baseline,
  reviewed candidate hashes and healthy service. Runtime rollout is recorded by
  its private backup receipt; private data and receipts are not included here.

The single shared backend serves installed Android, iOS and Windows/web clients;
no native rebuild is needed for this runtime-only correction.

