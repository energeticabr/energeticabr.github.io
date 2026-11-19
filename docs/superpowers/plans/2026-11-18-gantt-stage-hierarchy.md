# Gantt stage hierarchy implementation plan

> Execute inline using superpowers:executing-plans.

**Goal:** Make it clear that expanded demonstrativo etapa rows belong to the larger stage above them.

**Design:** Give child rows a pale blue horizontal fill across the label and timeline, a left inset border, and the visible text `Parte de: <stage name>` below the activity name. Keep status colors, dates, durations, finalization, detail dialogs, branch filtering and expansion unchanged. Add a matching legend entry `Trecho da etapa`. Use the actual parent passed from the expansion loop, including for undated children. The fill spans the row, not a date range, so it never implies a new schedule.

**Architecture:** Extend the existing renderer with an optional parent-stage argument and render parent text using textContent. CSS provides the hierarchy treatment without intercepting clicks. Preserve the month grid through a translucent timeline fill and an opaque sticky label.

**Tech Stack:** Shared JavaScript UI and CSS, Node tests, Chromium/WebKit visual verification.

**Spec:** Design above, based on the user's photo and request; user instructed autonomous implementation and publication.

## Global constraints

- Preserve signature gesture locks.
- Publish web/Windows PWA, Google Play internal, and TestFlight.
- No fiscal, attendance, date or payment data mutations.

## Review focus

- Long parent names must wrap inside the label on mobile.
- Undated children must still show their parent.
- Multiple stages and branches must not mix parent names.
- Horizontal scrolling must keep the hierarchy label readable and grid visible.
- Collapse, refresh, status colors and detail actions must still work.

### Task 1: Show the parent relation

**Files:** `apps/energetico-mobile/src/ui/stage-gantt-view.js`, `apps/energetico-mobile/src/ui/stage-gantt.css`, `apps/energetico-mobile/tests/stage-gantt-view.test.mjs`.

**Interfaces:** `renderRow(item, parent, parentStage = null)` consumes the parent stage only for activity rows.

- [ ] Update existing view assertions for the new parent indicator, including undated children, and run the file to observe failure.
- [ ] Add the indicator, legend, translucent row fill and inset border.
- [ ] Run the Gantt/stage-progress tests and browser layout checks; visually inspect Chromium and WebKit at 320, 390, 844 and 1365 px.
- [ ] Review, build, commit and publish the same revision in the existing three release workflows; verify each result.
