# Registration Gallery Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Access the four existing supply registration galleries from a gray shortcut beside Efetuar Cadastros.
**Architecture:** Client-side chooser, existing gallery controller/data routes, shared menu lifecycle with Imobilizados.
**Tech Stack:** JavaScript, native DOM, Node tests, JSDOM, Vite, existing real Chrome layout runner.
**Spec:** docs/superpowers/specs/2026-11-02-registration-gallery-hub-design.md

## Global Constraints
- User opted out of questions/approval; use existing isolated worktree and publish validated change to web/Windows, Play internal and TestFlight.
- Preserve protected signature blocks; no business-data writes during verification.
- Four choices only: Grupo, Família, Subfamília, Produto. Existing direct access remains valid.

## Review Focus
- Stale menu/gallery factories after navigation or sign-out must not reopen overlays.
- Back from each child must return to this chooser, with direct access preserving its original behavior.
- Double taps create only one menu/child and make no remote chat request.
- Missing/duplicate server menu options cannot produce duplicate shortcuts or unrelated placement.
- At 320 px both paired buttons and all menu choices remain readable, gray and within the viewport.

### Task 1: Supply registration chooser and routing
**Files:** UI chat-view, controller, shared gallery-menu, asset wrapper, registration wrapper, shared menu stylesheet; registration-gallery-menu tests/fixture and existing chat/asset tests.
**Interfaces:** consumes existing registration gallery kinds group/family/subfamily/product and existing reply IDs; produces action_registration_hub with kind registrationMenu and child onBack handlers.
- [ ] Write behavior tests for the shortcut, local menu, all four child routes, return and session/navigation races; run RED.
- [ ] Implement the shortcut and shared chooser using existing gallery routes; run focused chat/asset/registration tests GREEN.
- [ ] Verify real browser layout and click behavior at 320/390/desktop, signature guard and app/PWA builds.
- [ ] Obtain independent whole-branch review, commit, merge and verify exact public assets, Play internal publication and Apple processed/group-attached build for this revision.
