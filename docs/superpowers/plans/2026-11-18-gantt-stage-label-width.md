# Gantt stage label width

Remove the branch subtitle beneath stage names. Retain the branch selector, detail context, accessible branch identity and activity property/responsible information. Increase the sticky label column modestly from 180–230px / 27vw to 220–280px / 32 logical viewport units, leaving the timeline horizontally scrollable.

Execute without approval questions per the user's instructions. Reuse the isolated worktree on fix/gantt-stage-label-width. Preserve signature locks, chronological order, horizontal date ranges and cost/profession navigation.

- [x] Update existing DOM/layout regression expectations and verify failure on old behavior.
- [x] Implement the two scoped view/style changes; run focused tests, builds, guard and responsive Chromium/WebKit inspection; fresh review.
- [ ] Integrate and verify publication on PC/web, Play internal and TestFlight. Existing release workflows run the complete suites before distribution; avoid duplicate or stale releases and preserve other active work.

Validation: old code failed subtitle and width checks. All 29 focused Gantt/landscape tests now pass. Chromium/WebKit at 320/390/844/1365 show 237/270/270/280px columns, no stage subtitles and at least 300px visible timeline. Screenshots with the previously read Xavante snapshot were inspected. Native/PWA builds, iOS project, secrets and signature14 pass. Fresh reviewer found no actionable findings and independently passed three Gantt view tests and signature14.
