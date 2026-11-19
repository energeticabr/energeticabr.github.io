# Gallery latest filters implementation plan

**Goal:** Cancel superseded launch gallery reads immediately and render only the final filters across web, Android and iOS.

**Architecture:** Existing local-filter galleries already cancel replaced snapshot reads and filter their loaded rows using current controls. The launch gallery sends filters to the server but only discards outdated responses. Add an immediate filter-change callback to the existing auto-filter binding, abort the launch snapshot through the existing client signal contract, and retain version checks for non-cooperative responses.

**Tech stack:** JavaScript, AbortController, node:test, jsdom, Vite, Capacitor.

**Constraints:** Preserve signature gesture locks; preserve typing delay, editable search and filter controls, pagination and loading feedback. Do not cancel mutations or unrelated consumers.

## Implementation and verification

- [ ] Add regression tests for immediate cancellation during typing, coalescing final filters, supersession, stale success/error/progress, invalid dates and close/destroy.
- [ ] Run the tests and confirm failure on missing cancellation.
- [ ] Extend `src/ui/auto-filter-form.js` with optional `onPendingChange`, excluding picker search text and duplicate events.
- [ ] In `src/ui/launch-gallery-view.js`, abort superseded snapshot reads, propagate signal to progress and transport, invalidate cancelled applications, and guard results regardless of loading mode.
- [ ] Run gallery and shared-filter regressions, full app test command, gesture guard and web/native builds. Review diff for lifecycle and race conditions.
- [ ] Commit, integrate and verify actual web, Google Play internal and TestFlight distribution.
