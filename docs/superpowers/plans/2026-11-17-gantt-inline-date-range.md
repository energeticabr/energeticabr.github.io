# Gantt inline date range

**Goal:** Below-bar endpoints stay on one horizontal line: green start, dash, red end. Ongoing bars show only Em andamento at the end, while duration and range calculations remain unchanged.

**Approach:** Keep direct absolute labels and existing ResizeObserver lifecycle. Add an initially invisible measurable dash. Below the bar, position the dash and end after the start without overlap; reserve one label row and enough trailing scroll space for the entire range. Keep inside endpoints and the dash hidden when all three labels fit inside.

**Execution:** The user requests immediate implementation and publication without approval questions. Reuse the current isolated worktree on fix/gantt-inline-date-range. No data changes or signature edits.

- [x] Update existing unit/browser expectations first and verify failure on the old layout/copy.
- [x] Implement label copy, horizontal positioning, one-row spacing and scroll gutter. Preserve chronology, cost/profession navigation and duration placement.
- [x] Run focused regressions, native/PWA builds, signature and repository checks. Inspect Chromium/WebKit in 320/390/844/1365 plus resize and larger fonts. Fresh code review.
- [ ] Publish the exact integrated revision through existing workflows; their complete suites gate publication. Verify served web assets, Play internal receipt/AAB and TestFlight readiness/group/artifact.

Validation: all 29 focused Gantt/landscape tests passed; eight Chromium/WebKit viewport combinations passed, including resize, 24px root font, final-day gutter and detail click. Native/PWA builds, iOS project, secrets and 14-block signature guard passed. Fresh reviewer found no actionable findings and independently reran four unit/browser tests and the signature guard. The existing publication workflows run the complete suites on the final revision.
