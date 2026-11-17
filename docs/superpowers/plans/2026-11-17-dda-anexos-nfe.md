# DDA e anexos da NF-e Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Execute without approval checkpoints as expressly requested by the user.

**Goal:** Attach each safely correlated DDA boleto to its fiscal item and carry every fiscal-item attachment into orders and provision descriptions.

**Architecture:** Preserve the server reconciler's unique matching rules and existing invoice-to-DDA copies; add deterministic, verified reverse copies. The mobile proposal data service downloads a complete attachment collection, and posting verifies every file before activating and linking financial records. Preserve financial reservation/retry semantics and existing PDF validation.

**Tech Stack:** JavaScript, Node test runner, SharePoint REST, Python, Power Automate, OCI/systemd, Vite/Capacitor.

**Spec:** User request and attached report screenshot. Existing order/provision parent records remain the attachment destinations.

## Global Constraints

- Preserve protected signature gesture blocks.
- Publish web/Windows PWA, Google Play internal and iOS TestFlight.
- Never overwrite conflicting attachments or duplicate financial records.
- Do not change matching or financial amounts, statuses or payment fields in server reconciliation.
- Transfer all fiscal-item attachments, including DDA and non-PDF documents; an unreadable file prevents completion.

## Review Focus

- Multiple installment DDAs must all reach the same fiscal item.
- A failed upload/readback must leave proposals resumable and unlinked.
- Existing conflicting bytes must remain untouched.
- Attachments arriving during posting must prevent incomplete completion; a retry includes new files.
- Already-linked financial records may acquire missing attachments without creating or modifying financial rows.

### Task 1: Server reverse synchronization

- [x] Retrieve current deployed worker and bridge definition; preserve bounded asynchronous requests and caches.
- [x] Add failing tests for reverse DDA transfer, conflict preservation, multiple installments and rerun idempotency.
- [x] Implement verified reverse writes, retaining existing matching revalidation.
- [x] Run tests, back up/deploy bridge and worker, execute backlog and verify fields and hashes. 36 tests passed; 23 PDFs on 18 fiscal records/22 DDAs verified; replay created zero attachments and exited successfully. Original timer cadence was verified live as 08:40, 13:40 and 18:40 BRT and preserved. Source and aggregate evidence: `backend-patches/dda-nfe-attachments/DEPLOYMENT-VERIFIED.md`.

### Task 2: Complete proposal attachments

**Files:** `apps/energetico-mobile/src/chat/nfe-proposal-data.js`, `nfe-proposal-posting.js`, `src/ui/nfe-proposal-view.js`, and focused proposal tests.

- [x] Add failing tests: order and provision copy DANFE, multiple DDA PDFs and non-PDF attachments; retry after upload failure; preserve conflicting destination; include attachments added on retry and reject mid-posting collection changes.
- [x] Download the complete source collection with validated names and readable nonempty bytes, preserving the original fiscal PDF check. Re-read collection before returning.
- [x] Generalize posting's verified attachment transfer, keep original PDF hash in reservations, and verify source collection again before linking. Allow existing linked parents to receive missing files.
- [x] Update review/submission text to say all attachments, including DDA.
- [x] Run focused tests, signature guard and native/PWA builds: 93 passed, 14 protected blocks intact, both builds succeeded.

### Task 3: Review and release

- [x] Fresh review of final application diff and verification evidence; fix material findings. Late-arriving attachments are rechecked after destination reads while retaining the fiscal ETag for conditional linking. Reviewer independently verified 38 posting tests.
- [ ] Commit, push, merge via PR; follow web, Android internal and TestFlight jobs for feature-containing revisions.
- [ ] Verify publication results and provide concise Portuguese outcome with any real pending cases.
