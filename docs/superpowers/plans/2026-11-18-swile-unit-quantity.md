# Swile unit value and quantity

Goal: Below the name search, show Valor Un: (45) and Qtd: (5). Recalculate linked recharge values and totals immediately, preserving zero exclusions and individual overrides.

Architecture: Keep the existing Swile view, amountOverrides map, cent-based parsing, preview and confirmation. Derive unmodified employee amounts from the two form inputs; never rewrite overrides. Keep the meal-launch subtotals flow unchanged.

Tech stack: JavaScript DOM, CSS, node:test/JSDOM, Vite/Capacitor.

## Task 1
- [ ] Add behavior tests for both factors, individual overrides, zero, hidden employees, refresh, preview payload and invalid factors.
- [ ] Run tests before implementation, then implement controls and responsive layout in swile-view.js/swile.css.
- [ ] Run focused tests, signature guard, build/PWA and full suite. Review diff with a fresh reviewer.
- [ ] Push, integrate PR, verify Pages, Google Play internal and TestFlight for the merged revision.

Review focus: Preserve overrides across temporary directory disappearance; do not turn excluded people into linked rows; use integer cents and integer nonnegative quantities; block invalid or overflowing factors; keep meal subtotals unchanged; preserve focus while typing.
