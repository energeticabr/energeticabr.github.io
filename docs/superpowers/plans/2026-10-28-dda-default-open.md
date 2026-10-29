# DDA default Em aberto implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this small change inline with one final independent review.

**Goal:** Open GALERIA DDA with Em aberto selected by default.
**Architecture:** Existing registration gallery model owns the default and fixed choices; the view resets only explicitly opted-in controls when opening.
**Tech Stack:** JavaScript, Node test runner, JSDOM, Vite, Capacitor.
**Spec:** `docs/superpowers/specs/2026-10-28-dda-default-open-design.md`.

## Global constraints

- Preserve all signature gesture lock blocks and run their guard before/after.
- Keep explicit filter choices during refresh; reset situation on reopening.
- Keep Em aberto available on empty/all-paid snapshots; no payment mutations for QA.
- Publish web/Windows, Android internal and iOS TestFlight through existing workflows.

## Review focus

Empty snapshot must not revert to Todos; user-selected Todos must survive refresh;
confirmed-paid records must leave the open list; summary metrics retain full-base
scope; other gallery defaults and the separate report remain unchanged.

## Task 1: Default situation and release

- [ ] Add regressions to `apps/energetico-mobile/tests/dda-gallery.test.mjs` for initial/default display, empty/all-paid rows, refresh choice and reopening.
- [ ] Run the focused suite and confirm failures demonstrate the missing default.
- [ ] Set model `defaultFilters`, `filterChoices` and `resetFiltersOnOpen` in `src/chat/registration-gallery-data.js`; consume the opt-in reset in `src/ui/registration-gallery-view.js`.
- [ ] Validate payment behavior under the new default, focused gallery tests and browser fixture at 320/390/Windows widths.
- [ ] Run full mobile tests, relevant builds, gesture guard and independent review; record any limitations with baseline evidence.
- [ ] Commit, create PR, verify checks, merge, and verify web/Android/iOS publication receipts.
