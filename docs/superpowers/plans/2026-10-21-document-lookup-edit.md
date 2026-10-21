# Document selector repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow browsing, clearing and searching editable gallery fields without weakening validation.

**Architecture:** Fix the shared searchable select and dynamic form, rather than special-case TIPODOCUMENTO. Retain explicit read-only controls and remotely validated choices.

**Tech Stack:** JavaScript, Node test runner, JSDOM, Chrome, Vite/Capacitor.

**Spec:** docs/superpowers/specs/2026-10-21-document-lookup-edit.md

## Global Constraints

- Do not modify the 14 signature gesture locks or user changes in other worktrees.
- Preserve required-field checks, closed-option validation and explicit read-only locks.
- No persisted document changes during QA.
- Publish verified web/Windows, Android internal and iOS TestFlight builds.

## Review Focus

- Slow remote responses must not restore a cleared selection or overwrite typed search.
- Blur, Escape and selection must not reopen a picker after a late response.
- Search beyond the visible batch must call the provider, not filter only local options.
- Failed reads must retain the existing selection; parent changes must revoke dependent selections.
- Optional blank fields must save blank; required and read-only fields must remain protected.

### Task 1: Shared selector repair

**Files:** portal/forms/searchable-select.js, portal/ui/dynamic-form.js, tests/searchable-select.test.mjs, tests/dynamic-form-searchable-select.test.mjs, apps/energetico-mobile/tests/gallery-record-actions.test.mjs; browser fixture/test as needed.

**Interfaces:** createSearchableSelect(root, config) adds opt-in clearable and setOptions(options, {preserveInput}) behavior; dynamic forms use searchable edit controls and request browse on open, bounded term search on input.

- [ ] Write regressions: document fields accept typing and clearing, open all remote alternatives, select a remote-only result, reject arbitrary text, preserve selection on errors and ignore stale responses after dismissing/changing query.
- [ ] Run focused tests; observe failures against current source.
- [ ] Implement minimal shared changes and update superseded edit-only expectations.
- [ ] Run focused suites, full suites, signature guard, native config/security checks and build; verify phone and desktop browser UI without saving real records.
- [ ] Commit, obtain fresh review, address important findings with RED/GREEN tests, then PR/merge and verify all three publications for the merged revision.
