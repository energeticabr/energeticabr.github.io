# RHID Monthly Net Hours and PDF Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the RHID monthly PDF show full punch labels, no observations column, a break declaration, and net daily/monthly hours.

**Architecture:** The monthly model deducts declared breaks only from complete recorded days; it does not change the daily attendance screen. The PDF renders six columns and moves exceptional notes out of the table into full-width dated notes, preserving audit details without an observations column.

**Tech Stack:** JavaScript, Node test runner, pdf-lib, PDF.js.

**Spec:** This file's “User requirements” section, transcribed from the 2026-10-15 conversation.

## User requirements

- Replace `E`, `S`, `E2`, `S2` with `ENTRADA 1`, `SAÍDA 1`, `ENTRADA 2`, `SAÍDA 2` in generated monthly RHID PDFs.
- Remove the observations table column.
- Declare 15 minutes of morning rest/snack every day and 15 minutes of afternoon rest/snack Monday through Thursday.
- Deduct those breaks when calculating net worked hours.
- Implement, verify, and publish for web/Windows PWA, Android internal, and iOS TestFlight.

## Global Constraints

- Run `pnpm guard:signature-gestures` before mobile edits and preserve all locked gesture blocks.
- Preserve page-per-supplier, A4 bounds, signature fields, official logo and custom-period behavior.
- Keep meaningful adjustment/issue notes readable outside the removed column.
- No public App Store or production Play rollout.

## Review Focus

- Friday deducts morning only; Monday–Thursday deduct both breaks (Task 1).
- Weekend work deducts morning only, and unrecorded/incomplete days do not create negative totals (Task 1).
- A short complete shift never produces a negative daily total (Task 1).
- A 31-day month plus declaration and signatures remains one page when there are no exceptional notes (Task 2).
- Long exceptional notes continue without clipping or silently disappearing (Task 2).

---

### Task 1: Net hours in monthly model

**Files:** Modify `apps/energetico-mobile/src/chat/rhid-monthly-model.js`; test `apps/energetico-mobile/tests/rhid-monthly-model.test.mjs`.

**Interfaces:** `buildRhidMonthlyReport(...)` retains its existing report shape, with `days[].total` and `total` now net `HH:MM` strings.

- [ ] Add failing tests for Thursday, Friday, Saturday, incomplete day and a shift shorter than the applicable break.
- [ ] Run `node --test tests/rhid-monthly-model.test.mjs` and confirm assertion failures.
- [ ] Deduct 30 minutes on Monday–Thursday and 15 on Friday–Sunday from each complete day, clamped at zero; sum the net day totals.
- [ ] Run the model tests and commit the passing change.

### Task 2: PDF headers, notes and declaration

**Files:** Modify `apps/energetico-mobile/src/chat/rhid-monthly-pdf.js`; test `apps/energetico-mobile/tests/rhid-monthly-pdf.test.mjs`.

**Interfaces:** `buildRhidMonthlyPdf(report, {logoBytes})` remains unchanged; output has six columns and a declaration before the signatures.

- [ ] Add failing PDF text/layout assertions for exact headers, absence of `Observações`, dated exceptional notes, declaration, one-page 31-day month, and overflow safety.
- [ ] Run `node --test tests/rhid-monthly-pdf.test.mjs` and confirm assertion failures.
- [ ] Render six appropriately sized columns; put only exceptional notes in full-width dated rows; add the declaration with space reserved before signatures.
- [ ] Run PDF and model tests, then commit.

### Task 3: Final verification and publication

**Files:** No source edits unless verification exposes a regression.

- [ ] Run signature guard, focused tests, full tests and PWA/iOS verification; review code and visual PDF bounds.
- [ ] Request independent code review; resolve concrete findings and reverify.
- [ ] Open PR, confirm CI, merge, verify live web/Windows PWA and mobile internal distributions.
