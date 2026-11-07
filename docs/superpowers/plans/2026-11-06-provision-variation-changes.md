# Provision variation changes implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show Dado alterado, Antes, Depois above the variation buttons, one row per changed field.

**Architecture:** Compare the current unsaved provision line with the preceding saved line. Pass scoped change_table metadata through the existing poll channel and render a dedicated three-column HTML table.

**Tech Stack:** Python workflow/bridge; JavaScript, CSS, Node test, browser layout fixtures.

**Spec:** User screenshot and request in this task. No questions or design approval, per the user's standing instruction.

## Constraints

- Keep the financial writes, navigation, attachments and signature blocks unchanged.
- No empty table; repeated edits update one row; reverting removes it.
- Dates in pt-BR, blank values as EM BRANCO; preserve long names on 320px and 390px.
- Publish the backend, Windows/web, Google Play internal and TestFlight.

## Tasks

- [ ] Add failing real-workflow and frontend tests for three columns, multiple fields, reverts, blank/date display, scope and table-before-buttons.
- [ ] Add `_provision_variation_changes` in `worker/payment_provision_flow.py`; attach metadata to the variation step and scoped delivery in workflow/bridge.
- [ ] Add `src/ui/provision-variation-changes.js`, integrate with `chat-view.js`, and add wrapping CSS; verify selections still work.
- [ ] Run focused frontend, real-backend, transport, installer and browser layout tests; build and run signature guard.
- [ ] Deploy with independent source hashes, gate/drain, backups and rollback; verify installed code and health.
- [ ] Commit, CI, merge and verify web, Android internal and TestFlight delivery.
