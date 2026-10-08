# Supplier payroll reference layout implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Match the user's second reference image in the existing payroll-by-supplier report, replacing pink rows with alternating light blue and white and retaining shared centered report arrows.

**Architecture:** Extend the read-only existing snapshot with supplier profession, keep canonical month/ID grouping and verified launch financial values. The view uses the existing asynchronous payment reader for totals/counts, bounded background loading and retryable errors. Shared navigation and PDF services remain unchanged.

**Tech Stack:** ES modules, native details/summary, CSS, decimal.js, jsdom, existing headless layout tests.

**Spec:** In-chat design: compact logo/print/refresh/month/supplier/profession header; supplier initials, name/profession, IDs/count, total paid/payment count; expandable existing payment columns; blue/white striping; common arrow vertical center. Standing user instruction waives repeated design/plan approval pauses and authorizes tested releases.

## Global constraints

- No edits to protected signature blocks, no new libraries, no financial writes.
- Current São Paulo reference month defaults; unknown totals never become zero.
- Keep close, auth/cancellation, searchable filters and filtered PDF/return behavior.
- Blue #d2e4f2 and white #ffffff alternate supplier rows and payment rows.
- Publish exact merged SHA to Pages/Windows PWA, Play internal and TestFlight, not production/review.

## Review focus

- Duplicate supplier names/professions must not produce guessed identity or totals.
- Filter/close/refresh cancellation must prevent late summary updates.
- Pending/failed/unknown totals must be explicitly identified, never partial zero.
- Background summaries and printing must reuse/deduplicate loading and preserve accordion states.
- Long supplier labels, multiple IDs and both arrows must fit horizontal phone/tablet/desktop without overlapping controls.

### Task 1: Data/model profession contract (parallel sidecar)

Files: supplier-payroll-report-data.js/model.js and their corresponding tests.
Consumes: FORNECEDORES CADASTRO/FORNECEDOR and PROFISSAO, existing IDFOLHA and FOLHAPGTO schemas.
Produces: snapshot.sheets[].profession string, overview.groups[].profession string and overview.professions string[], profession filter argument (blank = all). Keep existing amount source untouched.

- [x] Add/run RED tests for real repository response normalization and profession filtering.
- [x] Implement exact case-insensitive supplier join with no inferred accents/IDs; strict ambiguous schema; blank profession displayed as not informed.
- [x] Run data/model tests GREEN including pagination/cancellation and unchanged financial truth.

### Task 2: Reference renderer and style (main critical path)

Files: supplier-payroll-report-view.js/css; view tests; new supplier payroll layout fixture/browser test.
Consumes: Task 1 interface, existing loadPaymentsForPayrollIds(ids,{signal}) rows, summarizePayrollPayments(rows).
Produces: compact filter header, read-only supplier summaries and alternating rows, shared midpoint arrows.

- [x] Add/run RED tests for summary totals/counts before expansion, profession, filter changes, print cancellation and real rendered geometry/colors.
- [x] Implement logo header, three filters, supplier avatar/ID/financial sections, async bounded totals and retry; preserve native details and print state.
- [x] Remove the oversized brand/title/banner and unilateral left margin; give both arrows symmetric reserved space and same common position.
- [x] Run focused/browser GREEN; full app/root suites, native/PWA builds, signature guard and secrets scanner.

### Task 3: Review and publication (main)

- [x] Fresh whole-change review, repair consequential findings with RED→GREEN tests.
- [ ] Explicit stage/commit/push/PR; require all pinned CI green then merge authorized revision.
- [ ] Verify Pages, Play internal and TestFlight exact SHA publication; actual live report screenshot and expansion/filter proof.
