# Petranet monthly provisions implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, then independent whole-branch review.

**Goal:** Capture Petranet PDFs for recurrence 14 and apply only to the existing provision for the due month and its actual linked description.

**Architecture:** Reuse the durable queue and the existing OCI 07:00 America/Sao_Paulo worker. Add a separate exact Petranet Outlook event subscription, keeping the Cemig subscriptions unchanged. Parse Petranet separately and resolve a fixed provider profile into the existing monthly reconciliation and locking path.

**Tech Stack:** Python 3.9, pypdf, Power Automate Outlook/SharePoint connectors, systemd, PowerShell publisher.

**Spec:** User request and supplied Petranet screenshot in this conversation; existing Cemig monthly-pair design.

## Global constraints

- Recurrence 14, supplier PETRANET, branch 004 - EDIFÍCIO XAVANTE.
- Exact sender boleto@grupopetranet.com.br and subject Boleto da Petranet internet.
- Validate payer customer 11721, one approved Petranet beneficiary (Cprnet LP Ltda / 60.777.188/0001-00, or LP Servicos e Instalacoes Ltda / 57.145.714/0001-05), and Antonio Torres dos Santos 134 / Xavante in PDF. Both beneficiary pairs were verified in the real November and September PDFs. Do not persist the payer document.
- Cross-check email invoice number, due date, amount and bank line with original PDF. Reference comes from the email; the due month selects the child.
- Preserve payments, original PDFs, prior attachments, ETags, parent locks and SHA-256 deduplication. Missing child or link waits, shared/ambiguous parent requires review, paid amount mismatch requires review.
- One daily financial processing schedule at 07:00 America/Sao_Paulo, independent of the user's PC. No mobile application code changes.

## Review focus

- Reminder emails for one invoice: replay must not duplicate byte-identical files or apply another month; newer successful versions prevent stale overwrite.
- Body/PDF mismatch or different payer/property: no financial write.
- Multiple PDFs: every attached PDF must identify the same invoice or be rejected for review.
- Existing paid November pair: attach only if both totals already match; retain payment data.
- September invoice from screenshot: missing historical parent must wait rather than borrowing November's description.

### Task 1: Provider parser and exact monthly targets

Files: add `backend-patches/cemig-provision-email/petranet.py` and `test_petranet.py`; modify `cemig_sync.py` profile routing and supplier-aware reconciliation; extend `test_flow_definition.py`.

- [x] Write failing tests for matching email/PDF, invoice/customer/address/date/value/bank-line mismatch, multiple documents, multi-month/cross-provider scope, paid matches, missing/shared parent and supersession isolation.
- [x] Run unittest discovery and observe the new failures.
- [x] Implement `petranet.parse_email(body)` and `petranet.validate_pdf(text, details)` and route the Petranet profile to `Bill` and the existing `reconcile` path. Preserve existing Cemig defaults and file names.
- [x] Add `provider='cemig'` to the flow builder and publisher, with separate state keys for Petranet event/replay. Test exact sender/subject and durable secure envelope without modifying Cemig filters.
- [x] Run all tests on Windows and OCI Python 3.9, and independent review. Resolve significant findings with regression tests.

### Task 2: Production deployment and publication

- [x] Snapshot the existing recurrence 4, 14, 33 targets and attachment names/ETags, and back up deployed code/cloud definitions.
- [x] Deploy tested parser/core/builder/tests; publish only the Petranet event subscription; ingest the latest November email and screenshot's September email with a temporary recovery flow.
- [x] Dry-run exact queued entries; apply only confirmed monthly pairs. Verify original hashes on both targets, payment fields unchanged and all unrelated targets unchanged. Replay must plan zero writes. Delete temporary recovery flow.
- [ ] Confirm one active daily timer at 07:00 and both provider event flows Started. Publish through PR, green Windows/Linux checks and merge; record evidence and actual pending cases.

Execution choices: The user has explicitly opted out of approval questions. Reuse the clean existing isolated linked worktree on branch `codex/petranet-monthly-provisions` from main; baseline 42 tests pass. The screenshot is September 2026, while the latest existing email is November 2026. No artificial financial records will be created to demonstrate completion.

Verification ledger: 57 tests pass locally on Windows and on production OCI Python 3.9. Independent review and beneficiary follow-up found no significant issues, and compared Cemig event/replay definitions byte-for-byte with the base. A real PDF exposed a receipt-heading bank-code ambiguity; its failing regression is now green. The September legacy beneficiary and rejection of mixed beneficiary documents also have RED-to-GREEN coverage.

Live outcome: queue 4 DONE, November child 329 / parent 16, added one original PDF to each, zero amount updates, original SHA-256 4a9822d67df74c6df7807351f0ed1f64c128b7d433ac05d4c8e733193962b632 confirmed once on each. Replay plans zero uploads/updates. Queue 5 WAITING for September child 283's missing description. Of 26 financial targets, only 329/16 attachment collections changed; no financial business fields changed anywhere. Petranet event 46b42242-29d4-4a01-8d94-d25426ba032b Started; Cemig flow still Started with unchanged definition. Temporary recovery flow deleted. CI/source merge remains the final publication gate.
