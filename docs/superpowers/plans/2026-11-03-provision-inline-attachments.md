# Provision inline attachments implementation plan

> Execute inline using superpowers:executing-plans. User explicitly requests execution and publication without design approval questions.

**Goal:** Preserve the pending-provisions report position and allow attachments to be appended to the selected description, including empty descriptions.

**Architecture:** Keep the existing attachment data/upload pipeline and per-description queue. Render an inline tray below existing attachments, route gallery/files/scanner selection to that queue, and restore the report scroll after shell replacement.

**Tech Stack:** JavaScript, Capacitor native adapters, SharePoint attachments, Node test runner, jsdom, Chrome fixtures.

**Spec:** User request and attached pending-provisions screenshot in this session.

## Constraints and review focus

- Never modify signature gesture lock blocks; guard before and after.
- Preserve existing attachments and append to the exact selected description through its existing source-aware data service.
- Empty attachment state is orange and expandable; loading/error states keep consultation/retry behavior.
- Cancel clears only the staged queue; submit becomes visible only with staged files.
- Retain unsuccessful files, avoid duplicate uploads, lock mutations while submitting, and discard stale picker results after closing or session changes.
- Verify 320/390px and Windows layout, full tests/builds, then web, Play internal and TestFlight separately.

## Task 1: Regression coverage

- [ ] Update prior tests that intentionally hid uploads/disabled empty disclosures to reflect the requested behavior.
- [ ] Add tests for preserved scroll through disclosure, selecting each source into the correct row, cancel, empty-to-first-upload, and picker/submission concurrency.
- [ ] Run focused tests and observe failures for missing behavior.

## Task 2: Implementation

- [ ] Update `src/ui/chat-view.js` to show the tray, staged files, cancel/submit, and source selector; preserve report scroll on rerender.
- [ ] Update `src/app-controller.js` to allow empty disclosures/uploads, route all three pickers, clear a queue on cancel, and guard concurrent/stale operations.
- [ ] Update `src/styles.css` for the orange empty arrow and responsive tray.
- [ ] Run focused tests and browser checks; inspect screenshots with fictitious data.

## Task 3: Validate and release

- [ ] Run signature guard, full mobile tests, native and PWA builds.
- [ ] Review branch and fix material regressions.
- [ ] Push/merge the validated change and monitor web, Android internal and iOS TestFlight workflows on the resulting revision.
- [ ] Verify final assets and publication receipts separately.
