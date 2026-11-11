# Sicoob Pix webhook implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Receive Sicoob Pix payment identifiers automatically, query the bank for receiver names, and verify delivery for payments made in the Sicoob app.

**Architecture:** A small loopback HTTP service receives notifications through the existing Caddy HTTPS host and commits IDs into a private SQLite inbox before acknowledgement. The existing locked collector queries those IDs through the bank API and uses its financial identity and uniqueness checks before filling missing receiver fields. Existing archived receipts remain a historical fallback only.

**Tech Stack:** Python standard library, SQLite, existing PowerShell mTLS reader, systemd, Caddy, SharePoint.

**Spec:** User request in this conversation: enable `pixpagamentos_webhook`, avoid depending on uploaded receipts, verify events from the Sicoob app.

## Global constraints

- Never initiate a payment for testing; verify the next user-originated payment.
- Preserve amounts, dates, original transaction IDs, existing names and attachments.
- Callback input supplies candidate IDs only; names must come from the authenticated bank API.
- No bank data or credentials in public responses/logs. Private durable state and random callback path.
- Retain retryable events and tolerate duplicates, reordered delivery, and events preceding the statement.
- Scope activation, callback registration, and real app-originated delivery are separate verification gates.

## Review focus

- Duplicate callback after processing must not create another update.
- A forged event or wrong recipient must never produce an unverified name.
- Missing/invalid payload and oversized requests must not enter the inbox.
- API failure or unavailable statement must preserve the event for a later run.
- Concurrent event reception and collection must not lose acknowledged events.

### Task 1: Durable authenticated inbox

Files: `backend-patches/sicoob-movements/pix_events.py`, `test_pix_events.py`.

- [x] Write failing tests for authenticated HTTP receipt, duplicate persistence, invalid/oversized payload, retry ordering and concurrent insertion.
- [x] Implement `Inbox(root)`, `accept(payload)`, `pending(limit=100)`, `attempted(ids)`, `complete(id, movement_id)`, and a bounded loopback HTTP server.
- [x] Run the tests and verify acknowledgement follows the SQLite commit.

### Task 2: Bank-confirmed enrichment

Files: `sync_pix_receivers.py`, `test_pix_receivers.py`.

- [x] Add tests for event-before-statement, name from API only, duplicate notification, conflicting identities and API failure retention.
- [x] Resolve inbox IDs before historical attachment lookup, using existing bank/account/date/amount/recipient checks and readback.
- [x] Keep collector statistics compatible with the existing scheduled/manual runner.
- [x] Run focused tests and independent review.

### Task 3: Enable and validate

Files: webhook service unit and deployment/registration tooling in the collector folder.

- [x] Deploy with existing service/collector locks, expected hashes, private state, backups, health checks and rollback.
- [x] Enable `pixpagamentos_webhook` through Portal Developers; preserve the active integration if a separate application is required.
- [x] Query the existing callback before registration; preserve unrelated registrations.
- [x] Register the verified HTTPS receiver and read it back using the bank API.
- [ ] Observe a real subsequent Pix made by the user through the Sicoob app; reconcile its ID and receiver through the API and read back the application record.
- [ ] Report each gate separately. Do not claim full automation until live delivery is observed.

## Evidence at 2026-11-11 18:25 UTC

- 46 focused tests passed on Windows and the OCI Linux service runtime.
- Independent review blockers fixed: cross-batch ambiguity, historical fallback bypass,
  resumability, and compatibility with the existing worker result parser.
- Receiver installed and active. Scheduled collection timer remains active.
- Existing backend health checks and public receiver health passed.
- A synthetic rejected notification returned HTTP 200 and left the inbox empty.
  This checks the transport only; it is not bank delivery evidence.
- Bank scope check still returns HTTP 400 `invalid_scope`; no callback registered.
- The active Developers application exposes only the Pix consultation scope and
  no editing control. New application flow requires a separate company login.
- Scope activation and real mobile-app delivery remain outstanding.

## Evidence at 2026-11-11 18:42 UTC

- Created `ENERGETICA - PIX NOTIFICACOES` with only consultation and webhook
  scopes, using the existing company public certificate in PEM format. The
  user approved it in Sicoob; Developers status is Active.
- Separate encrypted webhook client configuration preserves the existing
  statement integration. The new client obtains the requested OAuth scope.
- The bank returned HTTP 201 when creating the callback (the published schema
  lists 200). Added a regression covering 201 followed by exact URL readback.
- Gateway reads initially alternated valid responses and 401. Bounded retries
  of reads now tolerate this while still requiring exact configuration readback.
- Live registration result: `scope_granted=true`, `registered=true`,
  `verified=true`, `token_http=200`.
- Public receiver health is 200; receiver service and collection timer active.
- Inbox has zero events at 18:42 UTC. Real app-originated delivery remains
  unverified, pending a subsequent routine Pix from the user through Sicoob.
