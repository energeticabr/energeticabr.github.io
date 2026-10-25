# Grouped provision settlement review

New grouped payment settlements show every linked provision in one table:
product, quantity, unit price, line total and a final grand total. The existing
poll offers SUBMETER or EDITAR ALGUMA LINHA. Submit accepts valid numeric values
as a batch and continues to the shared payment questions; it never performs the
final settlement. Edit selects a pending line then product, quantity, unit price
or freight, and returns to the recalculated table without remote writes.

Paid rows are read-only and the pending subtotal is distinguished from the grand
total. Decimal unit-price precision and freight remain intact. Missing or invalid
amounts prevent submission, rather than becoming zero. Existing unversioned
drafts retain their original path. The final concurrency checks, attachments,
one-order conversion, journal and final confirmation are reused.

The optional `detail_table.kind = provision_settlement_review` is scoped to the
active parent and overview phase. Older clients retain a complete textual table.
The shared mobile/web renderer uses semantic columns, escaped text and table-only
horizontal scrolling on narrow screens. Existing reply controls remain unchanged.

## Private source and deployment

Only the four-file reviewed diff and its hash manifest are public. The complete
fresh backend snapshot, configuration, source archive and all runtime evidence
remain private. No business records, attachments, credentials or schema changes
are included in this patch.

`package.py` builds `source.patch`, `deploy-manifest.json` and a separately located
private `source-files.tar` from a fresh baseline/candidate and mirror hashes.
`deploy.py` pins each root separately, rejects drift, compiles the exact allowlist,
backs up production and mirror, installs atomically and checks both services and
the bridge health. Failure restores each changed file; unrelated state is never
deleted. The shared rollout helper is hash-pinned from
`backend-patches/launch-payroll-per-payment/deploy.py` with canonical LF endings.

Run `deploy.py --check <manifest-sha256>` before `--deploy` with the same hash.
The private stage path is fixed in the installer. `source-files.tar` is ignored
and must never be committed. See `verification.md` for evidence and limitations.
