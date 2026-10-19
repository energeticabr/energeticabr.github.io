# Payroll History and Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Correct combined payroll totals, show immutable weekly paid history, and deliver row attachments to linked financial records.

**Architecture:** Extend the existing breakdown data context with canonical paid lines. A pure model groups Monday–Sunday history; an isolated attachment service resolves and verifies existing destinations. Keep financial creation separate from historical attachment-only submissions.

**Tech Stack:** JavaScript modules, Decimal.js, SharePoint repository, node:test/JSDOM, existing Python settlement runtime if needed.

**Spec:** docs/superpowers/specs/2026-10-19-payroll-history-attachments-design.md

## Global Constraints

- Same IDFOLHA and supplier; no financial writes for paid history.
- Monday–Sunday grouping, unique assignment across month-end; paid plus new totals.
- No fake financial records; missing/ambiguous links fail visibly.
- File collision protection, byte verification, same-operation recovery.
- Keep all 14 signature lock blocks intact; publish existing internal/beta channels.

## Review Focus

- Multiple prices in one rubric must not become a fabricated unit price.
- A Sunday payment and next Monday belong to different weeks.
- A month-end shared with a Friday must not duplicate paid totals.
- Lost upload response or changed financial links must not overwrite or leak files.
- Restart without File bytes must require reselection rather than lose attachments.

### Task 1: Weekly history and combined totals

**Files:** Create src/chat/payroll-breakdown-history.js; modify src/chat/payroll-breakdown-data.js, src/ui/payroll-breakdown-view.js, src/ui/payroll-breakdown.css; tests/payroll-breakdown-history.test.mjs, tests/payroll-breakdown-data.test.mjs, tests/payroll-breakdown-view.test.mjs (paths under apps/energetico-mobile).

**Interfaces:** loadPayrollContext(supplier, month) retains sheetId/paid/paidTotal and adds payments: [{id,date,rubric,quantity,unitValue,total,provisionId,launchId}]. payrollBreakdownPeriods(month,payments,today) returns dated periods with weekStart/weekEnd/past/payments; payrollCombinedTotal(forecast,paid) sums exact cents.

- [ ] Write failing tests: paid 3883.61 + forecast 0 => header 3883.61; forecast 100 =>3983.61; Sunday18/Monday19 separate; Oct30/31 paid appears once; distinct unit prices remain distinct rows.
- [ ] Run node --test tests/payroll-breakdown-history.test.mjs tests/payroll-breakdown-data.test.mjs tests/payroll-breakdown-view.test.mjs; observe expected failures.
- [ ] Implement canonical context and pure grouping, read-only gray historical cards, combined date and grand totals. Preserve future editable lines and existing submission semantics.
- [ ] Re-run task tests; expect all pass. Commit tested task.

### Task 2: Verified attachment service

**Files:** Create src/chat/payroll-breakdown-attachments.js and tests/payroll-breakdown-attachments.test.mjs; modify src/chat/payroll-breakdown-data.js and tests/payroll-breakdown-data.test.mjs.

**Interfaces:** createPayrollBreakdownAttachments({repository,assertSession}) exposes prepareFiles(files), submit({supplier,sheetId,paymentId,files,progress,onProgress}). Resolve targets from fresh FOLHAPGTO + provision/launch/order links, not caller IDs. New post calls this after confirming the line IDs; manifest is separate from financial signature.

- [ ] Write tests for historical salary three-target delivery, pending provision delivery, cross-sheet/supplier rejection, same-name different-bytes refusal, lost-response idempotent retry and missing target visibility; observe RED.
- [ ] Implement transport authorization, safe target resolution, preflight file validation and content-verified upload recovery; do not update payment amounts or create financial records in attachment-only path.
- [ ] Run node --test tests/payroll-breakdown-attachments.test.mjs tests/payroll-breakdown-data.test.mjs tests/payroll-provision-integration.test.mjs; expect all pass. Commit.

### Task 3: Row UI, recovery and propagation integration

**Files:** Modify src/ui/payroll-breakdown-view.js, src/ui/payroll-breakdown.css, payroll breakdown tests/fixture; backend reviewed patch package only if propagation tests show missing behavior.

**Interfaces:** Row inputs hold File[] only in memory. Saved progress stores expected file names/sizes/hashes, never File JSON. Restore preserves financial signature and prompts to reselect missing bytes. Historical submit invokes Task2 with paymentId and current supplier/sheet.

- [ ] Write tests for file selection on new and historical rows, paid values never editable, new files carried into post, restore requiring matching bytes, partial three-target upload retry, and post-settlement propagation; observe RED.
- [ ] Implement row file controls and visible per-row status, safe reselection during retry and end-to-end attachment propagation using confirmed IDs.
- [ ] Run focused tests plus pnpm test, guard:signature-gestures, build, build:pwa, ios:verify and secrets:verify; all task cases pass, document any infrastructure failures and repeat isolated without masking assertions.
- [ ] Whole-branch independent review and browser QA with read-only fixtures, then commit, PR, merge and publish validated SHA. Verify Pages loaded bundle, Play internal receipt and TestFlight processed/group-attached receipt. Never create real payroll records for QA.
