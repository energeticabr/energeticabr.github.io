# Home attendance summary implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Add the supplied mascot as the second HOME shortcut on the right, opening the supplied attendance summary.
**Architecture:** Independent read-only report with SharePoint DESCRITIVOPRESENCA and FORNECEDORES data. Reuse RH normalization, searchable selects and landscape overlay conventions. Preserve the first-right cargos shortcut and five left shortcuts.
**Tech Stack:** JavaScript, Decimal, DOM, Graph repository, node:test/JSDOM, Vite.
**Spec:** Latest user request, attached mascot/screenshot and full PowerFx at C:/Users/Bernardonotini/.codex/attachments/e5038144-5246-4fc6-af4e-35f0b5a49295/Texto colado.txt.

## Global Constraints

- Second right shortcut: below cargos, outside HOME card. Exact supplied bitmap, no additional inner frame.
- Read-only: never submit attendance or payments. No 2,000-record truncation.
- Filters in one compact row: period dd/mm/yyyy, filial, status fornecedor (ATIVO initially), fornecedor, presença.
- Initial dates today minus 14 days through today as PowerFx; clearing either permits an open-ended range.
- Landscape warning in portrait; full-height landscape dialog; outside click/Escape closes and restores focus.
- Four metrics, profession/provider cards and descending date/branch detail with payment badges and duplicate highlights as supplied PowerFx.
- Missing/invalid financial data cannot become a false zero; partial/error/aborted loads cannot display totals.
- Native Android/iOS and Windows PWA style imports; signature blocks remain untouched.

## Review Focus

- Duplicate supplier names/status conflicts cannot grant active eligibility incorrectly.
- Unknown money cannot be silently zeroed.
- Date typing errors and reversed ranges must not show stale totals.
- Account changes, closure and rotation must cancel stale responses.
- Narrow landscape screens retain inline filters and full-width tables.

### Task 1: Read-only data and PowerFx calculations

**Files:** src/chat/attendance-summary-model.js, src/chat/attendance-summary-data.js and matching tests under apps/energetico-mobile.
**Interfaces:** createAttendanceSummaryData({tokenProvider,repository}).loadSnapshot({signal}); buildAttendanceSummary(snapshot,filters) returns {rows,summary:{pending,present,absent,total},professions:[{name,emoji,tone,recordCount,professionalCount,providers:[{name,tone,recordCount,present,pending,financial}],financial}],days:[{date,weekday,weekend,branches:[{branch,pending, present,absent,professions,total}]}]}. Financial fields pendingApproval,approvedPayment,paid,total. Daily category arrays contain {name,count,paymentBadges} and profession arrays {name,emoji,count}.

- [x] RED: tests exact counts/sums, absent exclusion from profession cards, paid precedence, duplicates, active/inactive/unknown supplier status, missing amounts, open dates, pagination/abort/schema failures.
- [x] GREEN: normalize with existing RH functions; complete traversal with repository windows max100 and finite overall guard; reject corrupt pages, duplicate IDs and cycles; filter supplier statuses by registry.
- [x] Verify: node --test matching model/data files => no failures.

### Task 2: Session/controller integration

**Files:** src/app-controller.js and tests/attendance-summary-controller.test.mjs.
**Interfaces:** createAttendanceSummaryReportView({data,document}).open/close/destroy; injected attendanceSummaryFactory and attendanceSummaryDataFactory. Action open-attendance-summary; reply action_attendance_summary.

- [x] RED: real controller tests for action/resume, authenticated token scopes, single open, stale account/logout and busy-flow guards.
- [x] GREEN: lazy factories, per-session cleanup, abort-aware token retrieval, latest request generation.
- [x] Verify: node --test tests/attendance-summary-controller.test.mjs => no failures.

### Task 3: Home/UI and cross-platform verification

**Files:** src/ui/attendance-summary-view.js, src/ui/attendance-summary.css, src/ui/chat-view.js, src/styles.css, src/main.js, src/web/main.js, tests/attendance-summary-view.test.mjs, tests/chat-view.test.mjs, tests/fixtures/home-provisions-mascot.html, tests/home-provisions-mascot-browser.test.mjs, assets/report-mascots/attendance-summary.png.
**Interfaces:** consumes Tasks 1/2 interfaces verbatim.

- [x] RED: real DOM report tests of metrics/cards/daily cells/filters/XSS/error/orientation/focus. HOME action click opens only the new report, existing mascots remain.
- [x] GREEN: implement compact report using DOM textContent and existing searchable-select adapter; supplied asset copied unchanged.
- [x] Verify: focused tests, pnpm test, native/PWA build, signature guard, ios:verify and secrets:verify; browser portrait/landscape/desktop screenshots.
- [x] Review complete diff independently; fix important findings with regression tests.
- [ ] Commit, PR, merge when required checks pass, publish Android internal/iOS TestFlight/Windows PWA; only report publication backed by successful logs.
