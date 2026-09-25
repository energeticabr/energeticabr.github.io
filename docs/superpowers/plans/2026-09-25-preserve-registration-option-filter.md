# Preserve Registration Choices While Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a poll's existing “CADASTRAR NOVO …” action visible while server-side filtering updates the matching records.

**Architecture:** Preserve registration actions from the current database-filter poll when a filter request returns another poll with the same filter key and prompt. Share the registration-action classifier with the existing local filter so both layers apply the same definition. Do not carry actions into a different poll or flow.

**Tech Stack:** JavaScript ES modules, Node.js test runner, existing mobile app test suite.

**Spec:** User request in this conversation: “Sempre mantenha a opção de CADASTRAR NOVO … mesmo quando o usuário realiza filtragem.”

## Global Constraints

- Keep signature gesture lock blocks unchanged; run `pnpm guard:signature-gestures` before mobile code edits.
- Scope retention to a filter response for the same database-filter key; do not alter normal poll transitions.
- Keep the implementation in shared mobile UI/controller code so web/PWA, Android, and iOS receive the same behavior.

## Review Focus

- A filter response with zero matches must still show the existing registration action.
- A response that already includes the registration action must not render duplicates.
- A response for a different poll/filter key must not inherit the old action.
- Manually submitted filters with more than two words must retain the action too.
- Ordinary choices must remain filtered as before.

---

### Task 1: Preserve registration action across filtered server responses

**Files:**
- Modify: `apps/energetico-mobile/src/chat/database-filter.js`
- Modify: `apps/energetico-mobile/src/ui/chat-view.js`
- Modify: `apps/energetico-mobile/src/app-controller.js`
- Test: `apps/energetico-mobile/tests/app-controller.test.mjs`
- Test: `apps/energetico-mobile/tests/chat-view.test.mjs`

**Interfaces:**
- `latestDatabaseFilter(messages)` remains the source of the active poll/filter key.
- Export one shared registration-action predicate and a helper to merge missing registration options into a same-key filtered response.

- [ ] Add an app-controller regression test where the initial poll contains “CADASTRAR NOVO FORNECEDOR” and the filtered response omits it; verify it remains in the resulting poll.
- [ ] Run that test and verify it fails because the action is missing.
- [ ] Implement shared registration-action recognition and merge it whenever a server response remains on the same database-filter key and prompt, including manually submitted longer queries.
- [ ] Extend coverage for zero-match and already-present actions, run focused tests, then run the full mobile suite and builds plus `pnpm guard:signature-gestures`.
- [ ] Review the diff, commit the implementation, and prepare it for normal PR/release verification.
