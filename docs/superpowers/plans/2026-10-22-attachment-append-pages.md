# Attachment append pages implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for integration, with disjoint parallel component work. Steps use checkbox syntax.

**Goal:** Append selected/captured pages to a tray attachment and atomically replace it with a PDF.

**Architecture:** A focused browser PDF composer produces the complete replacement, preserving current-page order. A dedicated raw-PDF replacement operation on the existing upload route checks ownership, target identity, original SHA-256 and idempotency before one state-store commit. Preview UI and controller use a scoped callback, never the normal chat file-ingestion path.

**Tech Stack:** ES modules, pdf-lib, Node test/jsdom, Python bridge, existing deployment gate.

**Spec:** docs/superpowers/specs/2026-10-22-attachment-append-pages.md

## Global Constraints

- No protected signature gesture edits; run `pnpm guard:signature-gestures`.
- No unrelated canonical worktree changes or private backend bundle in Git.
- Maximum aggregate input/output 60 MB; maximum 200 PDF pages.
- Always PDF, original first, then additions in selection order.
- No silent loss on cancel, invalid input, stale target, upload failure or retry.
- Publish web/Windows, Google Play internal, TestFlight only.

## Review Focus

- Identical filenames and concurrent replacement must never overwrite the wrong file.
- A lost HTTP confirmation must not append the same pages twice.
- Filled forms, rotated photos and digital signatures must not silently disappear.
- Closing/logging out while selecting/merging must not send a stale result.
- The current conversational question and draft must survive replacement.

### Task 1: PDF composition

**Files:** create `apps/energetico-mobile/src/web/append-attachment-pdf.js`; test `apps/energetico-mobile/tests/append-attachment-pdf.test.mjs`.

**Interfaces:** `appendAttachmentPdf(originalBlob, originalName, additions, {signal,onProgress}={}) -> Promise<File>`; `isAppendableAttachment(blob,name) -> boolean`. Output application/pdf, .pdf name. Throws on unsupported/corrupt/encrypted/digitally signed files; original is never mutated. Preserve filled form appearance and EXIF orientation.

- [ ] Write real-PDF tests for original-first order, image conversion, multiple files, malformed input, cancellation, size/page limits, forms and signatures.
- [ ] Run `node --test tests/append-attachment-pdf.test.mjs`: expect RED before implementation.
- [ ] Implement bounded composition using pdf-lib and existing image orientation helpers; no silent skipping.
- [ ] Run focused tests: expect all PASS. Commit component.

### Task 2: Scoped preview action

**Files:** modify `src/web/attachment-preview.js`, `.css`; tests `tests/attachment-preview.test.mjs` (all under mobile app).

**Interfaces:** `open(source,name,{onAppendPages})`, callback `(mode,{blob,fileName,signal,onProgress}) -> Promise<{blob,fileName}|null>`, mode `files` or `camera`. A successful callback reloads the same preview; null means cancelled. Callback remains usable after replacement. No callback means no + action.

- [ ] RED tests for menu labels, callback modes, cancelled/failed append, duplicate click exclusion, stale preview isolation and no action in unrelated previews.
- [ ] Implement accessible header +/two choices, busy/error status, retain close/cancel, update PDF preview only after callback confirmation.
- [ ] Run `node --test tests/attachment-preview.test.mjs`: expect PASS. Verify 320/390 px. Commit component.

### Task 3: Atomic VM replacement and controller integration

**Files:** new `backend-patches/attachment-append-pages/` helper/patch/deployment/tests; modify `src/chat/chat-client.js`, `src/app-controller.js`; focused client/controller tests.

**Interfaces:** `client.replaceAttachment(id,file,{expectedSha256,requestId,onProgress,progressSignal})`. Existing upload URL with `operation=attachment_replace`, `attachment_id`, `expected_sha256`, `request_id` query parameters; regular auth/raw body headers. Response `{status:'processed',operation:'attachment_replaced',requestId,previousAttachmentId,replacement:{...snapshotEntry},attachments:[...]}`. Retry exact request returns same receipt, changed content/request collisions fail closed. Preserve existing attachment identity metadata where safe; reject read-only/special signing state.

- [ ] RED Python tests: single commit, original retained until commit, hash/owner/stale/read-only denial, malformed PDF denial, idempotent retry, save failure rollback, no question change.
- [ ] Implement bridge helper and route patch against verified live baseline; keep source/pins private until packaging.
- [ ] RED JS tests: replacement request contract and open-file callback selection/merge/replace without sendFile/sendText; cancel/stale/session guards and repeat append.
- [ ] Wire callback, composer, original hash and confirmed snapshot, scoped busy state and exact request retry.
- [ ] Run focused Python + Node tests: all PASS. Commit integration.

### Task 4: Verification and publication

- [ ] Run full mobile tests, guard, builds, iOS/secrets checks and backend regressions; inspect actual merged PDF pages with Poppler and a fictitious browser fixture.
- [ ] Request independent review, fix evidenced important findings RED/GREEN, rerun affected/full tests.
- [ ] Create PR, verify CI; deploy pinned VM operation with backup/gate and verify read-only health/receipts.
- [ ] Merge approved/tested branch, verify web artifacts, Android internal and TestFlight receipts; visibly open live app. Record evidence and hand off concise Portuguese result.
