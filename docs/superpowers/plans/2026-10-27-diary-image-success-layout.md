# Diary Image Success Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Show confirmed diary-image additions in the existing new success layout.

**Architecture:** Recognize diary-images narrowly in postingCompletion(message), then reuse the diary branded markup and chat sender integration. Existing CSS and upload behavior stay in use.

**Tech Stack:** JavaScript ESM, shared DOM/CSS, JSDOM/Vite/Chrome; no dependencies.

**Spec:** docs/superpowers/specs/2026-10-27-diary-image-success-layout-design.md

## Global Constraints

Preserve all14 signature blocks; no real posting or attachment mutation. Preserve source text/time/ID and safe notes. Test320/390/1024/1365px with fictitious data. Publish one revision to web/Windows, Play internal and TestFlight internal. User has already authorized implementation and publication without further approval.

## Review Focus

- Screenshot literal message and markdown/ASCII database variants must render.
- Partial/warning/negative notices and unknown addition operations must not claim success.
- Exactly one valid diary ID, including large literal IDs, must remain visible.
- Source metadata, ancillary notes and existing receipt kinds must be preserved.
- Narrow cards must not clip IDs, titles or sender/mascot.

### Task1: Integrate and publish diary-image receipts

**Files:** Modify apps/energetico-mobile/src/chat/posting-completion.js, src/ui/posting-completion.js and src/ui/chat-view.js. Extend tests/construction-diary-creation-receipt.test.mjs, tests/fixtures/posting-completion.html and tests/posting-completion-layout.test.mjs under the same app.

**Interfaces:** Consume postingCompletion(message), postingCompletionMarkup(receipt,notesMarkup,sender) and renderChatMarkup(state). Produce kind diary-images with existing {title,database,time,records,notes}.

- [x] Add integration cases using the screenshot-shaped notice, source22:36/ID228 and branded receipt. Observe expected RED. Cover partial/malformed/unrelated/negative results and immutability.
- [x] Implement narrow recognition and existing diary rendering, with accurate added-images subtitle; run existing receipt suites GREEN.
- [x] Extend the browser fixture sample and layout expectations; inspect320/390/1024/1365px, no overflow or extra mutation controls.
- [ ] Run guard14, relevant builds/checks and project suites; obtain one fresh whole-branch review, fix material findings with regressions.
- [ ] Commit/push/PR/merge. Wait for exact-source CI and verify published public assets/open app, Google Play internal receipt and processed TestFlight build attached to internal group.
