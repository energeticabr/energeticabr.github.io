# Invoice email daily search implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline and an independent final review.

**Goal:** Search email only once per day for Cemig recurrences 4/33 and Petranet recurrence 14, replacing arrival subscriptions.

**Architecture:** Reuse the two existing cloud flow IDs and their Outlook/SharePoint connections, replacing each notification trigger with a Day/1 recurrence at 06:45 E. South America Standard Time. Retain the existing OCI daily financial worker at 07:00 America/Sao_Paulo. Each daily search reads metadata using server-side Search Query, then downloads full original emails only when the durable queue lacks the envelope. Repair incomplete existing queue rows instead of creating duplicate technical records. Existing invoice parsing and exact-month financial reconciliation stay unchanged.

**Tech Stack:** Power Automate Recurrence, Outlook GetEmailsV3/GetEmailV2, SharePoint connector, Python definition builder, PowerShell publisher.

**Spec:** Latest user correction: every email search itself must occur once daily; prior queue processing alone was insufficient. The user authorizes execution without further questions.

## Global constraints

- No OnNewEmailV3 or minute polling triggers remain on these flows.
- One Day/1 search per provider; 06:45 capture gives the unchanged 07:00 worker time to receive PDFs.
- Search includes read and unread messages, exact sender, subject token and attachments, from 2026-11-04 onward to bridge the cutover. Full exact subject equality is enforced before storage. No sliding window may silently lose emails after an outage.
- Filter via Search Query rather than first-250-mail connector filters; metadata only until deduplication.
- Fail explicitly on mail/queue truncation. Preserve original envelopes and recover missing ones using existing row IDs.
- No changes to utility parsing, payment amounts/status, attachment fanout or mobile application code.

## Review focus

- Duplicate queue records or repaired RECEIVING/WAITING envelopes must not strand mail or cause duplicate uploads.
- Read emails must be eligible; existing complete emails must skip attachment retrieval.
- Daily trigger timezone/start and disabled notification subscriptions must be verified live.
- Returned limit/continuation tokens must stop rather than silently drop older mail.
- Sequential mail processing and trigger concurrency must prevent duplicate row creation during overlapping runs.

### Task 1: Daily capture definition and tests

Files: modify `backend-patches/cemig-provision-email/flow_definition.py`, `Publish-CemigFlows.ps1`, `test_flow_definition.py`, `test_petranet.py`, `README.md`.

- [x] Write failing tests for daily Day/1 trigger, both provider search queries/read handling, queue deduplication and incomplete repair, serialized execution, secure original payloads and overflow rejection.
- [x] Implement the scheduled wrapper and reusable original-envelope actions, retaining explicit manual single-message recovery only for maintenance.
- [x] Change publishing to update only production schedules; create temporary recovery flows only when explicitly requested.
- [x] Run all tests on Windows/OCI Python 3.9 and get independent review; address significant findings.

### Task 2: Deployment and source publication

- [x] Back up full definitions and stop both arrival subscriptions immediately.
- [x] Deploy definition/publisher; update the same two cloud flows and enable only the daily triggers.
- [x] Verify actual connector batch/dedup path once, without financial writes, then remove temporary verification ingress. Check queue/financial integrity and active 07:00 OCI timer.
- [ ] Publish through PR and green checks, merge and verify only daily triggers remain Started.

Baseline: clean existing isolated worktree, branch `codex/invoice-email-daily-search` from main. The previous production flows were Started with OnNewEmailV3; both are now Stopped while being replaced. Five queue rows already preserve all previously captured originals and pending cases.

Verification ledger: 60 tests pass on Windows and deployed OCI Python 3.9. Independent initial/follow-up review found no significant issues. Live connector validation exposed its automatic quoting of the entire search query; nested subject phrase quotes produced HTTP 400 before any writes. A failing quote regression now passes using an unquoted subject token with full exact-subject validation retained in both create and repair paths.

Both original production flow IDs are now Started with only Recurrence Day/1 at 06:45 Brasilia. Successful live runs: Cemig 08584077556577219902716660476CU29 and Petranet 08584077556573278055310055671CU04. Search, queue read, loop and dedup succeeded; full email reads, recovery, queue creation and envelope uploads were skipped for existing complete mail. No temporary verification ingress was created. The five queue rows and DONE/WAITING states are unchanged. The existing OCI timer remains enabled/active at 07:00 Brasilia. Source PR/CI/merge is the final publication gate.
