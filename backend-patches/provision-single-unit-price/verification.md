# Verification - 2026-11-04

The requested control is the initial detail table of **APONTAR PAGAMENTO DA PROVISÃO**, not the create-provision wizard. The patch routes a single linked child with a missing, pending or zero unit price directly to `validar_valor_total_baixa`, then back to `description_review` after a valid value.

## Regression evidence

- On the unmodified source, the first-question regression failed because the engine returned `description_review` instead of the unit-price question.
- Missing/whitespace/pending prices, integer zero and decimal zero are covered. Positive prices and other invalid values keep the previous behavior. Counting all linked children prevents the shortcut when one pending child has paid siblings.
- Existing grouped settlement tests cover individual edits, freight, quantity, precision, concurrent changes, lost-response retries, partial selections and final financial confirmation.
- An additional attachment regression exposed the generic upload path entering collection during numeric editing. The reviewed correction enables form uploads only while an edit index remains active; completion clears that index before returning to the table.
- The first-price final-confirmation regression verifies no SharePoint mutations during questions and the resulting unit price/parent total after synthetic final approval.
- Seven isolated installer contracts pass, including separate source roots, manifest/input drift, source drift, concurrent drift, backup, rollback and inactive worker detection.
- All 35 grouped conversation tests passed against the installed production modules after deployment, with synthetic financial boundaries and temporary attachment-control storage.
- Independent review found two installer issues, both corrected and rereviewed before publication: separate service health checks and root-owned package execution.

## Deployment evidence

Manifest SHA-256: `387ee37e68958e1f72611f1a0eb2e313d66528140f6e647eca097c9bea8e0acf`.

Production source SHA-256: `baac76a2cd78558a1becc91cecd38800600fda8a63fbd076e881ce788ff4c720`.

Independent build-mirror source SHA-256: `f692a17d3467e0a515aeaa9300e1672e7203df929ed3734e95756a9030003cc3`.

The installer returned `deployed`, health `ok`, with backup receipt `provision-single-unit-price-20261104T115105903318Z`. Both systemd services were independently confirmed active and the installed hashes independently reread. A root-owned release directory and the verified existing ingress/drain gate were used.

Android, iOS and Windows/web use this shared conversation backend. No client code or protected signature blocks changed; no client build is required. Financial test IO was synthetic; deployment did not migrate or submit real drafts. Authenticated device UI was not exercised as part of this server-only change.
