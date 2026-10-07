# Pending Work Diaries Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan. Steps use checkbox syntax.

**Goal:** Add the fifth pink mascot on the HOME right rail for pending construction diaries.

**Architecture:** Reuse the read-only pending diary source, normalize and sort rows for this report without changing reminder ordering. Mount an isolated report modal through the existing controller, navigation and PDF decorators.

**Tech Stack:** JavaScript, DOM, Graph/SharePoint, Vite, node:test and JSDOM.

**Spec:** User's supplied PowerFx and images in the current request: DIÁRIO DE OBRAS, STATUS=PENDENTE, ID descending, first 2000, ID/DATA/FILIAL/STATUS, pending count footer.

## Global Constraints

- Keep all 14 locked signature blocks intact.
- Add the pink shortcut after supplier payroll and before orange reports; navigate only within pink.
- Use sharp transparent mascot artwork over a uniform pink CSS fill.
- No business writes; invalid/incomplete source must never appear as a successful zero count.
- Reuse print/refresh, PDF sharing and close-to-report. Include CSS in native and web entries.
- Publish the reviewed revision to web/Windows, Play internal and TestFlight.

## Review Focus

- More than 2000 pending diaries: display newest 2000 and the source's warning count, never an exact false total.
- Invalid rows, duplicate IDs and unexpected statuses: do not include non-pending rows or allow HTML injection.
- Closing/refreshing/rotating during loads: stale results must not repopulate the report.
- Account/sign-in transitions: no cross-account cache; pending action resumes once.
- Right rail offsets and last-pink navigation: no overlap or transition to orange.

### Task 1: Data, report and HOME integration

**Files:**
- Create `apps/energetico-mobile/src/chat/pending-work-diaries-report-model.js` and tests.
- Create `apps/energetico-mobile/src/ui/pending-work-diaries-report-view.js`, CSS and tests.
- Modify controller, chat view, navigation, print, auth resume, styles and both entry points.
- Create `assets/report-mascots/pending-work-diaries.png`.

**Interfaces:**
- Source: `createPendingConstructionDiaryData(...).loadSnapshot({signal}) -> {rows:[{id,date,branch,status}],count}`.
- Model: `buildPendingWorkDiariesReport(snapshot) -> {rows,pendingCount,limited,countLabel}`; keeps newest 2000 and labels the 2000 boundary `⚠️ > 2.000`.
- View: `createPendingWorkDiariesReportView({document,data}) -> {element,open,close,destroy}`.
- HOME action `open-pending-work-diaries-report`, auth action `home-pending-work-diaries-report`.

- [x] Write failing behavioral tests for model, modal lifecycle, HOME event/order, navigation and controller lifecycle.
- [x] Run focused tests, verify expected missing behavior failures.
- [x] Implement the smallest read-only report matching the supplied layout and existing lifecycle safeguards.
- [x] Run focused tests, all app tests and root portal tests; expect no failures.

**Verification:** 4505 app tests passed; 961 portal tests passed with 6 pre-existing skips. Both builds, gesture guard (14 blocks), secrets check and iOS verification passed. Fresh independent review's two Important findings were repaired with observed RED/GREEN: navigation margin and opt-in strict source validation; reminder ordering and behavior are preserved.
- [x] Run gesture guard, builds, credential/iOS validation and diff check; expect success.
- [x] Obtain independent whole-change review, repair important findings with RED/GREEN tests.
- [ ] Commit, push, PR, merge and confirm all three publication workflows on the same revision.
- [ ] Open the published app and verify pink placement, real rows/count, refresh, navigation and PDF return.
