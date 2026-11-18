# Proposal attachments implementation plan

> Execute inline with superpowers:executing-plans and test-driven-development. User explicitly opted out of approval questions.

**Goal:** Add a proposal-specific attachment bar after every invoice line, capturing shares while open and submitting files to PEDIDOS with the invoice attachments.

**Architecture:** The proposal owns a retained per-invoice tray. The report exposes a captured receiver to the controller before native inbox reads. Native pickers feed that same tray. Posting merges extra files with fiscal files, checks bytes and handles name collisions deterministically. A reservation records the additional manifest so interrupted sends cannot silently omit files.

**Constraints:** Preserve signature locks, fiscal unit behavior and all original invoice/DDA attachments. Publish Pages, internal Google Play and TestFlight. Do not send financial test records to live lists.

**Review focus:** Shares during loading/picking/submission; duplicate inbox imports; same-name different-content files; missing local files on retry; close/reopen/account changes.

### Task 1: Proposal attachment ownership and posting

- [x] Add failing posting tests for additional files, collisions, upload failure and reservation recovery.
- [x] Add failing view tests for tray placement, native sources, share capture and retained files.
- [x] Implement tray and controller routing, keeping native inbox files until confirmed posting.
- [x] Implement additional manifest and verified parent attachment upload without duplicating financial records.
- [x] Run focused proposal/report/controller tests, gesture guard and native/PWA builds.
- [ ] Review, commit, integrate and verify each release destination.

Pre-flight: view passes `additionalAttachments` as File[] in submit options; posting owns manifest naming and recovery. Controller captures a proposal receiver before awaiting the native inbox so routing cannot drift into the general tray.

Implementation detail: picked and received files are stored in account/invoice-scoped IndexedDB. Native iOS/Android share metadata records the destination; the iOS extension queues those bytes instead of using the general upload API. Pending files on already linked orders expose a dedicated attachment-only resume action. Financial records are never recreated by that path.

Independent review identified native iOS early upload, volatile ownership, competing-manifest loss, and in-flight read/reopen races. These were addressed with native destination metadata, durable file storage, fail-closed manifest verification after each conditional write, shared per-invoice import tracking and resumable attachment-only delivery. Preview returns to the proposal. Focused suite: 106 passed; real Chrome/IndexedDB checks: 320, 390, 844 and 1365 px passed. Native Swift execution is checked by macOS CI.
