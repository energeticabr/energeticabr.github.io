# Work Diary Creation Receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the existing branded success layout to visit and diary-creation confirmations.

**Architecture:** Extend the read-only notice parser with narrowly validated construction-visit and diary-creation kinds. Reuse the diary branded markup/CSS and sender integration; keep titles/time/IDs from the source. Do not change posting behavior.

**Tech Stack:** Existing JavaScript ESM, DOM renderer, CSS, JSDOM/Vite browser tests; no dependencies.

**Spec:** docs/superpowers/specs/2026-10-25-work-diary-creation-receipt-design.md

## Global Constraints

- Preserve all14 signature-protected blocks; no financial/backend/schema writes.
- Reuse existing success layout, literal source IDs/time and escaped notes.
- Validate320/390px and tablet/Windows with fictitious data only.
- Publish the same revision to web/Windows, Google Play internal and TestFlight only.

## Review Focus

- Recognition must not turn unknown pointed operations or partial notices green.
- All3 visit records must be present exactly once, with no invalid/list IDs.
- Direct diary creation must keep its source title, not claim a filled diary.
- Message metadata, attachments, ancillary notes and large IDs must remain intact.
- Existing diary filling, settlement and other posting receipts must not regress.

### Task1: Recognize, render and publish diary-creation receipts

**Files:** Modify src/chat/posting-completion.js, src/ui/posting-completion.js and src/ui/chat-view.js under apps/energetico-mobile. Reuse src/ui/posting-completion.css unchanged. Add tests/construction-diary-creation-receipt.test.mjs; extend tests/fixtures/posting-completion.html and tests/posting-completion-layout.test.mjs. Add an isolated narrow-width preview fixture only if required for visual checks.

**Interfaces:** Consumes postingCompletion(message) and postingCompletionMarkup(receipt,notesMarkup,sender). Produces kinds construction-visit and diary-creation with existing {title,database,time,records,notes}; integrates with renderChatMarkup/createChatView. No new public APIs.

- [x] Add literal-message integration tests asserting the branded sender/banner,23:02 time and IDs7001/801/901 for a visit, and source-title diary creation. Observe RED before product edits.
- [x] Cover missing/duplicate/unrelated IDs, invalid time/database, zero/malformed IDs, unknown pointed subjects, partial/negative clauses, escaped notes, frozen metadata and non-text/user messages; retain existing filled-diary behavior.
- [x] Implement the narrow recognition/validation and shared diary rendering. Run new and147 existing receipt tests GREEN.
- [x] Extend the fictitious fixture and browser checks at320/390/1024/1365px, asserting every ID, sender/mascot geometry, legibility and no overflow. Visually inspect mobile/Windows without real postings.
- [ ] Run focused and full suites, native/PWA builds, iOS/secrets checks and guard14; obtain one independent whole-branch review and address Important/Critical findings with RED/GREEN regressions.
- [ ] Commit/push/PR/merge after verification. Verify actual Pages deployment, Play internal publish and processed internal TestFlight association for the same revision; open the published app without creating real records.
