# Single PDF attachment icon implementation plan

**Goal:** Show one shared illustrated PDF icon per provision or description, opening all of that record's attachments in order through the existing collection viewer.

**Architecture:** Reuse `PDF_ATTACHMENT_ICON` for summary and expanded rows. Pass the complete attachment collection to the existing viewer, which already supplies previous/next controls. Keep empty, loading, retry, cancellation and record ownership behavior.

**Tech stack:** JavaScript, existing SVG, Node test runner, Chromium/WebKit, Capacitor release workflows.

**Spec:** User's two reference images and request in this conversation. Execution and publishing are already authorized.

## Task 1: Unify provision attachment controls

- [ ] Update the record-ownership test to require one SVG control and every file in each collection; run and observe failure.
- [ ] Replace expanded per-file text controls with the shared icon; always open the complete collection. Remove obsolete per-file CSS.
- [ ] Update the browser fixture to include multiple PDFs and assert one illustrated icon per expanded record.
- [ ] Run focused report/preview tests, signature guard, builds, and Chromium/WebKit visual checks.

## Task 2: Review and publish

- [ ] Review diff and verify no unrelated changes or protected signature blocks.
- [ ] Commit, create and merge PR after checks. Verify web deployment, Android internal publishing and iOS TestFlight for the merged revision.

## Review focus

Files must stay with their own record; multiple PDFs must reach the viewer in order; single-file rows still open; empty cells stay blank; read errors remain retryable.
