# RHID monthly attendance implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Generate a monthly RHID attendance report for one active contractor selected from FORNECEDORES.CADASTRO.

**Architecture:** Reuse the VM monthly RHID snapshot, grouping records by day before using the existing effective attendance calculation. Add a read-only supplier loader and a focused modal report, preserving the existing daily calendar behind it.

**Tech Stack:** JavaScript, Graph read-only repository, existing RHID VM API, DOM, node:test/JSDOM and Chrome layout tests.

**Spec:** User request in this conversation: replace the daily calendar instruction with GERAR RELATÓRIO MENSAL; ask supplier, month and year; only EMPREITEIRO=SIM and STATUS=ATIVO.

## Global constraints

- Preserve all SIGNATURE_GESTURE_LOCK blocks; run the guard before editing and publishing.
- No SharePoint writes or automatic document submission; keep daily reports unchanged.
- Publish web/Windows, Android and iOS, with live verification.

## Review focus

- Names shared by different RHID people must not combine their attendance.
- Missing or incomplete monthly rows must not look like a completed empty report.
- Account change, close, cancellation and navigation must prevent stale rendering.
- Tablet and phone must retain readable month/year inputs and daily data.
- Administrative corrections and incomplete punches must remain visible, not fabricated as absence.

### Task 1: Read-only data and monthly calculation

**Files:** Create src/chat/rhid-monthly-data.js and src/chat/rhid-monthly-model.js in apps/energetico-mobile; tests/rhid-monthly-data.test.mjs and tests/rhid-monthly-model.test.mjs.

**Interfaces:** createRhidMonthlyData({tokenProvider,repository}).loadSuppliers({signal}) returns [{id,name}]. buildRhidMonthlyReport({month,supplier,snapshot}) returns {month,supplier,days,total,recordedDays,incompleteDays}; days have date, slots, total, adjusted, issues, recorded.

- [ ] Write tests for strict eligible choices and pagination/metadata, independent daily totals, effective adjustments, leap years and ambiguous identities.
- [ ] Run tests RED, then implement and run GREEN.
- [ ] Commit the data/model and their tests.

### Task 2: Monthly selection, report and controller entry

**Files:** Create src/ui/rhid-monthly-report-view.js, tests/rhid-monthly-view.test.mjs, tests/rhid-monthly-controller.test.mjs; modify src/app-controller.js, src/ui/chat-view.js and src/theme.css.

**Interfaces:** createRhidMonthlyReportView({document,data,onClose,now}).open({month}); data.loadSuppliers({signal}) and data.loadMonth(month,{signal}); view.close/destroy own DOM and abort requests. Controller factories allow external network replacement in tests.

- [ ] Test new calendar button, supplier/month/year selection, selected-period generation, error/cancel states and controller account/session cancellation before implementation.
- [ ] Implement modal and small controller hooks; revalidate eligible supplier on generation.
- [ ] Keep the daily calendar state and focus on return; reject stale responses and use read-only tokens.
- [ ] Run focused regression tests GREEN and commit.

### Task 3: Verify, review and publish

**Files:** Add responsive browser fixture/test under tests; no unrelated changes.

- [ ] Browser-check 390px phone, 1024px tablet and desktop; no page overflow and readable controls/report.
- [ ] Run pnpm test, pnpm guard:signature-gestures and pnpm build.
- [ ] Fresh independent whole-branch review; fix important findings with failing regression tests.
- [ ] Create PR, attach it, verify CI, merge and confirm web, Google Play internal and TestFlight publication.
- [ ] Open the live app and verify the monthly button/selection/report; report only verified outcomes.
