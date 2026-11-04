# Payroll assignment table

> Execute inline with superpowers:executing-plans; autonomous implementation/publication already authorized.

**Goal:** Display ID, FORNECEDOR, VALOR TOTAL in a real table in both payroll-sheet and payment-type questions. Individual assignment shows one payment; collective assignment shows all payments still affected.

**Architecture:** Dedicated escaped semantic table component in the shared app. Backend attaches scoped `payroll_assignment` metadata and readable text fallback to existing polls, preserving all reply commands and write behavior. Existing client versions keep the fallback until updated. No signature blocks or financial operations change.

**Tech stack:** JavaScript/CSS shared web/Capacitor app; Python WorkflowEngine/ChannelBridge.

- [x] RED: renderer and real-channel tests for single, collective, remaining checkpoints, totals and scope.
- [x] GREEN: component, responsive CSS and narrow backend presentation hooks; validate modes/filter/resume.
- [x] Verify 320/390px with long fictitious supplier names; focused/full app tests, builds and guards; backend presentation regressions.
- [ ] Independent review, CI, merge; publish pinned backend and web, Google Play internal and TestFlight for the same app revision; verify each target separately.

Review focus: original IDs on settlement rows; freight/decimal totals; only affected remaining rows after retry; escaping; table-only scrolling; no leaked metadata; readable old-client fallback.
