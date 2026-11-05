# Cemig Xavante email integration

Goal: Populate the existing recurrence 33 payment provision and its linked description with every PDF from the matching monthly Cemig email, updating their total from the bill.

Architecture: An Outlook cloud trigger stores the original email and attachment bytes as a private SharePoint queue attachment. An OCI worker processes the durable queue every minute. This uses the existing Outlook and SharePoint connections, with no third-party paid API or workstation dependency. Direct Graph mail access was tested and returned 403; the Outlook connector is the authorized mail reader.

Scope and decisions: Only sender fatura@cemig.com.br, subject CEMIG FATURA ONLINE, Xavante address aliases 130/134 and consumer unit 13.170.665.018-99. Match existing provision IDRECORRENCIA=33 by its original DATA payment month against invoice due month; PDF reference month is retained as evidence. Never create financial records, change payment status, overwrite paid amounts, or alter recurrence dates. Missing child/parent is retried. Ambiguous matches, conflicting invoices or a paid amount mismatch are retained for review. All PDF originals stay encrypted and byte-identical; only the known corporate document prefix is used transiently to read them. Content hashes prevent duplicates, including files uploaded under another name. ETags and the existing parent attachment lock protect writes. Parent must have exactly this child; grouped parents go to review. Parent/child partial progress is safely retried from authoritative current values.

Review focus: month/year rollover; email before provision creation; duplicate email/files with changed names; concurrent payment or relinking; original paid record with matching or different total; partial upload or one-sided value update. Do not infer payment from receiving the bill.

## Task 1: Core matching and synchronization
- [x] Write tests for exact PDF validation, sender/address scope, due-month matching, missing links, duplicates, paid records, stale versions and interrupted copies. Observed missing implementation failure.
- [x] Implement backend-patches/cemig-provision-email/cemig_sync.py with parser, guarded reconciliation, SharePoint adapter and queue worker.
- [x] Run focused unit tests and the three real local PDF fixtures without writing historical amounts.

## Task 2: Cloud ingestion and deployment
- [x] Test flow builder structure before implementing it: event trigger, exact sender, account ownership, secure inputs/outputs, durable envelope and READY only after upload.
- [x] Implement flow builder, queue bootstrap and systemd timer. Use existing server credentials without exposing them.
- [x] Publish the cloud event flow and a temporary signed replay flow using the same ingestion actions. Replay the real October email to prove Outlook read and queue upload, without sending mail. Delete maintenance flows after verification.
- [x] Dry-run live provision/parent and compare source and destination hashes. Deployed worker added two missing originals to 326/13, preserved paid amount/status/date. Source and both destination SHA-256: f13c260edfe9c1d9e0602c6b469143660c030bedaef01579de26aecf4aea6b31.
- [ ] Verify timer and cloud flow state. The change is server/data only, consumed by the existing Android/iOS/Windows clients; no mobile package change is needed.

## Task 3: Review and finish
- [ ] Independent whole-change review, focused regression fixes, final tests, commit/publish source and record operational IDs and verification without secrets.

Ledger: The user explicitly requests autonomous execution, so design confirmation and worktree-consent questions are waived. The native worktree tool rejected an external source repository; an isolated Git worktree was created in this task workspace. Native attachment rejected the unmanaged checkout; all commands use its explicit path. No other checkout is edited.

Review fixes: Independent reviewer identified a payment-month race, stranded RECEIVING entries, and a committed-write/lost-response rollback defect. Each has a failing reproduction followed by a passing fix; suite now 30/30 on Windows and OCI Python 3.9. Aged RECEIVING envelopes retry after ten minutes; every financial target is revalidated under its parent lock; uncertain writes are reread before compensation.

Operational rulings: Server app cannot create SharePoint lists (403), so delegated SharePoint connector created the technical queue. Tenant authentication requested through this Flow API did not enable an OAuth policy; maintenance callbacks therefore use their signed URL only in memory and are deleted afterward. Production ingestion is solely an authenticated Outlook subscription, without an HTTP trigger. Initial root dry-run created a root-owned worker lock; corrected ownership on that exact lock before running the service under its dedicated account. No permissions were broadened.
