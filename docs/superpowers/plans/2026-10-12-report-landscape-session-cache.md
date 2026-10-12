# Report landscape session cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Open existing landscape reports immediately and reuse complete data within a single authenticated session.

**Architecture:** A report-local landscape viewport owns geometry only. Controller-owned snapshot cache decorates read-only data sources and observes refresh, authenticated-session transitions and successful/possibly-partial mutations. The two implementations have disjoint file ownership and run in parallel under dispatching-parallel-agents; final integration and fresh review are required. User instructs execution and publication without further approval.

**Tech Stack:** JavaScript ESM, DOM/CSS, node:test/jsdom, existing Graph client, Vite/Capacitor.

**Spec:** docs/superpowers/specs/2026-10-12-report-landscape-session-cache.md

## Global Constraints

- Rotate only landscape-gated reports; do not modify protected signature gesture blocks or portrait-friendly monthly RHID.
- Complete successful snapshots only, memory only, strict session/account separation; no TTL re-fetch or persistent storage.
- Explicit refresh and mutations invalidate; cancellation/stale completion never cache.
- Preserve ledger 200-item scrolling, filters and complete PDF.
- Publish web/Windows, Android internal and iOS TestFlight after verification.

## Review Focus

1. A slow request during rotation retains its signal and completes once.
2. A report-local expanded searchable picker fits the logical landscape viewport.
3. PDF column measurement ignores the screen's 90-degree transform.
4. A response completing after logout/invalidation cannot become a current cached snapshot.
5. Editing a different report/gallery and returning must not reuse stale financial data.

### Task 1: Landscape surface (main agent)

**Files:** Create src/ui/report-landscape.js and tests/report-landscape.test.mjs; modify landscape-gated src/ui/*-view.js, searchable-filter-selects.js, report-print.js and existing orientation tests.

**Interfaces:** Produces bindReportLandscape(root): {update(), destroy()} and reportLayoutViewport(element)/reportLayoutRect(element) for logical geometry. Does not own data cache or controller.

- [x] Write portrait-open/rotation-pending/picker/PDF geometry tests and watch them fail against the existing warning/unload behavior.
- [x] Implement report-local CSS/geometry and remove data-changing orientation branches in every gated view.
- [x] Run all affected view tests. Expected: portrait opens data, resize never increases reads or aborts.
- [ ] Commit only owned files after focused tests and gesture guard.

### Task 2: Session snapshot cache (parallel worker)

**Files:** Create focused cache/mutation modules and tests; modify src/app-controller.js and ../../portal/data/graph-client.js only as needed. Do not edit view files.

**Interfaces:** Consumes unchanged view data load signatures and existing controller guards. Produces controller-scoped cached sources reused after report recreation, with refresh invalidation wired via the existing decorator/refresh controls. No dependency on Task 1.

- [x] Write tests for cache hits after recreation, argument separation, refresh, failed/aborted reads, stale generation, logout/account change and mutation invalidation; run RED.
- [x] Implement memory-only cache at controller read-source boundary, maintain existing authorization guards on hits and late completions, invalidate on mutation and session lifecycle.
- [x] Run cache/controller/Graph tests. Expected: zero extra network reads on unchanged reopen and new reads after invalidation.
- [x] Return changed files and verification evidence for integration; do not merge/publish.

### Task 3: Integration and release (main agent)

**Files:** Existing browser fixtures/tests and release configuration only if required by established workflow.

**Interfaces:** Consumes Task 1 viewport and Task 2 unchanged view load signatures.

- [ ] Run full mobile suite, both builds, secret scan and 14-block gesture guard. Expected: no failures.
- [ ] Verify portrait, landscape rotation, picker, PDF and reopening in real browser; inspect request counts and unchanged content.
- [x] Request fresh review of full diff focused on the five risks above; fix significant findings with RED/GREEN tests.
- [ ] Create PR, attach it, merge pinned revision after CI, verify web and Android/iOS publication logs for exact merge revision.

## Review evidence

One fresh review identified concurrent payroll re-priming and reversed portrait safe-area mapping. Both were reproduced RED and fixed GREEN. The final focused suite passes 76 tests, including a three-reader cancellation regression and an actual Chromium portrait layout with asymmetric physical insets (top 59, bottom 34, left 11, right 23). All report controls and the expanded filter remain in that physical safe rectangle. Earlier migration suite: 31 orientation cases; browser suite: four report fixtures across phone, tablet and desktop. Session cache reuses snapshots across all 22 report factories and rejects stale account/session/mutation completions.
