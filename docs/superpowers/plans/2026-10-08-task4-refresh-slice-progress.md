# Task 4 refresh slice handoff

Plan: docs/superpowers/plans/2026-10-08-pending-app-requests.md
Spec: docs/superpowers/specs/2026-10-08-pending-app-requests.md

Independent slice complete. Main owns launch wiring and integrated validation/publication.

## Exact shared interface

```js
import { attachGalleryRefreshButton } from './gallery-refresh.js';
const refreshShortcut = attachGalleryRefreshButton({
  document, root, container, onRefresh, isAvailable, button // button optional
});
// Returns { button: HTMLButtonElement, sync: () => void, destroy: () => void }.
```

The action is independent of onCreate. Its callback can be synchronous or return a Promise; callbacks normally use the existing loader's visible error feedback. Unexpected callback failures get a local alert. Repeated pending clicks, synthetic clicks while unavailable, visible editors/dialogs, busy roots and inert/hidden ancestors are blocked. Destroy removes the listener and observer and disables the button. Removed roots are not updated by late callback results; closing/reopening does not surface an old callback error.

## Changes owned by this slice

- Added src/ui/gallery-refresh.js and refresh styling in gallery-create-shortcut.css.
- Wired orders, tasks, registration, HR payroll, recurring expenses and payment programming views only.
- Reused the registration, recurring and programming buttons, moved them above collapsed filters, and removed their old click listeners.
- Manual refresh uses refresh:true with existing loaders. Selection values survive disappearing options or registration catalog errors. Search, dates, sort and page-size controls are retained.
- HR retains a valid current page/cursor; invalid cursor or an empty refreshed later page falls back once to page one. A pending search debounce is consumed before refresh so a cached filter request cannot supersede the forced read.
- Mutation guards persist across closing/reopening; loaders and catalog responses ignore detached UI and old gallery sessions.
- Toolbar retains the existing search/Filters/+ row; refresh occupies a second row, with 46px height and no horizontal overflow.
- Updated only the refresh-related Tab expectation in tests/registration-gallery.test.mjs: Filters -> visible refresh -> first record action.
- Added gallery-refresh.test.mjs, gallery-refresh-helper.test.mjs, gallery-refresh-live-layout.test.mjs, helpers/gallery-refresh-cases.mjs and fixtures/gallery-refresh-responsive.html.

## TDD evidence

Initial RED: 40 real-DOM gallery tests failed on missing/hidden/old refresh controls; seven helper tests failed on the missing API; the browser fixture failed at 320px on missing Tasks refresh. Minimal implementation then produced GREEN.

Further RED -> GREEN: eight detached-loader cases; four HR cursor/page fallback cases; stale helper rejection after close/reopen; failed/detached registration catalog cases; two pending HR search-debounce cases. Tests use synthetic rows and injected read services, with no real financial records.

## Final verification

407/407 focused functional/regression tests passed, no skips:

```sh
node --test --test-concurrency=2 tests/gallery-refresh.test.mjs tests/gallery-refresh-helper.test.mjs tests/orders-gallery-view.test.mjs tests/tasks-gallery-view.test.mjs tests/registration-gallery.test.mjs tests/hr-payroll-gallery-view.test.mjs tests/recurring-expenses-gallery-view.test.mjs tests/payment-programming-gallery-view.test.mjs tests/gallery-create-shortcuts.test.mjs tests/gallery-create-async.test.mjs tests/gallery-controls-integration.test.mjs tests/gallery-attachment-counts.test.mjs tests/gallery-record-actions.test.mjs tests/registration-gallery-filter-data.test.mjs tests/registration-gallery-repository-integration.test.mjs tests/delegated-tasks-gallery.test.mjs tests/recurring-tasks-gallery.test.mjs
```

2/2 browser layout regressions passed, no skips:

```sh
node --test --test-concurrency=1 tests/gallery-refresh-live-layout.test.mjs tests/gallery-create-live-layout.test.mjs
```

Refresh layout measures all 26 non-launch gallery variants with filters collapsed/expanded at 320, 390, 1024 and 1365px. Existing creation layout regression also covers launch and 844px landscape.

Signature guard: 14 blocks intact. Scoped git diff --check: clean.

Ruling: no full suite, build, commit, publication, agent dispatch or master-ledger updates in this independent slice, per the explicit task scope. Main performs integration, review and release. No edits to launch-gallery-view.js, app-controller.js, gallery-record-actions.css, tasks-gallery.css, payroll data or media files.

Helper ownership released to main at handoff.
