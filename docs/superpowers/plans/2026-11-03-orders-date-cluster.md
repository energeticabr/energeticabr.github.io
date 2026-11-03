# Order date cluster

**Goal:** Show DATA PEDIDO to the left of the pencil in each orders gallery card, below the supplier name.

**Design:** Use the existing heading grid and a compact blue date cluster. Keep the supplier across the full available heading width; place status/date on the next row and the existing launch cue below. At narrow widths, reserve the action buttons' horizontal space only for the date cluster. Read DATAPEDIDO / DATA PEDIDO; an absent date is an em dash.

**Scope:** `orders-gallery-view.js`, `orders-gallery.css`; no record writes or changes to sorting/filtering. Preserve long-name wrapping, attachment rail, pencil/delete actions and linked launches. Keep signature gesture locks intact.

**Execution:** Inline under the user's standing authorization, with test-driven development and independent review.

- [ ] Add failing date-source/empty-state unit tests and real browser geometry checks in `orders-gallery-view.test.mjs` / `orders-order-date-browser.test.mjs`.
- [ ] Add fictitious dated/undated cases to `tests/fixtures/orders-gallery-responsive.html`.
- [ ] Implement the cluster using existing `formatDate` and grid rows below the supplier in `src/ui/orders-gallery-view.js` / `src/ui/orders-gallery.css`.
- [ ] Verify source date vs payment/creation date, no name/date/action collisions, no overflow, short and long suppliers at 320/390/768/1024/1365px, and inspect screenshots.
- [ ] Run signature guard, focused gallery tests, full tests and native/PWA builds.
- [ ] Obtain independent review, commit and merge.
- [ ] Verify published web/Windows assets, Android internal publication and processed/attached TestFlight build for the same revision.
