# RHID calendar irregularities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display a small red irregular-presence count below calendar dates, after administrator corrections.
**Architecture:** Extend the authenticated paginated monthly snapshot with slim attendance rows and latest SharePoint adjustments. Reuse the app's effective-slot classifier; count each person/day once, only when presence exists and one of four slots is missing. Keep absence colors unchanged.
**Tech Stack:** Python bridge, SharePoint, JavaScript, CSS, Node tests, Chromium.
**Spec:** User request and screenshot in current conversation.

## Global Constraints

Do not alter signature gesture protected blocks. Preserve administrator audit records and RHID source rows. Deploy web, Android internal and TestFlight using the same validated revision.

## Review Focus

Repaired raw duplicate punches must not cause a warning. Absence must not count as incomplete presence. Group duplicate daily records by stable person ID. Reject out-of-month records. Clear stale counts on month navigation/error and ignore stale responses.

### Task 1: Effective monthly snapshot and calendar warning

**Files:** `backend-patches/rhid-calendar-irregularities/`, `apps/energetico-mobile/src/chat/rhid-attendance-table.js`, `src/app-controller.js`, `src/ui/chat-view.js`, `src/styles.css`, and corresponding tests.
**Interfaces:** Backend `attendanceMonth.rows` includes date, identity, raw punches and slim latest `ADMIN_AJUSTES`; `rhidIrregularCountsByDate(rows, month)` produces date-to-person-count; view consumes `irregularCounts`.

- [x] Add failing helper, monthly controller, view and backend snapshot tests; verify RED.
- [x] Implement paginated monthly overlay and effective-slot counts, then red calendar labels. Verify GREEN.
- [x] Run complete tests, signature guard, web/PWA builds, mobile/desktop layout verification and fresh read-only review.
- [ ] Deploy backend with hash-checked backup/rollback, create PR, merge and verify all publication channels and live web assets.
