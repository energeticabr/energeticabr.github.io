# Order date in the orders editor

> Execution: inline, as authorized by the user. Use executing-plans and test-driven-development.

**Goal:** Replace DATAPGTOEFETUADO with DATA PEDIDO in the notas-pendentes edit form and preselect the saved DATAPEDIDO.

**Architecture:** Override the edit field declaration in the shared UI contract, using the actual DATAPEDIDO metadata. Keep the original record intact and persist only changes. The approval date validation must follow the editable order date so it cannot require a field removed from the screen.

**Tech Stack:** JavaScript, Node test runner, JSDOM, Vite, Capacitor.

**Spec:** User clarification on 2026-11-03: substitute the payment date field with order date in the orders edit screen.

## Constraints and review focus

- Preserve payment dates in stored records; no data migration.
- Scope the field replacement to notas-pendentes edit mode, all applicable variants.
- Saved ISO dates must preselect without changing the calendar day.
- Empty dates stay empty; no implicit current-date default on edit.
- Date-only and datetime controls elsewhere retain existing behavior.
- Preserve ETags, review confirmation, attachments and signature gesture blocks.
- Verify web/Windows, Android internal, and iOS TestFlight publication separately.

## Task 1: Correct the editable field and date validation

- [x] Add regression cases for contract variants, saved date preselection, unchanged save, changed DATAPEDIDO-only save, cleared date and approval validation.
- [x] Run focused tests and confirm failure before implementation.
- [x] Update `portal/catalog/powerapps-ui-contract.js` edit declarations and `apps/energetico-mobile/src/chat/orders-form43-locks.js` approval date validation.
- [x] Run focused date/gallery/approval tests, full app and portal suites, signature guard and both Vite builds.
- [x] Review the diff and verify live record 452 read-only against the corrected editor.
- [ ] Commit, push, merge and follow publication workflows to each final target.

## Validation evidence

- 53 focused tests pass; independent code review approved.
- 74 date fields across 30 entities preselect saved ISO dates and retain blanks correctly.
- Native/PWA builds pass; 14 signature blocks intact.
- Full root suite: 9,849 tests, 9,837 pass, 10 skipped. The home diary fixture measurement failed once and its isolated retry passed; the old contract parity expectation was updated for the requested field substitution and its 48 runnable tests pass.
- Independent review approved the parity fixture adjustment without weakening closed-control checks.
