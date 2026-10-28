# Provision Settlement Launch Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Present the launch-choice summary in provision settlement as a compact table.

**Architecture:** A read-only renderer recognizes the complete legacy poll, escapes every received value, and returns semantic table markup. Chat integration preserves existing choices, warnings and fallback text. Reuse provision review styles with a compact variant.

**Tech Stack:** JavaScript ESM, existing CSS, JSDOM/Vite/browser tests; no new dependency.

**Spec:** docs/superpowers/specs/2026-10-28-provision-settlement-launch-summary-design.md

## Global Constraints

Preserve all14 signature blocks and financial/attachment mutations. Do not infer unit prices. Keep source replies, warnings, literal IDs and amounts; exact cents for display total. User authorized implementation and publishing without confirmation. Targets: web/Windows, Google Play internal and internal TestFlight.

## Review Focus

- Screenshot-shaped single row and multiple rows with decimal quantities and product punctuation.
- Missing/invalid amounts or duplicate IDs retain complete original text.
- Notices and alternative order explanations are never omitted or rewritten.
- Hostile product text remains escaped and cannot create DOM elements.
- Historical polls, disabled options and busy state preserve reply behavior; narrow layout keeps totals/buttons accessible.

### Task1: Render and publish the visual summary

**Files:** Create src/ui/provision-settlement-launch-summary.js and tests/provision-settlement-launch-summary.test.mjs under apps/energetico-mobile. Modify src/ui/chat-view.js and src/ui/provision-settlement-review.css. Add a fictitious browser fixture and layout tests.

**Interfaces:** Consume poll question/prompt and options; produce provisionSettlementLaunchSummaryMarkup(message), returning empty string on unrecognized input. Chat hides original question only when markup is complete. Choices are rendered by the existing chat logic.

- [x] Add JSDOM integration tests for screenshot-shaped summary, totals, notices, escaping, malformed fallback and unchanged replies; run and observe expected RED.
- [x] Implement the narrow renderer and integration; run focused review/chat tests GREEN.
- [x] Add browser fixture, verify320/390/1024/1365px and inspect screenshots.
- [ ] Run guard14, applicable checks/build and project suite; obtain one fresh whole-branch review and fix material findings with regressions.
- [ ] Commit/push/PR/merge and verify explicit CI plus published web/Windows assets, internal Google Play receipt and processed TestFlight build attached to internal group.
