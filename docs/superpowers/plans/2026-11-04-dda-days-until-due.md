# DDA days until due implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement and verify this small change in the isolated worktree. The user explicitly authorized implementation and publication without approval questions.

**Goal:** Show a compact days-until-due cluster below the due date in the DDA report from the supplied screenshot.

**Architecture:** Reuse the report's normalized calendar dates, its existing UTC day-difference helper and São Paulo today key. Inherit the existing due-date tone and strengthen the badge contrast using solid color, white text and a border. No bank status or financial data changes.

**Tech stack:** Existing JavaScript DOM renderer, CSS, node:test/JSDOM and Chrome layout runner.

**Spec:** User request in this conversation: today is `0 d`; tomorrow `1 d`; yesterday `-1 d`. Keep existing due-column colors and improve visibility.

## Global constraints

- Preserve existing date colors: today red, tomorrow orange, other dates green, missing dates neutral.
- Preserve signature gesture blocks and existing report interactions.
- Publish and independently verify web/Windows, Android internal and iOS TestFlight.

## Review focus

- São Paulo date near UTC midnight must match existing due tone.
- Month/year/leap-day changes use calendar day distance, independent of hours.
- Invalid/missing due dates must not display a fabricated number.
- The badge must remain below the date and inside its cell at 320/390px and desktop.
- Print must retain the indicator and colors without changing data.

### Task 1: Render and validate the due-day cluster

**Files:** `apps/energetico-mobile/src/ui/dda-report-view.js`, `src/ui/dda-report.css`, `tests/dda-report-due-days.test.mjs`, `tests/dda-report-due-days-browser.test.mjs`, `tests/fixtures/dda-report-due-days.html`.

**Interfaces:** Existing `createDdaReportView({document,data,now})`; no new public API.

- [ ] Add behavioral tests for today, tomorrow, yesterday, distant dates, missing/invalid dates, midnight, month/year/leap transitions and printing.
- [ ] Run focused tests and confirm failure because the cluster is absent.
- [ ] Render the badge below a date span and reuse the existing due-tone colors with a solid contrasting badge.
- [ ] Verify behavioral tests and browser layout/color/contrast at 320/390/1365px with fictitious data.
- [ ] Run signature guard, relevant DDA tests, full suite and web/PWA builds.
- [ ] Review the complete diff, commit, create/merge PR after successful CI.
- [ ] Verify published web bundle, Play internal release and TestFlight processing/group attachment.
