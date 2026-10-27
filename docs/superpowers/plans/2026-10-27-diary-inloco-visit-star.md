# Diary IN LOCO visit star Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. One fresh whole-branch reviewer follows implementation.

**Goal:** Mark IN LOCO with a star before its construction emoji only for a confirmed field visit on the selected diary date and branch.

**Architecture:** Extend the existing read-only diary visit decorator to the diary type question. Resolve the selected diary from activeFlow rows, retain cancellation/session guards, and add presentation only at the view boundary.

**Tech Stack:** JavaScript, Node test, JSDOM, Vite and existing SharePoint repository.

**Spec:** docs/superpowers/specs/2026-10-27-diary-inloco-visit-star-design.md

## Global Constraints

- Render `1 - ⭐ 🏗️ IN LOCO` only with a confirmed visit.
- Preserve original choice IDs/labels/payloads, draft, attachments and all 14 gesture blocks.
- No SharePoint/VM writes or additional permissions for the indicator.
- Deliver web/Windows, Android internal and iOS TestFlight with explicit receipts.

## Review Focus

- Direct conversation resume on the type question still resolves the selected diary.
- Selected ID changes while the poll object stays the same invalidate the old query.
- Failed, incomplete or late lookups do not produce a star.
- REMOTO and abandon never receive the visit decoration.
- Tapping the decorated button sends exactly its original label and reply.

### Task 1: Selected-diary visit indicator

**Files:** Modify src/chat/diary-field-visit-options.js, src/app-controller.js and src/ui/chat-view.js under apps/energetico-mobile. Extend tests/diary-field-visit-controller.test.mjs and tests/chat-view.test.mjs there.

**Interfaces:** Reuse createDiaryFieldVisitData().load({diaryIds, signal}) and presentation-only option.diaryFieldVisit. Add selectedDiaryTypeVisitId(poll, activeFlow) -> string and isInLocoDiaryOption(option) -> boolean to the option helper.

- [ ] Add failing controller cases for direct resume, absent/failed lookup and selected-ID changes with late replies.
- [ ] Add failing view cases for star order, no remote/abandon decoration, invalid contexts and unchanged tap payload.
- [ ] Run focused tests and confirm the expected missing-indicator failures.
- [ ] Add conservative selected-ID/type recognition; bind the lookup context to flow context and selected IDs; decorate only IN LOCO.
- [ ] Render one accessible star after the numeric prefix, keeping the original choice payload.
- [ ] Run the focused data/controller/view suites and existing diary browser checks; inspect 320/390 px and desktop previews.
- [ ] Run signature guard, builds, full suite and one fresh branch review. Fix material findings with focused regressions.
- [ ] Commit, create PR, merge through required checks, and independently verify all published targets.
