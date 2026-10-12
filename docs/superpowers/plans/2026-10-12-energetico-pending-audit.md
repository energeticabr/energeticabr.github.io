# Energético: pending attendance and interrupted-request audit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Finish the pending attendance checklist and identify/finish genuinely missing earlier requests without repeating already-published data writes.

**Architecture:** Reuse the RH attendance selection UI and batch validation engine. Audit RHID/signatures, report layouts, and provision workflows in independent scopes; integrate only verified missing changes into the existing isolated branch.

**Tech Stack:** JavaScript, Node test runner/JSDOM, Python workflow engine, SharePoint, GitHub Actions, Capacitor.

**Spec:** User requests in this conversation: Pending attendance must match RH checkboxes/select-all/proceed; combine unfinished earlier requests and execute independently in parallel.

## Global constraints

- Publish relevant Android internal, iOS TestFlight, and Windows/web changes.
- Preserve real HR/financial records during QA; use in-memory fixtures and block HTTP for backend tests.
- Preserve the selected pending date, individual review, and AVALIAR OUTRA DATA.
- Only register historical provision parents once; do not repeat verified backfill/synchronization.
- Preserve all unrelated tracked/untracked work. Existing isolated worktree is reused.
- The user explicitly authorizes execution; do not pause for design approval.

## Review focus

- A date or poll change must discard stale checkbox selections.
- A lone selected ID must use existing individual review, not write immediately.
- Batch submission must require confirmation and reject IDs/dates/statuses outside the current list.
- Returning from a pending-origin batch must restore the same pending date.
- Capacity errors do not prove absence: verify current source, regression tests and publication evidence.

### Task 1: Pending attendance checklist and batch routing

**Files:** `apps/energetico-mobile/src/ui/chat-view.js`, its test; `artifacts/pending-attendance-checkboxes/worker.patch`, `test_pending_attendance_selection.py`.

**Interfaces:** Polls use `attendance_multi_select`; legacy pending accordion polls remain recognized by the pending record prefix. Proceed emits `attendance_batch:<comma-separated IDs>`; backend reuses the RH batch engine with `attendance_batch_origin=pending`.

- [x] Add UI regressions; observe missing checkbox failures; reuse shared renderer and native checkbox events.
- [x] Add backend regressions; observe unsupported batch/old presentation failures; implement routing and same-date return.
- [x] Verify busy/old polls, individual actions, select-all, batch confirmation, conflict protection and date return against real code with in-memory fixtures.
- [ ] Review, commit only scoped files, merge after CI, deploy only hash-guarded backend patch with backup/health checks.
- [ ] Verify published phone/Windows UI without submitting real attendance; confirm Android/iOS release logs.

### Task 2: Parallel earlier-request audit

**Files:** Existing RHID/PDF/signature modules and tests; report model/view modules and tests; historical provisioning artifacts and flow receipts. Main retains ownership of shared chat view and current backend workflow patch.

**Interfaces:** Each worker returns an evidence-backed completed/missing inventory and disjoint patches if a missing scoped requirement is proven.

- [x] Dispatch independent RHID/signature, report/layout, and provision/Power Automate evidence workers.
- [x] Collect results; distinguish published, implemented-but-unverified and genuinely missing requirements.
- [ ] For each missing requirement, add failing tests and implement a disjoint fix; never repeat historical cloud data updates blindly.
- [ ] Integrate, verify, review and publish changed platforms; report any actual remaining access/external blockers explicitly.
